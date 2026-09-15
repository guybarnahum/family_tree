// Focus the selected new person's name editor without leaving mobile keyboards in a dead-focus state.
(() => {
    if (window.__familyNewPersonFocusInstalled) return;
    window.__familyNewPersonFocusInstalled = true;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');
    const cardsLayer = document.getElementById('cards-layer');
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

    function openMobilePane() {
        const pane = document.getElementById('person-pane');
        if (!pane || !mobileQuery.matches) return;
        pane.classList.add('person-pane-open');
        pane.querySelector('.person-pane-handle')?.setAttribute('aria-expanded', 'true');
    }

    function editorFor(personId) {
        return document.querySelector(
            `#person-pane .person-pane-name[data-id="${CSS.escape(personId)}"]`
        );
    }

    function focusNow(personId, { userGesture = false } = {}) {
        const editor = editorFor(personId);
        if (!editor) return false;

        openMobilePane();

        // Mobile browsers only show the virtual keyboard reliably when focus happens inside
        // the user's tap. New-person creation crosses async graph/render work, so focusing here
        // afterward can leave the contenteditable focused with no keyboard. Keep the pane open,
        // but leave the editor unfocused until the user taps the visible name.
        if (mobileQuery.matches && !userGesture) {
            if (document.activeElement === editor) editor.blur();
            editor.scrollIntoView?.({ block: 'nearest' });
            return true;
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
        // Selection can render the pane before GraphView commits the new root. Desktop can
        // focus immediately. Mobile opens the editor pane now and waits for a direct name tap.
        return focusNow(pendingPersonId);
    }

    cardsLayer?.addEventListener('click', event => {
        if (!mobileQuery.matches) return;
        const name = event.target.closest?.('h2[data-field="name"][data-id]');
        if (!name) return;
        focusNow(name.dataset.id, { userGesture: true });
    });

    window.addEventListener('family-focus-person-name', event => {
        focusName(event.detail?.id);
    });
    window.addEventListener('family-graph-rendered', event => {
        if (!pendingPersonId || event.detail?.rootId !== pendingPersonId) return;
        if (focusNow(pendingPersonId)) pendingPersonId = null;
    });

    window.FamilyNewPersonFocus = Object.freeze({ focusName });
})();
