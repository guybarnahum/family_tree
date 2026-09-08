// Explicit render + viewport ownership for the family graph.
// One projection generation owns one geometry commit:
// projection/cards -> layout stages -> connector -> validation -> center/anchor.
(() => {
    if (window.FamilyRenderController) return;

    const viewportEl = document.getElementById('scroll-viewport');
    const canvasEl = document.getElementById('canvas');
    const cardsLayerEl = document.getElementById('cards-layer');
    const svgLayerEl = document.getElementById('svg-layer');
    if (!viewportEl || !canvasEl || !cardsLayerEl || !svgLayerEl) return;

    const IDLE_RECENTER_MS = 30000;
    const IDLE_RECENTER_ANIMATION_MS = 900;
    const layoutStages = new Map();
    const prepareStages = new Map();
    const validationStages = new Map();
    let connectorStage = null;
    let serial = 0;
    let frameId = 0;
    let pending = null;
    let runningStage = null;
    let activeContext = null;
    let prepareDepth = 0;
    let idleTimer = 0;
    let centerFrameId = 0;
    let centerInsetX = 0;
    let centerInsetY = 0;

    const diagnostics = {
        generationsStarted: 0,
        generationsCommitted: 0,
        generationsSuperseded: 0,
        externalLayouts: 0,
        explicitLayoutRequests: 0,
        prepareRuns: 0,
        connectorRuns: 0,
        validationRuns: 0,
        viewportCommits: 0,
        rootIdentityCommits: 0,
        idleRecenters: 0,
        fallbackRecenters: 0,
        lastGeneration: 0,
        lastReason: '',
        lastRootId: null,
        lastStartedAt: null,
        lastCommittedAt: null,
        lastInteractionAt: null,
        lastIdleRecenterAt: null,
        lastViewportReason: null,
        lastStageOrder: [],
        lastStageDurationsMs: {},
        lastPrepareOrder: [],
        lastPrepareDurationsMs: {},
        lastValidationOrder: [],
        lastValidationDurationsMs: {},
        lastError: null
    };

    const ordered = map => [...map.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const orderedLayoutStages = () => ordered(layoutStages);
    const orderedPrepareStages = () => ordered(prepareStages);
    const orderedValidationStages = () => ordered(validationStages);

    function expose() {
        window.__familyRenderControllerDiagnostics = {
            ...diagnostics,
            layoutStages: orderedLayoutStages().map(stage => ({
                name: stage.name,
                order: stage.order,
                ownsPrefix: !!stage.ownsPrefix
            })),
            prepareStages: orderedPrepareStages().map(stage => ({ name: stage.name, order: stage.order })),
            validationStages: orderedValidationStages().map(stage => ({ name: stage.name, order: stage.order })),
            connectorStage: connectorStage?.name || null,
            pendingGeneration: pending?.id || null,
            runningStage,
            preparing: prepareDepth > 0,
            idleRecenterMs: IDLE_RECENTER_MS,
            centerInsetX,
            centerInsetY
        };
    }

    function syncViewportCenteringInsets() {
        const computed = window.getComputedStyle?.(viewportEl);
        const marginX = (parseFloat(computed?.marginLeft) || 0) + (parseFloat(computed?.marginRight) || 0);
        const windowWidth = Number(window.innerWidth) || 0;
        const width = windowWidth ? Math.max(0, windowWidth - marginX) : Math.max(0, Number(viewportEl.clientWidth) || 0);
        const height = Math.max(0, Number(window.innerHeight) || Number(viewportEl.clientHeight) || 0);
        centerInsetX = Math.ceil(width / 2);
        centerInsetY = Math.ceil(height / 2);
        viewportEl.style.boxSizing = 'border-box';
        viewportEl.style.paddingLeft = `${centerInsetX}px`;
        viewportEl.style.paddingRight = `${centerInsetX}px`;
        viewportEl.style.paddingTop = `${centerInsetY}px`;
        viewportEl.style.paddingBottom = `${centerInsetY}px`;
        expose();
    }

    function registerLayoutStage({ name, order, run, ownsPrefix = false }) {
        if (!name || typeof run !== 'function') throw new Error('Layout stage requires name + run');
        layoutStages.set(name, { name, order: Number(order) || 0, run, ownsPrefix: !!ownsPrefix });
        expose();
    }

    function registerPrepareStage({ name, order, run }) {
        if (!name || typeof run !== 'function') throw new Error('Prepare stage requires name + run');
        prepareStages.set(name, { name, order: Number(order) || 0, run });
        expose();
    }

    function registerValidationStage({ name, order, run }) {
        if (!name || typeof run !== 'function') throw new Error('Validation stage requires name + run');
        validationStages.set(name, { name, order: Number(order) || 0, run });
        expose();
    }

    function registerConnectorStage({ name, run }) {
        if (!name || typeof run !== 'function') throw new Error('Connector stage requires name + run');
        connectorStage = { name, run };
        expose();
    }

    async function prepare(context = {}) {
        const order = [];
        const durations = {};
        prepareDepth += 1;
        expose();
        try {
            for (const stage of orderedPrepareStages()) {
                const started = performance.now();
                await stage.run(context);
                durations[stage.name] = Math.round((performance.now() - started) * 100) / 100;
                order.push(stage.name);
            }
            diagnostics.prepareRuns += 1;
            diagnostics.lastPrepareOrder = order;
            diagnostics.lastPrepareDurationsMs = durations;
        } finally {
            prepareDepth = Math.max(0, prepareDepth - 1);
            expose();
        }
    }

    function baseGeometry() {
        if (!globalNodes?.length) {
            cardsLayerEl.innerHTML = '';
            svgLayerEl.innerHTML = '';
            return;
        }
        window.FamilyNodeFaceDecoration?.apply?.();
        measureCards();
        window.FamilyNodeFaceDecoration?.extendMeasurements?.();
        buildFamilyUnits();
        assignGenerations();
        const byGen = layoutUnits();
        assignVerticalPositions(byGen);
        positionMembers();
        updateCanvasBounds();
        syncCardPositions();
    }

    function addDuration(context, name, duration) {
        context.stageDurations[name] = Math.round(((context.stageDurations[name] || 0) + duration) * 100) / 100;
    }

    function invokeStage(stage, context) {
        runningStage = stage.name;
        const started = performance.now();
        try {
            const value = stage.run(context);
            addDuration(context, stage.name, performance.now() - started);
            context.stageOrder.push(stage.name);
            return value;
        } finally {
            runningStage = null;
        }
    }

    function runThrough(targetName = null, inheritedContext = null) {
        const stages = orderedLayoutStages();
        const targetIndex = targetName == null
            ? stages.length - 1
            : stages.findIndex(stage => stage.name === targetName);
        if (targetName != null && targetIndex < 0) throw new Error(`Unknown layout stage: ${targetName}`);

        const selected = targetIndex < 0 ? [] : stages.slice(0, targetIndex + 1);
        const isRootRun = !inheritedContext;
        const context = inheritedContext || { stageOrder: [], stageDurations: {} };
        const previousActive = activeContext;
        if (isRootRun) activeContext = context;

        try {
            let ownerIndex = -1;
            for (let i = 0; i < selected.length; i++) {
                if (selected[i].ownsPrefix) ownerIndex = i;
            }

            if (ownerIndex >= 0) {
                invokeStage(selected[ownerIndex], context);
                for (let i = ownerIndex + 1; i < selected.length; i++) invokeStage(selected[i], context);
            } else {
                runningStage = 'base-geometry';
                const started = performance.now();
                baseGeometry();
                addDuration(context, 'base-geometry', performance.now() - started);
                context.stageOrder.push('base-geometry');
                runningStage = null;
                for (const stage of selected) invokeStage(stage, context);
            }
            return context;
        } finally {
            if (isRootRun) activeContext = previousActive;
        }
    }

    function runValidation() {
        const order = [];
        const durations = {};
        for (const stage of orderedValidationStages()) {
            runningStage = `validate:${stage.name}`;
            const started = performance.now();
            try { stage.run(); }
            finally {
                durations[stage.name] = Math.round((performance.now() - started) * 100) / 100;
                order.push(stage.name);
                runningStage = null;
            }
        }
        diagnostics.validationRuns += order.length;
        diagnostics.lastValidationOrder = order;
        diagnostics.lastValidationDurationsMs = durations;
    }

    const selectedRootId = () => window.FamilySelectionController?.getSelectedPersonId?.() || null;

    function commitRootIdentity(rootId) {
        if (!rootId) return false;
        let found = false;
        for (const card of cardsLayerEl.querySelectorAll('.absolute-card[data-node-id]')) {
            const isRoot = card.dataset.nodeId === rootId;
            card.classList.toggle('graph-root', isRoot);
            if (isRoot) {
                found = true;
                card.classList.remove('graph-context', 'graph-spouse-parent', 'graph-spouse-ancestor-deep');
                card.dataset.familyVisualRole = 'root';
            }
        }
        if (found) diagnostics.rootIdentityCommits += 1;
        return found;
    }

    function finiteCenterNode(node) {
        return !!node && Number.isFinite(node.x) && Number.isFinite(node.targetY);
    }

    function fallbackCenterNode(preferredId = null) {
        const ids = [
            preferredId,
            selectedRootId(),
            diagnostics.lastRootId,
            window.FamilyGraphView?.rootId?.()
        ].filter(Boolean);
        for (const id of ids) {
            const node = globalNodeMap?.get(id);
            if (finiteCenterNode(node)) return node;
        }

        const nodes = (globalNodes || []).filter(finiteCenterNode);
        if (!nodes.length) return null;
        const centerY = node => node.targetY + (Number(node.cardHeight) || 0) / 2;
        const minX = Math.min(...nodes.map(node => node.x));
        const maxX = Math.max(...nodes.map(node => node.x));
        const minY = Math.min(...nodes.map(centerY));
        const maxY = Math.max(...nodes.map(centerY));
        const graphCenterX = (minX + maxX) / 2;
        const graphCenterY = (minY + maxY) / 2;
        return nodes.reduce((best, node) => {
            const dx = node.x - graphCenterX;
            const dy = centerY(node) - graphCenterY;
            const distance = dx * dx + dy * dy;
            return !best || distance < best.distance ? { node, distance } : best;
        }, null)?.node || nodes[0];
    }

    function cancelCenterAnimation() {
        if (centerFrameId) cancelAnimationFrame(centerFrameId);
        centerFrameId = 0;
    }

    function centerTarget(node) {
        const faceShift = Math.max(0, Number(node.cardFaceOutset) || 0) / 2;
        const nodeCenterY = node.targetY + (Number(node.cardHeight) || 0) / 2;
        return {
            left: Math.max(0, centerInsetX + node.x - faceShift - viewportEl.clientWidth / 2),
            top: Math.max(0, centerInsetY + nodeCenterY - viewportEl.clientHeight / 2),
            visual: true
        };
    }

    function moveViewport(target, animate) {
        cancelCenterAnimation();
        if (!animate || !target.visual || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
            viewportEl.scrollLeft = target.left;
            viewportEl.scrollTop = target.top;
            return;
        }

        const startLeft = viewportEl.scrollLeft;
        const startTop = viewportEl.scrollTop;
        const deltaLeft = target.left - startLeft;
        const deltaTop = target.top - startTop;
        let startedAt = null;
        const step = now => {
            if (startedAt == null) startedAt = now;
            const progress = Math.min(1, Math.max(0, (now - startedAt) / IDLE_RECENTER_ANIMATION_MS));
            const eased = progress * progress * (3 - 2 * progress);
            viewportEl.scrollLeft = startLeft + deltaLeft * eased;
            viewportEl.scrollTop = startTop + deltaTop * eased;
            if (progress < 1) centerFrameId = requestAnimationFrame(step);
            else centerFrameId = 0;
        };
        centerFrameId = requestAnimationFrame(step);
    }

    function centerRoot(rootId = selectedRootId(), { reason = 'center', animate = false } = {}) {
        syncViewportCenteringInsets();
        const node = fallbackCenterNode(rootId);
        if (!node) return false;
        if (!rootId || node.id !== rootId) diagnostics.fallbackRecenters += 1;

        moveViewport(centerTarget(node), animate);
        diagnostics.viewportCommits += 1;
        diagnostics.lastViewportReason = reason;
        expose();
        return true;
    }

    function restoreCommittedAnchor(anchor) {
        if (!anchor || typeof restoreAnchor !== 'function') return false;
        cancelCenterAnimation();
        restoreAnchor(anchor);
        diagnostics.viewportCommits += 1;
        diagnostics.lastViewportReason = 'anchor-restore';
        return true;
    }

    function finalConnectors() {
        if (!globalNodes?.length) {
            svgLayerEl.innerHTML = '';
            return;
        }
        if (!connectorStage) throw new Error('Connector stage is not registered');
        connectorStage.run();
        diagnostics.connectorRuns += 1;
    }

    function completeVisualCommit(options, generation, context) {
        const rootId = options.rootId || selectedRootId();
        finalConnectors();
        if (typeof assertLayout === 'function') assertLayout();
        runValidation();
        commitRootIdentity(rootId);
        window.FamilyVisualRoles?.refreshNow?.(rootId);
        window.FamilyUnionChildActions?.refresh?.();

        if (options.recenter) centerRoot(rootId, { reason: options.reason || 'render-recenter' });
        else if (options.anchor) restoreCommittedAnchor(options.anchor);

        diagnostics.generationsCommitted += 1;
        diagnostics.lastGeneration = generation;
        diagnostics.lastReason = options.reason || 'render';
        diagnostics.lastRootId = rootId;
        diagnostics.lastCommittedAt = new Date().toISOString();
        diagnostics.lastStageOrder = [...context.stageOrder];
        diagnostics.lastStageDurationsMs = { ...context.stageDurations };
        diagnostics.lastError = null;

        window.dispatchEvent(new CustomEvent('family-graph-rendered', {
            detail: {
                kind: options.kind || 'layout',
                rootId: diagnostics.lastRootId,
                generation,
                reason: diagnostics.lastReason,
                stages: [...context.stageOrder]
            }
        }));
    }

    function cancelPending(reason = 'superseded') {
        if (!pending) return;
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
        const previous = pending;
        pending = null;
        diagnostics.generationsSuperseded += 1;
        previous.resolve?.({ committed: false, superseded: true, reason });
        expose();
    }

    function schedule(options = {}) {
        cancelPending('newer-generation');
        const generation = ++serial;
        diagnostics.generationsStarted += 1;
        diagnostics.lastStartedAt = new Date().toISOString();
        diagnostics.lastReason = options.reason || 'render';
        diagnostics.lastRootId = options.rootId || selectedRootId();
        if (options.kind === 'layout') diagnostics.externalLayouts += 1;

        if (options.hide !== false) canvasEl.style.visibility = 'hidden';
        expose();

        return new Promise(resolve => {
            pending = { id: generation, options, resolve };
            frameId = requestAnimationFrame(() => {
                frameId = 0;
                const transaction = pending;
                if (!transaction || transaction.id !== generation) return;
                pending = null;

                try {
                    const context = runThrough(null);
                    completeVisualCommit(options, generation, context);
                    resolve({ committed: true, superseded: false, generation });
                } catch (error) {
                    diagnostics.lastError = String(error?.message || error);
                    console.error('Family render transaction failed:', error);
                    resolve({ committed: false, superseded: false, generation, error });
                } finally {
                    canvasEl.style.visibility = '';
                    runningStage = null;
                    expose();
                }
            });
        });
    }

    function renderProjection({ rootId = selectedRootId(), recenter = false, anchor = null, reason = 'projection' } = {}) {
        return schedule({ kind: 'projection', rootId, recenter: !!recenter, anchor, reason, hide: true });
    }

    function requestLayout({
        reason = 'layout-request',
        preserveAnchor = true,
        recenter = false,
        anchorId = null,
        hide = false
    } = {}) {
        const rootId = selectedRootId();
        const effectiveAnchorId = anchorId || rootId;
        const anchor = !recenter && preserveAnchor && effectiveAnchorId && typeof captureAnchor === 'function'
            ? captureAnchor(effectiveAnchorId)
            : null;
        diagnostics.explicitLayoutRequests += 1;
        expose();
        return schedule({ kind: 'layout', rootId, recenter: !!recenter, anchor, reason, hide: !!hide });
    }

    function requestRecenter({ personId = selectedRootId(), reason = 'recenter' } = {}) {
        const centered = centerRoot(personId, { reason });
        return Promise.resolve({ committed: centered, recentered: centered, reason });
    }

    function interactionBlocksIdleRecenter() {
        const active = document.activeElement;
        if (active && (active.isContentEditable || active.matches?.('input, textarea, select, [contenteditable="true"]'))) {
            return true;
        }
        return !!document.querySelector?.('#person-media-modal.open');
    }

    function scheduleIdleRecenter() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = 0;
        if (document.hidden) return;
        idleTimer = setTimeout(() => {
            idleTimer = 0;
            if (document.hidden || pending || runningStage || interactionBlocksIdleRecenter()) {
                scheduleIdleRecenter();
                return;
            }
            if (centerRoot(selectedRootId(), { reason: 'idle-recenter', animate: true })) {
                diagnostics.idleRecenters += 1;
                diagnostics.lastIdleRecenterAt = new Date().toISOString();
                expose();
            }
            scheduleIdleRecenter();
        }, IDLE_RECENTER_MS);
    }

    function noteInteraction() {
        cancelCenterAnimation();
        diagnostics.lastInteractionAt = new Date().toISOString();
        scheduleIdleRecenter();
        expose();
    }

    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin', 'input']) {
        window.addEventListener(type, noteInteraction, { capture: true, passive: type === 'wheel' || type === 'touchstart' });
    }
    viewportEl.addEventListener?.('scroll', () => {
        if (!centerFrameId) noteInteraction();
    }, { passive: true });
    document.addEventListener?.('visibilitychange', () => {
        if (document.hidden) {
            cancelCenterAnimation();
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = 0;
            return;
        }
        noteInteraction();
    });

    window.addEventListener('resize', () => {
        cancelCenterAnimation();
        syncViewportCenteringInsets();
        scheduleIdleRecenter();
        if (!globalNodes?.length) return;
        void requestLayout({ reason: 'viewport-resize', preserveAnchor: false, recenter: true });
    }, { passive: true });

    window.FamilyRenderController = Object.freeze({
        registerLayoutStage,
        registerPrepareStage,
        registerValidationStage,
        registerConnectorStage,
        prepare,
        renderProjection,
        requestLayout,
        requestGeometryRefresh: requestLayout,
        requestRecenter,
        centerRoot,
        runThrough: name => runThrough(name, activeContext),
        snapshot: () => ({ ...window.__familyRenderControllerDiagnostics })
    });

    syncViewportCenteringInsets();
    scheduleIdleRecenter();
    expose();
})();