// Keep selected-root UI state coherent across reloads and reroots without owning layout.
//
// Responsibilities:
// - after the complete render stack has settled on startup, replay the persisted root through
//   the existing history/person-pane path and center it without invoking layoutAndRender();
// - before a stable reroot is revealed, ensure the selected card cannot retain contextual
//   (gray) styling from the previous root generation;
// - ask the root-context refinement to recompute from the now-authoritative root.
(() => {
    if (window.__familyRootSelectionCoherenceInstalled) return;
    window.__familyRootSelectionCoherenceInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const ROOT_STORAGE_KEY = 'family-tree.anchor-person';
    const STARTUP_MAX_FRAMES = 180;
    const STARTUP_SETTLE_FRAMES = 3;

    const diagnostics = {
        startupReplays: 0,
        stableCorrections: 0,
        lastRootId: null,
        lastReason: '',
        lastAppliedAt: null
    };

    function exposeDiagnostics() {
        window.__familyRootSelectionDiagnostics = { ...diagnostics };
    }

    function cardFor(personId) {
        return personId ? document.getElementById(`card-${personId}`) : null;
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

    function urlRootId() {
        try { return new URL(window.location.href).searchParams.get('person'); }
        catch (_) { return null; }
    }

    function domRootId() {
        return cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]')?.dataset.nodeId || null;
    }

    // URL/LocalStorage are the persisted selection sources, but only accept them after the
    // matching card is actually the rendered root. This prevents a stale/deleted persisted id
    // from overriding the graph renderer's valid replacement root.
    function preferredStableRootId() {
        for (const personId of [urlRootId(), storedRootId()]) {
            const card = cardFor(personId);
            if (card?.classList.contains('graph-root')) return personId;
        }
        return domRootId();
    }

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    async function waitFrames(count) {
        for (let index = 0; index < count; index++) await nextFrame();
    }

    function coordinatorReady() {
        return typeof window.layoutAndRender === 'function' &&
            window.layoutAndRender.name === 'stableGraphLayout' &&
            typeof window.FamilyGraphRenderStability?.centerRoot === 'function' &&
            !!window.__familyPersonPaneInstalled;
    }

    function coordinatorBusy() {
        const snapshot = window.__familyRenderStabilityDiagnostics;
        return !!snapshot?.structuralActive || !!snapshot?.selectionActive;
    }

    function makeSelectedCardPrimary(personId) {
        const card = cardFor(personId);
        if (!card) return false;

        card.classList.remove('graph-context');
        if (card.dataset.familyRootContextForced === 'true') {
            delete card.dataset.familyRootContextForced;
        }
        if (card.dataset.familyRootContextRole === 'other-union') {
            delete card.dataset.familyRootContextRole;
        }
        return true;
    }

    function replayPaneSelection(personId) {
        const card = cardFor(personId);
        if (!card?.classList.contains('graph-root')) return false;

        persistRootId(personId);
        const url = new URL(window.location.href);
        url.searchParams.set('person', personId);

        // person-pane.js already wraps replaceState and treats it as a selection refresh.
        // Replacing the same root URL does not trigger popstate and the render-stability wrapper
        // sees no root change, so this updates the pane without starting a graph redraw.
        history.replaceState(history.state, '', url);
        return true;
    }

    function refreshRootContext() {
        try { window.FamilyRootContextRefinement?.refresh?.(); }
        catch (error) { console.warn('Unable to refresh selected-root context:', error); }
    }

    function applyStableSelection(personId, reason, { center = false, startup = false } = {}) {
        const card = cardFor(personId);
        if (!card?.classList.contains('graph-root')) return false;

        makeSelectedCardPrimary(personId);
        replayPaneSelection(personId);
        refreshRootContext();

        if (center) {
            try { window.FamilyGraphRenderStability?.centerRoot?.(); }
            catch (error) { console.warn('Unable to center restored family root:', error); }
        }

        diagnostics.lastRootId = personId;
        diagnostics.lastReason = reason;
        diagnostics.lastAppliedAt = Date.now();
        if (startup) diagnostics.startupReplays += 1;
        else diagnostics.stableCorrections += 1;
        exposeDiagnostics();
        return true;
    }

    // graph-render-stability dispatches this synchronously after final connectors + centering
    // but before it reveals the transaction. Correct contextual styling here so no old gray
    // state can ever become the visible final frame for the newly selected root.
    window.addEventListener('family-graph-render-stable', event => {
        const personId = event.detail?.rootId;
        if (!personId) return;
        applyStableSelection(personId, `stable:${event.detail?.kind || 'render'}`);
    });

    async function replayStartupSelection() {
        for (let frame = 0; frame < STARTUP_MAX_FRAMES; frame++) {
            if (!coordinatorReady() || coordinatorBusy()) {
                await nextFrame();
                continue;
            }

            const personId = preferredStableRootId();
            if (!personId) {
                await nextFrame();
                continue;
            }

            // The final router/layout wrappers can still have initialization RAFs queued when
            // the coordinator first becomes available. Let those finish, then verify that no
            // newer selection transaction replaced the root before replaying UI selection.
            await waitFrames(STARTUP_SETTLE_FRAMES);
            if (coordinatorBusy() || preferredStableRootId() !== personId) continue;

            if (applyStableSelection(personId, 'startup-restore', {
                center: true,
                startup: true
            })) return;
        }

        console.warn('Unable to replay persisted family root after startup');
    }

    exposeDiagnostics();
    void replayStartupSelection();
})();
