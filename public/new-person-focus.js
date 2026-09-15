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
        // the user's tap. New-person creation crosses async graph/render work, so on mobile
        // simply expose the editor until the user taps it. Never blur a field the user already
        // focused, because that dismisses the virtual keyboard.
        if (mobileQuery.matches && !userGesture) {
            if (document.activeElement === editor) {
                pendingPersonId = null;
                return true;
            }
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
        const id = name.dataset.id;
        if (focusNow(id, { userGesture: true }) && pendingPersonId === id) pendingPersonId = null;
    });

    document.getElementById('person-pane')?.addEventListener('focusin', event => {
        if (!mobileQuery.matches || !pendingPersonId) return;
        const editor = event.target.closest?.('.person-pane-name[data-id]');
        if (editor?.dataset.id === pendingPersonId) pendingPersonId = null;
    }, true);

    window.addEventListener('family-focus-person-name', event => {
        focusName(event.detail?.id);
    });
    window.addEventListener('family-graph-rendered', event => {
        if (!pendingPersonId || event.detail?.rootId !== pendingPersonId) return;
        if (focusNow(pendingPersonId) && !mobileQuery.matches) pendingPersonId = null;
    });

    window.FamilyNewPersonFocus = Object.freeze({ focusName });
})();
