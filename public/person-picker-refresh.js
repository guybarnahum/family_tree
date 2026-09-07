// Keep every person picker synchronized with the canonical GraphStore document.
// The observer below watches the face editor's own select lifecycle; graph-to-module
// communication is explicit through store/identity events.
(() => {
    if (window.__familyPersonPickerRefreshInstalled) return;
    window.__familyPersonPickerRefreshInstalled = true;

    const Identity = window.FamilyPersonIdentity;
    const Store = window.FamilyGraphStore;
    if (!Store) return;

    let queued = false;
    let rebuildingFaceSelect = false;

    function normalizedName(person) {
        return Identity?.normalizePersonName?.(person?.name) || String(person?.name || '').trim();
    }

    function currentSnapshot() {
        return Store.snapshot();
    }

    function peopleForPicker(snapshot = currentSnapshot()) {
        const graph = snapshot?.graph;
        return (Array.isArray(graph?.people) ? graph.people : [])
            .filter(person => person && person.id)
            .sort((a, b) =>
                normalizedName(a).localeCompare(normalizedName(b), document.documentElement.lang || 'he') ||
                String(a.id).localeCompare(String(b.id))
            );
    }

    function selectSignature(select, people) {
        const selected = select.value || '';
        return `${selected}|${people.map(person => `${person.id}:${normalizedName(person)}`).join('|')}`;
    }

    function rebuildFaceSelect(select, people) {
        if (!(select instanceof HTMLSelectElement) || rebuildingFaceSelect) return;
        const signature = selectSignature(select, people);
        if (select.dataset.familyPeopleSignature === signature) return;

        rebuildingFaceSelect = true;
        try {
            const selected = select.value || '';
            select.replaceChildren();

            const unknown = document.createElement('option');
            unknown.value = '';
            unknown.textContent = 'לא מזוהה';
            select.appendChild(unknown);

            for (const person of people) {
                const option = document.createElement('option');
                option.value = person.id;
                const label = Identity?.describe?.(person.id);
                option.textContent = label?.display || normalizedName(person) || 'ללא שם';
                select.appendChild(option);
            }

            if (selected && !people.some(person => person.id === selected)) {
                const missing = document.createElement('option');
                missing.value = selected;
                missing.textContent = `אדם לא זמין (${selected})`;
                select.appendChild(missing);
            }
            select.value = selected;
            select.dataset.familyPeopleSignature = selectSignature(select, people);
        } finally {
            rebuildingFaceSelect = false;
        }
    }

    function refreshGraphSearch() {
        const input = document.querySelector('.graph-search-input');
        if (!input) return;
        if (document.activeElement === input || input.value) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function refreshNow() {
        const snapshot = currentSnapshot();
        if (!snapshot?.graph) return;
        Identity?.setGraph?.(snapshot.graph, snapshot.indexes);
        const people = peopleForPicker(snapshot);
        document.querySelectorAll('.face-person-select').forEach(select => rebuildFaceSelect(select, people));
        window.FamilyPersonPickerLabels?.refresh?.();
        refreshGraphSearch();
        window.dispatchEvent(new CustomEvent('family-person-picker-data-updated', {
            detail: { people: people.length }
        }));
    }

    function queueRefresh() {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            refreshNow();
        });
    }

    // This observer is intentionally UI-local: face-tagging replaces options/select content
    // internally. It does not discover canonical graph changes.
    new MutationObserver(mutations => {
        if (rebuildingFaceSelect) return;
        if (mutations.some(mutation =>
            mutation.type === 'childList' &&
            (mutation.target instanceof HTMLSelectElement || mutation.target.closest?.('.face-person-select'))
        )) queueRefresh();
    }).observe(document.body, { childList: true, subtree: true });

    window.addEventListener('family-graph-store-changed', queueRefresh);
    window.addEventListener('family-person-disambiguation-updated', queueRefresh);

    window.FamilyPersonPickerRefresh = Object.freeze({ refresh: queueRefresh });
    queueRefresh();
})();
