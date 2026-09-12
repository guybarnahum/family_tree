// Canonical graph/person mutation owner.
// UI modules express intent here; FamilyApi owns transport and GraphStore owns graph state.
(() => {
    if (window.FamilyMutations) return;

    const Store = window.FamilyGraphStore;
    const Api = window.FamilyApi;
    const Selection = window.FamilySelectionController;
    const cardsLayer = document.getElementById('cards-layer');
    if (!Store || !Api || !Selection || !cardsLayer) return;

    const DRAFT_TTL_MS = 30 * 60 * 1000;
    const draftLifecycle = new Map();

    const diagnostics = {
        structuralWrites: 0,
        personWrites: 0,
        noopPersonWrites: 0,
        draftCreates: 0,
        draftPromotions: 0,
        draftExpirations: 0,
        actionClicks: 0,
        lastAction: '',
        lastError: null
    };

    if (document.createElement && document.head) {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes family-node-plop-out {
                0% { transform: translateX(-50%) scale(1); opacity: 1; filter: blur(0); }
                28% { transform: translateX(-50%) scale(1.08); opacity: 1; filter: blur(0); }
                100% { transform: translateX(-50%) translateY(8px) scale(.08) rotate(3deg); opacity: 0; filter: blur(2px); }
            }
            .absolute-card.graph-node-plop-out {
                animation: family-node-plop-out .27s cubic-bezier(.55,.02,.9,.45) forwards !important;
                pointer-events: none !important;
                z-index: 120 !important;
            }
            @media (prefers-reduced-motion: reduce) {
                .absolute-card.graph-node-plop-out { animation-duration: .08s !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function expose() {
        window.__familyMutationDiagnostics = {
            ...diagnostics,
            activeDrafts: draftLifecycle.size
        };
    }

    function cloneGraph(value) {
        return typeof structuredClone === 'function'
            ? structuredClone(value)
            : JSON.parse(JSON.stringify(value));
    }

    function nextPersonId() {
        return 'node_' + Math.random().toString(36).slice(2, 11);
    }

    function meaningfulValue(value) {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return !!value.trim();
        if (Array.isArray(value)) return value.some(meaningfulValue);
        if (typeof value === 'object') return Object.values(value).some(meaningfulValue);
        return true;
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
        await Store.refresh({ authoritative: true, reason });
        const value = Store.snapshot().graph;
        if (!value) throw new Error('Authoritative graph is unavailable');
        return cloneGraph(value);
    }

    async function refreshProjection() {
        const GraphView = window.FamilyGraphView;
        if (!GraphView?.refresh) return null;
        return GraphView.refresh({ force: false, recenter: false });
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

    function clearDraftTimer(id) {
        const lifecycle = draftLifecycle.get(id);
        if (lifecycle?.timer != null && typeof clearTimeout === 'function') clearTimeout(lifecycle.timer);
        if (lifecycle) lifecycle.timer = null;
    }

    function scheduleDraftExpiry(id, delay = DRAFT_TTL_MS) {
        const lifecycle = draftLifecycle.get(id);
        if (!lifecycle || typeof setTimeout !== 'function') return;
        clearDraftTimer(id);
        const wait = Math.max(0, Number(delay) || 0);
        lifecycle.expiresAt = Date.now() + wait;
        lifecycle.timer = setTimeout(() => {
            lifecycle.timer = null;
            void expireDraft(id);
        }, wait);
    }

    async function animateRemoval(id) {
        const card = document.getElementById(`card-${id}`);
        if (!card?.classList) return;
        card.classList.add('graph-node-plop-out');
        if (typeof card.addEventListener !== 'function') return;
        await new Promise(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            card.addEventListener('animationend', finish, { once: true });
            if (typeof setTimeout === 'function') setTimeout(finish, 340);
        });
    }

    function restoreRemoval(id) {
        document.getElementById(`card-${id}`)?.classList?.remove?.('graph-node-plop-out');
    }

    function selectAndFocus(personId, reason = 'new-person') {
        if (!Selection.selectPerson?.(personId, { source: reason })) return false;
        window.dispatchEvent(new CustomEvent('family-focus-person-name', {
            detail: { id: personId, reason }
        }));
        return true;
    }

    async function createDraft(relationships, anchorId, reason) {
        const id = nextPersonId();
        const added = Store.addDraft(
            { id, name: null, metadata: {} },
            relationships,
            { reason: `${reason}-draft` }
        );
        if (!added) throw new Error('Unable to create draft person');

        draftLifecycle.set(id, {
            anchorId: anchorId || null,
            expiresAt: Date.now() + DRAFT_TTL_MS,
            timer: null
        });
        scheduleDraftExpiry(id);
        diagnostics.draftCreates += 1;
        diagnostics.lastAction = `${reason}:draft`;
        expose();

        await refreshProjection();
        selectAndFocus(id, reason);
        return id;
    }

    function draftHasContent(record, patch = {}) {
        const person = { ...(record?.person || {}), ...(patch || {}) };
        return meaningfulValue(person.name) || meaningfulValue(person.metadata || {});
    }

    async function persistDraft(id, patch = {}, { reason = 'draft-persist', force = false } = {}) {
        const record = Store.draft(id);
        if (!record) return { changed: false, revision: Store.snapshot().revision, draft: false };
        if (!force && !draftHasContent(record, patch)) {
            return { changed: false, revision: Store.snapshot().revision, draft: true };
        }

        const lifecycle = draftLifecycle.get(id) || {
            anchorId: null,
            expiresAt: Date.now() + DRAFT_TTL_MS,
            timer: null
        };
        const remaining = Math.max(0, lifecycle.expiresAt - Date.now());
        const value = await authoritativeGraph(`${reason}-intent`);
        const person = {
            ...record.person,
            ...patch,
            metadata: patch.metadata && typeof patch.metadata === 'object'
                ? { ...patch.metadata }
                : { ...(record.person.metadata || {}) }
        };
        if (!value.people.some(candidate => candidate.id === id)) value.people.push(person);
        for (const relation of record.relationships) addRelationship(value, relation);

        clearDraftTimer(id);
        Store.removeDraft(id, { reason: `${reason}-promote`, emit: false });
        draftLifecycle.delete(id);
        try {
            await putGraph(value, { anchorId: lifecycle.anchorId || id, reason });
            diagnostics.draftPromotions += 1;
            diagnostics.lastAction = reason;
            expose();
            return {
                changed: true,
                revision: Store.snapshot().revision,
                patch,
                draft: false
            };
        } catch (error) {
            Store.addDraft(record.person, record.relationships, { reason: `${reason}-restore` });
            draftLifecycle.set(id, {
                anchorId: lifecycle.anchorId,
                expiresAt: Date.now() + remaining,
                timer: null
            });
            scheduleDraftExpiry(id, remaining);
            await refreshProjection();
            throw error;
        }
    }

    async function ensurePersisted(id, reason) {
        if (!Store.isDraft?.(id)) return true;
        await persistDraft(id, {}, { reason, force: true });
        return !Store.isDraft?.(id);
    }

    async function expireDraft(id) {
        if (!Store.isDraft?.(id)) return false;
        const lifecycle = draftLifecycle.get(id) || {};
        await animateRemoval(id);
        const fallback = lifecycle.anchorId || Store.snapshot().graph?.people?.[0]?.id || null;
        if (Selection.getSelectedPersonId?.() === id && fallback) {
            Selection.replaceUrlPerson?.(fallback, {
                source: 'draft-expired',
                persist: true,
                notify: false
            });
        }
        Store.removeDraft(id, { reason: 'draft-expired' });
        draftLifecycle.delete(id);
        diagnostics.draftExpirations += 1;
        diagnostics.lastAction = 'draft-expired';
        expose();
        await refreshProjection();
        window.dispatchEvent(new CustomEvent('family-draft-expired', { detail: { id } }));
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

        if (Store.isDraft?.(id)) {
            const result = await persistDraft(id, effective, { reason: 'initialize-person' });
            if (result.changed) diagnostics.personWrites += 1;
            expose();
            return result;
        }

        const response = await Api.request(`/api/nodes/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(effective)
        });
        if (!response.ok) throw new Error(await response.text());
        const nextRevision = Api.revisionFromResponse(response);
        Store.updatePerson(id, effective, { revision: nextRevision, reason });
        diagnostics.personWrites += 1;
        diagnostics.lastAction = reason;
        diagnostics.lastError = null;
        expose();
        return { changed: true, revision: nextRevision, patch: effective };
    }

    async function addSpouse(partnerId) {
        showStatus('מוסיף בן/בת זוג...');
        try {
            await ensurePersisted(partnerId, 'initialize-before-spouse');
            const value = await authoritativeGraph('add-spouse-intent');
            if (!value.people.some(person => person.id === partnerId)) throw new Error('Partner is missing from graph');
            const spouseId = await createDraft(
                [{ type: 'spouse', person1Id: partnerId, person2Id: nextPersonId() }],
                partnerId,
                'new-spouse'
            );
            // createDraft owns the id; replace the placeholder id in the relationship atomically.
            const record = Store.draft(spouseId);
            if (record) record.relationships[0].person2Id = spouseId;
            showStatus('נוסף');
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
            await ensurePersisted(childId, 'initialize-before-parent');
            const value = await authoritativeGraph('add-parent-intent');
            const { parentsByChild } = graphIndexes(value);
            const existing = [...(parentsByChild.get(childId) || [])];
            if (existing.length >= 2) {
                showStatus('כבר יש שני הורים');
                return null;
            }
            if (!value.people.some(person => person.id === childId)) throw new Error('Child is missing from graph');

            const relations = [{ type: 'parent', person1Id: null, person2Id: childId }];
            if (existing.length === 1) {
                relations.push({ type: 'spouse', person1Id: existing[0], person2Id: null });
            }
            const parentId = await createDraft(relations, childId, 'new-parent');
            const record = Store.draft(parentId);
            if (record) {
                record.relationships.forEach(relation => {
                    if (relation.person1Id === null) relation.person1Id = parentId;
                    if (relation.person2Id === null) relation.person2Id = parentId;
                });
            }
            showStatus('נוסף');
            return parentId;
        } catch (error) {
            diagnostics.lastError = String(error?.message || error);
            expose();
            console.error('Unable to add parent:', error);
            showStatus('שגיאה בהוספה');
            return null;
        }
    }

    async function addChildForParents(parentIds, anchorId, graphValue = null) {
        const parents = [...new Set(parentIds.filter(Boolean))];
        if (!parents.length || parents.length > 2) throw new Error('Child creation requires one or two explicit parents');
        for (const parentId of parents) await ensurePersisted(parentId, 'initialize-before-child');
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
        const relations = parents.map(parentId => ({
            type: 'parent', person1Id: parentId, person2Id: childId
        }));
        const added = Store.addDraft(
            { id: childId, name: null, metadata: {} },
            relations,
            { reason: 'new-child-draft' }
        );
        if (!added) throw new Error('Unable to create draft child');
        draftLifecycle.set(childId, {
            anchorId: anchorId || parents[0],
            expiresAt: Date.now() + DRAFT_TTL_MS,
            timer: null
        });
        scheduleDraftExpiry(childId);
        diagnostics.draftCreates += 1;
        expose();
        await refreshProjection();
        selectAndFocus(childId, 'new-child');
        return childId;
    }

    async function addChild(parentId) {
        showStatus('מוסיף ילד...');
        try {
            await ensurePersisted(parentId, 'initialize-before-child-policy');
            const value = await authoritativeGraph('add-child-policy');
            const { spousesByPerson } = graphIndexes(value);
            const partners = [...(spousesByPerson.get(parentId) || [])];
            if (partners.length > 1) {
                showStatus('בחרו זוגיות להוספת ילד');
                return { requiresUnion: true };
            }
            const parents = partners.length === 1 ? [parentId, partners[0]] : [parentId];
            const childId = await addChildForParents(parents, parentId, value);
            showStatus('נוסף');
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
            await ensurePersisted(a, 'initialize-before-union-child');
            await ensurePersisted(b, 'initialize-before-union-child');
            const value = await authoritativeGraph('add-child-union-intent');
            const childId = await addChildForParents(
                [a, b],
                Selection.getSelectedPersonId?.() || a,
                value
            );
            showStatus('נוסף');
            return childId;
        } catch (error) {
            diagnostics.lastError = String(error?.message || error);
            expose();
            console.error('Unable to add child to union:', error);
            showStatus('שגיאה בהוספה');
            return null;
        }
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

    async function deleteDraft(id) {
        const lifecycle = draftLifecycle.get(id) || {};
        showStatus('מוחק...');
        await animateRemoval(id);
        const fallback = lifecycle.anchorId || Store.snapshot().graph?.people?.[0]?.id || null;
        if (Selection.getSelectedPersonId?.() === id && fallback) {
            Selection.replaceUrlPerson?.(fallback, {
                source: 'delete-draft-person',
                persist: true,
                notify: false
            });
        }
        clearDraftTimer(id);
        Store.removeDraft(id, { reason: 'delete-draft-person' });
        draftLifecycle.delete(id);
        await refreshProjection();
        showStatus('נמחק');
        return true;
    }

    async function deletePerson(id) {
        if (Store.isDraft?.(id)) return deleteDraft(id);
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
            await animateRemoval(id);
            value.people = value.people.filter(candidate => candidate.id !== id);
            value.relationships = value.relationships.filter(relation =>
                relation.person1Id !== id && relation.person2Id !== id
            );
            const anchorId = relatedAnchor || value.people[0]?.id || null;
            if (Selection.getSelectedPersonId?.() === id && anchorId) {
                Selection.replaceUrlPerson(anchorId, {
                    source: 'delete-person',
                    persist: true,
                    notify: false
                });
            }
            await putGraph(value, { anchorId, reason: 'delete-person' });
            showStatus('נמחק');
            return true;
        } catch (error) {
            restoreRemoval(id);
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
        persistDraft,
        expireDraft,
        putGraph,
        constants: Object.freeze({ draftTtlMs: DRAFT_TTL_MS }),
        diagnostics: () => ({ ...window.__familyMutationDiagnostics })
    });

    expose();
})();
