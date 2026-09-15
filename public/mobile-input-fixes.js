// Mobile-only input affordances that need to stay inside the originating user gesture.
(() => {
    if (window.__familyMobileInputFixesInstalled) return;
    window.__familyMobileInputFixesInstalled = true;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');
    const pane = document.getElementById('person-pane');

    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            #person-media-modal .face-person-search-wrap {
                display: none !important;
            }

            #person-media-modal .face-person-select {
                position: static !important;
                display: block !important;
                width: 100% !important;
                height: 40px !important;
                min-height: 40px !important;
                margin: 0 !important;
                padding: 0 10px !important;
                border: 1px solid rgba(88,129,87,.25) !important;
                border-radius: 8px !important;
                background: #fff !important;
                color: #344e41 !important;
                opacity: 1 !important;
                overflow: visible !important;
                pointer-events: auto !important;
                font: 500 16px/1 Inter,sans-serif !important;
                appearance: auto !important;
                -webkit-appearance: menulist !important;
            }
        }
    `;
    document.head.appendChild(style);

    function placeCaret(editor) {
        if (!editor || !document.createRange) return;
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }

    // person-pane.js renders a newly requested metadata field synchronously, but its focus is
    // deferred to requestAnimationFrame. Mobile browsers require the focus that summons the
    // keyboard to stay inside the originating tap. This listener runs after person-pane's own
    // click handler and focuses the newly rendered editor before the click stack unwinds.
    pane?.querySelector('.person-pane-body')?.addEventListener('click', event => {
        if (!mobileQuery.matches) return;
        const option = event.target.closest?.('[data-add-person-field]');
        const key = option?.dataset.addPersonField;
        if (!key) return;

        const editor = pane.querySelector(
            `[contenteditable="true"][data-meta-key="${CSS.escape(key)}"]`
        );
        if (!editor) return;
        try { editor.focus({ preventScroll: true }); }
        catch (_) { editor.focus(); }
        placeCaret(editor);
        editor.scrollIntoView?.({ block: 'nearest' });
    });
})();
