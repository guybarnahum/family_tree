// Crossing-safe orthogonal connector router for the visible family graph.
// It runs after planar-layout.js: spouse/union geometry is preserved, while parent-child
// buses receive distinct corridor lanes chosen by an explicit segment-intersection solver.
(() => {
    if (window.__familyPlanarRouterInstalled) return;
    window.__familyPlanarRouterInstalled = true;

    const UNION_LANE_CLEARANCE = 18;
    const UNION_LANE_STEP = 16;
    const CORRIDOR_MARGIN = 10;
    const MAX_SEARCH_STATES = 50000;
    const EPSILON = 0.5;

    let graphDocument = null;
    let graphPromise = null;
    let parentsByChild = new Map();
    let spousesByPerson = new Map();
    let installed = false;

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuildIndexes() {
        parentsByChild = new Map();
        spousesByPerson = new Map();
        for (const relation of graphDocument?.relationships || []) {
            if (relation.type === 'parent') addSet(parentsByChild, relation.person2Id, relation.person1Id);
            else if (relation.type === 'spouse') {
                addSet(spousesByPerson, relation.person1Id, relation.person2Id);
                addSet(spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }
    }

    async function refreshGraph(force = false) {
        if (graphDocument && !force) return graphDocument;
        if (graphPromise && !force) return graphPromise;
        graphPromise = fetch('/api/graph', { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error(await response.text());
                return response.json();
            })
            .then(value => {
                graphDocument = value;
                rebuildIndexes();
                return value;
            })
            .finally(() => { graphPromise = null; });
        return graphPromise;
    }

    function spouseIds(id) {
        return [...(spousesByPerson.get(id) || [])];
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

    function spouseEdge(a, b) {
        return spousesByPerson.get(a)?.has(b) || false;
    }

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function generationY(unit) {
        if (Number.isFinite(unit?.generationCenterY)) return unit.generationCenterY;
        const member = unit?.members?.[0];
        return member ? member.targetY + member.cardHeight / 2 : 0;
    }

    const leftEdge = node => node.x - node.cardWidth / 2;
    const rightEdge = node => node.x + node.cardWidth / 2;
    const bottomEdge = node => node.targetY + node.cardHeight;

    function unionGeometry(unit) {
        const result = new Map();
        const centerY = generationY(unit);
        const index = new Map(unit.members.map((member, i) => [member.id, i]));
        const pairs = [];

        for (const member of unit.members) {
            for (const spouseId of spouseIds(member.id)) {
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
            const x1 = rightEdge(left);
            const x2 = leftEdge(right);

            if (adjacent) {
                result.set(key, {
                    key: `union:${unit.id}:${key}`,
                    x: (x1 + x2) / 2,
                    y: centerY,
                    path: `M ${x1} ${centerY} L ${x2} ${centerY}`,
                    width: 2.5
                });
                continue;
            }

            const laneY = maxBottom + UNION_LANE_CLEARANCE + (laneByPair.get(key) || 0) * UNION_LANE_STEP;
            const inset = Math.min(14, Math.max(8, (x2 - x1) * 0.08));
            result.set(key, {
                key: `union:${unit.id}:${key}`,
                x: (x1 + x2) / 2,
                y: laneY,
                path: roundedOrthogonalPath([
                    [x1, centerY], [x1 + inset, centerY], [x1 + inset, laneY],
                    [x2 - inset, laneY], [x2 - inset, centerY], [x2, centerY]
                ], CONNECTOR_KNEE_RADIUS),
                width: 2.3
            });
        }
        return result;
    }

    function sourceForChild(parentUnit, child, geometry) {
        const inUnit = parentIds(child.id)
            .filter(parentId => unitByNodeId.get(parentId) === parentUnit);

        for (let i = 0; i < inUnit.length; i++) {
            for (let j = i + 1; j < inUnit.length; j++) {
                if (!spouseEdge(inUnit[i], inUnit[j])) continue;
                const key = pairKey(inUnit[i], inUnit[j]);
                const union = geometry.get(key);
                if (union) return union;
            }
        }

        if (inUnit.length) {
            const parent = globalNodeMap.get(inUnit[0]);
            if (parent) {
                return {
                    key: `parent:${parentUnit.id}:${parent.id}`,
                    x: parent.x,
                    y: bottomEdge(parent)
                };
            }
        }

        if (parentUnit.members.length === 2) {
            return { key: `unit:${parentUnit.id}`, x: parentUnit.centerX, y: generationY(parentUnit) };
        }
        const parent = parentUnit.members[0];
        return { key: `unit:${parentUnit.id}`, x: parent.x, y: bottomEdge(parent) };
    }

    function buildRouteGroups() {
        const geometryByUnit = new Map();
        for (const unit of globalUnits) geometryByUnit.set(unit, unionGeometry(unit));

        const groupsByLayer = new Map();
        for (const parentUnit of globalUnits) {
            const children = globalNodes.filter(child =>
                child.gen === parentUnit.gen + 1 &&
                parentIds(child.id).some(parentId => unitByNodeId.get(parentId) === parentUnit)
            );
            const geometry = geometryByUnit.get(parentUnit) || new Map();

            for (const child of children) {
                const source = sourceForChild(parentUnit, child, geometry);
                const layerKey = `${parentUnit.gen}->${child.gen}`;
                if (!groupsByLayer.has(layerKey)) groupsByLayer.set(layerKey, new Map());
                const layer = groupsByLayer.get(layerKey);
                if (!layer.has(source.key)) {
                    layer.set(source.key, {
                        key: source.key,
                        sourceX: source.x,
                        sourceY: source.y,
                        clearY: Math.max(source.y, ...parentUnit.members.map(bottomEdge)),
                        edges: []
                    });
                }
                layer.get(source.key).edges.push({ childId: child.id, targetX: child.x, targetY: child.targetY });
            }
        }

        return { geometryByUnit, groupsByLayer };
    }

    function segment(type, x1, y1, x2, y2, groupKey, targetKey = null) {
        return { type, x1, y1, x2, y2, groupKey, targetKey };
    }

    function routeSegments(group, laneY) {
        const segments = [segment('v', group.sourceX, group.sourceY, group.sourceX, laneY, group.key)];
        for (const edge of group.edges) {
            if (Math.abs(edge.targetX - group.sourceX) > EPSILON) {
                segments.push(segment('h', group.sourceX, laneY, edge.targetX, laneY, group.key, edge.childId));
            }
            segments.push(segment('v', edge.targetX, laneY, edge.targetX, edge.targetY, group.key, edge.childId));
        }
        return segments;
    }

    function between(value, a, b) {
        return value > Math.min(a, b) + EPSILON && value < Math.max(a, b) - EPSILON;
    }

    function perpendicularIntersection(a, b) {
        const h = a.type === 'h' ? a : b.type === 'h' ? b : null;
        const v = a.type === 'v' ? a : b.type === 'v' ? b : null;
        if (!h || !v) return false;
        return between(v.x1, h.x1, h.x2) && between(h.y1, v.y1, v.y2);
    }

    function segmentCrossesAssigned(segmentValue, assignedSegments) {
        for (const other of assignedSegments) {
            if (segmentValue.groupKey === other.groupKey) continue;
            if (segmentValue.targetKey && other.targetKey && segmentValue.targetKey === other.targetKey) continue;
            if (perpendicularIntersection(segmentValue, other)) return true;
        }
        return false;
    }

    function segmentCrossesCard(segmentValue, ignoredNodeIds) {
        for (const node of globalNodes) {
            if (ignoredNodeIds.has(node.id)) continue;
            const rect = {
                left: leftEdge(node), right: rightEdge(node),
                top: node.targetY, bottom: bottomEdge(node)
            };
            if (segmentValue.type === 'v') {
                if (segmentValue.x1 > rect.left + EPSILON && segmentValue.x1 < rect.right - EPSILON &&
                    Math.max(segmentValue.y1, segmentValue.y2) > rect.top + EPSILON &&
                    Math.min(segmentValue.y1, segmentValue.y2) < rect.bottom - EPSILON) return true;
            } else if (segmentValue.y1 > rect.top + EPSILON && segmentValue.y1 < rect.bottom - EPSILON &&
                Math.max(segmentValue.x1, segmentValue.x2) > rect.left + EPSILON &&
                Math.min(segmentValue.x1, segmentValue.x2) < rect.right - EPSILON) return true;
        }
        return false;
    }

    function laneCandidates(groups) {
        const minTargetY = Math.min(...groups.flatMap(group => group.edges.map(edge => edge.targetY)));
        const maxSourceY = Math.max(...groups.map(group => group.sourceY));
        const top = Math.max(...groups.map(group => group.clearY ?? group.sourceY)) + CORRIDOR_MARGIN;
        const bottom = minTargetY - CORRIDOR_MARGIN;
        const count = Math.max(groups.length, 1);

        if (!(bottom > top + 2)) {
            const middle = maxSourceY + Math.max(20, (minTargetY - maxSourceY) * 0.5);
            return Array.from({ length: count }, (_, index) => middle + index * 2);
        }

        const step = (bottom - top) / (count + 1);
        return Array.from({ length: count }, (_, index) => top + step * (index + 1));
    }

    function preferredLaneOrder(groups, lanes) {
        const sourceOrder = [...groups].sort((a, b) => a.sourceX - b.sourceX || a.key.localeCompare(b.key));
        const preferred = new Map();
        // Reverse lane order is a strong default for overlapping monotone intervals: left
        // sources take lower lanes and right sources upper lanes, reducing stem/bus crosses.
        sourceOrder.forEach((group, index) => preferred.set(group.key, lanes.length - 1 - index));
        return preferred;
    }

    function solveLayer(groups) {
        if (!groups.length) return { assignments: new Map(), crossings: 0 };
        const lanes = laneCandidates(groups);
        const preferred = preferredLaneOrder(groups, lanes);
        const ordered = [...groups].sort((a, b) => {
            const aSpan = Math.max(...a.edges.map(edge => Math.abs(edge.targetX - a.sourceX)), 0);
            const bSpan = Math.max(...b.edges.map(edge => Math.abs(edge.targetX - b.sourceX)), 0);
            return bSpan - aSpan || a.sourceX - b.sourceX || a.key.localeCompare(b.key);
        });

        let states = 0;
        let solution = null;

        function visit(index, used, assignments, assignedSegments) {
            if (solution || states++ > MAX_SEARCH_STATES) return;
            if (index === ordered.length) {
                solution = new Map(assignments);
                return;
            }

            const group = ordered[index];
            const candidateIndexes = lanes.map((_, laneIndex) => laneIndex)
                .filter(laneIndex => !used.has(laneIndex))
                .sort((a, b) =>
                    Math.abs(a - preferred.get(group.key)) - Math.abs(b - preferred.get(group.key))
                );

            const ignored = new Set(group.edges.map(edge => edge.childId));
            for (const member of globalUnits.find(unit =>
                unit.members.some(person => Math.abs(person.x - group.sourceX) < EPSILON)
            )?.members || []) ignored.add(member.id);

            for (const laneIndex of candidateIndexes) {
                const laneY = lanes[laneIndex];
                if (laneY <= group.sourceY + 2) continue;
                const segments = routeSegments(group, laneY);
                if (segments.some(seg => segmentCrossesAssigned(seg, assignedSegments))) continue;
                if (segments.some(seg => segmentCrossesCard(seg, ignored))) continue;

                used.add(laneIndex);
                assignments.set(group.key, laneY);
                visit(index + 1, used, assignments, [...assignedSegments, ...segments]);
                assignments.delete(group.key);
                used.delete(laneIndex);
                if (solution) return;
            }
        }

        visit(0, new Set(), new Map(), []);
        if (solution) return { assignments: solution, crossings: 0 };

        // Rare fallback for genuinely rejoining/non-planar visible structures: choose the
        // least-conflicting unique lanes deterministically and report the residual count.
        const assignments = new Map();
        const used = new Set();
        const assignedSegments = [];
        let crossings = 0;
        for (const group of ordered) {
            let best = null;
            for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
                if (used.has(laneIndex)) continue;
                const laneY = lanes[laneIndex];
                const segments = routeSegments(group, laneY);
                let cost = 0;
                for (const seg of segments) {
                    for (const other of assignedSegments) {
                        if (perpendicularIntersection(seg, other)) cost++;
                    }
                }
                if (!best || cost < best.cost) best = { laneIndex, laneY, segments, cost };
            }
            if (!best) continue;
            used.add(best.laneIndex);
            assignments.set(group.key, best.laneY);
            assignedSegments.push(...best.segments);
            crossings += best.cost;
        }
        return { assignments, crossings };
    }

    function pathForGroupEdge(group, edge, laneY) {
        if (Math.abs(edge.targetX - group.sourceX) < EPSILON) {
            return `M ${group.sourceX} ${group.sourceY} L ${edge.targetX} ${edge.targetY}`;
        }
        return roundedOrthogonalPath([
            [group.sourceX, group.sourceY],
            [group.sourceX, laneY],
            [edge.targetX, laneY],
            [edge.targetX, edge.targetY]
        ], CONNECTOR_KNEE_RADIUS);
    }

    function crossingSafeDraw() {
        if (!graphDocument || !globalUnits?.length) return;
        const { geometryByUnit, groupsByLayer } = buildRouteGroups();
        let svg = '';

        for (const geometry of geometryByUnit.values()) {
            for (const union of geometry.values()) svg += svgPath(union.path, union.width);
        }

        let residualCrossings = 0;
        const layerDiagnostics = [];
        for (const [layerKey, layerMap] of groupsByLayer) {
            const groups = [...layerMap.values()];
            const solved = solveLayer(groups);
            residualCrossings += solved.crossings;
            layerDiagnostics.push({ layerKey, groups: groups.length, crossings: solved.crossings });

            for (const group of groups) {
                const laneY = solved.assignments.get(group.key) ??
                    group.sourceY + Math.max(48, (Math.min(...group.edges.map(edge => edge.targetY)) - group.sourceY) * 0.52);
                for (const edge of group.edges) {
                    svg += svgPath(pathForGroupEdge(group, edge, laneY));
                }
            }
        }

        svgLayer.innerHTML = svg;
        window.__familyRouteDiagnostics = {
            crossingCount: residualCrossings,
            layers: layerDiagnostics,
            crossingFree: residualCrossings === 0,
            checkedAt: new Date().toISOString()
        };
        if (residualCrossings) {
            console.error('Family route solver could not remove every crossing:', window.__familyRouteDiagnostics);
        }
    }

    function installRouter() {
        if (installed) return;
        installed = true;
        drawSVGLines = crossingSafeDraw;

        const baseLoadTree = loadTree;
        loadTree = async function routerAwareLoadTree(...args) {
            const result = await baseLoadTree(...args);
            try { await refreshGraph(true); }
            catch (error) { console.warn('Unable to refresh connector routing graph:', error); }
            return result;
        };

        requestAnimationFrame(() => {
            try {
                drawSVGLines();
                if (typeof assertLayout === 'function') assertLayout();
            } catch (error) {
                console.warn('Unable to initialize crossing-safe connector routing:', error);
            }
        });
    }

    async function waitForPlanarLayout() {
        for (let attempt = 0; attempt < 120; attempt++) {
            if (window.__familyPlanarLayoutInstalled) return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        console.warn('Planar layout did not initialize before connector router');
    }

    Promise.all([waitForPlanarLayout(), refreshGraph(true)])
        .then(installRouter)
        .catch(error => console.warn('Unable to initialize crossing-safe connector router:', error));
})();
