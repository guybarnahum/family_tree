// Person-centric, ephemeral family graph view.
//
// The database is one global graph. This file projects it around one selected person:
//   - selected ancestry + descendants are eager
//   - spouse ancestry is capped at one generation by default
//   - siblings are contextual
//   - collateral branches are behind reversible +N / − controls
//   - legacy one-parent children are projected under both partners only when the known
//     parent has exactly one spouse; multiple-partner cases are deliberately not guessed.
(() => {
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

    // Source card -> exact immediate branches opened from that card. Keeping ownership
    // makes expansion reversible without hiding people still needed by another expansion.
    const expandedBySource = new Map();

    const title = document.querySelector('h1');
    const titleCard = title?.parentElement;
    const subtitle = titleCard?.querySelector('p');
    titleCard?.classList.add('family-title-card');

    const style = document.createElement('style');
    style.textContent = `
        .graph-search-wrap {
            position: relative;
            margin-top: 8px;
            width: min(290px, 68vw);
            direction: ltr;
        }

        .graph-search-input {
            width: 100%;
            border: 1px solid rgba(163, 177, 138, 0.45);
            background: rgba(255, 255, 255, 0.82);
            color: #344e41;
            border-radius: 999px;
            padding: 5px 11px;
            font-size: 11px;
            line-height: 1.3;
            outline: none;
        }

        .graph-search-input:focus {
            border-color: #588157;
            background: #fff;
        }

        .graph-search-results {
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            right: 0;
            max-height: 230px;
            overflow: auto;
            border: 1px solid rgba(163, 177, 138, 0.4);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.98);
            box-shadow: 0 10px 24px rgba(52, 78, 65, 0.14);
            display: none;
            z-index: 200;
        }

        .graph-search-results.open { display: block; }

        .graph-search-result {
            display: block;
            width: 100%;
            border: 0;
            border-bottom: 1px solid rgba(163, 177, 138, 0.18);
            background: transparent;
            color: #344e41;
            padding: 7px 10px;
            text-align: left;
            cursor: pointer;
            font-size: 11px;
        }

        .graph-search-result:last-child { border-bottom: 0; }
        .graph-search-result:hover,
        .graph-search-result:focus-visible {
            background: rgba(163, 177, 138, 0.13);
            outline: none;
        }

        .graph-search-result small {
            display: block;
            color: #8a8a84;
            font-size: 9px;
            margin-top: 1px;
        }

        .absolute-card.graph-context {
            opacity: 0.56;
            filter: saturate(0.62);
        }

        .absolute-card.graph-context:hover,
        .absolute-card.graph-context:focus-within {
            opacity: 0.92;
            filter: saturate(0.9);
        }

        .absolute-card.graph-root {
            box-shadow: 0 8px 22px rgba(52, 78, 65, 0.18);
            border-top-width: 4px;
        }

        .absolute-card:not(:has([contenteditable]:focus)) { cursor: pointer; }

        .graph-frontier {
            position: absolute;
            top: 50%;
            right: -15px;
            transform: translateY(-50%);
            min-width: 25px;
            height: 25px;
            padding: 0 6px;
            border: 1px solid rgba(88, 129, 87, 0.36);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.96);
            color: #588157;
            font-size: 10px;
            font-weight: 600;
            line-height: 23px;
            text-align: center;
            box-shadow: 0 2px 7px rgba(52, 78, 65, 0.10);
            opacity: 0.72;
            z-index: 35;
            cursor: pointer;
        }

        .graph-frontier.graph-frontier-collapse {
            color: #344e41;
            background: rgba(237, 242, 232, 0.98);
            border-color: rgba(52, 78, 65, 0.42);
            font-size: 15px;
            line-height: 21px;
        }

        .graph-frontier:hover,
        .graph-frontier:focus-visible {
            opacity: 1;
            border-color: #588157;
            outline: none;
        }
    `;
    document.head.appendChild(style);

    let searchInput = null;
    let searchResults = null;

    if (titleCard) {
        const searchWrap = document.createElement('div');
        searchWrap.className = 'graph-search-wrap';
        searchWrap.innerHTML = `
            <input class="graph-search-input" type="search" dir="auto"
                   autocomplete="off" spellcheck="false"
                   placeholder="Search person…" aria-label="Search family graph">
            <div class="graph-search-results" role="listbox"></div>
        `;
        titleCard.appendChild(searchWrap);
        searchInput = searchWrap.querySelector('.graph-search-input');
        searchResults = searchWrap.querySelector('.graph-search-results');
    }

    function hasMetadataValue(person, key) {
        return !!person?.metadata && Object.prototype.hasOwnProperty.call(person.metadata, key);
    }

    function personLifeDates(person) {
        return hasMetadataValue(person, 'lifeDates')
            ? String(person.metadata.lifeDates ?? '')
            : String(person?.dates ?? '');
    }

    function personBio(person) {
        return hasMetadataValue(person, 'bio')
            ? String(person.metadata.bio ?? '')
            : String(person?.description ?? '');
    }

    function graphStructureSignature(people, relationships) {
        return JSON.stringify([
            (people || []).map(person => [person.id, person.name]),
            (relationships || []).map(relation => [
                relation.id, relation.type, relation.person1Id, relation.person2Id
            ])
        ]);
    }

    function addToMapSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuildIndexes() {
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

        // Legacy rows often contain only one parent relationship. When that parent has
        // exactly one spouse and the child has exactly one explicit parent, project the
        // child under both partners. This is intentionally view-only and conservative:
        // once a parent has multiple spouses, the renderer refuses to guess the co-parent.
        const explicitParents = new Map(
            [...parentsByChild].map(([childId, parents]) => [childId, new Set(parents)])
        );
        for (const [childId, parents] of explicitParents) {
            if (parents.size !== 1) continue;
            const [parentId] = parents;
            const spouses = [...(spousesByPerson.get(parentId) || [])];
            if (spouses.length !== 1) continue;
            const coParentId = spouses[0];
            if (!graphPeopleById.has(coParentId)) continue;
            addToMapSet(parentsByChild, childId, coParentId);
            addToMapSet(childrenByParent, coParentId, childId);
        }
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
        const siblings = new Set();
        for (const parentId of parentsByChild.get(personId) || []) {
            for (const childId of childrenByParent.get(parentId) || []) {
                if (childId !== personId) siblings.add(childId);
            }
        }
        return siblings;
    }

    function activeExpandedBranches() {
        const active = new Set();
        for (const branches of expandedBySource.values()) {
            for (const branchId of branches) active.add(branchId);
        }
        return active;
    }

    function computeVisibleGraph() {
        primaryIds = new Set();
        lateralIds = new Set();
        if (!graphRootId || !graphPeopleById.has(graphRootId)) {
            visibleIds = new Set();
            return;
        }

        primaryIds.add(graphRootId);
        addAncestorCouples(graphRootId, primaryIds);

        const descendants = new Set();
        addDescendants(graphRootId, descendants);
        descendants.forEach(id => primaryIds.add(id));

        const rootSpouses = new Set(spousesByPerson.get(graphRootId) || []);
        for (const spouseId of rootSpouses) {
            primaryIds.add(spouseId);
            addDirectParentsWithSpouses(spouseId, primaryIds);

            // Kept for compatibility with legacy/imported data. With conservative
            // co-parent projection above, children naturally appear from either parent.
            const spouseDescendants = new Set();
            addDescendants(spouseId, spouseDescendants);
            for (const descendantId of spouseDescendants) {
                descendants.add(descendantId);
                primaryIds.add(descendantId);
            }
        }

        for (const personId of [graphRootId, ...descendants]) {
            for (const spouseId of spousesByPerson.get(personId) || []) primaryIds.add(spouseId);
        }

        // Complete ancestral couples, but do not recurse farther up the selected spouse's
        // ancestry unless a frontier is explicitly expanded.
        for (const personId of [...primaryIds]) {
            const isAncestorOrRoot = personId === graphRootId || !descendants.has(personId);
            if (!isAncestorOrRoot) continue;
            for (const spouseId of spousesByPerson.get(personId) || []) primaryIds.add(spouseId);
        }

        for (const siblingId of siblingsOf(graphRootId)) {
            if (!primaryIds.has(siblingId)) lateralIds.add(siblingId);
        }

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
        for (const childId of aChildren) {
            if (visibleIds.has(childId) && bChildren.has(childId)) return true;
        }
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
                const score = candidateId => {
                    let value = 0;
                    if (personId === graphRootId || candidateId === graphRootId) value += 1000;
                    if (sharedVisibleChild(personId, candidateId)) value += 500;
                    if (primaryIds.has(candidateId)) value += 100;
                    return value;
                };
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

                // The current layout engine connects a child to one FamilyUnit. If both
                // parents are visible spouses, either endpoint resolves to the same unit.
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
                    metadata: person.metadata && typeof person.metadata === 'object'
                        ? { ...person.metadata }
                        : {},
                    last_updated: person.lastUpdated,
                    parent_id: parentId,
                    spouse_id: spouseChoice.get(person.id) || null,
                    viewRole: lateralIds.has(person.id)
                        ? 'context'
                        : (person.id === graphRootId ? 'root' : 'primary')
                };
            });
    }

    function hiddenBranchesFor(personId) {
        const hidden = new Set();

        for (const parentId of parentsByChild.get(personId) || []) {
            if (!visibleIds.has(parentId)) hidden.add(parentId);
        }
        for (const childId of childrenByParent.get(personId) || []) {
            if (!visibleIds.has(childId)) hidden.add(childId);
        }
        for (const spouseId of spousesByPerson.get(personId) || []) {
            if (!visibleIds.has(spouseId)) hidden.add(spouseId);
        }
        for (const siblingId of siblingsOf(personId)) {
            if (!visibleIds.has(siblingId)) hidden.add(siblingId);
        }

        return hidden;
    }

    function decorateCards() {
        for (const node of globalNodes) {
            const card = document.getElementById(`card-${node.id}`);
            if (!card) continue;

            card.querySelectorAll('.graph-frontier').forEach(button => button.remove());
            card.classList.toggle('graph-root', node.id === graphRootId);
            card.classList.toggle('graph-context', lateralIds.has(node.id));
            card.setAttribute('title', node.id === graphRootId
                ? 'Current center'
                : 'Click to center the family graph here');

            const isExpandedSource = expandedBySource.has(node.id);
            const hidden = hiddenBranchesFor(node.id);
            if (!isExpandedSource && !hidden.size) continue;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = `graph-frontier${isExpandedSource ? ' graph-frontier-collapse' : ''}`;

            if (isExpandedSource) {
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

    function centerOnRoot() {
        const root = globalNodeMap.get(graphRootId);
        if (!root || root.x == null || root.targetY == null) return;
        viewport.scrollLeft = Math.max(0, root.x - viewport.clientWidth / 2);
        viewport.scrollTop = Math.max(0, root.targetY - viewport.clientHeight / 2 + root.cardHeight / 2);
    }

    function updateRootUI() {
        if (!graphPeopleById.has(graphRootId)) return;
        if (subtitle) subtitle.textContent = 'דורות של אהבה • גרור כדי לנווט';
        if (searchInput && document.activeElement !== searchInput) searchInput.value = '';
    }

    function expansionSignature() {
        return [...expandedBySource]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([sourceId, branches]) => `${sourceId}:${[...branches].sort().join('|')}`)
            .join(',');
    }

    function renderGraphView({ recenter = false } = {}) {
        if (!graphRootId || !graphPeopleById.has(graphRootId)) return;
        const anchor = !recenter && globalNodeMap.has(graphRootId)
            ? captureAnchor(graphRootId)
            : null;

        computeVisibleGraph();
        globalNodes = projectVisiblePeople();
        globalNodeMap = new Map(globalNodes.map(node => [node.id, node]));
        dataSignature = `graph:${graphSignature}:${graphRootId}:${expansionSignature()}`;

        renderCards();
        decorateCards();
        updateRootUI();

        requestAnimationFrame(() => {
            layoutAndRender();
            requestAnimationFrame(() => {
                decorateCards();
                if (recenter) centerOnRoot();
                else if (anchor) restoreAnchor(anchor);
            });
        });
    }

    function chooseInitialRoot() {
        const requested = new URL(window.location.href).searchParams.get('person');
        if (requested && graphPeopleById.has(requested)) return requested;
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

    function setRoot(personId, { updateUrl = true } = {}) {
        if (!graphPeopleById.has(personId)) return;
        graphRootId = personId;
        expandedBySource.clear();

        if (updateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set('person', personId);
            history.replaceState(null, '', url);
        }

        renderGraphView({ recenter: true });
    }

    function syncPersonDetailsWithoutRender(people) {
        let changed = false;
        for (const source of people || []) {
            const canonical = graphPeopleById.get(source.id);
            const visible = globalNodeMap?.get(source.id);
            const nextMetadata = source.metadata && typeof source.metadata === 'object'
                ? { ...source.metadata }
                : {};

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

        if (changed) {
            window.dispatchEvent(new CustomEvent('family-person-data-refreshed'));
        }
    }

    async function loadGraph(force = false, { recenter = false } = {}) {
        try {
            const response = await fetch('/api/graph', { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const documentValue = await response.json();
            const nextPeople = documentValue.people || [];
            const nextRelationships = documentValue.relationships || [];
            const nextSignature = graphStructureSignature(nextPeople, nextRelationships);

            // The five-second multi-client poll must not treat biography changes as graph
            // changes. Metadata is merged in place; only names/topology can replace cards
            // and invoke layoutAndRender().
            if (!force && nextSignature === graphSignature) {
                syncPersonDetailsWithoutRender(nextPeople);
                return;
            }

            graphSignature = nextSignature;
            graphPeople = nextPeople;
            graphRelationships = nextRelationships;
            rebuildIndexes();

            if (!graphRootId || !graphPeopleById.has(graphRootId)) {
                graphRootId = chooseInitialRoot();
                recenter = true;
            }

            if (!graphRootId) {
                globalNodes = [];
                globalNodeMap = new Map();
                renderCards();
                layoutAndRender();
                return;
            }

            renderGraphView({ recenter });
        } catch (error) {
            console.error('Failed to load family graph:', error);
            showStatus('שגיאה בטעינת הגרף');
        }
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
                return Number(!an.startsWith(q)) - Number(!bn.startsWith(q)) ||
                    an.localeCompare(bn) || a.id.localeCompare(b.id);
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
            setRoot(results[0].id);
            searchInput.blur();
        });

        searchResults.addEventListener('click', event => {
            const button = event.target.closest('[data-person-id]');
            if (!button) return;
            searchResults.classList.remove('open');
            setRoot(button.dataset.personId);
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
            renderGraphView({ recenter: false });
            return;
        }

        const expand = event.target.closest('[data-graph-expand]');
        if (expand) {
            event.preventDefault();
            event.stopPropagation();
            const sourceId = expand.dataset.graphExpand;
            const branches = hiddenBranchesFor(sourceId);
            if (branches.size) expandedBySource.set(sourceId, new Set(branches));
            renderGraphView({ recenter: false });
            return;
        }

        if (event.target.closest('[data-action]') || event.target.closest('[contenteditable="true"]')) return;
        const card = event.target.closest('.absolute-card[data-node-id]');
        if (!card) return;
        setRoot(card.dataset.nodeId);
    });

    // Existing add/edit/delete flows call loadTree(). Point them at the global graph.
    loadTree = async function graphAwareLoadTree(anchorId = null, force = false) {
        return loadGraph(force, { recenter: false });
    };

    const baseSaveEdit = saveEdit;
    saveEdit = async function graphAwareSaveEdit(element) {
        await baseSaveEdit(element);
        await loadGraph(true, { recenter: false });
    };

    // Pane-only edits deliberately avoid a graph reload. Mirror them into the canonical
    // in-memory graph so search/rerooting sees the saved value immediately without flicker.
    window.addEventListener('family-person-pane-saved', event => {
        const detail = event.detail || {};
        const person = graphPeopleById.get(detail.id);
        if (!person) return;
        if (detail.field === 'name') {
            person.name = detail.value;
            // The pane already reflowed the visible name card. Keep the polling signature
            // coherent so the next five-second poll does not redraw the same graph again.
            graphSignature = graphStructureSignature(graphPeople, graphRelationships);
        }
        if (detail.field === 'metadata' && detail.metadata && typeof detail.metadata === 'object') {
            person.metadata = { ...detail.metadata };
        }
    });

    window.startFamilyGraph = () => loadGraph(true, { recenter: true });
})();
