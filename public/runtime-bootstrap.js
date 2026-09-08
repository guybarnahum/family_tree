// Deterministic browser bootstrap: dependency order and startup only.
(() => {
    if (window.__familyRuntimeBootstrapInstalled) return;
    window.__familyRuntimeBootstrapInstalled = true;

    const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';
    const diagnostics = {
        phase: 'installing',
        loaded: [],
        registeredStages: [],
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
            registeredStages: [...diagnostics.registeredStages]
        };
    }

    function loadScript(src, dataKey) {
        const existing = document.querySelector(`script[${dataKey}]`);
        if (existing?.dataset.familyBootstrapLoaded === 'true') return Promise.resolve(existing);
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

    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const domReady = () => document.readyState !== 'loading'
        ? Promise.resolve()
        : new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));

    async function installFeatureStack() {
        await loadScript('/render-controller.js', 'data-family-render-controller');
        window.FamilySelectionController?.restoreSelection?.();

        await loadScript('/import-export.js', 'data-family-import-export');
        await loadScript('/interaction-refinement.js', 'data-family-interaction');
        await loadScript('/node-hover.js', 'data-family-node-hover');
        await loadScript('/mobile-refinement.js', 'data-family-mobile');
        await loadScript('/presentation-refinement.js', 'data-family-presentation');
        await loadScript('/multi-partner-refinement.js', 'data-family-multi-partner');

        const features = [
            ['/person-metadata.js', 'data-family-person-metadata'],
            ['/person-pane.js', 'data-family-person-pane'],
            ['/new-person-focus.js', 'data-family-new-person-focus'],
            ['/place-autocomplete.js', 'data-family-place-autocomplete'],
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
            ['/person-pane-editing.js', 'data-family-person-pane-editing'],
            ['/graph-card-geometry.js', 'data-family-graph-card-geometry'],
            ['/print-refinement.js', 'data-family-print']
        ];
        for (const [src, dataKey] of features) await loadScript(src, dataKey);
    }

    function verifyLayoutPipeline() {
        const snapshot = window.FamilyRenderController?.snapshot?.();
        if (!snapshot) throw new Error('RenderController diagnostics are unavailable');
        const layout = (snapshot.layoutStages || []).map(stage => stage.name);
        const prepare = (snapshot.prepareStages || []).map(stage => stage.name);
        const validation = (snapshot.validationStages || []).map(stage => stage.name);
        const expectedLayout = ['relationship-compaction', 'planar', 'member-order', 'bridge-compaction'];
        const expectedPrepare = ['multi-partner', 'planar', 'member-order', 'bridge-compaction', 'planar-router'];

        for (const name of expectedLayout) {
            if (!layout.includes(name)) throw new Error(`Missing layout stage: ${name}`);
        }
        for (const name of expectedPrepare) {
            if (!prepare.includes(name)) throw new Error(`Missing prepare stage: ${name}`);
        }
        if (!validation.includes('planar')) throw new Error('Missing planar validation stage');
        if (snapshot.connectorStage !== 'planar-router') throw new Error('Missing planar router connector stage');

        diagnostics.registeredStages = [
            ...layout,
            `connector:${snapshot.connectorStage}`,
            ...validation.map(name => `validate:${name}`)
        ];
        expose();
    }

    async function installLayoutStack() {
        await loadScript('/layout-refinement.js', 'data-family-layout-refinement');
        await loadScript('/planar-core.js', 'data-family-planar-core');
        await loadScript('/planar-layout.js', 'data-family-planar-layout');
        await loadScript('/member-order-refinement.js', 'data-family-member-order');
        await loadScript('/bridge-compaction.js', 'data-family-bridge-compaction');
        await loadScript('/planar-router.js', 'data-family-planar-router');
        await loadScript('/visual-roles.js', 'data-family-visual-roles');
        verifyLayoutPipeline();
    }

    async function installSyncStack() {
        await domReady();
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
            await nextFrame();

            diagnostics.phase = 'starting-sync';
            expose();
            await installSyncStack();

            diagnostics.phase = 'ready';
            diagnostics.readyAt = new Date().toISOString();
            expose();
            window.dispatchEvent(new CustomEvent('family-runtime-ready', {
                detail: {
                    selectedPersonId: window.FamilySelectionController?.getSelectedPersonId?.() || null,
                    graphStore: window.FamilyGraphStore?.snapshot?.() || null,
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
