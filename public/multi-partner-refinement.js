// Multi-partner relationship/layout extension.
//
// Ordinary single people and one-couple units intentionally keep the existing layout.
// Only visible spouse components with 3+ people use the extended member ordering and
// routed union geometry. Relationship edits go through family-graph v2 so adding another
// spouse/parent never deletes an existing relationship.
(() => {
    if (window.__familyMultiPartnerRefinement) return;
    window.__familyMultiPartnerRefinement = true;

    const cardsLayerEl = document.getElementById('cards-layer');
    if (!cardsLayerEl) return;

    const EXTRA_MEMBER_GAP = 58;
    const UNION_LANE_CLEARANCE = 18;
    const UNION_LANE_STEP = 16;

    let graphCache = null;
    let graphFetchPromise = null;
    let spouseMap = new Map();
    let parentsMap = new Map();
    let childrenMap = new Map();

    const baseBuildFamilyUnits = buildFamilyUnits;
    const basePositionMembers = positionMembers;
    const baseOrientCouples = orientCouples;
    const baseDrawSVGLines = drawSVGLines;
    const baseCreateCardHTML = createCardHTML;
    const baseLoadTree = loadTree;

    function addMapSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuildRelationshipIndexes() {
        spouseMap = new Map();
        parentsMap = new Map();
        childrenMap = new Map();

        for (const relation of graphCache?.relationships || []) {
            if (relation.type === 'spouse') {
                addMapSet(spouseMap, relation.person1Id, relation.person2Id);
                addMapSet(spouseMap, relation.person2Id, relation.person1Id);
            } else if (relation.type === 'parent') {
                addMapSet(parentsMap, relation.person2Id, relation.person1Id);
                addMapSet(childrenMap, relation.person1Id, relation.person2Id);
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
                rebuildRelationshipIndexes();
                return graphCache;
            })
            .finally(() => { graphFetchPromise = null; });

        return graphFetchPromise;
    }

    function currentRootId() {
        return new URL(window.location.href).searchParams.get('person') ||
            (() => {
                try { return localStorage.getItem('family-tree.anchor-person'); }
                catch (_) { return null; }
            })();
    }

    function visibleSpouseIds(personId) {
        const result = new Set();
        for (const spouseId of spouseMap.get(personId) || []) {
            if (globalNodeMap.has(spouseId)) result.add(spouseId);
        }
        return result;
    }

    function visibleParentIds(personId) {
        const explicit = [...(parentsMap.get(personId) || [])].filter(id => globalNodeMap.has(id));
        if (explicit.length) return explicit;
        const legacy = globalNodeMap.get(personId)?.parent_id;
        return legacy && globalNodeMap.has(legacy) ? [legacy] : [];
    }

    function spouseEdge(a, b) {
        return spouseMap.get(a)?.has(b) || false;
    }

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function connectedSpouseComponent(seedId, available) {
        const component = [];
        const queue = [seedId];
        const walked = new Set();

        while (queue.length) {
            const id = queue.shift();
            if (walked.has(id) || !available.has(id)) continue;
            walked.add(id);
            component.push(id);
            for (const spouseId of visibleSpouseIds(id)) {
                if (!walked.has(spouseId) && available.has(spouseId)) queue.push(spouseId);
            }
        }
        return component;
    }

    function childCenterHint(personId) {
        const centers = [...(childrenMap.get(personId) || [])]
            .map(id => globalNodeMap.get(id))
            .filter(node => node && Number.isFinite(node.x))
            .map(node => node.x);
        return centers.length ? average(centers) : null;
    }

    function chooseHub(component) {
        const rootId = currentRootId();
        return [...component].sort((a, b) => {
            const score = id => {
                const degree = [...visibleSpouseIds(id)].filter(other => component.includes(other)).length;
                return (id === rootId ? 10000 : 0) + degree * 100;
            };
            return score(b) - score(a) || a.localeCompare(b);
        })[0];
    }

    function orderMultiMembers(component) {
        if (component.length <= 2) {
            return component
                .map(id => globalNodeMap.get(id))
                .filter(Boolean)
                .sort((a, b) => a.id.localeCompare(b.id));
        }

        const hubId = chooseHub(component);
        const hub = globalNodeMap.get(hubId);
        const partners = component
            .filter(id => id !== hubId)
            .map(id => globalNodeMap.get(id))
            .filter(Boolean)
            .sort((a, b) => {
                const ax = childCenterHint(a.id);
                const bx = childCenterHint(b.id);
                if (Number.isFinite(ax) && Number.isFinite(bx) && Math.abs(ax - bx) > 1) return ax - bx;
                return a.id.localeCompare(b.id);
            });

        const left = [];
        const right = [];
        partners.forEach((partner, index) => {
            if (index % 2 === 0) left.push(partner);
            else right.push(partner);
        });

        return [...left.reverse(), hub, ...right];
    }

    function gapBetween(a, b) {
        return spouseEdge(a.id, b.id) ? SPOUSE_EDGE_GAP : EXTRA_MEMBER_GAP;
    }

    function computeUnitGeometry(unit) {
        unit.memberGaps = [];
        let width = 0;
        unit.members.forEach((member, index) => {
            width += member.cardWidth;
            if (index < unit.members.length - 1) {
                const gap = gapBetween(member, unit.members[index + 1]);
                unit.memberGaps.push(gap);
                width += gap;
            }
        });
        unit.width = width;
        unit.height = Math.max(...unit.members.map(member => member.cardHeight));
    }

    buildFamilyUnits = function relationshipAwareBuildFamilyUnits() {
        if (!graphCache) return baseBuildFamilyUnits();

        globalUnits = [];
        unitByNodeId = new Map();
        const available = new Set(globalNodes.map(node => node.id));
        const claimed = new Set();
        const sortedIds = [...available].sort((a, b) => a.localeCompare(b));

        for (const seedId of sortedIds) {
            if (claimed.has(seedId)) continue;

            const component = connectedSpouseComponent(seedId, available);
            const memberIds = component.length ? component : [seedId];
            memberIds.forEach(id => claimed.add(id));

            let members = orderMultiMembers(memberIds);
            if (!members.length) {
                const node = globalNodeMap.get(seedId);
                if (!node) continue;
                members = [node];
            }

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

            computeUnitGeometry(unit);
            globalUnits.push(unit);
            members.forEach(member => unitByNodeId.set(member.id, unit));
        }

        for (const unit of globalUnits) {
            for (const member of unit.members) {
                for (const parentId of visibleParentIds(member.id)) {
                    const parentUnit = unitByNodeId.get(parentId);
                    if (parentUnit && parentUnit !== unit) {
                        unit.parents.add(parentUnit);
                        parentUnit.children.add(unit);
                    }
                }
            }
        }
    };

    positionMembers = function relationshipAwarePositionMembers() {
        // Preserve the exact old orientation rule for ordinary two-person couples.
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

            computeUnitGeometry(unit);
            let cursor = unit.centerX - unit.width / 2;
            unit.members.forEach((member, index) => {
                member.x = cursor + member.cardWidth / 2;
                cursor += member.cardWidth;
                if (index < unit.members.length - 1) cursor += unit.memberGaps[index];
            });
        }
    };

    function generationLineY(unit) {
        if (Number.isFinite(unit?.generationCenterY)) return unit.generationCenterY;
        const member = unit?.members?.[0];
        return member ? member.targetY + member.cardHeight / 2 : 0;
    }

    function cardLeft(node) { return node.x - node.cardWidth / 2; }
    function cardRight(node) { return node.x + node.cardWidth / 2; }
    function cardTop(node) { return node.targetY; }
    function cardBottom(node) { return node.targetY + node.cardHeight; }

    function orderedPairNodes(a, b) {
        return a.x <= b.x ? [a, b] : [b, a];
    }

    function multiRelationshipGeometry(unit) {
        const result = new Map();
        const centerY = generationLineY(unit);
        const indexById = new Map(unit.members.map((member, index) => [member.id, index]));
        const pairs = [];

        for (const member of unit.members) {
            for (const spouseId of visibleSpouseIds(member.id)) {
                const spouse = globalNodeMap.get(spouseId);
                if (!spouse || unitByNodeId.get(spouseId) !== unit || member.id >= spouseId) continue;
                pairs.push([member, spouse]);
            }
        }

        const routed = pairs
            .filter(([a, b]) => Math.abs(indexById.get(a.id) - indexById.get(b.id)) > 1)
            .sort((left, right) => {
                const ld = Math.abs(indexById.get(left[0].id) - indexById.get(left[1].id));
                const rd = Math.abs(indexById.get(right[0].id) - indexById.get(right[1].id));
                return ld - rd || pairKey(left[0].id, left[1].id).localeCompare(pairKey(right[0].id, right[1].id));
            });
        const laneIndex = new Map(routed.map((pair, index) => [pairKey(pair[0].id, pair[1].id), index]));
        const maxBottom = Math.max(...unit.members.map(cardBottom));

        for (const [a, b] of pairs) {
            const [left, right] = orderedPairNodes(a, b);
            const key = pairKey(a.id, b.id);
            const adjacent = Math.abs(indexById.get(a.id) - indexById.get(b.id)) === 1;

            if (adjacent) {
                const x1 = cardRight(left);
                const x2 = cardLeft(right);
                result.set(key, {
                    path: `M ${x1} ${centerY} L ${x2} ${centerY}`,
                    anchorX: (x1 + x2) / 2,
                    anchorY: centerY,
                    width: 2.5
                });
                continue;
            }

            const lane = laneIndex.get(key) || 0;
            const laneY = maxBottom + UNION_LANE_CLEARANCE + lane * UNION_LANE_STEP;
            const exitsRight = left.id === a.id ? cardRight(left) : cardRight(left);
            const entersLeft = cardLeft(right);
            const startX = exitsRight;
            const endX = entersLeft;
            const horizontalInset = Math.min(14, Math.max(8, (endX - startX) * 0.08));
            const anchorX = (startX + endX) / 2;

            result.set(key, {
                path: roundedOrthogonalPath([
                    [startX, centerY],
                    [startX + horizontalInset, centerY],
                    [startX + horizontalInset, laneY],
                    [endX - horizontalInset, laneY],
                    [endX - horizontalInset, centerY],
                    [endX, centerY]
                ], CONNECTOR_KNEE_RADIUS),
                anchorX,
                anchorY: laneY,
                width: 2.3
            });
        }

        return result;
    }

    function explicitVisibleParents(child) {
        const ids = visibleParentIds(child.id);
        return ids.map(id => globalNodeMap.get(id)).filter(Boolean);
    }

    function parentPairForChild(child, unit) {
        const parents = explicitVisibleParents(child)
            .filter(parent => unitByNodeId.get(parent.id) === unit);
        if (parents.length < 2) return null;

        for (let i = 0; i < parents.length; i++) {
            for (let j = i + 1; j < parents.length; j++) {
                if (spouseEdge(parents[i].id, parents[j].id)) return [parents[i], parents[j]];
            }
        }
        return [parents[0], parents[1]];
    }

    function childSourceFor(unit, child, unionGeometry) {
        const pair = parentPairForChild(child, unit);
        if (pair) {
            const geometry = unionGeometry.get(pairKey(pair[0].id, pair[1].id));
            if (geometry) return { x: geometry.anchorX, y: geometry.anchorY };
            return { x: average(pair.map(parent => parent.x)), y: generationLineY(unit) };
        }

        const parent = explicitVisibleParents(child)
            .find(candidate => unitByNodeId.get(candidate.id) === unit);
        if (parent) return { x: parent.x, y: cardBottom(parent) };

        if (unit.members.length === 2) return { x: unit.centerX, y: generationLineY(unit) };
        const fallback = unit.members[0];
        return { x: fallback.x, y: cardBottom(fallback) };
    }

    drawSVGLines = function relationshipAwareDrawSVGLines() {
        if (!graphCache) return baseDrawSVGLines();

        let svgHTML = '';
        const geometryByUnit = new Map();

        for (const unit of globalUnits) {
            const geometry = multiRelationshipGeometry(unit);
            geometryByUnit.set(unit, geometry);
            for (const relation of geometry.values()) {
                svgHTML += svgPath(relation.path, relation.width);
            }
        }

        for (const unit of globalUnits) {
            const childNodes = globalNodes
                .filter(child => {
                    if (child.gen !== unit.gen + 1) return false;
                    return explicitVisibleParents(child)
                        .some(parent => unitByNodeId.get(parent.id) === unit);
                })
                .sort((a, b) => a.x - b.x);

            if (!childNodes.length) continue;
            const unionGeometry = geometryByUnit.get(unit) || new Map();

            childNodes.forEach(child => {
                const source = childSourceFor(unit, child, unionGeometry);
                const childX = child.x;
                const childY = cardTop(child);
                const midY = source.y + Math.max(48, (childY - source.y) * 0.52);

                if (Math.abs(childX - source.x) < 0.5) {
                    svgHTML += svgPath(`M ${source.x} ${source.y} L ${childX} ${childY}`);
                } else {
                    svgHTML += svgPath(roundedOrthogonalPath([
                        [source.x, source.y],
                        [source.x, midY],
                        [childX, midY],
                        [childX, childY]
                    ], CONNECTOR_KNEE_RADIUS));
                }
            });
        }

        svgLayer.innerHTML = svgHTML;
    };

    // The spouse control is an affordance, not a status indicator. Keep it available even
    // when one or more spouse relationships already exist.
    createCardHTML = function relationshipAwareCreateCardHTML(node) {
        let html = baseCreateCardHTML(node);
        const label = '+ הוסף בן/בת זוג';

        if (html.includes('data-action="add-spouse"')) {
            html = html.replace('♥ זוג', label);
            return html;
        }

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

    async function addGraphRelationship(type, person1Id, person2Id) {
        const documentValue = await loadGraphDocument(true);
        const exists = (documentValue.relationships || []).some(relation => {
            if (relation.type !== type) return false;
            if (type === 'spouse') {
                return (relation.person1Id === person1Id && relation.person2Id === person2Id) ||
                    (relation.person1Id === person2Id && relation.person2Id === person1Id);
            }
            return relation.person1Id === person1Id && relation.person2Id === person2Id;
        });
        if (exists) return;

        documentValue.relationships = [...(documentValue.relationships || []), {
            type,
            person1Id,
            person2Id
        }];
        await putGraph(documentValue);
    }

    async function addGraphRelationships(relations) {
        const documentValue = await loadGraphDocument(true);
        const next = [...(documentValue.relationships || [])];

        for (const relation of relations) {
            const exists = next.some(existing => {
                if (existing.type !== relation.type) return false;
                if (relation.type === 'spouse') {
                    return (existing.person1Id === relation.person1Id && existing.person2Id === relation.person2Id) ||
                        (existing.person1Id === relation.person2Id && existing.person2Id === relation.person1Id);
                }
                return existing.person1Id === relation.person1Id && existing.person2Id === relation.person2Id;
            });
            if (!exists) next.push(relation);
        }

        documentValue.relationships = next;
        await putGraph(documentValue);
    }

    addSpouse = async function relationshipAwareAddSpouse(partnerId) {
        const spouseId = 'node_' + Math.random().toString(36).slice(2, 11);
        showStatus('מוסיף בן/בת זוג...');

        try {
            const postResponse = await fetch('/api/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: spouseId })
            });
            if (!postResponse.ok) throw new Error(await postResponse.text());

            await addGraphRelationship('spouse', partnerId, spouseId);
            await loadTree(partnerId, true);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add spouse relationship:', error);
            showStatus('שגיאה בהוספה');
        }
    };

    addParent = async function relationshipAwareAddParent(childId) {
        const parentId = 'node_' + Math.random().toString(36).slice(2, 11);
        showStatus('מוסיף הורה...');

        try {
            const postResponse = await fetch('/api/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parentId })
            });
            if (!postResponse.ok) throw new Error(await postResponse.text());

            await addGraphRelationship('parent', parentId, childId);
            await loadTree(childId, true);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add parent relationship:', error);
            showStatus('שגיאה בהוספה');
        }
    };

    addChild = async function relationshipAwareAddChild(parentId) {
        const childId = 'node_' + Math.random().toString(36).slice(2, 11);
        showStatus('מוסיף ילד...');

        try {
            const postResponse = await fetch('/api/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: childId })
            });
            if (!postResponse.ok) throw new Error(await postResponse.text());

            const documentValue = await loadGraphDocument(true);
            const partnerIds = new Set();
            for (const relation of documentValue.relationships || []) {
                if (relation.type !== 'spouse') continue;
                if (relation.person1Id === parentId) partnerIds.add(relation.person2Id);
                if (relation.person2Id === parentId) partnerIds.add(relation.person1Id);
            }

            const relations = [{ type: 'parent', person1Id: parentId, person2Id: childId }];
            if (partnerIds.size === 1) {
                relations.push({
                    type: 'parent',
                    person1Id: [...partnerIds][0],
                    person2Id: childId
                });
            }

            await addGraphRelationships(relations);
            await loadTree(parentId, true);
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Unable to add child relationship:', error);
            showStatus('שגיאה בהוספה');
        }
    };

    // Ensure graph-aware layout data stays current after imports, deletes, or remote edits.
    loadTree = async function relationshipAwareLoadTree(...args) {
        try { await loadGraphDocument(true); }
        catch (error) { console.warn('Unable to refresh relationship graph:', error); }
        return baseLoadTree(...args);
    };

    const style = document.createElement('style');
    style.textContent = `
        .absolute-card [data-action="add-spouse"] {
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);

    loadGraphDocument(true)
        .then(() => {
            if (!globalNodes?.length) return;
            renderCards();
            requestAnimationFrame(() => layoutAndRender());
        })
        .catch(error => console.warn('Unable to initialize multi-partner layout:', error));
})();
