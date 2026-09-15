// Mobile-only input affordances that need to stay inside the originating user gesture.
(() => {
    if (window.__familyMobileInputFixesInstalled) return;
    window.__familyMobileInputFixesInstalled = true;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');
    const pane = document.getElementById('person-pane');
    const paneBody = pane?.querySelector('.person-pane-body');
    const mediaModal = document.getElementById('person-media-modal');

    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            #person-pane input.person-pane-value,
            #person-pane textarea.person-pane-value {
                display: block;
                width: 100%;
                box-sizing: border-box;
                border: 0;
                background: transparent;
                color: #37423a;
                font: 400 16px/1.5 Inter, sans-serif;
                -webkit-text-size-adjust: 100%;
            }

            #person-pane input.person-pane-value {
                min-height: 38px;
            }

            #person-pane textarea.person-pane-value {
                min-height: 88px;
                resize: vertical;
            }

            #person-pane input.person-pane-value:focus,
            #person-pane textarea.person-pane-value:focus {
                outline: none;
                background: rgba(163, 177, 138, 0.12);
            }

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

    function copyDataset(from, to) {
        for (const [key, value] of Object.entries(from.dataset)) to.dataset[key] = value;
    }

    function upgradeMetadataEditor(editor) {
        if (!mobileQuery.matches || !(editor instanceof HTMLElement)) return editor;
        if (editor.matches('input.person-pane-value, textarea.person-pane-value')) return editor;
        if (editor.getAttribute('contenteditable') !== 'true' || editor.dataset.field !== 'metadata' || !editor.dataset.metaKey) return editor;

        const multiline = editor.classList.contains('person-pane-bio');
        const control = document.createElement(multiline ? 'textarea' : 'input');
        if (control instanceof HTMLInputElement) control.type = 'text';
        control.className = editor.className;
        copyDataset(editor, control);
        control.setAttribute('contenteditable', 'false');
        control.spellcheck = true;
        control.autocomplete = 'off';
        control.placeholder = editor.dataset.placeholder || '';
        control.value = editor.textContent || '';
        control.dataset.value = control.value;

        // person-pane-editing reads dataset.value for any element carrying contenteditable.
        // Keep that contract current before the event bubbles to pane-level save handlers.
        control.addEventListener('input', () => {
            control.dataset.value = control.value;
        });

        editor.replaceWith(control);
        return control;
    }

    function upgradeAllMetadataEditors() {
        if (!mobileQuery.matches || !paneBody) return;
        paneBody.querySelectorAll('[contenteditable="true"][data-field="metadata"][data-meta-key]')
            .forEach(upgradeMetadataEditor);
    }

    function focusNativeEditor(editor) {
        if (!(editor instanceof HTMLInputElement) && !(editor instanceof HTMLTextAreaElement)) return;
        try { editor.focus({ preventScroll: true }); }
        catch (_) { editor.focus(); }
        const end = editor.value.length;
        try { editor.setSelectionRange(end, end); } catch (_) {}
        editor.scrollIntoView?.({ block: 'nearest' });
    }

    // person-pane.js renders a requested metadata field during this same click. Upgrade it to
    // a native control and focus before the originating tap unwinds so mobile may open keyboard.
    paneBody?.addEventListener('click', event => {
        if (!mobileQuery.matches) return;
        const option = event.target.closest?.('[data-add-person-field]');
        const key = option?.dataset.addPersonField;
        if (!key) return;
        upgradeAllMetadataEditors();
        const editor = paneBody.querySelector(`[data-field="metadata"][data-meta-key="${CSS.escape(key)}"]`);
        focusNativeEditor(editor);
    });

    // Re-apply after the legitimate render events that recreate person-pane contents.
    for (const type of ['family-selection-changed', 'family-graph-rendered', 'family-person-pane-saved']) {
        window.addEventListener(type, upgradeAllMetadataEditors);
    }
    mobileQuery.addEventListener?.('change', upgradeAllMetadataEditors);

    // Photo metadata remains contenteditable, but force focus during the originating tap. These
    // controls are not rebuilt by viewport-height changes after the RenderController fix.
    mediaModal?.addEventListener('click', event => {
        if (!mobileQuery.matches) return;
        const editor = event.target.closest?.('[contenteditable="true"][data-media-field]');
        if (!(editor instanceof HTMLElement)) return;
        try { editor.focus({ preventScroll: true }); }
        catch (_) { editor.focus(); }
    });

    upgradeAllMetadataEditors();
})();
