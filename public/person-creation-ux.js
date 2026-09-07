// UX coherence for newly created people.
//
// Structural actions may create a person asynchronously. Once the new person is selected,
// focus the right-pane name editor and keep every person picker sourced from the current
// canonical graph cache so newly added/renamed people appear immediately.
(() => {
    if (window.__familyPersonCreationUxInstalled) return;
    window.__familyPersonCreationUxInstalled = true;

    const Cache = window.FamilyGraphCache;
    const Identity = window.FamilyPersonIdentity;
    if (!Cache) return;

    let refreshQueued = false;
    let selectObserver = null;

    function graphPeople() {
        const entry = Cache.load();
        return Array.isArray(entry?.graph?.people) ? entry.graph.people : [];
    }

    function personLabel(person) {
        const item = Identity?.describe?.(person.id);
        if (item?.display) return item.display;
        const name = String(person?.name || '').trim();
        return name || 'ללא שם';
    }

    function desiredOptions(select) {
        const previous = select.value || '';
        const people = [...graphPeople()].sort((a, b) => {
            const an = String(a?.name || '').trim();
            const bn = String(b?.name || '').trim();
            return an.localeCompare(bn, document.documentElement.lang || 'he') ||
                String(a.id).localeCompare(String(b.id));
        });

        const options = [{ value: '', label: 'לא מזוהה' }];
        for (const person of people) {
            if (!person?.id) continue;
            options.push({ value: person.id, label: personLabel(person) });
        }

        if (previous && !people.some(person => person.id === previous)) {
            options.push({ value: previous, label: `אדם לא זמין (${previous})` });
        }
        return { previous, options };
    }

    function optionSignature(options) {
        return options.map(option => `${option.value}\u0000${option.label}`).join('\u0001');
    }

    function actualSignature(select) {
        return [...select.options]
            .map(option => `${option.value}\u0000${option.textContent?.trim() || ''}`)
            .join('\u0001');
    }

    function syncFacePersonSelect(select) {
        if (!(select instanceof HTMLSelectElement)) return false;
        const { previous, options } = desiredOptions(select);
        const desired = optionSignature(options);
        if (actualSignature(select) === desired) return false;

        const fragment = document.createDocumentFragment();
        for (const item of options) {
            const option = document.createElement('option');
            option.value = item.value;
            option.textContent = item.label;
            fragment.appendChild(option);
        }
        select.replaceChildren(fragment);
        select.value = options.some(option => option.value === previous) ? previous : '';
        select.dispatchEvent(new Event('family-person-options-refreshed'));
        return true;
    }

    function refreshOpenSearches() {
        const graphInput = document.querySelector('.graph-search-input');
        if (graphInput && (document.activeElement === graphInput || graphInput.value)) {
            graphInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        for (const select of document.querySelectorAll('.face-person-select')) {
            syncFacePersonSelect(select);
        }

        const faceInput = document.querySelector('.face-person-search');
        if (faceInput && document.activeElement === faceInput) {
            faceInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        window.FamilyPersonPickerLabels?.refresh?.();
    }

    function queueRefresh() {
        if (refreshQueued) return;
        refreshQueued = true;
        queueMicrotask(() => {
            refreshQueued = false;
            Identity?.refreshFromCache?.();
            refreshOpenSearches();
        });
    }

    function placeCaretAtEnd(element) {
        if (!element || !document.createRange) return;
        const range = document.createRange();
        range.selectNodeContents(element);
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

    async function focusPersonName(personId) {
        if (!personId) return false;
        openMobilePane();

        for (let attempt = 0; attempt < 24; attempt++) {
            const editor = document.querySelector(`#person-pane .person-pane-name[data-id="${CSS.escape(personId)}"]`);
            if (editor) {
                openMobilePane();
                editor.focus({ preventScroll: false });
                placeCaretAtEnd(editor);
                return document.activeElement === editor;
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return false;
    }

    window.addEventListener('family-focus-person-name', event => {
        void focusPersonName(event.detail?.id);
    });

    window.addEventListener('family-person-disambiguation-updated', queueRefresh);
    window.addEventListener('family-graph-synced', queueRefresh);
    window.addEventListener('family-person-pane-saved', () => queueMicrotask(queueRefresh));
    window.addEventListener('family-graph-fetch', event => {
        if (event.detail?.source === 'network') queueRefresh();
    });

    // face-tagging.js historically cached its people array for the life of the page. If it
    // repopulates the hidden select from that stale array, immediately restore the canonical
    // options. The signature check makes this observer idempotent rather than recursive.
    selectObserver = new MutationObserver(mutations => {
        if (mutations.some(mutation =>
            mutation.target instanceof HTMLSelectElement &&
            mutation.target.classList.contains('face-person-select') ||
            mutation.target.parentElement?.classList?.contains('face-person-select')
        )) {
            queueRefresh();
            return;
        }
        if (mutations.some(mutation => mutation.type === 'childList')) queueRefresh();
    });
    selectObserver.observe(document.body, { childList: true, subtree: true });

    window.FamilyPersonCreationUX = Object.freeze({
        refreshPickers: queueRefresh,
        focusName: focusPersonName
    });

    queueRefresh();
})();
