// Focus the right-pane name editor when the requested new person becomes the committed root.
(() => {
    if (window.__familyNewPersonFocusInstalled) return;
    window.__familyNewPersonFocusInstalled = true;

    let pendingPersonId = null;

    function placeCaret(editor) {
        if (!editor || !document.createRange) return;
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }

    function focusNow(personId) {
        const editor = document.querySelector(
            `#person-pane .person-pane-name[data-id="${CSS.escape(personId)}"]`
        );
        if (!editor) return false;

        const pane = document.getElementById('person-pane');
        if (pane && window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches) {
            pane.classList.add('person-pane-open');
            pane.querySelector('.person-pane-handle')?.setAttribute('aria-expanded', 'true');
        }

        try { editor.focus({ preventScroll: true }); }
        catch (_) { editor.focus(); }
        placeCaret(editor);
        editor.scrollIntoView?.({ block: 'nearest' });
        return true;
    }

    function focusName(personId) {
        pendingPersonId = String(personId || '').trim() || null;
        if (!pendingPersonId) return false;
        if (!focusNow(pendingPersonId)) return false;
        pendingPersonId = null;
        return true;
    }

    window.addEventListener('family-focus-person-name', event => {
        focusName(event.detail?.id);
    });
    window.addEventListener('family-graph-rendered', event => {
        if (!pendingPersonId || event.detail?.rootId !== pendingPersonId) return;
        if (focusNow(pendingPersonId)) pendingPersonId = null;
    });

    window.FamilyNewPersonFocus = Object.freeze({ focusName });
})();
