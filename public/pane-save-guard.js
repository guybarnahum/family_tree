// Hard boundary between person-pane persistence and graph rendering.
// The legacy page has a body-level contenteditable focusout handler that calls saveEdit().
// Slice C saves pane fields itself; if that legacy handler ever sees a pane blur, swallowing
// it here guarantees metadata edits cannot reload or redraw the graph.
(() => {
    if (window.__familyPaneSaveGuardInstalled) return;
    window.__familyPaneSaveGuardInstalled = true;

    if (typeof saveEdit !== 'function') return;
    const priorSaveEdit = saveEdit;

    saveEdit = async function paneSafeSaveEdit(element) {
        if (element?.closest?.('#person-pane')) return;
        return priorSaveEdit(element);
    };
})();
