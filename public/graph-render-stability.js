// Serialize structural graph redraws and root-selection redraws around one authoritative
// layout pass. This layer deliberately installs after the complete planar/router stack.
//
// Why it exists:
// - graph-view renders before several historical loadTree wrappers finish refreshing their
//   relationship indexes;
// - those wrappers can request corrective layouts later;
// - a newly-created person can be selected while requestAnimationFrame work from the prior
//   root is still pending.
//
// During structural loadTree() work we therefore suppress intermediate layouts, let every
// topology-aware wrapper refresh, drain stale animation frames, then run one final layout.
// Root changes are hidden until their one layout + connector frames settle, so graph-view's
// early recentering is never painted. The final visible frame is centered on the chosen root.
(() => {
    if (window.__familyGraphRenderStabilityInstalled) return;
    window.__familyGraphRenderStabilityInstalled = true;

    const viewport = document.getElementById('scroll-viewport');
    const canvas = document.getElementById('canvas');
    const cardsLayer = document.getElementById('cards-layer');
    if (!viewport || !canvas || !cardsLayer) return;

    const ROOT_STORAGE_KEY = 'family-tree.anchor-person';
    const DRAIN_FRAMES = 2;
    const SETTLE_FRAMES = 3;
    const INSTALL_RETRIES = 300;

    const style = document.createElement('style');
    style.textContent = `
        #canvas.family-render-pending {
            visibility: hidden !important;
        }
    `;
    document.head.appendChild(style);

    let installed = false;
    let authoritativeLayout = null;
    let serial = 0;
    let structural = null;
    let selection = null;
    let remoteReconcilePending = false;
    let remoteSettleInFlight = false;
    const hiddenReasons = new Set();

    const diagnostics = {
        structuralTransactions: 0,
        selectionTransactions: 0,
        remoteSettles: 0,
        suppressedLayouts: 0,
        finalLayouts: 0,
        staleTransactionsDiscarded: 0,
        lastReason: '',
        lastRootId: null,
        lastStartedAt: null,
        lastSettledAt: null,
        lastSuppressedLayouts: 0
    };

    function exposeDiagnostics() {
        window.__familyRenderStabilityDiagnostics = {
            ...diagnostics,
            structuralActive: !!structural,
            selectionActive: !!selection,
            hiddenReasons: [...hiddenReasons]
        };
    }

    function hide(reason) {
        hiddenReasons.add(reason);
        canvas.classList.add('family-render-pending');
        exposeDiagnostics();
    }

    function reveal(reason) {
        hiddenReasons.delete(reason);
        if (!hiddenReasons.size) canvas.classList.remove('family-render-pending');
        exposeDiagnostics();
    }

    function storedRootId() {
        try { return localStorage.getItem(ROOT_STORAGE_KEY); }
        catch (_) { return null; }
    }

    function persistRootId(personId) {
        if (!personId) return;
        try { localStorage.setItem(ROOT_STORAGE_KEY, personId); }
        catch (_) {}
    }

    function currentRootId() {
        const rootCard = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        if (rootCard?.dataset.nodeId) return rootCard.dataset.nodeId;
        const urlId = new URL(window.location.href).searchParams.get('person');
        return urlId || storedRootId();
    }

    function centerRoot(personId = currentRootId()) {
        if (!personId) return false;
        let node = null;
        try { node = globalNodeMap?.get(personId) || null; }
        catch (_) {}

        if (node && Number.isFinite(node.x) && Number.isFinite(node.targetY)) {
            const cardHeight = Number(node.cardHeight) || 0;
            viewport.scrollLeft = Math.max(0, node.x - viewport.clientWidth / 2);
            viewport.scrollTop = Math.max(0, node.targetY + cardHeight / 2 - viewport.clientHeight / 2);
            diagnostics.lastRootId = personId;
            persistRootId(personId);
            return true;
        }

        const card = document.getElementById(`card-${personId}`);
        if (!card) return false;
        const viewportRect = viewport.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        if (!cardRect.width || !cardRect.height) return false;
        viewport.scrollLeft = Math.max(
            0,
            viewport.scrollLeft + (cardRect.left + cardRect.width / 2) -
                (viewportRect.left + viewportRect.width / 2)
        );
        viewport.scrollTop = Math.max(
            0,
            viewport.scrollTop + (cardRect.top + cardRect.height / 2) -
                (viewportRect.top + viewportRect.height / 2)
        );
        diagnostics.lastRootId = personId;
        persistRootId(personId);
        return true;
    }

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    async function waitFrames(count, stillCurrent = () => true) {
        for (let i = 0; i < count; i++) {
            await nextFrame();
            if (!stillCurrent()) return false;
        }
        return true;
    }

    function finalConnectorDraw() {
        try {
            if (typeof drawSVGLines === 'function') drawSVGLines();
            if (typeof assertLayout === 'function') assertLayout();
        } catch (error) {
            console.warn('Unable to finalize stable graph connectors:', error);
        }
    }

    function rootFromHistoryArgs(args) {
        try {
            const raw = args[2];
            if (raw === undefined || raw === null || raw === '') return null;
            const url = new URL(String(raw), window.location.href);
            return url.searchParams.get('person');
        } catch (_) {
            return null;
        }
    }

    function cancelSelection(reason = 'superseded') {
        if (!selection) return;
        reveal(`selection:${selection.id}`);
        diagnostics.staleTransactionsDiscarded += 1;
        diagnostics.lastReason = reason;
        selection = null;
        exposeDiagnostics();
    }

    function startSelection(rootId, reason = 'root-selection') {
        if (!rootId) return null;

        // A structural transaction already owns visibility, final layout and final centering.
        // Root replacement during that transaction (for example deleting the selected person)
        // is folded into it instead of creating a competing selection generation.
        if (structural) {
            structural.pendingRootId = rootId;
            persistRootId(rootId);
            diagnostics.lastReason = `${reason}-during-structural`;
            exposeDiagnostics();
            return null;
        }

        if (selection?.rootId === rootId) return selection;
        if (selection) cancelSelection('selection-superseded');

        const transaction = {
            id: ++serial,
            rootId,
            reason,
            suppressLayouts: true,
            suppressedLayouts: 0,
            settleSerial: 0,
            startedAt: Date.now()
        };
        selection = transaction;
        diagnostics.selectionTransactions += 1;
        diagnostics.lastReason = reason;
        diagnostics.lastStartedAt = transaction.startedAt;
        persistRootId(rootId);
        hide(`selection:${transaction.id}`);
        void settleSelection(transaction);
        return transaction;
    }

    async function settleSelection(transaction) {
        const settleSerial = ++transaction.settleSerial;
        const stillCurrent = () =>
            selection === transaction &&
            transaction.settleSerial === settleSerial &&
            !structural;

        try {
            // Root replacement is synchronous, but graph-view and several refinements still
            // have queued RAF layouts from the prior generation. Drain those callers while
            // the transaction gate is closed, then invoke the complete final stack ourselves.
            if (!(await waitFrames(DRAIN_FRAMES, stillCurrent))) return;
            if (!stillCurrent() || typeof authoritativeLayout !== 'function') return;

            authoritativeLayout();
            diagnostics.finalLayouts += 1;

            if (!(await waitFrames(SETTLE_FRAMES, stillCurrent))) return;
            if (!stillCurrent()) return;

            finalConnectorDraw();
            centerRoot(transaction.rootId);
            diagnostics.lastSettledAt = Date.now();
            diagnostics.lastSuppressedLayouts = transaction.suppressedLayouts;

            window.dispatchEvent(new CustomEvent('family-graph-render-stable', {
                detail: {
                    kind: 'selection',
                    rootId: transaction.rootId,
                    transactionId: transaction.id,
                    suppressedLayouts: transaction.suppressedLayouts
                }
            }));
        } catch (error) {
            console.warn('Unable to settle root-selection render transaction:', error);
        } finally {
            if (selection === transaction) selection = null;
            reveal(`selection:${transaction.id}`);
            exposeDiagnostics();
        }
    }

    function install() {
        if (installed) return true;
        const routerReady =
            typeof loadTree === 'function' && loadTree.name === 'routerAwareLoadTree' &&
            typeof drawSVGLines === 'function' && drawSVGLines.name === 'crossingSafeDraw';
        if (!window.__familyPlanarRouterInstalled ||
            !window.__familyRevisionLayoutGuardInstalled ||
            !routerReady ||
            typeof layoutAndRender !== 'function') {
            return false;
        }

        installed = true;
        const baseLayout = layoutAndRender;
        authoritativeLayout = baseLayout.__familyRevisionLayoutBase || baseLayout;
        const baseLoadTree = loadTree;

        layoutAndRender = function stableGraphLayout(...args) {
            if (structural?.suppressLayouts) {
                structural.suppressedLayouts += 1;
                diagnostics.suppressedLayouts += 1;
                exposeDiagnostics();
                return;
            }

            if (selection?.suppressLayouts) {
                selection.suppressedLayouts += 1;
                diagnostics.suppressedLayouts += 1;
                exposeDiagnostics();
                return;
            }

            return baseLayout.apply(this, args);
        };
        window.layoutAndRender = layoutAndRender;

        loadTree = async function stableGraphLoadTree(...args) {
            // Nested calls participate in the outer transaction; only the outermost call
            // performs the authoritative final layout and reveal.
            if (structural) return baseLoadTree(...args);

            if (selection) cancelSelection('structural-superseded-selection');

            const transaction = {
                id: ++serial,
                reason: 'structural-load',
                suppressLayouts: true,
                suppressedLayouts: 0,
                pendingRootId: null,
                startedAt: Date.now()
            };
            structural = transaction;
            diagnostics.structuralTransactions += 1;
            diagnostics.lastReason = transaction.reason;
            diagnostics.lastStartedAt = transaction.startedAt;
            hide(`structural:${transaction.id}`);

            try {
                const result = await baseLoadTree(...args);

                // renderGraphView and several older refinements schedule animation-frame work.
                // Drain those frames while layouts are still suppressed. By this point every
                // loadTree wrapper has also completed its graph/index refresh.
                const current = () => structural === transaction;
                if (!(await waitFrames(DRAIN_FRAMES, current))) {
                    diagnostics.staleTransactionsDiscarded += 1;
                    return result;
                }

                // A local mutation token was designed to keep the first layout. Here every
                // caller-driven layout remains intentionally suppressed; the authoritative
                // pass below bypasses that historical guard and consumes coherent topology once.
                if (window.__familyGraphMutationLayoutToken?.kind === 'mutation') {
                    window.__familyGraphMutationLayoutToken = null;
                }

                authoritativeLayout();
                diagnostics.finalLayouts += 1;

                // Keep the transaction gate closed while callbacks produced by the final stack
                // settle. Any unrelated/stale global layout request during these frames is not
                // allowed to mutate coordinates after the authoritative generation.
                if (!(await waitFrames(SETTLE_FRAMES, current))) {
                    diagnostics.staleTransactionsDiscarded += 1;
                    return result;
                }

                finalConnectorDraw();
                const rootId = transaction.pendingRootId || currentRootId();
                if (rootId) centerRoot(rootId);
                diagnostics.lastSettledAt = Date.now();
                diagnostics.lastSuppressedLayouts = transaction.suppressedLayouts;

                window.dispatchEvent(new CustomEvent('family-graph-render-stable', {
                    detail: {
                        kind: 'structural',
                        rootId,
                        transactionId: transaction.id,
                        suppressedLayouts: transaction.suppressedLayouts
                    }
                }));
                return result;
            } finally {
                if (structural === transaction) structural = null;
                reveal(`structural:${transaction.id}`);
                exposeDiagnostics();
            }
        };
        window.loadTree = loadTree;

        // Capture root selection before graph-view starts its render. Keeping the canvas hidden
        // means its historical early center can still run internally but is never painted; the
        // transaction reveals only after final connector geometry and our root-centered scroll.
        const priorReplaceState = history.replaceState.bind(history);
        history.replaceState = function stableReplaceState(...args) {
            const previous = currentRootId();
            const next = rootFromHistoryArgs(args);
            if (next && next !== previous) startSelection(next, 'replaceState');
            const result = priorReplaceState(...args);
            if (next) persistRootId(next);
            return result;
        };

        const priorPushState = history.pushState.bind(history);
        history.pushState = function stablePushState(...args) {
            const previous = currentRootId();
            const next = rootFromHistoryArgs(args);
            if (next && next !== previous) startSelection(next, 'pushState');
            const result = priorPushState(...args);
            if (next) persistRootId(next);
            return result;
        };

        window.addEventListener('popstate', () => {
            const rootId = new URL(window.location.href).searchParams.get('person') || storedRootId();
            if (rootId) startSelection(rootId, 'popstate');
        });

        // graph-sync intentionally uses a direct graph-view loader for remote revisions. That
        // avoids historical redraw multiplication but also bypasses the refinement index refresh
        // chain. Hide that direct reconciliation, then run one cache-backed loadTree transaction
        // after it reports completion. No additional D1 graph read is required.
        window.addEventListener('family-graph-sync-metrics', event => {
            const inFlight = !!event.detail?.reconcileInFlight;
            if (inFlight && !remoteReconcilePending) {
                remoteReconcilePending = true;
                hide('remote-reconcile');
                return;
            }

            // A failed reconciliation never dispatches family-graph-synced. Once graph-sync
            // leaves its in-flight state without a settle pass having started, reveal the last
            // good cached graph instead of leaving the canvas hidden.
            if (!inFlight && remoteReconcilePending && !remoteSettleInFlight) {
                remoteReconcilePending = false;
                reveal('remote-reconcile');
                exposeDiagnostics();
            }
        });

        window.addEventListener('family-graph-synced', () => {
            if (!remoteReconcilePending || remoteSettleInFlight) return;
            remoteSettleInFlight = true;
            void (async () => {
                try {
                    await loadTree(null, false);
                    diagnostics.remoteSettles += 1;
                } catch (error) {
                    console.warn('Unable to settle remote graph reconciliation:', error);
                } finally {
                    remoteSettleInFlight = false;
                    remoteReconcilePending = false;
                    reveal('remote-reconcile');
                    exposeDiagnostics();
                }
            })();
        });

        const initialRoot = currentRootId();
        if (initialRoot) persistRootId(initialRoot);
        exposeDiagnostics();
        return true;
    }

    let attempts = 0;
    function waitForFinalLayoutStack() {
        if (install()) return;
        attempts += 1;
        if (attempts < INSTALL_RETRIES) {
            setTimeout(waitForFinalLayoutStack, 25);
        } else {
            console.warn('Graph render stability could not find the final layout/router stack');
        }
    }

    window.FamilyGraphRenderStability = Object.freeze({
        snapshot: () => ({ ...window.__familyRenderStabilityDiagnostics }),
        centerRoot: () => centerRoot(),
        storedRootId
    });

    waitForFinalLayoutStack();
})();
