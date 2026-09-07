// Deterministic browser bootstrap for the family graph runtime.
// The base HTML defines legacy geometry primitives only; no graph is rendered until this
// module has installed the complete current refinement/layout stack in a known order.
(() => {
    if (window.__familyRuntimeBootstrapInstalled) return;
    window.__familyRuntimeBootstrapInstalled = true;

    const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';
    // graph-view is loaded immediately before this bootstrap. Keep its direct loader so the
    // later sync layer can preserve its efficient reconciliation path without booting early.
    const directGraphLoadTree = typeof window.loadTree === 'function' ? window.loadTree : null;
    const diagnostics = {
        phase: 'installing',
        loaded: [],
        startedAt: new Date().toISOString(),
        graphStartedAt: null,
        syncStartedAt: null,
        readyAt: null,
        error: null
    };

    function expose() {
        window.__familyRuntimeBootstrapDiagnostics = { ...diagnostics, loaded: [...diagnostics.loaded] };
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
                    diagnostics.loaded.push(src);
                    expose();
                    resolve(existing);
                };
                existing.addEventListener('load', done, { once: true });
                existing.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
                // Existing server-injected scripts execute before this bootstrap. If their
                // installation marker is already visible, do not wait for an already-fired load.
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

    async function loadMobileStack() {
        // mobile-refinement historically self-loaded presentation + multi-partner. Temporary
        // marker scripts suppress those nested loaders so this bootstrap owns exact order.
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
        await loadScript('/multi-partner-refinement.js', 'data-family-multi-partner');
        await waitFor(() => !!window.__familyMultiPartnerRefinement, 'multi-partner refinement');
    }

    async function installFeatureStack() {
        await loadScript('/selection-controller.js', 'data-family-selection-controller');
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
    }

    async function installLayoutStack() {
        await loadScript('/planar-core.js', 'data-family-planar-core');
        await loadScript('/planar-layout.js', 'data-family-planar-layout');
        await waitFor(
            () => typeof layoutAndRender === 'function' && layoutAndRender.name === 'crossingSafeLayoutAndRender',
            'planar layout wrapper'
        );

        await loadScript('/member-order-refinement.js', 'data-family-member-order');
        await waitFor(
            () => typeof layoutAndRender === 'function' && layoutAndRender.name === 'lineageAwareLayoutAndRender',
            'member-order wrapper'
        );

        await loadScript('/bridge-compaction.js', 'data-family-bridge-compaction');
        await waitFor(
            () => typeof layoutAndRender === 'function' && layoutAndRender.name === 'bridgeCompactedLayoutAndRender',
            'bridge-compaction wrapper'
        );

        await loadScript('/planar-router.js', 'data-family-planar-router');
        await waitFor(
            () => window.__familyPlanarRouterInstalled &&
                typeof loadTree === 'function' && loadTree.name === 'routerAwareLoadTree' &&
                typeof drawSVGLines === 'function' && drawSVGLines.name === 'crossingSafeDraw',
            'planar router'
        );

        // revision-layout-guard is still a safety rail in M1. It was loaded before graph-view
        // and installs itself only after the final router becomes available.
        await waitFor(
            () => typeof layoutAndRender === 'function' && !!layoutAndRender.__familyRevisionLayoutGuard,
            'revision layout guard'
        );

        await loadScript('/graph-render-stability.js', 'data-family-graph-render-stability');
        await waitFor(
            () => typeof layoutAndRender === 'function' && layoutAndRender.name === 'stableGraphLayout',
            'graph render stability coordinator'
        );

        await loadScript('/visual-roles.js', 'data-family-visual-roles');
    }

    async function installSyncStack() {
        // Never allow the startup revision check to become an alternate first renderer.
        // Wait until the initial graph is committed, then load sync. Temporarily expose the
        // graph-view loader captured before wrappers so graph-sync retains its existing direct
        // reconciliation optimization; restore the authoritative final wrapper immediately.
        await waitFor(() => document.readyState === 'complete', 'window load');
        const finalLoadTree = window.loadTree;
        try {
            if (directGraphLoadTree) {
                loadTree = directGraphLoadTree;
                window.loadTree = directGraphLoadTree;
            }
            await loadScript('/graph-sync.js', 'data-family-graph-sync');
        } finally {
            loadTree = finalLoadTree;
            window.loadTree = finalLoadTree;
        }
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
            window.FamilyVisualRoles?.refreshNow?.();
            await settleFrames(4);

            diagnostics.phase = 'starting-sync';
            expose();
            await installSyncStack();

            diagnostics.phase = 'ready';
            diagnostics.readyAt = new Date().toISOString();
            expose();
            window.dispatchEvent(new CustomEvent('family-runtime-ready', {
                detail: { selectedPersonId: window.FamilySelectionController?.getSelectedPersonId?.() || null }
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