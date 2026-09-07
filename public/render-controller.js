// M2 explicit render ownership for the family graph.
//
// One projection generation owns one geometry commit:
//   projection/cards -> named layout stages -> final connector route -> assertions -> center/anchor.
// Historical layout modules are captured as named stages by runtime-bootstrap; they no longer
// own the global layoutAndRender/loadTree chain at runtime.
(() => {
    if (window.FamilyRenderController) return;

    const viewportEl = document.getElementById('scroll-viewport');
    const canvasEl = document.getElementById('canvas');
    const cardsLayerEl = document.getElementById('cards-layer');
    const svgLayerEl = document.getElementById('svg-layer');
    if (!viewportEl || !canvasEl || !cardsLayerEl || !svgLayerEl) return;

    const layoutStages = new Map();
    const prepareStages = new Map();
    let connectorStage = null;
    let serial = 0;
    let frameId = 0;
    let pending = null;
    let runningStage = null;
    let activeContext = null;
    let capturedRafs = [];
    let prepareDepth = 0;

    const diagnostics = {
        generationsStarted: 0,
        generationsCommitted: 0,
        generationsSuperseded: 0,
        externalLayouts: 0,
        prepareRuns: 0,
        prepareLayoutRequestsSuppressed: 0,
        connectorRuns: 0,
        lastGeneration: 0,
        lastReason: '',
        lastRootId: null,
        lastStartedAt: null,
        lastCommittedAt: null,
        lastStageOrder: [],
        lastStageDurationsMs: {},
        lastPrepareOrder: [],
        lastPrepareDurationsMs: {},
        lastError: null
    };

    function orderedLayoutStages() {
        return [...layoutStages.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }

    function orderedPrepareStages() {
        return [...prepareStages.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }

    function expose() {
        window.__familyRenderControllerDiagnostics = {
            ...diagnostics,
            layoutStages: orderedLayoutStages().map(stage => ({
                name: stage.name,
                order: stage.order,
                ownsPrefix: !!stage.ownsPrefix
            })),
            prepareStages: orderedPrepareStages().map(stage => ({ name: stage.name, order: stage.order })),
            connectorStage: connectorStage?.name || null,
            pendingGeneration: pending?.id || null,
            runningStage,
            preparing: prepareDepth > 0
        };
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
        measureCards();
        buildFamilyUnits();
        assignGenerations();
        const byGen = layoutUnits();
        assignVerticalPositions(byGen);
        positionMembers();
        updateCanvasBounds();
        syncCardPositions();
    }

    function withCapturedAnimationFrames(stageName, fn) {
        const nativeRaf = window.requestAnimationFrame;
        let nextFakeId = 1;
        window.requestAnimationFrame = callback => {
            capturedRafs.push({ stageName, callback });
            return -nextFakeId++;
        };
        try {
            return fn();
        } finally {
            window.requestAnimationFrame = nativeRaf;
        }
    }

    function addDuration(context, name, duration) {
        context.stageDurations[name] = Math.round(((context.stageDurations[name] || 0) + duration) * 100) / 100;
    }

    function invokeStage(stage, context) {
        runningStage = stage.name;
        const started = performance.now();
        const value = withCapturedAnimationFrames(stage.name, () => stage.run(context));
        addDuration(context, stage.name, performance.now() - started);
        context.stageOrder.push(stage.name);
        runningStage = null;
        return value;
    }

    function runThrough(targetName = null, inheritedContext = null) {
        const stages = orderedLayoutStages();
        const targetIndex = targetName == null
            ? stages.length - 1
            : stages.findIndex(stage => stage.name === targetName);
        if (targetName != null && targetIndex < 0) throw new Error(`Unknown layout stage: ${targetName}`);

        const selected = targetIndex < 0 ? [] : stages.slice(0, targetIndex + 1);
        const isRootRun = !inheritedContext;
        const context = inheritedContext || {
            stageOrder: [],
            stageDurations: {}
        };
        const previousActive = activeContext;
        if (isRootRun) activeContext = context;

        try {
            // Feedback stages (currently lineage member-order) intentionally own execution of
            // the prefix because they may rerun it several times. Start at the last such stage,
            // then run only later deltas. Without an owner, run base geometry then each delta.
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

    function runDeferredDiagnostics() {
        // Old planar stage callbacks contain the useful planarity validator plus historical
        // connector/assert paints. Execute only the final planar callback with paint/assert
        // temporarily disabled, preserving diagnostics without creating another SVG generation.
        const planarCallbacks = capturedRafs.filter(item => item.stageName === 'planar');
        const planar = planarCallbacks.length ? planarCallbacks[planarCallbacks.length - 1] : null;
        capturedRafs = [];
        if (!planar) return;

        const savedDraw = drawSVGLines;
        const savedAssert = assertLayout;
        try {
            drawSVGLines = () => {};
            assertLayout = () => {};
            planar.callback(performance.now());
        } catch (error) {
            console.warn('Unable to run deferred planar diagnostics:', error);
        } finally {
            drawSVGLines = savedDraw;
            assertLayout = savedAssert;
        }
    }

    function selectedRootId() {
        const selected = window.FamilySelectionController?.getSelectedPersonId?.();
        if (selected) return selected;
        const card = cardsLayerEl.querySelector('.absolute-card.graph-root[data-node-id]');
        if (card?.dataset.nodeId) return card.dataset.nodeId;
        return new URL(window.location.href).searchParams.get('person') || null;
    }

    function centerRoot(rootId = selectedRootId()) {
        if (!rootId) return;
        const node = globalNodeMap?.get(rootId);
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.targetY)) return;
        viewportEl.scrollLeft = Math.max(0, node.x - viewportEl.clientWidth / 2);
        viewportEl.scrollTop = Math.max(
            0,
            node.targetY - viewportEl.clientHeight / 2 + (Number(node.cardHeight) || 0) / 2
        );
    }

    function finalConnectors() {
        if (!globalNodes?.length) {
            svgLayerEl.innerHTML = '';
            return;
        }
        if (connectorStage) connectorStage.run();
        else drawSVGLines();
        diagnostics.connectorRuns += 1;
    }

    function completeVisualCommit(options, generation, context) {
        runDeferredDiagnostics();
        finalConnectors();
        if (typeof assertLayout === 'function') assertLayout();
        window.FamilyVisualRoles?.refreshNow?.();
        window.FamilyUnionChildActions?.refresh?.();

        if (options.recenter) centerRoot(options.rootId);
        else if (options.anchor && typeof restoreAnchor === 'function') restoreAnchor(options.anchor);

        diagnostics.generationsCommitted += 1;
        diagnostics.lastGeneration = generation;
        diagnostics.lastReason = options.reason || 'render';
        diagnostics.lastRootId = options.rootId || selectedRootId();
        diagnostics.lastCommittedAt = new Date().toISOString();
        diagnostics.lastStageOrder = [...context.stageOrder];
        diagnostics.lastStageDurationsMs = { ...context.stageDurations };
        diagnostics.lastError = null;

        const detail = {
            kind: options.kind || 'layout',
            rootId: diagnostics.lastRootId,
            generation,
            reason: diagnostics.lastReason,
            stages: [...context.stageOrder]
        };
        window.dispatchEvent(new CustomEvent('family-graph-rendered', { detail }));
        // Compatibility event for feature modules; unlike the retired repair coordinator this
        // is emitted directly by the one authoritative controller commit.
        window.dispatchEvent(new CustomEvent('family-graph-render-stable', { detail }));
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
                capturedRafs = [];

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
        return schedule({
            kind: 'projection',
            rootId,
            recenter: !!recenter,
            anchor,
            reason,
            hide: true
        });
    }

    function requestLayout({ reason = 'layout-request', preserveAnchor = true } = {}) {
        const rootId = selectedRootId();
        const anchor = preserveAnchor && rootId && typeof captureAnchor === 'function'
            ? captureAnchor(rootId)
            : null;
        return schedule({
            kind: 'layout',
            rootId,
            recenter: false,
            anchor,
            reason,
            hide: false
        });
    }

    function controlledLayoutAndRender() {
        if (prepareDepth > 0) {
            diagnostics.prepareLayoutRequestsSuppressed += 1;
            expose();
            return;
        }
        void requestLayout({ reason: 'layoutAndRender' });
    }

    function installFacade() {
        layoutAndRender = controlledLayoutAndRender;
        window.layoutAndRender = controlledLayoutAndRender;
        expose();
        return controlledLayoutAndRender;
    }

    window.FamilyRenderController = Object.freeze({
        registerLayoutStage,
        registerPrepareStage,
        registerConnectorStage,
        prepare,
        renderProjection,
        requestLayout,
        centerRoot,
        installFacade,
        facade: () => controlledLayoutAndRender,
        runThrough: name => runThrough(name, activeContext),
        snapshot: () => ({ ...window.__familyRenderControllerDiagnostics })
    });

    installFacade();
})();
