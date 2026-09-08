// Explicit render + viewport ownership for the family graph.
//
// One projection generation owns one geometry commit:
//   projection/cards -> named layout stages -> final connector route -> validation -> center/anchor.
(() => {
    if (window.FamilyRenderController) return;

    const viewportEl = document.getElementById('scroll-viewport');
    const canvasEl = document.getElementById('canvas');
    const cardsLayerEl = document.getElementById('cards-layer');
    const svgLayerEl = document.getElementById('svg-layer');
    if (!viewportEl || !canvasEl || !cardsLayerEl || !svgLayerEl) return;

    const nativeRestoreAnchor = typeof restoreAnchor === 'function' ? restoreAnchor : null;
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

    const diagnostics = {
        generationsStarted: 0,
        generationsCommitted: 0,
        generationsSuperseded: 0,
        externalLayouts: 0,
        explicitLayoutRequests: 0,
        legacyLayoutRequestsIgnored: 0,
        legacyViewportRequestsIgnored: 0,
        prepareRuns: 0,
        prepareLayoutRequestsSuppressed: 0,
        connectorRuns: 0,
        validationRuns: 0,
        viewportCommits: 0,
        rootIdentityCommits: 0,
        lastGeneration: 0,
        lastReason: '',
        lastRootId: null,
        lastStartedAt: null,
        lastCommittedAt: null,
        lastStageOrder: [],
        lastStageDurationsMs: {},
        lastPrepareOrder: [],
        lastPrepareDurationsMs: {},
        lastValidationOrder: [],
        lastValidationDurationsMs: {},
        lastError: null
    };

    function ordered(map) {
        return [...map.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }

    function orderedLayoutStages() { return ordered(layoutStages); }
    function orderedPrepareStages() { return ordered(prepareStages); }
    function orderedValidationStages() { return ordered(validationStages); }

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
        measureCards();
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

    function selectedRootId() {
        return window.FamilySelectionController?.getSelectedPersonId?.() || null;
    }

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

    function centerRoot(rootId = selectedRootId()) {
        if (!rootId) return false;
        const node = globalNodeMap?.get(rootId);
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.targetY)) return false;
        viewportEl.scrollLeft = Math.max(0, node.x - viewportEl.clientWidth / 2);
        viewportEl.scrollTop = Math.max(
            0,
            node.targetY - viewportEl.clientHeight / 2 + (Number(node.cardHeight) || 0) / 2
        );
        diagnostics.viewportCommits += 1;
        return true;
    }

    function restoreCommittedAnchor(anchor) {
        if (!anchor || typeof nativeRestoreAnchor !== 'function') return false;
        nativeRestoreAnchor(anchor);
        diagnostics.viewportCommits += 1;
        return true;
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
        const rootId = options.rootId || selectedRootId();
        finalConnectors();
        if (typeof assertLayout === 'function') assertLayout();
        runValidation();
        commitRootIdentity(rootId);
        window.FamilyVisualRoles?.refreshNow?.(rootId);
        window.FamilyUnionChildActions?.refresh?.();

        if (options.recenter) centerRoot(rootId);
        else if (options.anchor) restoreCommittedAnchor(options.anchor);

        diagnostics.generationsCommitted += 1;
        diagnostics.lastGeneration = generation;
        diagnostics.lastReason = options.reason || 'render';
        diagnostics.lastRootId = rootId;
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
        return requestLayout({ reason, preserveAnchor: false, recenter: true, anchorId: personId });
    }

    // Temporary compatibility boundary for still-loaded presentation modules. These calls are
    // intentionally inert; M4-G removes the remaining callers rather than making them render.
    function controlledLayoutAndRender() {
        if (prepareDepth > 0) diagnostics.prepareLayoutRequestsSuppressed += 1;
        else diagnostics.legacyLayoutRequestsIgnored += 1;
        expose();
    }

    function controlledRestoreAnchor() {
        diagnostics.legacyViewportRequestsIgnored += 1;
        expose();
    }

    function installFacade() {
        window.layoutAndRender = controlledLayoutAndRender;
        if (typeof layoutAndRender !== 'undefined') layoutAndRender = controlledLayoutAndRender;
        if (nativeRestoreAnchor) {
            window.restoreAnchor = controlledRestoreAnchor;
            restoreAnchor = controlledRestoreAnchor;
        }
        expose();
        return controlledLayoutAndRender;
    }

    window.addEventListener('resize', () => {
        if (!globalNodes?.length) return;
        void requestLayout({ reason: 'viewport-resize', preserveAnchor: true });
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
        installFacade,
        facade: () => controlledLayoutAndRender,
        runThrough: name => runThrough(name, activeContext),
        snapshot: () => ({ ...window.__familyRenderControllerDiagnostics })
    });

    installFacade();
})();
