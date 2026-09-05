// Multi-partner relationship/layout extension.
// Ordinary people and one-couple units intentionally retain the existing visual behavior.
// Only visible spouse components with 3+ people activate the extended union layout.
(() => {
    if (window.__familyMultiPartnerRefinement) return;
    window.__familyMultiPartnerRefinement = true;

    const cardsLayerEl = document.getElementById('cards-layer');
    if (!cardsLayerEl) return;

    const EXTRA_MEMBER_GAP = 58;
    const UNION_LANE_CLEARANCE = 18;
    const UNION_LANE_STEP = 16;
    const UNION_CHILD_GROUP_GAP = 24;

    let graphCache = null;
    let graphFetchPromise = null;
    let spouseMap = new Map();
    let parentsMap = new Map();
    let childrenMap = new Map();

    const baseBuildFamilyUnits = buildFamilyUnits;
    const baseOrientCouples = orientCouples;
    const baseDrawSVGLines = drawSVGLines;
    const baseCreateCardHTML = createCardHTML;
    const baseLoadTree = loadTree;

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuildIndexes() {
        spouseMap = new Map();
        parentsMap = new Map();
        childrenMap = new Map();
        for (const relation of graphCache?.relationships || []) {
            if (relation.type === 'spouse') {
                addSet(spouseMap, relation.person1Id, relation.person2Id);
                addSet(spouseMap, relation.person2Id, relation.person1Id);
            } else if (relation.type === 'parent') {
                addSet(parentsMap, relation.person2Id, relation.person1Id);
                addSet(childrenMap, relation.person1Id, relation.person2Id);
            }
        }
    }

    async function loadGraphDocument(force = false) {
        if (graphCache && !force) return graphCache;
        if (graphFetchPromise && !force) return graphFetchPromise;
        graphFetchPromise = fetch('/api/graph', { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error(await response.text());
                return response.json();
            })
            .then(documentValue => {
                graphCache = documentValue;
                rebuildIndexes();
                return graphCache;
            })
            .finally(() => { graphFetchPromise = null; });
        return graphFetchPromise;
    }

    function currentRootId() {
        return new URL(window.location.href).searchParams.get('person') || (() => {
            try { return localStorage.getItem('family-tree.anchor-person'); }
            catch (_) { return null; }
        })();
    }

    function spouseIds(personId, { visibleOnly = false } = {}) {
        const result = [...(spouseMap.get(personId) || [])];
        return visibleOnly ? result.filter(id => globalNodeMap.has(id)) : result;
    }

    // Preserve the existing legacy compatibility rule: when a child has exactly one
    // explicit parent and that parent has exactly one spouse, treat that spouse as the
    // second parent for projection/layout. Never infer a co-parent with multiple spouses.
    function parentIds(personId, { visibleOnly = false } = {}) {
        let explicit = [...(parentsMap.get(personId) || [])];
        if (explicit.length === 1) {
            const partners = spouseIds(explicit[0]);
            if (partners.length === 1) explicit = [...explicit, partners[0]];
        }
        if (!explicit.length) {
            const legacy = globalNodeMap.get(personId)?.parent_id;
            if (legacy) explicit = [legacy];
        }
        return visibleOnly ? explicit.filter(id => globalNodeMap.has(id)) : explicit;
    }

    function spouseEdge(a, b) {
        return spouseMap.get(a)?.has(b) || false;
    }

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function spouseComponent(seedId, available) {
        const queue = [seedId];
        const walked = new Set();
        const ids = [];
        while (queue.length) {
            const id = queue.shift();
            if (walked.has(id) || !available.has(id)) continue;
            walked.add(id);
            ids.push(id);
            for (const spouseId of spouseIds(id, { visibleOnly: true })) {
                if (!walked.has(spouseId)) queue.push(spouseId);
            }
        }
        return ids;
    }

    function childHint(personId) {
        const values = [...(childrenMap.get(personId) || [])]
            .map(id => globalNodeMap.get(id))
            .filter(node => Number.isFinite(node?.x))
            .map(node => node.x);
        return values.length ? average(values) : null;
    }

    function chooseHub(ids) {
        const rootId = currentRootId();
        return [...ids].sort((a, b) => {
            const score = id =>
                (id === rootId ? 10000 : 0) +
                spouseIds(id, { visibleOnly: true }).filter(other => ids.includes(other)).length * 100;
            return score(b) - score(a) || a.localeCompare(b);
        })[0];
    }

    function orderMembers(ids) {
        if (ids.length <= 2) {
            return ids.map(id => globalNodeMap.get(id)).filter(Boolean)
                .sort((a, b) => a.id.localeCompare(b.id));
        }

        const hubId = chooseHub(ids);
        const hub = globalNodeMap.get(hubId);
        const partners = ids.filter(id => id !== hubId)
            .map(id => globalNodeMap.get(id)).filter(Boolean)
            .sort((a, b) => {
                const ax = childHint(a.id);
                const bx = childHint(b.id);
                if (Number.isFinite(ax) && Number.isFinite(bx) && Math.abs(ax - bx) > 1) return ax - bx;
                return a.id.localeCompare(b.id);
            });

        const left = [];
        const right = [];
        partners.forEach((partner, index) => (index % 2 === 0 ? left : right).push(partner));
        return [...left.reverse(), hub, ...right];
    }

    function memberGap(a, b) {
        return spouseEdge(a.id, b.id) ? SPOUSE_EDGE_GAP : EXTRA_MEMBER_GAP;
    }

    function sizeUnit(unit) {
        unit.memberGaps = [];
        unit.width = 0;
        unit.members.forEach((member, index) => {
            unit.width += member.cardWidth;
            if (index < unit.members.length - 1) {
                const gap = memberGap(member, unit.members[index + 1]);
                unit.memberGaps.push(gap);
                unit.width += gap;
            }
        });
        unit.height = Math.max(...unit.members.map(member => member.cardHeight));
    }

    buildFamilyUnits = function relationshipAwareBuildFamilyUnits() {
        if (!graphCache) return baseBuildFamilyUnits();

        globalUnits = [];
        unitByNodeId = new Map();
        const available = new Set(globalNodes.map(node => node.id));
        const claimed = new Set();

        for (const seedId of [...available].sort((a, b) => a.localeCompare(b))) {
            if (claimed.has(seedId)) continue;
            const component = spouseComponent(seedId, available);
            const ids = component.length ? component : [seedId];
            ids.forEach(id => claimed.add(id));
            const members = orderMembers(ids);
            if (!members.length) continue;

            const unit = {
                id: members.map(member => member.id).sort().join('::'),
                members,
                parents: new Set(),
                children: new Set(),
                gen: null,
                width: 0,
                height: 0,
                centerX: 0,
                component: -1,
                multiPartner: members.length > 2,
                memberGaps: []
            };
            sizeUnit(unit);
            globalUnits.push(unit);
            members.forEach(member => unitByNodeId.set(member.id, unit));
        }

        for (const unit of globalUnits) {
            for (const member of unit.members) {
                for (const parentId of parentIds(member.id, { visibleOnly: true })) {
                    const parentUnit = unitByNodeId.get(parentId);
                    if (parentUnit && parentUnit !== unit) {
                        unit.parents.add(parentUnit);
                        parentUnit.children.add(unit);
                    }
                }
            }
        }
    };

    function placeMembers() {
        try { baseOrientCouples(); } catch (_) {}

        for (const unit of globalUnits) {
            if (unit.members.length === 1) {
                unit.members[0].x = unit.centerX;
                continue;
            }
            if (unit.members.length === 2 && !unit.multiPartner) {
                const [left, right] = unit.members;
                left.x = unit.centerX - (SPOUSE_EDGE_GAP / 2 + left.cardWidth / 2);
                right.x = unit.centerX + (SPOUSE_EDGE_GAP / 2 + right.cardWidth / 2);
                unit.memberGaps = [SPOUSE_EDGE_GAP];
                continue;
            }

            sizeUnit(unit);
            let cursor = unit.centerX - unit.width / 2;
            unit.members.forEach((member, index) => {
                member.x = cursor + member.cardWidth / 2;
                cursor += member.cardWidth;
                if (index < unit.members.length - 1) cursor += unit.memberGaps[index];
            });
        }
    }

    positionMembers = function relationshipAwarePositionMembers() {
        placeMembers();
        refineUnionChildRows();
    };

    function generationY(unit) {
        if (Number.isFinite(unit?.generationCenterY)) return unit.generationCenterY;
        const member = unit?.members?.[0];
        return member ? member.targetY + member.cardHeight / 2 : 0;
    }

    const leftEdge = node => node.x - node.cardWidth / 2;
    const rightEdge = node => node.x + node.cardWidth / 2;
    const topEdge = node => node.targetY;
    const bottomEdge = node => node.targetY + node.cardHeight;

    function unionGeometry(unit) {
        const result = new Map();
        const centerY = generationY(unit);
        const index = new Map(unit.members.map((member, i) => [member.id, i]));
        const pairs = [];

        for (const member of unit.members) {
            for (const spouseId of spouseIds(member.id, { visibleOnly: true })) {
                const spouse = globalNodeMap.get(spouseId);
                if (!spouse || unitByNodeId.get(spouseId) !== unit || member.id >= spouseId) continue;
                pairs.push([member, spouse]);
            }
        }

        const routed = pairs.filter(([a, b]) => Math.abs(index.get(a.id) - index.get(b.id)) > 1)
            .sort((a, b) => pairKey(a[0].id, a[1].id).localeCompare(pairKey(b[0].id, b[1].id)));
        const laneByPair = new Map(routed.map((pair, i) => [pairKey(pair[0].id, pair[1].id), i]));
        const maxBottom = Math.max(...unit.members.map(bottomEdge));

        for (const [a, b] of pairs) {
            const left = a.x <= b.x ? a : b;
            const right = left === a ? b : a;
            const key = pairKey(a.id, b.id);
            const adjacent = Math.abs(index.get(a.id) - index.get(b.id)) === 1;

            if (adjacent) {
                const x1 = rightEdge(left);
                const x2 = leftEdge(right);
                result.set(key, {
                    path: `M ${x1} ${centerY} L ${x2} ${centerY}`,
                    x: (x1 + x2) / 2,
                    y: centerY,
                    width: 2.5
                });
                continue;
            }

            const laneY = maxBottom + UNION_LANE_CLEARANCE + (laneByPair.get(key) || 0) * UNION_LANE_STEP;
            const x1 = rightEdge(left);
            const x2 = leftEdge(right);
            const inset = Math.min(14, Math.max(8, (x2 - x1) * 0.08));
            result.set(key, {
                path: roundedOrthogonalPath([
                    [x1, centerY], [x1 + inset, centerY], [x1 + inset, laneY],
                    [x2 - inset, laneY], [x2 - inset, centerY], [x2, centerY]
                ], CONNECTOR_KNEE_RADIUS),
                x: (x1 + x2) / 2,
                y: laneY,
                width: 2.3
            });
        }
        return result;
    }

    function visibleParents(child) {
        return parentIds(child.id, { visibleOnly: true })
            .map(id => globalNodeMap.get(id)).filter(Boolean);
    }

    function childParentPair(child, unit) {
        const parents = visibleParents(child).filter(parent => unitByNodeId.get(parent.id) === unit);
        if (parents.length < 2) return null;
        for (let i = 0; i < parents.length; i++) {
            for (let j = i + 1; j < parents.length; j++) {
                if (spouseEdge(parents[i].id, parents[j].id)) return [parents[i], parents[j]];
            }
        }
        return [parents[0], parents[1]];
    }

    function childSource(unit, child, geometry) {
        const pair = childParentPair(child, unit);
        if (pair) {
            const union = geometry.get(pairKey(pair[0].id, pair[1].id));
            if (union) return { x: union.x, y: union.y };
            return { x: average(pair.map(parent => parent.x)), y: generationY(unit) };
        }

        const parent = visibleParents(child).find(candidate => unitByNodeId.get(candidate.id) === unit);
        if (parent) return { x: parent.x, y: bottomEdge(parent) };
        if (unit.members.length === 2) return { x: unit.centerX, y: generationY(unit) };
        return { x: unit.members[0].x, y: bottomEdge(unit.members[0]) };
    }

    function unionDescriptorForChildUnit(childUnit, geometryByParent) {
        for (const member of childUnit.members) {
            const parents = visibleParents(member);
            const byParentUnit = new Map();
            for (const parent of parents) {
                const parentUnit = unitByNodeId.get(parent.id);
                if (!parentUnit?.multiPartner || parentUnit.gen !== childUnit.gen - 1) continue;
                if (!byParentUnit.has(parentUnit)) byParentUnit.set(parentUnit, []);
                byParentUnit.get(parentUnit).push(parent);
            }

            for (const [parentUnit, inUnit] of byParentUnit) {
                if (!inUnit.length) continue;
                let pair = null;
                for (let i = 0; i < inUnit.length && !pair; i++) {
                    for (let j = i + 1; j < inUnit.length; j++) {
                        if (spouseEdge(inUnit[i].id, inUnit[j].id)) {
                            pair = [inUnit[i], inUnit[j]];
                            break;
                        }
                    }
                }

                if (pair) {
                    const key = pairKey(pair[0].id, pair[1].id);
                    const union = geometryByParent.get(parentUnit)?.get(key);
                    return {
                        key: `${parentUnit.id}::${key}`,
                        anchorX: union?.x ?? average(pair.map(parent => parent.x))
                    };
                }

                if (inUnit.length === 1) {
                    return {
                        key: `${parentUnit.id}::solo:${inUnit[0].id}`,
                        anchorX: inUnit[0].x
                    };
                }
            }
        }
        return null;
    }

    function clusterInternalLayout(units) {
        const sorted = [...units].sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
        if (sorted.length === 1) {
            return { units: sorted, width: sorted[0].width, offsets: new Map([[sorted[0], 0]]) };
        }

        const centers = [sorted[0].width / 2];
        for (let i = 1; i < sorted.length; i++) {
            centers.push(centers[i - 1] + unitSeparation(sorted[i - 1], sorted[i]));
        }
        const left = centers[0] - sorted[0].width / 2;
        const right = centers[centers.length - 1] + sorted[sorted.length - 1].width / 2;
        const middle = (left + right) / 2;
        return {
            units: sorted,
            width: right - left,
            offsets: new Map(sorted.map((unit, i) => [unit, centers[i] - middle]))
        };
    }

    function clusterGap(left, right) {
        const leftUnit = left.units[left.units.length - 1];
        const rightUnit = right.units[0];
        const normalGap = Math.max(0,
            unitSeparation(leftUnit, rightUnit) - leftUnit.width / 2 - rightUnit.width / 2
        );
        const extra = left.unionKey && right.unionKey && left.unionKey !== right.unionKey
            ? UNION_CHILD_GROUP_GAP
            : 0;
        return normalGap + extra;
    }

    function packClusters(clusters) {
        if (!clusters.length) return;
        clusters.sort((a, b) => a.targetX - b.targetX || a.oldX - b.oldX || a.key.localeCompare(b.key));
        const positions = clusters.map(cluster => cluster.targetX);

        for (let i = 1; i < clusters.length; i++) {
            const minimum = positions[i - 1] +
                clusters[i - 1].width / 2 + clusterGap(clusters[i - 1], clusters[i]) + clusters[i].width / 2;
            positions[i] = Math.max(positions[i], minimum);
        }
        for (let i = clusters.length - 2; i >= 0; i--) {
            const maximum = positions[i + 1] -
                clusters[i].width / 2 - clusterGap(clusters[i], clusters[i + 1]) - clusters[i + 1].width / 2;
            positions[i] = Math.min(positions[i], maximum);
        }

        const delta = average(clusters.map((cluster, i) => cluster.targetX - positions[i]));
        clusters.forEach((cluster, i) => {
            const center = positions[i] + delta;
            for (const unit of cluster.units) {
                unit.centerX = center + (cluster.offsets.get(unit) || 0);
            }
        });
    }

    // The base sweeps know only that all children belong to the same multi-partner
    // FamilyUnit, so children from distinct unions can interleave. Repack just those rows:
    // each parent-pair becomes an indivisible child cluster ordered by its union anchor.
    // A single child can therefore land directly below the union; sibling groups stay
    // contiguous and centered around it, minimizing/eliminating crossed connector paths.
    function refineUnionChildRows() {
        const multiParents = globalUnits.filter(unit => unit.multiPartner);
        if (!multiParents.length) return;

        const geometryByParent = new Map(multiParents.map(unit => [unit, unionGeometry(unit)]));
        const descriptors = new Map();
        for (const unit of globalUnits) {
            const descriptor = unionDescriptorForChildUnit(unit, geometryByParent);
            if (descriptor) descriptors.set(unit, descriptor);
        }
        if (!descriptors.size) return;

        const generations = [...new Set([...descriptors.keys()].map(unit => unit.gen))].sort((a, b) => a - b);
        for (const gen of generations) {
            const row = globalUnits.filter(unit => unit.gen === gen);
            const grouped = new Map();
            const clusters = [];

            for (const unit of row) {
                const descriptor = descriptors.get(unit);
                if (!descriptor) {
                    const layout = clusterInternalLayout([unit]);
                    clusters.push({
                        key: `unit:${unit.id}`,
                        unionKey: null,
                        targetX: unit.centerX,
                        oldX: unit.centerX,
                        ...layout
                    });
                    continue;
                }

                if (!grouped.has(descriptor.key)) {
                    grouped.set(descriptor.key, {
                        key: `union:${descriptor.key}`,
                        unionKey: descriptor.key,
                        targetX: descriptor.anchorX,
                        oldX: 0,
                        rawUnits: []
                    });
                }
                grouped.get(descriptor.key).rawUnits.push(unit);
            }

            for (const group of grouped.values()) {
                const layout = clusterInternalLayout(group.rawUnits);
                group.oldX = average(group.rawUnits.map(unit => unit.centerX));
                delete group.rawUnits;
                Object.assign(group, layout);
                clusters.push(group);
            }

            packClusters(clusters);
            // Child units may themselves be couples/multi-partner units; update their card
            // coordinates before using them as union anchors for the next generation.
            placeMembers();
        }
    }

    drawSVGLines = function relationshipAwareDrawSVGLines() {
        if (!graphCache) return baseDrawSVGLines();

        let svg = '';
        const geometryByUnit = new Map();
        for (const unit of globalUnits) {
            const geometry = unionGeometry(unit);
            geometryByUnit.set(unit, geometry);
            for (const union of geometry.values()) svg += svgPath(union.path, union.width);
        }

        for (const unit of globalUnits) {
            const children = globalNodes.filter(child =>
                child.gen === unit.gen + 1 &&
                visibleParents(child).some(parent => unitByNodeId.get(parent.id) === unit)
            ).sort((a, b) => a.x - b.x);

            const geometry = geometryByUnit.get(unit) || new Map();
            for (const child of children) {
                const source = childSource(unit, child, geometry);
                const targetX = child.x;
                const targetY = topEdge(child);
                const midY = source.y + Math.max(48, (targetY - source.y) * 0.52);
                svg += Math.abs(targetX - source.x) < 0.5
                    ? svgPath(`M ${source.x} ${source.y} L ${targetX} ${targetY}`)
                    : svgPath(roundedOrthogonalPath([
                        [source.x, source.y], [source.x, midY],
                        [targetX, midY], [targetX, targetY]
                    ], CONNECTOR_KNEE_RADIUS));
            }
        }
        svgLayer.innerHTML = svg;
    };

    // The spouse pill is always an available action, never a status indicator.
    createCardHTML = function relationshipAwareCreateCardHTML(node) {
        let html = baseCreateCardHTML(node);
        const label = '+ הוסף בן/בת זוג';
        if (html.includes('data-action="add-spouse"')) return html.replace('♥ זוג', label);

        const id = escapeHTML(node.id);
        const button = `
                    <button data-action="add-spouse" data-id="${id}"
                            class="absolute -top-2.5 right-1 bg-pink-100 text-pink-700 text-[8px] px-2 py-0.5 rounded-full hover:bg-pink-200 shadow z-30 transition whitespace-nowrap">${label}</button>
`;
        return html.replace('\n                    <h2 contenteditable="true"', `${button}\n                    <h2 contenteditable="true"`);
    };

    async function putGraph(documentValue) {
        const response = await fetch('/api/graph', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(documentValue)
        });
        if (!response.ok) throw new Error(await response.text());
        graphCache = null;
        await loadGraphDocument(true);
    }

    function sameRelationship(a, b) {
        if (a.type !== b.type) return false;
        if (a.type === 'spouse') {
            return (a.person1Id === b.person1Id && a.person2Id === b.person2Id) ||
                (a.person1Id === b.person2Id && a.person2Id === b.person1Id);
        }
        return a.person1Id === b.person1Id && a.person2Id === b.person2Id;
    }

    async function addRelationships(relations) {
        const documentValue = await loadGraphDocument(true);
        const next = [...(documentValue.relationships || [])];
        for (const relation of relations) {
            if (!next.some(existing => sameRelationship(existing, relation))) next.push(relation);
        }
        documentValue.relationships = next;
        await putGraph(documentValue);
    }

    addSpouse = async function relationshipAwareAddSpouse(partnerId) {
        const spouseId = 'node_' + Math.random().toString(36).slice(2, 11);
        showStatus('מוסיף בן/בת זוג...');
        try {
            const response = await fetch('/api/nodes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: spouseId })
            });
            if (!response.ok) throw new Error(await response.text());
            await addRelationships([{ type: 'spouse', person1Id: partnerId, person2Id: spouseId }]);
            await loadTree(partnerId, true);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add spouse:', error);
            showStatus('שגיאה בהוספה');
        }
    };

    addParent = async function relationshipAwareAddParent(childId) {
        const parentId = 'node_' + Math.random().toString(36).slice(2, 11);
        showStatus('מוסיף הורה...');
        try {
            const response = await fetch('/api/nodes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parentId })
            });
            if (!response.ok) throw new Error(await response.text());
            await addRelationships([{ type: 'parent', person1Id: parentId, person2Id: childId }]);
            await loadTree(childId, true);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add parent:', error);
            showStatus('שגיאה בהוספה');
        }
    };

    addChild = async function relationshipAwareAddChild(parentId) {
        const childId = 'node_' + Math.random().toString(36).slice(2, 11);
        showStatus('מוסיף ילד...');
        try {
            const response = await fetch('/api/nodes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: childId })
            });
            if (!response.ok) throw new Error(await response.text());

            await loadGraphDocument(true);
            const partners = spouseIds(parentId);
            const relations = [{ type: 'parent', person1Id: parentId, person2Id: childId }];
            if (partners.length === 1) {
                relations.push({ type: 'parent', person1Id: partners[0], person2Id: childId });
            }
            await addRelationships(relations);
            await loadTree(parentId, true);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add child:', error);
            showStatus('שגיאה בהוספה');
        }
    };

    loadTree = async function relationshipAwareLoadTree(...args) {
        try { await loadGraphDocument(true); }
        catch (error) { console.warn('Unable to refresh relationship graph:', error); }
        return baseLoadTree(...args);
    };

    const style = document.createElement('style');
    style.textContent = `.absolute-card [data-action="add-spouse"] { white-space: nowrap; }`;
    document.head.appendChild(style);

    loadGraphDocument(true).then(() => {
        if (!globalNodes?.length) return;
        renderCards();
        requestAnimationFrame(() => layoutAndRender());
    }).catch(error => console.warn('Unable to initialize multi-partner layout:', error));
})();