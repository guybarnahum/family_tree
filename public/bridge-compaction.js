// Safe compaction for long bridge connectors.
//
// Once row/member order is planar, some self-contained ancestry/descendant branches can
// still drift far from the single edge that attaches them to the selected person's graph.
// If that attachment is a graph bridge, move the entire non-root side rigidly toward the
// attachment. Internal geometry is unchanged; collision bounds prevent any unit from
// passing a stationary unit, so planar order cannot be invalidated by this refinement.
(() => {
    if (window.__familyBridgeCompactionInstalled) return;
    window.__familyBridgeCompactionInstalled = true;

    const MIN_ARM = 56;
    const MIN_SHIFT = 2;
    const MAX_PASSES = 4;
    const EPSILON = 0.5;

    let graphDocument = null;
    let graphPromise = null;
    let graphSignature = '';
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

    // Match the renderer's conservative legacy projection.
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

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function median(values, fallback = 0) {
        const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!finite.length) return fallback;
        const middle = Math.floor(finite.length / 2);
        return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
    }

    function parentSourceX(parentUnit, ids) {
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                if (!spouseEdge(ids[i], ids[j])) continue;
                const a = globalNodeMap.get(ids[i]);
                const b = globalNodeMap.get(ids[j]);
                if (!a || !b) continue;
                const left = a.x <= b.x ? a : b;
                const right = left === a ? b : a;
                return ((left.x + left.cardWidth / 2) + (right.x - right.cardWidth / 2)) / 2;
            }
        }
        const xs = ids.map(id => globalNodeMap.get(id)?.x).filter(Number.isFinite);
        return median(xs, parentUnit.centerX);
    }

    function unitLinks() {
        const grouped = new Map();
        for (const childUnit of globalUnits) {
            for (const child of childUnit.members || []) {
                const byParentUnit = new Map();
                for (const parentId of parentIds(child.id)) {
                    const parentUnit = unitByNodeId.get(parentId);
                    if (!parentUnit || parentUnit === childUnit || parentUnit.gen !== childUnit.gen - 1) continue;
                    if (!byParentUnit.has(parentUnit)) byParentUnit.set(parentUnit, []);
                    byParentUnit.get(parentUnit).push(parentId);
                }
                for (const [parentUnit, ids] of byParentUnit) {
                    const key = `${parentUnit.id}->${childUnit.id}`;
                    if (!grouped.has(key)) grouped.set(key, {
                        key,
                        parentUnit,
                        childUnit,
                        records: []
                    });
                    grouped.get(key).records.push({
                        childId: child.id,
                        sourceX: parentSourceX(parentUnit, ids),
                        targetX: child.x
                    });
                }
            }
        }
        return [...grouped.values()];
    }

    function adjacencyFromLinks(links) {
        const adjacency = new Map(globalUnits.map(unit => [unit.id, new Set()]));
        for (const link of links) {
            adjacency.get(link.parentUnit.id)?.add(link.childUnit.id);
            adjacency.get(link.childUnit.id)?.add(link.parentUnit.id);
        }
        return adjacency;
    }

    function currentRootUnit() {
        const rootCard = document.querySelector('#cards-layer .absolute-card.graph-root[data-node-id]');
        const urlId = new URL(window.location.href).searchParams.get('person');
        let id = rootCard?.dataset.nodeId || urlId;
        if (!id) {
            try { id = localStorage.getItem('family-tree.anchor-person'); } catch (_) {}
        }
        return id ? unitByNodeId.get(id) : null;
    }

    function reachable(adjacency, startId, excludedKey) {
        const result = new Set();
        if (!startId || !adjacency.has(startId)) return result;
        const queue = [startId];
        while (queue.length) {
            const id = queue.shift();
            if (result.has(id)) continue;
            result.add(id);
            for (const next of adjacency.get(id) || []) {
                if (pairKey(id, next) === excludedKey || result.has(next)) continue;
                queue.push(next);
            }
        }
        return result;
    }

    function bridgeCandidates(links) {
        const rootUnit = currentRootUnit();
        if (!rootUnit) return [];
        const adjacency = adjacencyFromLinks(links);
        const byPair = new Map();
        for (const link of links) {
            const key = pairKey(link.parentUnit.id, link.childUnit.id);
            if (!byPair.has(key)) byPair.set(key, []);
            byPair.get(key).push(link);
        }

        const candidates = [];
        for (const [edgeKey, pairLinks] of byPair) {
            // Multiple semantic records between the same two units are still one graph edge.
            const sample = pairLinks[0];
            const rootSide = reachable(adjacency, rootUnit.id, edgeKey);
            const parentInRoot = rootSide.has(sample.parentUnit.id);
            const childInRoot = rootSide.has(sample.childUnit.id);
            if (parentInRoot === childInRoot) continue; // not a bridge relative to the root component

            const branchEndpoint = parentInRoot ? sample.childUnit : sample.parentUnit;
            const branchIds = reachable(adjacency, branchEndpoint.id, edgeKey);
            if (!branchIds.size || branchIds.has(rootUnit.id)) continue;

            const records = pairLinks.flatMap(link => link.records);
            const span = Math.max(...records.map(record => Math.abs(record.targetX - record.sourceX)), 0);
            candidates.push({
                edgeKey,
                links: pairLinks,
                branchIds,
                branchContainsParent: branchIds.has(sample.parentUnit.id),
                span
            });
        }
        return candidates.sort((a, b) => b.span - a.span || a.edgeKey.localeCompare(b.edgeKey));
    }

    function desiredShift(candidate) {
        const deltas = [];
        for (const link of candidate.links) {
            for (const record of link.records) {
                if (candidate.branchContainsParent) {
                    deltas.push(record.targetX - record.sourceX);
                } else {
                    deltas.push(record.sourceX - record.targetX);
                }
            }
        }
        return median(deltas, 0);
    }

    function separation(left, right) {
        try {
            if (typeof unitSeparation === 'function') return unitSeparation(left, right);
        } catch (_) {}
        return left.width / 2 + UNIT_GAP + right.width / 2;
    }

    function allowedShift(branchIds, desired) {
        if (Math.abs(desired) < MIN_SHIFT) return 0;
        const moving = globalUnits.filter(unit => branchIds.has(unit.id));
        const stationary = globalUnits.filter(unit => !branchIds.has(unit.id));
        let limit = Math.abs(desired);

        if (desired > 0) {
            for (const a of moving) {
                for (const b of stationary) {
                    if (a.gen !== b.gen || b.centerX <= a.centerX + EPSILON) continue;
                    limit = Math.min(limit, Math.max(0, b.centerX - a.centerX - separation(a, b)));
                }
            }
            return Math.min(desired, limit);
        }

        for (const a of moving) {
            for (const b of stationary) {
                if (a.gen !== b.gen || b.centerX >= a.centerX - EPSILON) continue;
                limit = Math.min(limit, Math.max(0, a.centerX - b.centerX - separation(b, a)));
            }
        }
        return -Math.min(Math.abs(desired), limit);
    }

    function translateBranch(branchIds, dx) {
        if (Math.abs(dx) < MIN_SHIFT) return;
        for (const unit of globalUnits) {
            if (!branchIds.has(unit.id)) continue;
            unit.centerX += dx;
            for (const member of unit.members || []) member.x += dx;
        }
    }

    function normalizeHorizontalBounds() {
        if (!globalUnits.length) return;
        const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
        const delta = CANVAS_PAD_X - minLeft;
        if (!Number.isFinite(delta) || Math.abs(delta) <= EPSILON) return;
        for (const unit of globalUnits) {
            unit.centerX += delta;
            for (const member of unit.members || []) member.x += delta;
        }
    }

    function compactBridgeBranches() {
        if (!graphDocument || !globalUnits?.length) return [];
        const moves = [];

        for (let pass = 0; pass < MAX_PASSES; pass++) {
            const links = unitLinks();
            const candidates = bridgeCandidates(links).filter(candidate => candidate.span >= MIN_ARM);
            let movedThisPass = false;

            for (const candidate of candidates) {
                // Geometry may have changed after an earlier move in this pass.
                const currentLinks = unitLinks();
                const fresh = bridgeCandidates(currentLinks).find(value => value.edgeKey === candidate.edgeKey);
                if (!fresh || fresh.span < MIN_ARM) continue;

                const desired = desiredShift(fresh);
                const dx = allowedShift(fresh.branchIds, desired);
                if (Math.abs(dx) < MIN_SHIFT) continue;

                const before = fresh.span;
                translateBranch(fresh.branchIds, dx);
                const afterLink = unitLinks().filter(link => pairKey(link.parentUnit.id, link.childUnit.id) === fresh.edgeKey);
                const after = Math.max(...afterLink.flatMap(link => link.records)
                    .map(record => Math.abs(record.targetX - record.sourceX)), 0);
                moves.push({
                    edgeKey: fresh.edgeKey,
                    branchUnits: fresh.branchIds.size,
                    desired,
                    applied: dx,
                    before,
                    after
                });
                movedThisPass = true;
            }
            if (!movedThisPass) break;
        }

        normalizeHorizontalBounds();
        window.__familyBridgeDiagnostics = {
            movedBranches: moves.length,
            moves,
            checkedAt: new Date().toISOString()
        };
        return moves;
    }

    function installWrapper() {
        if (installed) return;
        installed = true;
        const BASE_LAYOUT = layoutAndRender;

        layoutAndRender = function bridgeCompactedLayoutAndRender() {
            BASE_LAYOUT();
            if (!graphDocument || !globalUnits?.length) return;

            compactBridgeBranches();
            updateCanvasBounds();
            syncCardPositions();
            requestAnimationFrame(() => {
                drawSVGLines();
                assertLayout();
            });
        };

        const BASE_LOAD_TREE = loadTree;
        loadTree = async function bridgeAwareLoadTree(...args) {
            const result = await BASE_LOAD_TREE(...args);
            try {
                const refreshed = await refreshGraph(true);
                if (refreshed.changed && globalNodes?.length) layoutAndRender();
            } catch (error) {
                console.warn('Unable to refresh bridge compaction graph:', error);
            }
            return result;
        };

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!globalNodes?.length) return;
            try { layoutAndRender(); }
            catch (error) { console.warn('Unable to initialize bridge compaction:', error); }
        }));
    }

    async function waitForMemberOrder() {
        for (let attempt = 0; attempt < 180; attempt++) {
            if (typeof layoutAndRender === 'function' && layoutAndRender.name === 'lineageAwareLayoutAndRender') return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Lineage-aware member ordering did not initialize');
    }

    Promise.all([waitForMemberOrder(), refreshGraph(true)])
        .then(installWrapper)
        .catch(error => console.warn('Unable to initialize bridge compaction:', error));
})();
