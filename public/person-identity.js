// Shared person-name normalization and collision disambiguation for every person picker.
// Derived entirely from the canonical graph and rebuilt only when relevant graph data changes.
(() => {
    if (window.FamilyPersonIdentity) return;

    let peopleById = new Map();
    let labelsById = new Map();
    let collisionIds = new Set();
    let graphSignature = '';

    function normalizePersonName(value) {
        return String(value ?? '')
            .normalize('NFC')
            .trim()
            .replace(/\s+/gu, ' ');
    }

    function textValue(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object' && !Array.isArray(value)) {
            return normalizePersonName(value.text ?? '');
        }
        return normalizePersonName(value);
    }

    function metadataValue(person, key) {
        return textValue(person?.metadata?.[key]);
    }

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function relevantSignature(graph) {
        const people = Array.isArray(graph?.people) ? graph.people : [];
        const relationships = Array.isArray(graph?.relationships) ? graph.relationships : [];
        return JSON.stringify([
            [...people]
                .map(person => [
                    person?.id || '',
                    normalizePersonName(person?.name),
                    metadataValue(person, 'birthDate'),
                    metadataValue(person, 'deathDate'),
                    metadataValue(person, 'birthPlace'),
                    metadataValue(person, 'residence')
                ])
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
            [...relationships]
                .map(relation => [
                    relation?.id || '', relation?.type || '',
                    relation?.person1Id || '', relation?.person2Id || ''
                ])
                .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        ]);
    }

    function relatedName(id) {
        const person = peopleById.get(id);
        return normalizePersonName(person?.name) || 'ללא שם';
    }

    function candidateQualifiers(person, indexes) {
        const candidates = [];
        const seen = new Set();
        const push = value => {
            const clean = normalizePersonName(value);
            if (!clean || seen.has(clean)) return;
            seen.add(clean);
            candidates.push(clean);
        };

        const byRelatedName = (a, b) =>
            relatedName(a).localeCompare(relatedName(b), 'he') || String(a).localeCompare(String(b));
        const parents = [...(indexes.parentsByChild.get(person.id) || [])].sort(byRelatedName);
        const children = [...(indexes.childrenByParent.get(person.id) || [])].sort(byRelatedName);
        const spouses = [...(indexes.spousesByPerson.get(person.id) || [])].sort(byRelatedName);

        // Prefer relationship context; all wording is neutral with respect to the person's gender.
        for (const parentId of parents) push(`הורה: ${relatedName(parentId)}`);
        if (parents.length > 1) push(`הורים: ${parents.map(relatedName).join(', ')}`);
        for (const childId of children) push(`הורה של ${relatedName(childId)}`);
        for (const spouseId of spouses) push(`בן/בת זוג: ${relatedName(spouseId)}`);

        const birthDate = metadataValue(person, 'birthDate');
        const deathDate = metadataValue(person, 'deathDate');
        if (birthDate && deathDate) push(`${birthDate}–${deathDate}`);
        if (birthDate) push(birthDate);
        if (deathDate) push(`פטירה: ${deathDate}`);

        const birthPlace = metadataValue(person, 'birthPlace');
        const residence = metadataValue(person, 'residence');
        if (birthPlace) push(`מקום לידה: ${birthPlace}`);
        if (residence) push(`מגורים: ${residence}`);

        // Pathological final fallback. This is intentionally last because internal IDs are
        // implementation details, but it guarantees that every picker can distinguish rows.
        push(`מזהה: ${person.id}`);
        return candidates;
    }

    function chooseQualifiers(group, indexes) {
        const candidateLists = new Map(group.map(person => [person.id, candidateQualifiers(person, indexes)]));
        const choice = new Map(group.map(person => [person.id, 0]));

        for (let pass = 0; pass < 64; pass++) {
            const buckets = new Map();
            for (const person of group) {
                const list = candidateLists.get(person.id) || [];
                const index = Math.min(choice.get(person.id) || 0, Math.max(0, list.length - 1));
                const qualifier = list[index] || `מזהה: ${person.id}`;
                if (!buckets.has(qualifier)) buckets.set(qualifier, []);
                buckets.get(qualifier).push(person.id);
            }

            const collisions = [...buckets.values()].filter(ids => ids.length > 1);
            if (!collisions.length) break;

            let advanced = false;
            for (const ids of collisions) {
                for (const id of ids) {
                    const list = candidateLists.get(id) || [];
                    const index = choice.get(id) || 0;
                    if (index < list.length - 1) {
                        choice.set(id, index + 1);
                        advanced = true;
                    }
                }
            }
            if (!advanced) break;
        }

        return new Map(group.map(person => {
            const list = candidateLists.get(person.id) || [];
            const index = Math.min(choice.get(person.id) || 0, Math.max(0, list.length - 1));
            return [person.id, list[index] || `מזהה: ${person.id}`];
        }));
    }

    function build(graph) {
        const people = (Array.isArray(graph?.people) ? graph.people : [])
            .filter(person => person && typeof person.id === 'string' && person.id)
            .map(person => ({ ...person, name: normalizePersonName(person.name) }));
        const relationships = Array.isArray(graph?.relationships) ? graph.relationships : [];

        peopleById = new Map(people.map(person => [person.id, person]));
        labelsById = new Map();
        collisionIds = new Set();

        const indexes = {
            parentsByChild: new Map(),
            childrenByParent: new Map(),
            spousesByPerson: new Map()
        };
        for (const relation of relationships) {
            if (relation?.type === 'parent') {
                addSet(indexes.parentsByChild, relation.person2Id, relation.person1Id);
                addSet(indexes.childrenByParent, relation.person1Id, relation.person2Id);
            } else if (relation?.type === 'spouse') {
                addSet(indexes.spousesByPerson, relation.person1Id, relation.person2Id);
                addSet(indexes.spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }

        const groups = new Map();
        for (const person of people) {
            const key = normalizePersonName(person.name);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(person);
        }

        for (const group of groups.values()) {
            const ambiguous = group.length > 1;
            const qualifiers = ambiguous ? chooseQualifiers(group, indexes) : new Map();
            for (const person of group) {
                const name = normalizePersonName(person.name) || 'ללא שם';
                const qualifier = ambiguous ? (qualifiers.get(person.id) || '') : '';
                if (ambiguous) collisionIds.add(person.id);
                labelsById.set(person.id, Object.freeze({
                    id: person.id,
                    name,
                    qualifier,
                    ambiguous,
                    display: qualifier ? `${name} — ${qualifier}` : name
                }));
            }
        }
    }

    function setGraph(graph) {
        const nextSignature = relevantSignature(graph);
        if (nextSignature === graphSignature) return false;
        graphSignature = nextSignature;
        build(graph);
        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('family-person-disambiguation-updated'));
        }
        return true;
    }

    function describe(personId) {
        return labelsById.get(personId) || Object.freeze({
            id: personId,
            name: relatedName(personId),
            qualifier: '',
            ambiguous: false,
            display: relatedName(personId)
        });
    }

    function needsDisambiguation(personId) {
        return collisionIds.has(personId);
    }

    function searchText(personId) {
        const item = describe(personId);
        return normalizePersonName(`${item.name} ${item.qualifier}`);
    }

    function refreshFromCache() {
        const entry = window.FamilyGraphCache?.load?.();
        if (entry?.graph) setGraph(entry.graph);
    }

    window.FamilyPersonIdentity = Object.freeze({
        normalizePersonName,
        setGraph,
        describe,
        needsDisambiguation,
        searchText,
        refreshFromCache
    });

    // Normalize interactive name edits before any existing pane/card blur-save handler sees
    // the value. This gives every current name editor one canonical whitespace rule.
    if (typeof document !== 'undefined') {
        document.addEventListener('focusout', event => {
            const target = event.target;
            if (!(target instanceof HTMLElement) ||
                !target.hasAttribute('contenteditable') ||
                target.dataset.field !== 'name') return;
            const clean = normalizePersonName(target.innerText);
            if (clean !== target.innerText) target.textContent = clean;
        }, true);
    }

    if (typeof window.addEventListener === 'function') {
        window.addEventListener('family-graph-fetch', refreshFromCache);
        window.addEventListener('family-graph-synced', refreshFromCache);
        window.addEventListener('family-person-pane-saved', () => queueMicrotask(refreshFromCache));
    }

    refreshFromCache();
})();
