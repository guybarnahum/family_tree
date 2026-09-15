// Focus the selected new person's name editor without leaving mobile keyboards in a dead-focus state.
(() => {
    if (window.__familyNewPersonFocusInstalled) return;
    window.__familyNewPersonFocusInstalled = true;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');
    const cardsLayer = document.getElementById('cards-layer');
    const pane = document.getElementById('person-pane');
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

    function setMobilePaneOpen(open) {
        if (!pane || !mobileQuery.matches) return;
        pane.classList.toggle('person-pane-open', open);
        pane.querySelector('.person-pane-handle')?.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function editorFor(personId) {
        return document.querySelector(
            `#person-pane .person-pane-name[data-id="${CSS.escape(personId)}"]`
        );
    }

    function focusNow(personId) {
        const editor = editorFor(personId);
        if (!editor) return false;

        setMobilePaneOpen(true);
        try { editor.focus({ preventScroll: true }); }
        catch (_) { editor.focus(); }
        placeCaret(editor);
        editor.scrollIntoView?.({ block: 'nearest' });
        return true;
    }

    function focusName(personId) {
        pendingPersonId = String(personId || '').trim() || null;
        if (!pendingPersonId) return false;

        // Desktop can focus immediately. On mobile the new-person selection still has a render
        // to commit; close the pane until that render lands so a user cannot focus an editor
        // that is about to be replaced (which dismisses the virtual keyboard).
        if (mobileQuery.matches) {
            setMobilePaneOpen(false);
            return true;
        }
        return focusNow(pendingPersonId);
    }

    cardsLayer?.addEventListener('click', event => {
        if (!mobileQuery.matches) return;
        const name = event.target.closest?.('h2[data-field="name"][data-id]');
        if (!name) return;
        const id = name.dataset.id;
        if (pendingPersonId === id) return;
        focusNow(id);
    });

    window.addEventListener('family-focus-person-name', event => {
        focusName(event.detail?.id);
    });

    window.addEventListener('family-graph-rendered', event => {
        if (!pendingPersonId || event.detail?.rootId !== pendingPersonId) return;
        const personId = pendingPersonId;
        pendingPersonId = null;

        if (mobileQuery.matches) {
            setMobilePaneOpen(true);
            editorFor(personId)?.scrollIntoView?.({ block: 'nearest' });
            return;
        }
        focusNow(personId);
    });

    window.FamilyNewPersonFocus = Object.freeze({ focusName });
})();
