// Exact lineage-aware ordering inside spouse/multi-partner family units.
//
// The planar row solver can move whole FamilyUnits, but ancestry can still cross when the
// people *inside* one unit are in the wrong left/right order. This layer treats member order
// as part of the topology: maximize adjacent spouse links first, then minimize incoming
// ancestry crossings, then shorten parent/child connectors. Chosen orders are ephemeral
// layout preferences and are fed back through the next layout pass; no DB state is changed.
(() => {
    if (window.__familyMemberOrderInstalled) return;
    window.__familyMemberOrderInstalled = true;

    const NON_SPOUSE_MEMBER_GAP = 58;
    const EXACT_MEMBER_LIMIT = 7;
    const MAX_FEEDBACK_PASSES = 3;
    const EPSILON = 0.5;

    let graphDocument = null;
    let graphPromise = null;
    let graphSignature = '';
    let parentsByChild = new Map();
    let spousesByPerson = new Map();
    let installed = false;
    const preferredOrders = new Map();

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuildIndexes() {
        parentsByChild = new Map();
        spousesByPerson = new Map();
        for (const relation of graphDocument?.relationships || []) {
            if (relation.type === 'parent') {
                addSet(parentsByChild, relation.person2Id, relation.person1Id);
            } else if (relation.type === 'spouse') {
                addSet(spousesByPerson, relation.person1Id, relation.person2Id);
                addSet(spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }
    }

    async function refreshGraph(force = false) {
        if (graphDocument && !force) return { graph: graphDocument, changed: false };
        if (graphPromise && !force) return graphPromise;
        graphPromise = fetch('/api/graph', { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error(await response.text());
                return response.json();
            })
            .then(value => {
                const signature = JSON.stringify((value.relationships || []).map(relation => [
                    relation.id || '', relation.type, relation.person1Id, relation.person2Id
                ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
                const changed = signature !== graphSignature;
                graphSignature = signature;
                graphDocument = value;
                rebuildIndexes();
                if (changed) {
                    // Unit ids are stable for unchanged spouse components, but relationship
                    // mutations can split/merge components. Stale preferences are harmless;
                    // clear them so the next topology starts from its own structural order.
                    preferredOrders.clear();
                }
                return { graph: value, changed };
            })
            .finally(() => { graphPromise = null; });
        return graphPromise;
    }

    function spouseIds(id) {
        return [...(spousesByPerson.get(id) || [])];
    }

    function spouseEdge(a, b) {
        return spousesByPerson.get(a)?.has(b) || false;
    }

    function parentIds(id) {
        let parents = [...(parentsByChild.get(id) || [])];
        if (parents.length === 1) {
            const partners = spouseIds(parents[0]);
            if (partners.length === 1) parents = [...parents, partners[0]];
        }
        if (!parents.length) {
            const legacy = globalNodeMap.get(id)?.parent_id;
            if (legacy) parents = [legacy];
        }
        return [...new Set(parents)].filter(parentId => globalNodeMap.has(parentId));
    }

    function gapFor(a, b) {
        return spouseEdge(a.id, b.id) ? SPOUSE_EDGE_GAP : NON_SPOUSE_MEMBER_GAP;
    }

    function candidateGeometry(unit, order) {
        const gaps = [];
        let width = 0;
        order.forEach((member, index) => {
            width += member.cardWidth;
            if (index < order.length - 1) {
                const gap = gapFor(member, order[index + 1]);
                gaps.push(gap);
                width += gap;
            }
        });

        const xById = new Map();
        const edgesById = new Map();
        let cursor = unit.centerX - width / 2;
        order.forEach((member, index) => {
            const left = cursor;
            const right = left + member.cardWidth;
            const x = (left + right) / 2;
            xById.set(member.id, x);
            edgesById.set(member.id, { left, right, width: member.cardWidth });
            cursor = right + (gaps[index] || 0);
        });
        return { width, gaps, xById, edgesById };
    }

    function applyOrder(unit, orderIds) {
        if (!unit?.members?.length || !Array.isArray(orderIds)) return false;
        const byId = new Map(unit.members.map(member => [member.id, member]));
        if (orderIds.length !== unit.members.length || orderIds.some(id => !byId.has(id))) return false;
        const order = orderIds.map(id => byId.get(id));
        const geometry = candidateGeometry(unit, order);
        unit.members = order;
        unit.width = geometry.width;
        unit.memberGaps = [...geometry.gaps];
        unit.members.forEach(member => { member.x = geometry.xById.get(member.id); });
        return true;
    }

    function applyPreferredOrders() {
        for (const unit of globalUnits || []) {
            const order = preferredOrders.get(unit.id);
            if (order) applyOrder(unit, order);
        }
    }

    function parentAnchorForUnit(parentUnit, parentIdsInUnit) {
        if (!parentIdsInUnit.length) return parentUnit.centerX;
        if (parentIdsInUnit.length >= 2) {
            for (let i = 0; i < parentIdsInUnit.length; i++) {
                for (let j = i + 1; j < parentIdsInUnit.length; j++) {
                    const a = globalNodeMap.get(parentIdsInUnit[i]);
                    const b = globalNodeMap.get(parentIdsInUnit[j]);
                    if (!a || !b || !spouseEdge(a.id, b.id)) continue;
                    const left = a.x <= b.x ? a : b;
                    const right = left === a ? b : a;
                    return ((left.x + left.cardWidth / 2) + (right.x - right.cardWidth / 2)) / 2;
                }
            }
        }
        const xs = parentIdsInUnit.map(id => globalNodeMap.get(id)?.x).filter(Number.isFinite);
        return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : parentUnit.centerX;
    }

    function incomingRecords(unit) {
        const records = [];
        for (const member of unit.members) {
            const byParentUnit = new Map();
            for (const parentId of parentIds(member.id)) {
                const parentUnit = unitByNodeId.get(parentId);
                if (!parentUnit || parentUnit === unit || parentUnit.gen !== unit.gen - 1) continue;
                if (!byParentUnit.has(parentUnit)) byParentUnit.set(parentUnit, []);
                byParentUnit.get(parentUnit).push(parentId);
            }
            for (const [parentUnit, ids] of byParentUnit) {
                records.push({
                    memberId: member.id,
                    sourceUnitId: parentUnit.id,
                    sourceX: parentAnchorForUnit(parentUnit, ids)
                });
            }
        }
        return records;
    }

    function routedSpouseCount(unit, order) {
        const index = new Map(order.map((member, i) => [member.id, i]));
        let count = 0;
        const seen = new Set();
        for (const member of order) {
            for (const spouseId of spouseIds(member.id)) {
                if (!index.has(spouseId)) continue;
                const key = member.id < spouseId ? `${member.id}|${spouseId}` : `${spouseId}|${member.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (Math.abs(index.get(member.id) - index.get(spouseId)) !== 1) count++;
            }
        }
        return count;
    }

    function incomingCrossings(records, geometry) {
        let count = 0;
        for (let i = 0; i < records.length; i++) {
            const a = records[i];
            for (let j = i + 1; j < records.length; j++) {
                const b = records[j];
                if (a.sourceUnitId === b.sourceUnitId || a.memberId === b.memberId) continue;
                const ax = geometry.xById.get(a.memberId);
                const bx = geometry.xById.get(b.memberId);
                if (!Number.isFinite(ax) || !Number.isFinite(bx)) continue;
                const sourceDelta = a.sourceX - b.sourceX;
                const targetDelta = ax - bx;
                if (Math.abs(sourceDelta) <= EPSILON || Math.abs(targetDelta) <= EPSILON) continue;
                if (sourceDelta * targetDelta < 0) count++;
            }
        }
        return count;
    }

    function incomingDistance(records, geometry) {
        return records.reduce((sum, record) => {
            const targetX = geometry.xById.get(record.memberId);
            return sum + (Number.isFinite(targetX) ? Math.abs(record.sourceX - targetX) : 0);
        }, 0);
    }

    function candidateUnionAnchor(parentIdsInUnit, geometry) {
        if (!parentIdsInUnit.length) return null;
        if (parentIdsInUnit.length >= 2) {
            for (let i = 0; i < parentIdsInUnit.length; i++) {
                for (let j = i + 1; j < parentIdsInUnit.length; j++) {
                    const a = parentIdsInUnit[i];
                    const b = parentIdsInUnit[j];
                    if (!spouseEdge(a, b)) continue;
                    const ax = geometry.xById.get(a);
                    const bx = geometry.xById.get(b);
                    if (!Number.isFinite(ax) || !Number.isFinite(bx)) continue;
                    const leftId = ax <= bx ? a : b;
                    const rightId = leftId === a ? b : a;
                    const leftEdgeValue = geometry.edgesById.get(leftId)?.right;
                    const rightEdgeValue = geometry.edgesById.get(rightId)?.left;
                    if (Number.isFinite(leftEdgeValue) && Number.isFinite(rightEdgeValue)) {
                        return (leftEdgeValue + rightEdgeValue) / 2;
                    }
                }
            }
        }
        const xs = parentIdsInUnit.map(id => geometry.xById.get(id)).filter(Number.isFinite);
        return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
    }

    function outgoingDistance(unit, geometry) {
        let distance = 0;
        for (const childUnit of globalUnits) {
            if (childUnit.gen !== unit.gen + 1) continue;
            for (const child of childUnit.members) {
                const inUnit = parentIds(child.id).filter(parentId => unitByNodeId.get(parentId) === unit);
                if (!inUnit.length) continue;
                const anchor = candidateUnionAnchor(inUnit, geometry);
                if (Number.isFinite(anchor)) distance += Math.abs(anchor - child.x);
            }
        }
        return distance;
    }

    function stabilityDistance(currentOrder, candidate) {
        const currentIndex = new Map(currentOrder.map((member, index) => [member.id, index]));
        return candidate.reduce((sum, member, index) => sum + Math.abs(index - currentIndex.get(member.id)), 0);
    }

    function scoreCandidate(unit, currentOrder, candidate, incoming) {
        const geometry = candidateGeometry(unit, candidate);
        return {
            routed: routedSpouseCount(unit, candidate),
            crossings: incomingCrossings(incoming, geometry),
            distance: incomingDistance(incoming, geometry) + outgoingDistance(unit, geometry) * 0.35,
            stability: stabilityDistance(currentOrder, candidate),
            key: candidate.map(member => member.id).join('|'),
            geometry
        };
    }

    function compareScore(a, b) {
        return a.routed - b.routed ||
            a.crossings - b.crossings ||
            a.distance - b.distance ||
            a.stability - b.stability ||
            a.key.localeCompare(b.key);
    }

    function enumeratePermutations(values, visit) {
        const source = [...values];
        const used = Array(source.length).fill(false);
        const current = [];
        function walk() {
            if (current.length === source.length) {
                visit([...current]);
                return;
            }
            for (let i = 0; i < source.length; i++) {
                if (used[i]) continue;
                used[i] = true;
                current.push(source[i]);
                walk();
                current.pop();
                used[i] = false;
            }
        }
        walk();
    }

    function heuristicCandidates(currentOrder) {
        const candidates = [currentOrder, [...currentOrder].reverse()];
        const ids = new Set(currentOrder.map(member => member.id));
        const degree = new Map(currentOrder.map(member => [
            member.id,
            spouseIds(member.id).filter(id => ids.has(id)).length
        ]));
        const hub = [...currentOrder].sort((a, b) => degree.get(b.id) - degree.get(a.id))[0];
        if (hub && degree.get(hub.id) > 1) {
            const others = currentOrder.filter(member => member !== hub)
                .sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || a.id.localeCompare(b.id));
            const middle = Math.floor(others.length / 2);
            candidates.push([...others.slice(0, middle), hub, ...others.slice(middle)]);
        }
        return candidates;
    }

    function optimizeUnit(unit) {
        if (!unit.members || unit.members.length < 2) return null;
        const currentOrder = [...unit.members];
        const incoming = incomingRecords(unit);
        let bestOrder = currentOrder;
        let bestScore = scoreCandidate(unit, currentOrder, currentOrder, incoming);

        const consider = candidate => {
            const score = scoreCandidate(unit, currentOrder, candidate, incoming);
            if (compareScore(score, bestScore) < 0) {
                bestOrder = candidate;
                bestScore = score;
            }
        };

        if (currentOrder.length <= EXACT_MEMBER_LIMIT) enumeratePermutations(currentOrder, consider);
        else heuristicCandidates(currentOrder).forEach(consider);

        const beforeScore = scoreCandidate(unit, currentOrder, currentOrder, incoming);
        if (bestOrder.every((member, index) => member === currentOrder[index])) {
            preferredOrders.set(unit.id, currentOrder.map(member => member.id));
            return {
                changed: false,
                before: beforeScore,
                after: bestScore,
                order: currentOrder.map(member => member.id)
            };
        }

        const nextIds = bestOrder.map(member => member.id);
        preferredOrders.set(unit.id, nextIds);
        applyOrder(unit, nextIds);
        return {
            changed: true,
            before: beforeScore,
            after: bestScore,
            from: currentOrder.map(member => member.id),
            to: nextIds
        };
    }

    function placeMembersFromCurrentOrder() {
        for (const unit of globalUnits) {
            if (!unit.members?.length) continue;
            if (unit.members.length === 1) {
                unit.members[0].x = unit.centerX;
                continue;
            }
            const geometry = candidateGeometry(unit, unit.members);
            unit.width = geometry.width;
            unit.memberGaps = [...geometry.gaps];
            unit.members.forEach(member => { member.x = geometry.xById.get(member.id); });
        }
    }

    function optimizeAllMemberOrders() {
        if (!graphDocument || !globalUnits?.length) return [];
        placeMembersFromCurrentOrder();
        const diagnostics = [];
        const units = [...globalUnits].sort((a, b) => a.gen - b.gen || a.centerX - b.centerX || a.id.localeCompare(b.id));
        for (const unit of units) {
            const result = optimizeUnit(unit);
            if (result) diagnostics.push({ unitId: unit.id, ...result });
        }
        placeMembersFromCurrentOrder();
        window.__familyMemberOrderDiagnostics = {
            changedUnits: diagnostics.filter(item => item.changed).length,
            units: diagnostics,
            checkedAt: new Date().toISOString()
        };
        return diagnostics;
    }

    function installWrapper() {
        if (installed) return;
        installed = true;

        // Feed chosen member orders into every subsequent family-unit rebuild. This is the
        // crucial feedback step: union child groups and the planar row solver then see the
        // same internal topology that the final router sees.
        const BASE_BUILD_FAMILY_UNITS = buildFamilyUnits;
        buildFamilyUnits = function lineagePreferredBuildFamilyUnits(...args) {
            const result = BASE_BUILD_FAMILY_UNITS(...args);
            applyPreferredOrders();
            return result;
        };

        // The planar layer still invokes the ordinary couple-orientation heuristic during
        // positioning. Let it make its suggestion, then restore an exact preferred order if
        // this optimizer has already found a better crossing-free orientation.
        const BASE_ORIENT_COUPLES = orientCouples;
        orientCouples = function lineagePreferredOrientCouples(...args) {
            const result = BASE_ORIENT_COUPLES(...args);
            applyPreferredOrders();
            return result;
        };

        const BASE_LAYOUT = layoutAndRender;
        layoutAndRender = function lineageAwareLayoutAndRender() {
            if (!graphDocument) return BASE_LAYOUT();

            let diagnostics = [];
            let changed = false;
            for (let pass = 0; pass < MAX_FEEDBACK_PASSES; pass++) {
                BASE_LAYOUT();
                if (!globalUnits?.length) return;
                diagnostics = optimizeAllMemberOrders();
                changed = diagnostics.some(item => item.changed);
                if (!changed) break;
            }

            // If the final optimization pass changed an order, consume that preference in
            // one last complete planar pass so descendant union blocks are centered on the
            // new union anchors rather than on pre-swap geometry.
            if (changed) {
                BASE_LAYOUT();
                optimizeAllMemberOrders();
            }

            updateCanvasBounds();
            syncCardPositions();
            requestAnimationFrame(() => {
                drawSVGLines();
                assertLayout();
            });
        };

        const BASE_LOAD_TREE = loadTree;
        loadTree = async function lineageAwareLoadTree(...args) {
            const result = await BASE_LOAD_TREE(...args);
            try {
                const refreshed = await refreshGraph(true);
                if (refreshed.changed && globalNodes?.length) layoutAndRender();
            } catch (error) {
                console.warn('Unable to refresh lineage-aware member ordering:', error);
            }
            return result;
        };

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!globalNodes?.length) return;
            try { layoutAndRender(); }
            catch (error) { console.warn('Unable to initialize lineage-aware member ordering:', error); }
        }));
    }

    async function waitForPlanarLayout() {
        for (let attempt = 0; attempt < 150; attempt++) {
            if (typeof layoutAndRender === 'function' && layoutAndRender.name === 'crossingSafeLayoutAndRender') return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Crossing-safe planar layout did not initialize');
    }

    Promise.all([waitForPlanarLayout(), refreshGraph(true)])
        .then(installWrapper)
        .catch(error => console.warn('Unable to initialize member-order refinement:', error));
})();
