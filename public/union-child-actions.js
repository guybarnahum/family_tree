// Union-aware child/parent actions.
//
// Structural writes are expressed as one canonical graph PUT so one logical action has one
// revision. Canonical data comes from FamilyGraphStore; render/controller lifecycle is explicit.
(() => {
    if (window.FamilyUnionChildActions) return;

    const cardsLayer = document.getElementById('cards-layer');
    const Store = window.FamilyGraphStore;
    if (!cardsLayer || !Store) return;

    const UNION_LANE_CLEARANCE = 18;
    const UNION_LANE_STEP = 16;
    const MAX_FOCUS_ATTEMPTS = 16;

    let graph = null;
    let spouseMap = new Map();
    let parentsMap = new Map();
    let syncQueued = false;
    let installed = false;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card[data-child-union-required="true"] [data-action="add-child"] {
            display: none !important;
        }

        #family-union-child-actions {
            position: absolute;
            inset: 0;
            z-index: 58;
            pointer-events: none;
        }

        #family-union-child-actions .family-union-child-action {
            position: absolute;
            transform: translate(-50%, -50%);
            min-height: 23px;
            padding: 2px 8px;
            border: 1px solid rgba(88,129,87,.36);
            border-radius: 999px;
            background: rgba(255,255,255,.97);
            box-shadow: 0 2px 7px rgba(52,78,65,.13);
            color: #588157;
            font: 600 8px/1 Inter, sans-serif;
            white-space: nowrap;
            cursor: pointer;
            pointer-events: auto;
            transition: background-color .14s ease, border-color .14s ease, transform .14s ease;
        }

        #family-union-child-actions .family-union-child-action:hover,
        #family-union-child-actions .family-union-child-action:focus-visible {
            background: #fff;
            border-color: #588157;
            outline: none;
            transform: translate(-50%, -50%) scale(1.04);
        }

        @media (max-width:768px), (hover:none) and (pointer:coarse) {
            #family-union-child-actions .family-union-child-action {
                min-height: 30px;
                padding: 4px 10px;
                font-size: 10px;
            }
        }

        @media print {
            #family-union-child-actions { display: none !important; }
        }
    `;
    document.head.appendChild(style);

    function refreshFromStore() {
        const snapshot = Store.snapshot();
        graph = snapshot.graph || null;
        spouseMap = snapshot.indexes?.spousesByPerson || new Map();
        parentsMap = snapshot.indexes?.parentsByChild || new Map();
        return graph;
    }

    function spouseIds(personId) {
        return [...(spouseMap.get(personId) || [])];
    }

    function explicitParentIds(childId) {
        return [...(parentsMap.get(childId) || [])];
    }

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
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

    function cloneGraph(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function nextPersonId() {
        return 'node_' + Math.random().toString(36).slice(2, 11);
    }

    function currentRootId() {
        const selected = window.FamilySelectionController?.getSelectedPersonId?.();
        if (selected) return selected;
        const card = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        if (card?.dataset.nodeId) return card.dataset.nodeId;
        const urlId = new URL(window.location.href).searchParams.get('person');
        if (urlId) return urlId;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    async function authoritativeGraph() {
        // Structural writes may not use the intentionally coalesced/stale remote view. Force one
        // authoritative Store refresh first, then clone that exact canonical document for intent.
        const snapshot = await Store.refresh({
            authoritative: true,
            reason: 'structural-intent'
        });
        if (!snapshot?.graph) throw new Error('Authoritative graph is unavailable');
        refreshFromStore();
        return cloneGraph(snapshot.graph);
    }

    async function putGraph(value, anchorId) {
        const payload = {
            ...value,
            format: 'family-graph',
            version: 2,
            people: value.people || [],
            relationships: value.relationships || []
        };
        const response = await fetch('/api/graph', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(await response.text());

        const revision = Store.finiteRevision(
            response.headers.get('X-Family-Revision') ||
            response.headers.get('X-Family-Graph-Revision')
        );
        Store.noteMutation({ scope: 'graph', revision });

        // One canonical graph load folds the server-normalized result into Store and performs
        // the one controller-owned structural render generation.
        if (typeof loadTree === 'function') await loadTree(anchorId || null, true);
        else await Store.read({ refresh: true, reason: 'structural-write' });
        refreshFromStore();
        queueSync();
    }

    function personName(id) {
        const person = Store.person(id) || graph?.people?.find(candidate => candidate.id === id);
        return String(person?.name || '').trim() || 'ללא שם';
    }

    async function selectAndFocusNewPerson(personId) {
        for (let attempt = 0; attempt < MAX_FOCUS_ATTEMPTS; attempt++) {
            const card = cardsLayer.querySelector(`.absolute-card[data-node-id="${CSS.escape(personId)}"]`);
            if (card) {
                card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await new Promise(resolve => requestAnimationFrame(resolve));
                window.dispatchEvent(new CustomEvent('family-focus-person-name', {
                    detail: { id: personId, reason: 'new-child' }
                }));
                return true;
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return false;
    }

    async function addChildForParents(parentIds, anchorId) {
        const uniqueParents = [...new Set(parentIds.filter(Boolean))];
        if (!uniqueParents.length || uniqueParents.length > 2) {
            throw new Error('Child creation requires one or two explicit parents');
        }

        const value = await authoritativeGraph();
        const ids = new Set(value.people.map(person => person.id));
        if (uniqueParents.some(id => !ids.has(id))) throw new Error('Parent is missing from graph');

        if (uniqueParents.length === 2) {
            const [a, b] = uniqueParents;
            const unionExists = value.relationships.some(relation =>
                relation.type === 'spouse' &&
                ((relation.person1Id === a && relation.person2Id === b) ||
                 (relation.person1Id === b && relation.person2Id === a))
            );
            if (!unionExists) throw new Error('Selected parents are not a union');
        }

        const childId = nextPersonId();
        value.people.push({ id: childId, name: null, metadata: {} });
        for (const parentId of uniqueParents) {
            addRelationship(value, {
                type: 'parent',
                person1Id: parentId,
                person2Id: childId
            });
        }

        await putGraph(value, anchorId || uniqueParents[0]);
        await selectAndFocusNewPerson(childId);
        return childId;
    }

    async function unionAwareAddChild(parentId) {
        showStatus('מוסיף ילד...');
        try {
            const value = await authoritativeGraph();
            const partners = spouseIds(parentId);
            if (partners.length > 1) {
                showStatus('בחרו זוגיות להוספת ילד');
                queueSync();
                return;
            }

            const childId = nextPersonId();
            value.people.push({ id: childId, name: null, metadata: {} });
            addRelationship(value, {
                type: 'parent', person1Id: parentId, person2Id: childId
            });
            if (partners.length === 1) {
                addRelationship(value, {
                    type: 'parent', person1Id: partners[0], person2Id: childId
                });
            }

            await putGraph(value, parentId);
            await selectAndFocusNewPerson(childId);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add union-aware child:', error);
            showStatus('שגיאה בהוספה');
        }
    }

    async function addChildToUnion(a, b) {
        showStatus('מוסיף ילד...');
        try {
            await addChildForParents([a, b], currentRootId() || a);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add child to union:', error);
            showStatus('שגיאה בהוספה');
        }
    }

    async function unionAwareAddParent(childId) {
        showStatus('מוסיף הורה...');
        try {
            const value = await authoritativeGraph();
            const existingParents = explicitParentIds(childId);
            if (existingParents.length >= 2) {
                showStatus('כבר יש שני הורים');
                return;
            }

            const parentId = nextPersonId();
            value.people.push({ id: parentId, name: null, metadata: {} });
            addRelationship(value, {
                type: 'parent', person1Id: parentId, person2Id: childId
            });

            if (existingParents.length === 1) {
                addRelationship(value, {
                    type: 'spouse', person1Id: existingParents[0], person2Id: parentId
                });
            }

            await putGraph(value, childId);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add union-aware parent:', error);
            showStatus('שגיאה בהוספה');
        }
    }

    function meaningfulValue(value) {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return !!value.trim();
        if (Array.isArray(value)) return value.some(meaningfulValue);
        if (typeof value === 'object') return Object.values(value).some(meaningfulValue);
        return true;
    }

    function personLooksUnfilled(node) {
        if (!node) return false;
        const name = String(node.name || '').trim();
        if (name && name !== 'שם') return false;
        return !meaningfulValue(node.metadata || {});
    }

    async function blankPersonHasMedia(personId) {
        try {
            const response = await fetch(`/api/media?person=${encodeURIComponent(personId)}`, { cache: 'no-store' });
            if (!response.ok) return true;
            const payload = await response.json();
            return Array.isArray(payload.items) && payload.items.length > 0;
        } catch (_) {
            return true;
        }
    }

    function deletionAnchor(id) {
        refreshFromStore();
        const parent = explicitParentIds(id)[0];
        if (parent) return parent;
        return spouseIds(id)[0] || null;
    }

    async function deleteWithoutPrompt(id) {
        const anchorId = deletionAnchor(id);
        showStatus('מוחק...');
        const response = await fetch(`/api/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok) return showStatus('שגיאה במחיקה');
        const revision = Store.finiteRevision(
            response.headers.get('X-Family-Revision') || response.headers.get('X-Family-Graph-Revision')
        );
        Store.noteMutation({ scope: 'graph', revision });
        await loadTree(anchorId, true);
        showStatus('נמחק');
    }

    function generationY(unit) {
        if (Number.isFinite(unit?.generationCenterY)) return unit.generationCenterY;
        const member = unit?.members?.[0];
        return member ? member.targetY + member.cardHeight / 2 : null;
    }

    function unionPoint(unit, aId, bId) {
        if (!unit?.members?.length || typeof globalNodeMap === 'undefined') return null;
        const a = globalNodeMap.get(aId);
        const b = globalNodeMap.get(bId);
        if (!a || !b) return null;

        const index = new Map(unit.members.map((member, i) => [member.id, i]));
        if (!index.has(aId) || !index.has(bId)) return null;
        const centerY = generationY(unit);
        if (!Number.isFinite(centerY)) return null;

        const left = a.x <= b.x ? a : b;
        const right = left === a ? b : a;
        const x = ((left.x + left.cardWidth / 2) + (right.x - right.cardWidth / 2)) / 2;
        const adjacent = Math.abs(index.get(aId) - index.get(bId)) === 1;
        if (adjacent) return { x, y: centerY };

        const routedKeys = [];
        for (const member of unit.members) {
            for (const spouseId of spouseIds(member.id)) {
                if (!index.has(spouseId) || member.id >= spouseId) continue;
                if (Math.abs(index.get(member.id) - index.get(spouseId)) > 1) {
                    routedKeys.push(pairKey(member.id, spouseId));
                }
            }
        }
        routedKeys.sort((aKey, bKey) => aKey.localeCompare(bKey));
        const laneIndex = Math.max(0, routedKeys.indexOf(pairKey(aId, bId)));
        const maxBottom = Math.max(...unit.members.map(member => member.targetY + member.cardHeight));
        return {
            x,
            y: maxBottom + UNION_LANE_CLEARANCE + laneIndex * UNION_LANE_STEP
        };
    }

    function ensureOverlay() {
        let overlay = document.getElementById('family-union-child-actions');
        if (overlay?.parentElement === cardsLayer) return overlay;
        overlay?.remove();
        overlay = document.createElement('div');
        overlay.id = 'family-union-child-actions';
        cardsLayer.appendChild(overlay);
        return overlay;
    }

    function applyPersonChildPolicy() {
        cardsLayer.querySelectorAll('.absolute-card[data-node-id]').forEach(card => {
            const requiresUnion = spouseIds(card.dataset.nodeId).length > 1;
            if (requiresUnion) card.dataset.childUnionRequired = 'true';
            else card.removeAttribute('data-child-union-required');
        });
    }

    function syncUnionActions() {
        refreshFromStore();
        applyPersonChildPolicy();
        const overlay = ensureOverlay();
        overlay.replaceChildren();

        const rootId = currentRootId();
        if (!rootId || spouseIds(rootId).length <= 1) return;
        if (typeof unitByNodeId === 'undefined' || typeof globalNodeMap === 'undefined') return;
        const unit = unitByNodeId.get(rootId);
        if (!unit) return;

        for (const spouseId of spouseIds(rootId)) {
            if (!globalNodeMap.has(spouseId) || unitByNodeId.get(spouseId) !== unit) continue;
            const point = unionPoint(unit, rootId, spouseId);
            if (!point) continue;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'family-union-child-action';
            button.dataset.unionParent1 = rootId;
            button.dataset.unionParent2 = spouseId;
            button.style.left = `${point.x}px`;
            button.style.top = `${point.y}px`;
            button.textContent = '+ ילד';
            button.title = `הוסף ילד עם ${personName(spouseId)}`;
            button.setAttribute('aria-label', button.title);
            overlay.appendChild(button);
        }
    }

    function queueSync() {
        if (syncQueued) return;
        syncQueued = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            syncQueued = false;
            try { syncUnionActions(); }
            catch (error) { console.warn('Unable to sync union child actions:', error); }
        }));
    }

    function refreshOpenPersonSearch() {
        const input = document.querySelector('.graph-search-input');
        if (input && (document.activeElement === input || input.value)) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        window.FamilyPersonPickerLabels?.refresh?.();
    }

    function install() {
        if (installed) return;
        if (!window.__familyMultiPartnerRefinement) {
            setTimeout(install, 20);
            return;
        }
        installed = true;
        refreshFromStore();

        const baseDeleteNode = typeof deleteNode === 'function' ? deleteNode : null;
        addChild = unionAwareAddChild;
        addParent = unionAwareAddParent;

        if (baseDeleteNode) {
            deleteNode = async function quietBlankDeleteNode(id) {
                const node = typeof globalNodeMap !== 'undefined' ? globalNodeMap.get(id) : null;
                if (personLooksUnfilled(node) && !(await blankPersonHasMedia(id))) {
                    return deleteWithoutPrompt(id);
                }
                return baseDeleteNode(id);
            };
        }

        // No layout wrapper and no card MutationObserver: RenderController explicitly calls
        // FamilyUnionChildActions.refresh() after authoritative geometry, and store changes are
        // communicated through a dedicated event.
        window.addEventListener('family-graph-store-changed', queueSync);
        window.addEventListener('family-graph-rendered', queueSync);
        window.addEventListener('family-person-disambiguation-updated', () => {
            refreshFromStore();
            refreshOpenPersonSearch();
            queueSync();
        });
        window.addEventListener('family-person-pane-saved', () => {
            queueMicrotask(() => {
                refreshFromStore();
                refreshOpenPersonSearch();
                queueSync();
            });
        });
        window.addEventListener('resize', queueSync);

        cardsLayer.addEventListener('click', event => {
            const button = event.target.closest('.family-union-child-action');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            void addChildToUnion(button.dataset.unionParent1, button.dataset.unionParent2);
        }, true);

        queueSync();
    }

    window.FamilyUnionChildActions = Object.freeze({
        refresh: queueSync,
        addChildToUnion,
        spouseIds: personId => [...spouseIds(personId)]
    });

    install();
})();
