// Canonical graph/person mutation owner.
// UI modules express intent here; FamilyApi owns transport and GraphStore owns graph state.
(() => {
    if (window.FamilyMutations) return;

    const Store = window.FamilyGraphStore;
    const Api = window.FamilyApi;
    const Selection = window.FamilySelectionController;
    const cardsLayer = document.getElementById('cards-layer');
    if (!Store || !Api || !Selection || !cardsLayer) return;

    const diagnostics = {
        structuralWrites: 0,
        personWrites: 0,
        noopPersonWrites: 0,
        actionClicks: 0,
        lastAction: '',
        lastError: null
    };

    function expose() {
        window.__familyMutationDiagnostics = { ...diagnostics };
    }

    function cloneGraph(value) {
        return typeof structuredClone === 'function'
            ? structuredClone(value)
            : JSON.parse(JSON.stringify(value));
    }

    function nextPersonId() {
        return 'node_' + Math.random().toString(36).slice(2, 11);
    }

    function sameRelationship(a, b) {
        if (a.type !== b.type) return false;
        if (a.type === 'spouse') {
            return (a.person1Id === b.person1Id && a.person2Id === b.person2Id) ||
                (a.person1Id === b.person2Id && a.person2Id === b.person1Id);
        }
        return a.person1Id === b.person1Id && a.person2Id === b.person2Id;
    }

    function addRelationship(value, relation) {
        if (!value.relationships.some(existing => sameRelationship(existing, relation))) {
            value.relationships.push(relation);
        }
    }

    function graphIndexes(value) {
        const parentsByChild = new Map();
        const spousesByPerson = new Map();
        const add = (map, key, id) => {
            if (!map.has(key)) map.set(key, new Set());
            map.get(key).add(id);
        };
        for (const relation of value.relationships || []) {
            if (relation.type === 'parent') add(parentsByChild, relation.person2Id, relation.person1Id);
            if (relation.type === 'spouse') {
                add(spousesByPerson, relation.person1Id, relation.person2Id);
                add(spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }
        return { parentsByChild, spousesByPerson };
    }

    async function authoritativeGraph(reason = 'mutation-intent') {
        const snapshot = await Store.refresh({ authoritative: true, reason });
        if (!snapshot?.graph) throw new Error('Authoritative graph is unavailable');
        return cloneGraph(snapshot.graph);
    }

    async function refreshAfterStructuralWrite() {
        const GraphView = window.FamilyGraphView;
        if (!GraphView?.refresh) throw new Error('FamilyGraphView is required after structural writes');
        await GraphView.refresh({ force: true, recenter: false });
    }

    async function putGraph(value, { anchorId = null, reason = 'structural-write' } = {}) {
        const payload = {
            ...value,
            format: 'family-graph',
            version: 2,
            people: value.people || [],
            relationships: value.relationships || []
        };
        const response = await Api.request('/api/graph', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(await response.text());
        diagnostics.structuralWrites += 1;
        diagnostics.lastAction = reason;
        diagnostics.lastError = null;
        expose();
        await refreshAfterStructuralWrite();
        window.dispatchEvent(new CustomEvent('family-graph-mutated', {
            detail: { reason, anchorId }
        }));
        return true;
    }

    async function updatePerson(id, patch, { reason = 'person-update' } = {}) {
        const person = Store.person(id) || globalNodeMap?.get?.(id) || null;
        if (!id || !patch || typeof patch !== 'object') throw new Error('Person update requires id + patch');

        const effective = {};
        for (const [key, value] of Object.entries(patch)) {
            const before = person?.[key];
            if (JSON.stringify(before ?? null) !== JSON.stringify(value ?? null)) effective[key] = value;
        }
        const fields = Object.keys(effective);
        if (!fields.length) {
            diagnostics.noopPersonWrites += 1;
            diagnostics.lastAction = `${reason}:noop`;
            expose();
            return { changed: false, revision: Store.snapshot().revision };
        }
        if (fields.length !== 1) throw new Error('Person update expects exactly one field');

        const response = await Api.request(`/api/nodes/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(effective)
        });
        if (!response.ok) throw new Error(await response.text());
        const revision = Api.revisionFromResponse(response);
        Store.updatePerson(id, effective, { revision, reason });
        diagnostics.personWrites += 1;
        diagnostics.lastAction = reason;
        diagnostics.lastError = null;
        expose();
        return { changed: true, revision, patch: effective };
    }

    async function addSpouse(partnerId) {
        showStatus('מוסיף בן/בת זוג...');
        try {
            const value = await authoritativeGraph('add-spouse-intent');
            if (!value.people.some(person => person.id === partnerId)) throw new Error('Partner is missing from graph');
            const spouseId = nextPersonId();
            value.people.push({ id: spouseId, name: null, metadata: {} });
            addRelationship(value, { type: 'spouse', person1Id: partnerId, person2Id: spouseId });
            await putGraph(value, { anchorId: partnerId, reason: 'add-spouse' });
            showStatus('נשמר בהצלחה');
            return spouseId;
        } catch (error) {
            diagnostics.lastError = String(error?.message || error);
            expose();
            console.error('Unable to add spouse:', error);
            showStatus('שגיאה בהוספה');
            return null;
        }
    }

    async function addParent(childId) {
        showStatus('מוסיף הורה...');
        try {
            const value = await authoritativeGraph('add-parent-intent');
            const { parentsByChild } = graphIndexes(value);
            const existing = [...(parentsByChild.get(childId) || [])];
            if (existing.length >= 2) {
                showStatus('כבר יש שני הורים');
                return null;
            }
            if (!value.people.some(person => person.id === childId)) throw new Error('Child is missing from graph');

            const parentId = nextPersonId();
            value.people.push({ id: parentId, name: null, metadata: {} });
            addRelationship(value, { type: 'parent', person1Id: parentId, person2Id: childId });
            if (existing.length === 1) {
                addRelationship(value, { type: 'spouse', person1Id: existing[0], person2Id: parentId });
            }
            await putGraph(value, { anchorId: childId, reason: 'add-parent' });
            showStatus('נשמר בהצלחה');
            return parentId;
        } catch (error) {
            diagnostics.lastError = String(error?.message || error);
            expose();
            console.error('Unable to add parent:', error);
            showStatus('שגיאה בהוספה');
            return null;
        }
    }

    function selectAndFocus(personId, reason = 'new-person') {
        if (!Selection.selectPerson?.(personId, { source: reason })) return false;
        window.dispatchEvent(new CustomEvent('family-focus-person-name', {
            detail: { id: personId, reason }
        }));
        return true;
    }

    async function addChildForParents(parentIds, anchorId, graphValue = null) {
        const parents = [...new Set(parentIds.filter(Boolean))];
        if (!parents.length || parents.length > 2) throw new Error('Child creation requires one or two explicit parents');
        const value = graphValue ? cloneGraph(graphValue) : await authoritativeGraph('add-child-intent');
        const ids = new Set(value.people.map(person => person.id));
        if (parents.some(id => !ids.has(id))) throw new Error('Parent is missing from graph');

        if (parents.length === 2) {
            const [a, b] = parents;
            const union = value.relationships.some(relation =>
                relation.type === 'spouse' &&
                ((relation.person1Id === a && relation.person2Id === b) ||
                 (relation.person1Id === b && relation.person2Id === a))
            );
            if (!union) throw new Error('Selected parents are not a union');
        }

        const childId = nextPersonId();
        value.people.push({ id: childId, name: null, metadata: {} });
        parents.forEach(parentId => addRelationship(value, {
            type: 'parent', person1Id: parentId, person2Id: childId
        }));
        await putGraph(value, { anchorId: anchorId || parents[0], reason: 'add-child' });
        selectAndFocus(childId, 'new-child');
        return childId;
    }

    async function addChild(parentId) {
        showStatus('מוסיף ילד...');
        try {
            const value = await authoritativeGraph('add-child-policy');
            const { spousesByPerson } = graphIndexes(value);
            const partners = [...(spousesByPerson.get(parentId) || [])];
            if (partners.length > 1) {
                showStatus('בחרו זוגיות להוספת ילד');
                return { requiresUnion: true };
            }
            const parents = partners.length === 1 ? [parentId, partners[0]] : [parentId];
            const childId = await addChildForParents(parents, parentId, value);
            showStatus('נשמר בהצלחה');
            return { requiresUnion: false, childId };
        } catch (error) {
            diagnostics.lastError = String(error?.message || error);
            expose();
            console.error('Unable to add child:', error);
            showStatus('שגיאה בהוספה');
            return null;
        }
    }

    async function addChildToUnion(a, b) {
        showStatus('מוסיף ילד...');
        try {
            const childId = await addChildForParents(
                [a, b],
                Selection.getSelectedPersonId?.() || a
            );
            showStatus('נשמר בהצלחה');
            return childId;
        } catch (error) {
            diagnostics.lastError = String(error?.message || error);
            expose();
            console.error('Unable to add child to union:', error);
            showStatus('שגיאה בהוספה');
            return null;
        }
    }

    function meaningfulValue(value) {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return !!value.trim();
        if (Array.isArray(value)) return value.some(meaningfulValue);
        if (typeof value === 'object') return Object.values(value).some(meaningfulValue);
        return true;
    }

    async function hasMedia(personId) {
        try {
            const response = await Api.request(`/api/media?person=${encodeURIComponent(personId)}`, { cache: 'no-store' });
            if (!response.ok) return true;
            const payload = await response.json();
            return Array.isArray(payload.items) && payload.items.length > 0;
        } catch (_) {
            return true;
        }
    }

    async function deletePerson(id) {
        try {
            const value = await authoritativeGraph('delete-person-intent');
            const person = value.people.find(candidate => candidate.id === id);
            if (!person) return false;
            const { parentsByChild, spousesByPerson } = graphIndexes(value);
            const relatedAnchor = [...(parentsByChild.get(id) || [])][0] || [...(spousesByPerson.get(id) || [])][0] || null;
            const name = String(person.name || '').trim();
            const blank = (!name || name === 'שם') && !meaningfulValue(person.metadata || {});
            const media = blank ? await hasMedia(id) : true;
            if ((!blank || media) && !confirm('האם אתה בטוח שברצונך למחוק איש קשר זה?')) return false;

            showStatus('מוחק...');
            value.people = value.people.filter(candidate => candidate.id !== id);
            value.relationships = value.relationships.filter(relation =>
                relation.person1Id !== id && relation.person2Id !== id
            );
            const anchorId = relatedAnchor || value.people[0]?.id || null;
            if (Selection.getSelectedPersonId?.() === id && anchorId) {
                Selection.replaceUrlPerson(anchorId, {
                    source: 'delete-person',
                    persist: true,
                    notify: true
                });
            }
            await putGraph(value, { anchorId, reason: 'delete-person' });
            showStatus('נמחק');
            return true;
        } catch (error) {
            diagnostics.lastError = String(error?.message || error);
            expose();
            console.error('Unable to delete person:', error);
            showStatus('שגיאה במחיקה');
            return false;
        }
    }

    const actions = Object.freeze({
        'add-child': id => addChild(id),
        'add-parent': id => addParent(id),
        'add-spouse': id => addSpouse(id),
        'delete': id => deletePerson(id)
    });

    cardsLayer.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button || !actions[button.dataset.action]) return;
        event.preventDefault();
        event.stopPropagation();
        diagnostics.actionClicks += 1;
        diagnostics.lastAction = button.dataset.action;
        expose();
        void actions[button.dataset.action](button.dataset.id);
    }, true);

    window.FamilyMutations = Object.freeze({
        updatePerson,
        addChild,
        addChildToUnion,
        addParent,
        addSpouse,
        deletePerson,
        putGraph,
        diagnostics: () => ({ ...window.__familyMutationDiagnostics })
    });

    expose();
})();
