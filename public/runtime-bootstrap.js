// Deterministic browser bootstrap for the family graph runtime.
// M2 owns the final render pipeline explicitly: legacy algorithm modules are loaded in a
// capture harness, registered as named stages, and then relinquish global render ownership.
(() => {
    if (window.__familyRuntimeBootstrapInstalled) return;
    window.__familyRuntimeBootstrapInstalled = true;

    const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';
    // graph-view is loaded immediately before this bootstrap. Its loadTree implementation is
    // the canonical graph loader; M2 stage modules may temporarily replace it only while their
    // historical prepare wrappers are being captured.
    const directGraphLoadTree = typeof window.loadTree === 'function' ? window.loadTree : null;
    const diagnostics = {
        phase: 'installing',
        loaded: [],
        capturedStages: [],
        startedAt: new Date().toISOString(),
        graphStartedAt: null,
        syncStartedAt: null,
        readyAt: null,
        error: null
    };

    function expose() {
        window.__familyRuntimeBootstrapDiagnostics = {
            ...diagnostics,
            loaded: [...diagnostics.loaded],
            capturedStages: [...diagnostics.capturedStages]
        };
    }

    function scriptSelector(dataKey) {
        return `script[${dataKey}]`;
    }

    function loadScript(src, dataKey) {
        const existing = document.querySelector(scriptSelector(dataKey));
        if (existing && existing.dataset.familyBootstrapLoaded === 'true') return Promise.resolve(existing);
        if (existing?.src) {
            return new Promise((resolve, reject) => {
                let settled = false;
                const done = () => {
                    if (settled) return;
                    settled = true;
                    existing.dataset.familyBootstrapLoaded = 'true';
                    if (!diagnostics.loaded.includes(src)) diagnostics.loaded.push(src);
                    expose();
                    resolve(existing);
                };
                existing.addEventListener('load', done, { once: true });
                existing.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
                queueMicrotask(() => {
                    if (existing.dataset.familyBootstrapLoaded === 'true' ||
                        existing.readyState === 'complete' || existing.readyState === 'loaded') done();
                });
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${src}?v=${encodeURIComponent(build)}`;
            script.setAttribute(dataKey, 'true');
            script.async = false;
            script.addEventListener('load', () => {
                script.dataset.familyBootstrapLoaded = 'true';
                diagnostics.loaded.push(src);
                expose();
                resolve(script);
            }, { once: true });
            script.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
            document.body.appendChild(script);
        });
    }

    function waitFor(predicate, label, timeoutMs = 12000) {
        const started = performance.now();
        return new Promise((resolve, reject) => {
            const check = () => {
                let ready = false;
                try { ready = !!predicate(); } catch (_) {}
                if (ready) return resolve();
                if (performance.now() - started >= timeoutMs) {
                    return reject(new Error(`Timed out waiting for ${label}`));
                }
                setTimeout(check, 20);
            };
            check();
        });
    }

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    async function settleFrames(count) {
        for (let i = 0; i < count; i++) await nextFrame();
    }

    function setLayout(fn) {
        layoutAndRender = fn;
        window.layoutAndRender = fn;
    }

    function setLoadTree(fn) {
        loadTree = fn;
        window.loadTree = fn;
    }

    async function noOpLoadTree() {}
    function noOpLayoutAndRender() {}
    function lineageAwareLayoutAndRender() {}
    function crossingSafeLayoutAndRender() {
        return window.FamilyRenderController?.runThrough?.('planar');
    }

    async function captureLegacyModule({
        src,
        dataKey,
        layoutBase = null,
        loadBase = noOpLoadTree,
        expectedLayoutName = null,
        expectedLoadName = null,
        ready = null
    }) {
        const controller = window.FamilyRenderController;
        if (!controller) throw new Error('RenderController must be installed before stage capture');

        if (layoutBase) setLayout(layoutBase);
        if (loadBase) setLoadTree(loadBase);

        try {
            await loadScript(src, dataKey);
            if (ready) await waitFor(ready, `${src} readiness`);
            if (expectedLayoutName) {
                await waitFor(
                    () => typeof layoutAndRender === 'function' && layoutAndRender.name === expectedLayoutName,
                    `${src} layout capture`
                );
            }
            if (expectedLoadName) {
                await waitFor(
                    () => typeof loadTree === 'function' && loadTree.name === expectedLoadName,
                    `${src} prepare capture`
                );
            }

            return {
                layout: typeof layoutAndRender === 'function' ? layoutAndRender : null,
                prepare: typeof loadTree === 'function' && loadTree !== loadBase ? loadTree : null,
                connector: typeof drawSVGLines === 'function' ? drawSVGLines : null
            };
        } finally {
            if (directGraphLoadTree) setLoadTree(directGraphLoadTree);
            controller.installFacade();
        }
    }

    function registerPrepare(name, order, fn) {
        if (typeof fn !== 'function') return;
        window.FamilyRenderController.registerPrepareStage({
            name,
            order,
            run: context => fn(context?.anchorId || null, false)
        });
    }

    async function loadMobileStack() {
        // mobile-refinement historically self-loaded presentation + multi-partner. Temporary
        // marker scripts suppress those nested loaders so runtime-bootstrap owns exact order.
        const presentationSentinel = document.createElement('script');
        presentationSentinel.setAttribute('data-family-presentation', 'bootstrap-sentinel');
        const multiPartnerSentinel = document.createElement('script');
        multiPartnerSentinel.setAttribute('data-family-multi-partner', 'bootstrap-sentinel');
        document.body.appendChild(presentationSentinel);
        document.body.appendChild(multiPartnerSentinel);
        try {
            await loadScript('/mobile-refinement.js', 'data-family-mobile');
        } finally {
            presentationSentinel.remove();
            multiPartnerSentinel.remove();
        }
        await loadScript('/presentation-refinement.js', 'data-family-presentation');
    }

    async function installFeatureStack() {
        await loadScript('/selection-controller.js', 'data-family-selection-controller');
        await loadScript('/render-controller.js', 'data-family-render-controller');
        window.FamilySelectionController?.restoreSelection?.();

        await loadScript('/import-export.js', 'data-family-import-export');
        await loadScript('/interaction-refinement.js', 'data-family-interaction');
        await loadMobileStack();

        const features = [
            ['/person-metadata.js', 'data-family-person-metadata'],
            ['/person-pane.js', 'data-family-person-pane'],
            ['/new-person-focus.js', 'data-family-new-person-focus'],
            ['/place-autocomplete.js', 'data-family-place-autocomplete'],
            ['/pane-save-guard.js', 'data-family-pane-save-guard'],
            ['/person-media.js', 'data-family-person-media'],
            ['/face-tagging.js', 'data-family-face-tagging'],
            ['/face-tagging-ux.js', 'data-family-face-tagging-ux'],
            ['/person-picker-refresh.js', 'data-family-person-picker-refresh'],
            ['/face-primary.js', 'data-family-face-primary'],
            ['/face-open-selection.js', 'data-family-face-open-selection'],
            ['/node-face-decoration.js', 'data-family-node-face-decoration'],
            ['/node-face-footprint.js', 'data-family-node-face-footprint'],
            ['/parent-limit.js', 'data-family-parent-limit'],
            ['/union-child-actions.js', 'data-family-union-child-actions'],
            ['/person-pane-position.js', 'data-family-person-pane-position'],
            ['/mobile-chrome.js', 'data-family-mobile-chrome'],
            ['/slice-a-polish.js', 'data-family-slice-a-polish'],
            ['/slice-a-geometry.js', 'data-family-slice-a-geometry'],
            ['/print-polish.js', 'data-family-print-polish'],
            ['/print-refinement.js', 'data-family-print']
        ];
        for (const [src, dataKey] of features) await loadScript(src, dataKey);

        // Feature modules loaded during M1 may still contain historical layout wrappers. They
        // may observe controller events, but the controller is the sole global render owner.
        window.FamilyRenderController.installFacade();
    }

    async function installLayoutStack() {
        const controller = window.FamilyRenderController;

        // Multi-partner owns relationship-aware family-unit construction/positioning/card UX.
        // Capture only its graph-refresh loadTree wrapper; its lower-level geometry overrides
        // remain active and are consumed by the controller's base-geometry stage.
        const multi = await captureLegacyModule({
            src: '/multi-partner-refinement.js',
            dataKey: 'data-family-multi-partner',
            expectedLoadName: 'relationshipAwareLoadTree',
            ready: () => !!window.__familyMultiPartnerRefinement
        });
        registerPrepare('multi-partner', 10, multi.prepare);

        // Relationship compaction is a pure delta over base geometry when captured with a
        // no-op predecessor.
        const relationship = await captureLegacyModule({
            src: '/layout-refinement.js',
            dataKey: 'data-family-layout-refinement',
            layoutBase: noOpLayoutAndRender,
            loadBase: null,
            expectedLayoutName: 'layoutAndRenderWithRelationshipCompaction'
        });
        controller.registerLayoutStage({
            name: 'relationship-compaction',
            order: 20,
            run: () => relationship.layout()
        });
        diagnostics.capturedStages.push('relationship-compaction');

        await loadScript('/planar-core.js', 'data-family-planar-core');

        const planar = await captureLegacyModule({
            src: '/planar-layout.js',
            dataKey: 'data-family-planar-layout',
            layoutBase: noOpLayoutAndRender,
            expectedLayoutName: 'crossingSafeLayoutAndRender',
            expectedLoadName: 'planarAwareLoadTree',
            ready: () => !!window.__familyPlanarLayoutInstalled
        });
        controller.registerLayoutStage({
            name: 'planar',
            order: 30,
            run: () => planar.layout()
        });
        registerPrepare('planar', 30, planar.prepare);
        diagnostics.capturedStages.push('planar');

        // Member-order is the one feedback stage: its historical BASE_LAYOUT callback is now
        // an explicit call into the controller's named planar prefix. The optimizer can keep
        // its exact multi-pass behavior without owning global layoutAndRender.
        const member = await captureLegacyModule({
            src: '/member-order-refinement.js',
            dataKey: 'data-family-member-order',
            layoutBase: crossingSafeLayoutAndRender,
            expectedLayoutName: 'lineageAwareLayoutAndRender',
            expectedLoadName: 'lineageAwareLoadTree'
        });
        controller.registerLayoutStage({
            name: 'member-order',
            order: 40,
            ownsPrefix: true,
            run: () => member.layout()
        });
        registerPrepare('member-order', 40, member.prepare);
        diagnostics.capturedStages.push('member-order');

        const bridge = await captureLegacyModule({
            src: '/bridge-compaction.js',
            dataKey: 'data-family-bridge-compaction',
            layoutBase: lineageAwareLayoutAndRender,
            expectedLayoutName: 'bridgeCompactedLayoutAndRender',
            expectedLoadName: 'bridgeAwareLoadTree'
        });
        controller.registerLayoutStage({
            name: 'bridge-compaction',
            order: 50,
            run: () => bridge.layout()
        });
        registerPrepare('bridge-compaction', 50, bridge.prepare);
        diagnostics.capturedStages.push('bridge-compaction');

        const router = await captureLegacyModule({
            src: '/planar-router.js',
            dataKey: 'data-family-planar-router',
            expectedLoadName: 'routerAwareLoadTree',
            ready: () => !!window.__familyPlanarRouterInstalled &&
                typeof drawSVGLines === 'function' && drawSVGLines.name === 'crossingSafeDraw'
        });
        registerPrepare('planar-router', 60, router.prepare);
        controller.registerConnectorStage({
            name: 'planar-router',
            run: () => router.connector()
        });
        diagnostics.capturedStages.push('planar-router');

        await loadScript('/visual-roles.js', 'data-family-visual-roles');
        controller.installFacade();
        expose();
    }

    async function installSyncStack() {
        // Sync is installed only after the first controller-owned graph commit, so its initial
        // revision check cannot become a competing renderer. With M2 there is no loadTree wrapper
        // chain: graph-sync captures graph-view's canonical loader directly.
        await waitFor(() => document.readyState !== 'loading', 'DOM parsing');
        if (directGraphLoadTree) setLoadTree(directGraphLoadTree);
        window.FamilyRenderController?.installFacade?.();
        await loadScript('/graph-sync.js', 'data-family-graph-sync');
        await loadScript('/graph-debug.js', 'data-family-graph-debug');
        diagnostics.syncStartedAt = new Date().toISOString();
        expose();
    }

    async function start() {
        expose();
        try {
            await installFeatureStack();
            await installLayoutStack();

            if (typeof window.startFamilyGraph !== 'function') {
                throw new Error('Graph view did not expose startFamilyGraph');
            }

            diagnostics.phase = 'starting-graph';
            diagnostics.graphStartedAt = new Date().toISOString();
            expose();
            await window.startFamilyGraph();
            window.FamilySelectionController?.syncFromRenderedRoot?.({ source: 'initial-graph' });
            await settleFrames(1);

            diagnostics.phase = 'starting-sync';
            expose();
            await installSyncStack();

            diagnostics.phase = 'ready';
            diagnostics.readyAt = new Date().toISOString();
            expose();
            window.dispatchEvent(new CustomEvent('family-runtime-ready', {
                detail: {
                    selectedPersonId: window.FamilySelectionController?.getSelectedPersonId?.() || null,
                    renderController: window.FamilyRenderController?.snapshot?.() || null
                }
            }));
        } catch (error) {
            diagnostics.phase = 'failed';
            diagnostics.error = String(error?.message || error);
            expose();
            console.error('Family runtime bootstrap failed:', error);
            try { showStatus('שגיאה בטעינת עץ המשפחה'); } catch (_) {}
        }
    }

    void start();
})();
