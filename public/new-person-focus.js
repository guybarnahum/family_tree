// Focus the right-pane name editor after a newly created child becomes the graph root.
(() => {
    if (window.__familyNewPersonFocusInstalled) return;
    window.__familyNewPersonFocusInstalled = true;

    const MAX_ATTEMPTS = 20;

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
        if (!pane) return;
        const mobile = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches;
        if (!mobile) return;
        pane.classList.add('person-pane-open');
        pane.querySelector('.person-pane-handle')?.setAttribute('aria-expanded', 'true');
    }

    async function focusName(personId) {
        if (!personId) return false;
        openMobilePane();

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const editor = document.querySelector(
                `#person-pane .person-pane-name[data-id="${CSS.escape(personId)}"]`
            );
            if (editor) {
                try { editor.focus({ preventScroll: true }); }
                catch (_) { editor.focus(); }
                placeCaret(editor);
                editor.scrollIntoView?.({ block: 'nearest' });
                return true;
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return false;
    }

    window.addEventListener('family-focus-person-name', event => {
        void focusName(event.detail?.id);
    });

    window.FamilyNewPersonFocus = Object.freeze({ focusName });
})();
