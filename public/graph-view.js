// Person-centric, ephemeral family graph projection.
// GraphStore owns canonical data, SelectionController owns the selected person, and
// RenderController owns layout/viewport commits. This module owns projection semantics only.
(() => {
    if (window.FamilyGraphView) return;

    const Store = window.FamilyGraphStore;
    const Selection = window.FamilySelectionController;
    if (!Store) return console.warn('FamilyGraphStore must load before graph-view');

    let graphPeople = [];
    let graphRelationships = [];
    let graphPeopleById = new Map();
    let parentsByChild = new Map();
    let childrenByParent = new Map();
    let spousesByPerson = new Map();
    let graphRootId = null;
    let graphSignature = '';
    let visibleIds = new Set();
    let primaryIds = new Set();
    let lateralIds = new Set();
    let rootSiblingIds = new Set();
    const expandedBySource = new Map();

    const cardsLayer = document.getElementById('cards-layer');
    const svgLayer = document.getElementById('svg-layer');
    const title = document.querySelector('h1');
    const titleCard = title?.parentElement;
    const subtitle = titleCard?.querySelector('p');
    if (!cardsLayer || !svgLayer) return;
    titleCard?.classList.add('family-title-card');

    const style = document.createElement('style');
    style.textContent = `
        .graph-search-wrap { position:relative; margin-top:8px; width:min(290px,68vw); direction:ltr; }
        .graph-search-input {
            width:100%; border:1px solid rgba(163,177,138,.45); background:rgba(255,255,255,.82);
            color:#344e41; border-radius:999px; padding:5px 11px; font-size:11px; line-height:1.3; outline:none;
        }
        .graph-search-input:focus { border-color:#588157; background:#fff; }
        .graph-search-results {
            position:absolute; top:calc(100% + 4px); left:0; right:0; max-height:230px; overflow:auto;
            border:1px solid rgba(163,177,138,.4); border-radius:10px; background:rgba(255,255,255,.98);
            box-shadow:0 10px 24px rgba(52,78,65,.14); display:none; z-index:200;
        }
        .graph-search-results.open { display:block; }
        .graph-search-result {
            display:block; width:100%; border:0; border-bottom:1px solid rgba(163,177,138,.18);
            background:transparent; color:#344e41; padding:7px 10px; text-align:left; cursor:pointer; font-size:11px;
        }
        .graph-search-result:last-child { border-bottom:0; }
        .graph-search-result:hover,.graph-search-result:focus-visible { background:rgba(163,177,138,.13); outline:none; }
        .graph-search-result small { display:block; color:#8a8a84; font-size:9px; margin-top:1px; }
        .absolute-card.graph-context { opacity:.56; filter:saturate(.62); }
        .absolute-card.graph-context:hover,.absolute-card.graph-context:focus-within { opacity:.92; filter:saturate(.9); }
        .absolute-card.graph-root { box-shadow:0 8px 22px rgba(52,78,65,.18); border-top-width:4px; }
        .absolute-card:not(:has([contenteditable]:focus)) { cursor:pointer; }
        .graph-frontier {
            position:absolute; top:50%; right:-15px; transform:translateY(-50%); min-width:25px; height:25px;
            padding:0 6px; border:1px solid rgba(88,129,87,.36); border-radius:999px;
            background:rgba(255,255,255,.96); color:#588157; font-size:10px; font-weight:600;
            line-height:23px; text-align:center; box-shadow:0 2px 7px rgba(52,78,65,.10);
            opacity:.72; z-index:35; cursor:pointer;
        }
        .graph-frontier.graph-frontier-collapse {
            color:#344e41; background:rgba(237,242,232,.98); border-color:rgba(52,78,65,.42);
            font-size:15px; line-height:21px;
        }
        .graph-frontier:hover,.graph-frontier:focus-visible { opacity:1; border-color:#588157; outline:none; }
    `;
    document.head.appendChild(style);

    let searchInput = null;
    let searchResults = null;
    if (titleCard) {
        const wrap = document.createElement('div');
        wrap.className = 'graph-search-wrap';
        wrap.innerHTML = `
            <input class="graph-search-input" type="search" dir="auto" autocomplete="off" spellcheck="false"
                   placeholder="Search person…" aria-label="Search family graph">
            <div class="graph-search-results" role="listbox"></div>`;
        titleCard.appendChild(wrap);
        searchInput = wrap.querySelector('.graph-search-input');
        searchResults = wrap.querySelector('.graph-search-results');
    }

    function hasMetadataValue(person, key) {
        return !!person?.metadata && Object.prototype.hasOwnProperty.call(person.metadata, key);
    }
    function personLifeDates(person) {
        return hasMetadataValue(person, 'lifeDates') ? String(person.metadata.lifeDates ?? '') : String(person?.dates ?? '');
    }
    function personBio(person) {
        return hasMetadataValue(person, 'bio') ? String(person.metadata.bio ?? '') : String(person?.description ?? '');
    }
    function graphStructureSignature(people, relationships) {
        return JSON.stringify([
            (people || []).map(person => [person.id, person.name]),
            (relationships || []).map(relation => [relation.id, relation.type, relation.person1Id, relation.person2Id])
        ]);
    }
    function addToMapSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuildProjectionIndexes() {
        graphPeopleById = new Map(graphPeople.map(person => [person.id, person]));
        parentsByChild = new Map();
        childrenByParent = new Map();
        spousesByPerson = new Map();
        for (const relation of graphRelationships) {
            if (relation.type === 'parent') {
                addToMapSet(parentsByChild, relation.person2Id, relation.person1Id);
                addToMapSet(childrenByParent, relation.person1Id, relation.person2Id);
            } else if (relation.type === 'spouse') {
                addToMapSet(spousesByPerson, relation.person1Id, relation.person2Id);
                addToMapSet(spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }

        // Conservative view-only normalization for imported legacy rows: one explicit parent
        // plus exactly one spouse projects as a two-parent family. Never infer with 2+ spouses.
        const explicitParents = new Map([...parentsByChild].map(([id, parents]) => [id, new Set(parents)]));
        for (const [childId, parents] of explicitParents) {
            if (parents.size !== 1) continue;
            const [parentId] = parents;
            const spouses = [...(spousesByPerson.get(parentId) || [])];
            if (spouses.length !== 1 || !graphPeopleById.has(spouses[0])) continue;
            addToMapSet(parentsByChild, childId, spouses[0]);
            addToMapSet(childrenByParent, spouses[0], childId);
        }
    }

    function acceptGraph(documentValue) {
        graphPeople = documentValue?.people || [];
        graphRelationships = documentValue?.relationships || [];
        graphSignature = graphStructureSignature(graphPeople, graphRelationships);
        rebuildProjectionIndexes();
    }

    function addAncestorCouples(seedId, target) {
        const queue = [seedId];
        const walked = new Set();
        while (queue.length) {
            const childId = queue.shift();
            if (walked.has(childId)) continue;
            walked.add(childId);
            for (const parentId of parentsByChild.get(childId) || []) {
                target.add(parentId);
                queue.push(parentId);
                for (const spouseId of spousesByPerson.get(parentId) || []) {
                    target.add(spouseId);
                    queue.push(spouseId);
                }
            }
        }
    }
    function addDirectParentsWithSpouses(seedId, target) {
        for (const parentId of parentsByChild.get(seedId) || []) {
            target.add(parentId);
            for (const spouseId of spousesByPerson.get(parentId) || []) target.add(spouseId);
        }
    }
    function addDescendants(seedId, target) {
        const queue = [seedId];
        const walked = new Set();
        while (queue.length) {
            const parentId = queue.shift();
            if (walked.has(parentId)) continue;
            walked.add(parentId);
            for (const childId of childrenByParent.get(parentId) || []) {
                target.add(childId);
                queue.push(childId);
            }
        }
    }
    function siblingsOf(personId) {
        const result = new Set();
        for (const parentId of parentsByChild.get(personId) || []) {
            for (const childId of childrenByParent.get(parentId) || []) {
                if (childId !== personId) result.add(childId);
            }
        }
        return result;
    }
    function activeExpandedBranches() {
        const result = new Set();
        for (const branches of expandedBySource.values()) for (const id of branches) result.add(id);
        return result;
    }

    function computeVisibleGraph() {
        primaryIds = new Set();
        lateralIds = new Set();
        rootSiblingIds = new Set();
        if (!graphRootId || !graphPeopleById.has(graphRootId)) {
            visibleIds = new Set();
            return;
        }

        primaryIds.add(graphRootId);
        addAncestorCouples(graphRootId, primaryIds);
        const descendants = new Set();
        addDescendants(graphRootId, descendants);
        descendants.forEach(id => primaryIds.add(id));

        for (const spouseId of spousesByPerson.get(graphRootId) || []) {
            primaryIds.add(spouseId);
            addDirectParentsWithSpouses(spouseId, primaryIds);
            const spouseDescendants = new Set();
            addDescendants(spouseId, spouseDescendants);
            for (const id of spouseDescendants) {
                descendants.add(id);
                primaryIds.add(id);
            }
        }

        for (const personId of [graphRootId, ...descendants]) {
            for (const spouseId of spousesByPerson.get(personId) || []) primaryIds.add(spouseId);
        }
        for (const personId of [...primaryIds]) {
            const isAncestorOrRoot = personId === graphRootId || !descendants.has(personId);
            if (!isAncestorOrRoot) continue;
            for (const spouseId of spousesByPerson.get(personId) || []) primaryIds.add(spouseId);
        }

        rootSiblingIds = siblingsOf(graphRootId);
        for (const siblingId of rootSiblingIds) if (!primaryIds.has(siblingId)) lateralIds.add(siblingId);

        for (const branchId of activeExpandedBranches()) {
            if (!graphPeopleById.has(branchId)) continue;
            lateralIds.add(branchId);
            addAncestorCouples(branchId, lateralIds);
            addDescendants(branchId, lateralIds);
            for (const personId of [...lateralIds]) {
                for (const spouseId of spousesByPerson.get(personId) || []) {
                    if (!primaryIds.has(spouseId)) lateralIds.add(spouseId);
                }
            }
        }
        primaryIds.forEach(id => lateralIds.delete(id));
        visibleIds = new Set([...primaryIds, ...lateralIds]);
    }

    function sharedVisibleChild(a, b) {
        const aChildren = childrenByParent.get(a) || new Set();
        const bChildren = childrenByParent.get(b) || new Set();
        for (const childId of aChildren) if (visibleIds.has(childId) && bChildren.has(childId)) return true;
        return false;
    }

    function chooseVisibleSpouses() {
        const choice = new Map();
        const claimed = new Set();
        const ordered = [...visibleIds].sort((a, b) => {
            const ar = a === graphRootId ? 0 : (primaryIds.has(a) ? 1 : 2);
            const br = b === graphRootId ? 0 : (primaryIds.has(b) ? 1 : 2);
            return ar - br || a.localeCompare(b);
        });
        for (const personId of ordered) {
            if (claimed.has(personId)) continue;
            const candidates = [...(spousesByPerson.get(personId) || [])]
                .filter(id => visibleIds.has(id) && !claimed.has(id));
            if (!candidates.length) continue;
            candidates.sort((a, b) => {
                const score = candidateId =>
                    (personId === graphRootId || candidateId === graphRootId ? 1000 : 0) +
                    (sharedVisibleChild(personId, candidateId) ? 500 : 0) +
                    (primaryIds.has(candidateId) ? 100 : 0);
                return score(b) - score(a) || a.localeCompare(b);
            });
            const spouseId = candidates[0];
            choice.set(personId, spouseId);
            choice.set(spouseId, personId);
            claimed.add(personId);
            claimed.add(spouseId);
        }
        return choice;
    }

    function projectVisiblePeople() {
        const spouseChoice = chooseVisibleSpouses();
        return [...visibleIds]
            .map(id => graphPeopleById.get(id))
            .filter(Boolean)
            .map(person => {
                const visibleParents = [...(parentsByChild.get(person.id) || [])]
                    .filter(parentId => visibleIds.has(parentId))
                    .sort((a, b) => a.localeCompare(b));
                let parentId = visibleParents[0] || null;
                for (const candidate of visibleParents) {
                    const spouseId = spouseChoice.get(candidate);
                    if (spouseId && visibleParents.includes(spouseId)) {
                        parentId = candidate;
                        break;
                    }
                }
                return {
                    id: person.id,
                    name: person.name,
                    dates: personLifeDates(person),
                    description: personBio(person),
                    metadata: person.metadata && typeof person.metadata === 'object' ? { ...person.metadata } : {},
                    last_updated: person.lastUpdated,
                    parent_id: parentId,
                    spouse_id: spouseChoice.get(person.id) || null,
                    viewRole: person.id === graphRootId
                        ? 'root'
                        : (rootSiblingIds.has(person.id)
                            ? 'sibling'
                            : (lateralIds.has(person.id) ? 'context' : 'primary'))
                };
            });
    }

    function hiddenBranchesFor(personId) {
        const hidden = new Set();
        for (const id of parentsByChild.get(personId) || []) if (!visibleIds.has(id)) hidden.add(id);
        for (const id of childrenByParent.get(personId) || []) if (!visibleIds.has(id)) hidden.add(id);
        for (const id of spousesByPerson.get(personId) || []) if (!visibleIds.has(id)) hidden.add(id);
        for (const id of siblingsOf(personId)) if (!visibleIds.has(id)) hidden.add(id);
        return hidden;
    }

    function decorateCards() {
        for (const node of globalNodes) {
            const card = document.getElementById(`card-${node.id}`);
            if (!card) continue;
            card.querySelectorAll('.graph-frontier').forEach(button => button.remove());
            card.classList.toggle('graph-root', node.id === graphRootId);
            card.classList.toggle('graph-context', node.viewRole === 'context');
            card.setAttribute('title', node.id === graphRootId
                ? 'Current center'
                : 'Click to center the family graph here');

            const expanded = expandedBySource.has(node.id);
            const hidden = hiddenBranchesFor(node.id);
            if (!expanded && !hidden.size) continue;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `graph-frontier${expanded ? ' graph-frontier-collapse' : ''}`;
            if (expanded) {
                button.dataset.graphCollapse = node.id;
                button.textContent = '−';
                button.title = 'Collapse the branch opened here';
            } else {
                button.dataset.graphExpand = node.id;
                button.textContent = `+${hidden.size}`;
                button.title = `Show ${hidden.size} more connected ${hidden.size === 1 ? 'person' : 'people'}`;
            }
            button.setAttribute('aria-label', button.title);
            card.appendChild(button);
        }
    }

    function updateRootUI() {
        if (subtitle) subtitle.textContent = 'דורות של אהבה • גרור כדי לנווט';
        if (searchInput && document.activeElement !== searchInput) searchInput.value = '';
    }

    async function renderGraphView({ recenter = false, reason = 'projection' } = {}) {
        if (!graphRootId || !graphPeopleById.has(graphRootId)) return null;
        const anchor = !recenter && globalNodeMap.has(graphRootId) && typeof captureAnchor === 'function'
            ? captureAnchor(graphRootId)
            : null;
        computeVisibleGraph();
        globalNodes = projectVisiblePeople();
        globalNodeMap = new Map(globalNodes.map(node => [node.id, node]));
        renderCards();
        decorateCards();
        updateRootUI();

        const controller = window.FamilyRenderController;
        if (!controller?.renderProjection) throw new Error('RenderController is required for graph projection');
        return controller.renderProjection({ rootId: graphRootId, recenter, anchor, reason });
    }

    function chooseInitialRoot() {
        const selected = Selection?.getSelectedPersonId?.();
        if (selected && graphPeopleById.has(selected)) return selected;
        if (graphPeopleById.has('guy_1')) return 'guy_1';
        return [...graphPeople]
            .filter(person => person.name && person.name !== 'משפחתנו')
            .sort((a, b) => {
                const degree = id =>
                    (parentsByChild.get(id)?.size || 0) +
                    (childrenByParent.get(id)?.size || 0) +
                    (spousesByPerson.get(id)?.size || 0);
                return degree(b.id) - degree(a.id) || a.id.localeCompare(b.id);
            })[0]?.id || graphPeople[0]?.id || null;
    }

    function syncPersonDetailsWithoutRender(people) {
        let changed = false;
        for (const source of people || []) {
            const canonical = graphPeopleById.get(source.id);
            const visible = globalNodeMap?.get?.(source.id);
            const nextMetadata = source.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : {};
            if (canonical) {
                const before = JSON.stringify(canonical.metadata || {});
                const after = JSON.stringify(nextMetadata);
                if (before !== after || canonical.lastUpdated !== source.lastUpdated) changed = true;
                canonical.metadata = nextMetadata;
                canonical.lastUpdated = source.lastUpdated;
            }
            if (visible) {
                visible.metadata = { ...nextMetadata };
                visible.last_updated = source.lastUpdated;
            }
        }
        if (changed) window.dispatchEvent(new CustomEvent('family-person-data-refreshed'));
    }

    async function loadGraph(force = false, { recenter = false } = {}) {
        try {
            const snapshot = force
                ? await Store.refresh({ reason: 'graph-force' })
                : await Store.read({ reason: 'graph-load' });
            const documentValue = snapshot?.graph;
            if (!documentValue) throw new Error('Canonical graph is unavailable');
            const nextPeople = documentValue.people || [];
            const nextRelationships = documentValue.relationships || [];
            const nextSignature = graphStructureSignature(nextPeople, nextRelationships);

            if (!force && nextSignature === graphSignature) {
                syncPersonDetailsWithoutRender(nextPeople);
                return null;
            }

            acceptGraph(documentValue);
            if (!graphRootId || !graphPeopleById.has(graphRootId)) {
                graphRootId = chooseInitialRoot();
                recenter = true;
            }
            if (!graphRootId) {
                globalNodes = [];
                globalNodeMap = new Map();
                renderCards();
                svgLayer.innerHTML = '';
                return null;
            }

            const controller = window.FamilyRenderController;
            await controller?.prepare?.({
                reason: force ? 'graph-force' : 'graph-load',
                anchorId: graphRootId,
                rootId: graphRootId
            });
            return renderGraphView({
                recenter,
                reason: force ? 'graph-force' : 'graph-load'
            });
        } catch (error) {
            console.error('Failed to load family graph:', error);
            showStatus('שגיאה בטעינת הגרף');
            return null;
        }
    }

    function selectRoot(personId, source = 'graph-view') {
        if (!graphPeopleById.has(personId)) return false;
        return Selection?.replaceUrlPerson?.(personId, { source }) || false;
    }

    function applySelectedRoot(personId, source = 'selection') {
        if (!personId || !graphPeopleById.has(personId) || personId === graphRootId) return Promise.resolve(null);
        graphRootId = personId;
        expandedBySource.clear();
        return renderGraphView({ recenter: true, reason: source });
    }

    function matchesSearch(person, query) {
        const q = query.toLocaleLowerCase();
        return String(person.name || '').toLocaleLowerCase().includes(q) ||
            personLifeDates(person).toLocaleLowerCase().includes(q);
    }
    function renderSearchResults(query) {
        if (!searchResults) return [];
        searchResults.innerHTML = '';
        const trimmed = query.trim();
        if (!trimmed) {
            searchResults.classList.remove('open');
            return [];
        }
        const results = graphPeople
            .filter(person => matchesSearch(person, trimmed))
            .sort((a, b) => {
                const q = trimmed.toLocaleLowerCase();
                const an = String(a.name || '').toLocaleLowerCase();
                const bn = String(b.name || '').toLocaleLowerCase();
                return Number(!an.startsWith(q)) - Number(!bn.startsWith(q)) || an.localeCompare(bn) || a.id.localeCompare(b.id);
            })
            .slice(0, 8);
        for (const person of results) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'graph-search-result';
            button.dataset.personId = person.id;
            const name = document.createElement('span');
            name.textContent = person.name || 'ללא שם';
            button.appendChild(name);
            const datesValue = personLifeDates(person);
            if (datesValue) {
                const dates = document.createElement('small');
                dates.textContent = datesValue;
                button.appendChild(dates);
            }
            searchResults.appendChild(button);
        }
        searchResults.classList.toggle('open', results.length > 0);
        return results;
    }

    if (searchInput && searchResults) {
        searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
        searchInput.addEventListener('focus', () => renderSearchResults(searchInput.value));
        searchInput.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            const results = renderSearchResults(searchInput.value);
            if (!results.length) return;
            event.preventDefault();
            searchResults.classList.remove('open');
            selectRoot(results[0].id, 'search');
            searchInput.blur();
        });
        searchResults.addEventListener('click', event => {
            const button = event.target.closest('[data-person-id]');
            if (!button) return;
            searchResults.classList.remove('open');
            selectRoot(button.dataset.personId, 'search');
        });
        document.addEventListener('pointerdown', event => {
            if (!event.target.closest('.graph-search-wrap')) searchResults.classList.remove('open');
        });
    }

    cardsLayer.addEventListener('click', event => {
        const collapse = event.target.closest('[data-graph-collapse]');
        if (collapse) {
            event.preventDefault();
            event.stopPropagation();
            expandedBySource.delete(collapse.dataset.graphCollapse);
            void renderGraphView({ recenter: false, reason: 'collapse' });
            return;
        }
        const expand = event.target.closest('[data-graph-expand]');
        if (expand) {
            event.preventDefault();
            event.stopPropagation();
            const sourceId = expand.dataset.graphExpand;
            const branches = hiddenBranchesFor(sourceId);
            if (branches.size) expandedBySource.set(sourceId, new Set(branches));
            void renderGraphView({ recenter: false, reason: 'expand' });
        }
    });

    window.addEventListener('family-selection-changed', event => {
        void applySelectedRoot(event.detail?.personId || null, event.detail?.source || 'selection');
    });

    window.addEventListener('family-person-pane-saved', event => {
        const detail = event.detail || {};
        const person = graphPeopleById.get(detail.id);
        if (!person) return;
        if (detail.field === 'name') {
            person.name = detail.value;
            graphSignature = graphStructureSignature(graphPeople, graphRelationships);
        }
        if (detail.field === 'metadata' && detail.metadata && typeof detail.metadata === 'object') {
            person.metadata = { ...detail.metadata };
        }
    });

    async function refresh({ force = false, recenter = false } = {}) {
        return loadGraph(force, { recenter });
    }

    window.FamilyGraphView = Object.freeze({
        refresh,
        reroot: personId => selectRoot(personId, 'graph-view-api'),
        render: options => renderGraphView(options),
        rootId: () => graphRootId
    });
    window.startFamilyGraph = () => refresh({ force: true, recenter: true });
})();
