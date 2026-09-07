// Keep every person picker synchronized with the latest canonical graph/cache.
// This is especially important for long-lived face-tagging UI, whose native select can
// otherwise keep the people list that existed when the photo editor first opened.
(() => {
    if (window.__familyPersonPickerRefreshInstalled) return;
    window.__familyPersonPickerRefreshInstalled = true;

    const Identity = window.FamilyPersonIdentity;
    const Cache = window.FamilyGraphCache;
    if (!Cache) return;

    let queued = false;
    let rebuildingFaceSelect = false;

    function normalizedName(person) {
        return Identity?.normalizePersonName?.(person?.name) || String(person?.name || '').trim();
    }

    function currentGraph() {
        return Cache.load()?.graph || null;
    }

    function peopleForPicker() {
        const graph = currentGraph();
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
        const graph = currentGraph();
        if (!graph) return;
        Identity?.setGraph?.(graph);
        const people = peopleForPicker();
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

    new MutationObserver(mutations => {
        if (rebuildingFaceSelect) return;
        if (mutations.some(mutation =>
            mutation.type === 'childList' &&
            (mutation.target instanceof HTMLSelectElement || mutation.target.closest?.('.face-person-select'))
        )) queueRefresh();
    }).observe(document.body, { childList: true, subtree: true });

    for (const type of [
        'family-graph-fetch',
        'family-graph-synced',
        'family-person-pane-saved',
        'family-person-disambiguation-updated'
    ]) {
        window.addEventListener(type, queueRefresh);
    }

    window.FamilyPersonPickerRefresh = Object.freeze({ refresh: queueRefresh });
    queueRefresh();
})();
