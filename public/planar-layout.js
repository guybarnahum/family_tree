// Crossing-safe family layout refinement.
//
// The persistent graph remains People + Relationships. This layer builds ephemeral
// attachment blocks from the currently visible family units, orders those blocks by their
// actual parent/union ports, and validates crossings explicitly. Ordinary one-couple
// visuals are unchanged; the refinement only changes horizontal ordering/compaction.
(() => {
    if (window.__familyPlanarLayoutInstalled) return;
    window.__familyPlanarLayoutInstalled = true;

    const core = window.FamilyPlanarCore;
    if (!core) {
        console.warn('Planar family layout core is unavailable');
        return;
    }

    const BLOCK_GAP = 26;
    const ORDER_SWEEPS = 5;
    const POSITION_SWEEPS = 5;
    const EXACT_BLOCK_LIMIT = 7;
    const EPSILON = 0.5;

    let graphDocument = null;
    let graphPromise = null;
    let graphSignature = '';
    let lastRefreshChanged = false;
    let parentsByChild = new Map();
    let spousesByPerson = new Map();
    let installed = false;

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuildGraphIndexes() {
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
        if (graphDocument && !force) return graphDocument;
        if (graphPromise && !force) return graphPromise;
        graphPromise = fetch('/api/graph', { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error(await response.text());
                return response.json();
            })
            .then(value => {
                const nextSignature = JSON.stringify([
                    (value.people || []).map(person => person.id).sort(),
                    (value.relationships || []).map(relation => [
                        relation.id || '', relation.type, relation.person1Id, relation.person2Id
                    ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
                ]);
                lastRefreshChanged = nextSignature !== graphSignature;
                graphSignature = nextSignature;
                graphDocument = value;
                rebuildGraphIndexes();
                return value;
            })
            .finally(() => { graphPromise = null; });
        return graphPromise;
    }

    function spouseIds(personId) {
        return [...(spousesByPerson.get(personId) || [])];
    }

    // Match the graph renderer's conservative legacy projection: one explicit parent plus
    // exactly one spouse is treated as two parents for layout only. Never infer with 2+ spouses.
    function parentIds(personId) {
        let parents = [...(parentsByChild.get(personId) || [])];
        if (parents.length === 1) {
            const partners = spouseIds(parents[0]);
            if (partners.length === 1) parents = [...parents, partners[0]];
        }
        if (!parents.length) {
            const legacy = globalNodeMap.get(personId)?.parent_id;
            if (legacy) parents = [legacy];
        }
        return [...new Set(parents)].filter(id => globalNodeMap.has(id));
    }

    function spouseEdge(a, b) {
        return spousesByPerson.get(a)?.has(b) || false;
    }

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function generationCenterY(unit) {
        if (Number.isFinite(unit?.generationCenterY)) return unit.generationCenterY;
        const member = unit?.members?.[0];
        return member ? member.targetY + member.cardHeight / 2 : 0;
    }

    function placeMembersOnly() {
        // Keep the existing couple-orientation heuristic, but do not call positionMembers():
        // the multi-partner layer's positionMembers() also performs its own row repacking,
        // which would violate the hard block order established here.
        try { orientCouples(); } catch (_) {}

        for (const unit of globalUnits) {
            if (!unit.members?.length) continue;
            if (unit.members.length === 1) {
                unit.members[0].x = unit.centerX;
                continue;
            }

            if (unit.members.length === 2 && !unit.multiPartner) {
                const [left, right] = unit.members;
                left.x = unit.centerX - (SPOUSE_EDGE_GAP / 2 + left.cardWidth / 2);
                right.x = unit.centerX + (SPOUSE_EDGE_GAP / 2 + right.cardWidth / 2);
                continue;
            }

            // Multi-partner units already carry exact member gaps/width from their layer.
            let cursor = unit.centerX - unit.width / 2;
            unit.members.forEach((member, index) => {
                member.x = cursor + member.cardWidth / 2;
                cursor += member.cardWidth;
                if (index < unit.members.length - 1) {
                    cursor += unit.memberGaps?.[index] ?? UNIT_GAP;
                }
            });
        }
    }

    function memberPort(unit, memberId) {
        const member = globalNodeMap.get(memberId);
        if (!member || !Number.isFinite(member.x) || !Number.isFinite(unit.width) || unit.width <= 0) return 0.5;
        const left = unit.centerX - unit.width / 2;
        return Math.max(0, Math.min(1, (member.x - left) / unit.width));
    }

    function unionPort(unit, parentIdsInUnit) {
        if (!parentIdsInUnit.length) return { key: `unit:${unit.id}`, port: 0.5, x: unit.centerX };

        for (let i = 0; i < parentIdsInUnit.length; i++) {
            for (let j = i + 1; j < parentIdsInUnit.length; j++) {
                const a = parentIdsInUnit[i];
                const b = parentIdsInUnit[j];
                if (!spouseEdge(a, b)) continue;
                const aNode = globalNodeMap.get(a);
                const bNode = globalNodeMap.get(b);
                const ax = aNode?.x;
                const bx = bNode?.x;
                let x = unit.centerX;
                if (Number.isFinite(ax) && Number.isFinite(bx)) {
                    const leftNode = ax <= bx ? aNode : bNode;
                    const rightNode = leftNode === aNode ? bNode : aNode;
                    const innerLeft = leftNode.x + leftNode.cardWidth / 2;
                    const innerRight = rightNode.x - rightNode.cardWidth / 2;
                    x = (innerLeft + innerRight) / 2;
                }
                const left = unit.centerX - unit.width / 2;
                const port = unit.width > 0 ? Math.max(0, Math.min(1, (x - left) / unit.width)) : 0.5;
                return { key: `union:${unit.id}:${pairKey(a, b)}`, port, x };
            }
        }

        const parentId = parentIdsInUnit[0];
        const parent = globalNodeMap.get(parentId);
        return {
            key: `parent:${unit.id}:${parentId}`,
            port: memberPort(unit, parentId),
            x: Number.isFinite(parent?.x) ? parent.x : unit.centerX
        };
    }

    function semanticEdges() {
        const edges = [];
        for (const childUnit of globalUnits) {
            if (childUnit.gen == null) continue;
            for (const child of childUnit.members || []) {
                const byParentUnit = new Map();
                for (const parentId of parentIds(child.id)) {
                    const parentUnit = unitByNodeId.get(parentId);
                    if (!parentUnit || parentUnit === childUnit || parentUnit.gen !== childUnit.gen - 1) continue;
                    if (!byParentUnit.has(parentUnit)) byParentUnit.set(parentUnit, []);
                    byParentUnit.get(parentUnit).push(parentId);
                }

                for (const [parentUnit, parentIdsInUnit] of byParentUnit) {
                    const source = unionPort(parentUnit, parentIdsInUnit);
                    edges.push({
                        sourceUnitId: parentUnit.id,
                        targetUnitId: childUnit.id,
                        sourceKey: source.key,
                        targetKey: `person:${child.id}`,
                        sourcePort: source.port,
                        targetPort: memberPort(childUnit, child.id),
                        sourceX: source.x,
                        targetX: child.x,
                        childId: child.id,
                        parentUnit,
                        childUnit
                    });
                }
            }
        }
        return edges;
    }

    function rowsByGeneration() {
        const rows = new Map();
        for (const unit of globalUnits) {
            if (!rows.has(unit.gen)) rows.set(unit.gen, []);
            rows.get(unit.gen).push(unit);
        }
        for (const row of rows.values()) {
            row.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
        }
        return rows;
    }

    function rowIds(row) {
        return row.map(unit => unit.id);
    }

    function incomingEdgesFor(row, edges) {
        const ids = new Set(rowIds(row));
        return edges.filter(edge => ids.has(edge.targetUnitId));
    }

    function outgoingEdgesFor(row, edges) {
        const ids = new Set(rowIds(row));
        return edges.filter(edge => ids.has(edge.sourceUnitId));
    }

    function sourceRankMap(upperRow, edges) {
        const upperIndex = new Map(upperRow.map((unit, index) => [unit.id, index]));
        const result = new Map();
        for (const edge of edges) {
            if (!upperIndex.has(edge.sourceUnitId)) continue;
            const rank = core.endpointRank(upperIndex.get(edge.sourceUnitId), edge.sourcePort);
            if (!result.has(edge.sourceKey)) result.set(edge.sourceKey, []);
            result.get(edge.sourceKey).push(rank);
        }
        return new Map([...result].map(([key, values]) => [key, core.median(values, 0)]));
    }

    function sourceFrequency(row, incomingEdges) {
        const targetIds = new Set(rowIds(row));
        const freq = new Map();
        for (const edge of incomingEdges) {
            if (!targetIds.has(edge.targetUnitId)) continue;
            freq.set(edge.sourceKey, (freq.get(edge.sourceKey) || 0) + 1);
        }
        return freq;
    }

    function unitSourceKeys(unit, incomingEdges) {
        return [...new Set(incomingEdges
            .filter(edge => edge.targetUnitId === unit.id)
            .map(edge => edge.sourceKey))];
    }

    function choosePrimarySource(unit, incomingEdges, frequency, ranks) {
        const keys = unitSourceKeys(unit, incomingEdges);
        if (!keys.length) return null;
        return [...keys].sort((a, b) =>
            (frequency.get(b) || 0) - (frequency.get(a) || 0) ||
            (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity) ||
            a.localeCompare(b)
        )[0];
    }

    function buildAttachmentBlocks(row, upperRow, incomingEdges) {
        const frequency = sourceFrequency(row, incomingEdges);
        const ranks = upperRow ? sourceRankMap(upperRow, incomingEdges) : new Map();
        const groups = new Map();

        for (const unit of row) {
            const primary = choosePrimarySource(unit, incomingEdges, frequency, ranks);
            const key = primary ? `source:${primary}` : `free:${unit.id}`;
            if (!groups.has(key)) groups.set(key, { key, primary, units: [], sourceRank: Infinity });
            const block = groups.get(key);
            block.units.push(unit);
            if (primary && ranks.has(primary)) block.sourceRank = ranks.get(primary);
        }

        const blocks = [...groups.values()];
        for (const block of blocks) {
            const originalIndex = new Map(block.units.map((unit, index) => [unit.id, index]));
            block.units.sort((a, b) => {
                const aRanks = unitSourceKeys(a, incomingEdges).map(key => ranks.get(key)).filter(Number.isFinite);
                const bRanks = unitSourceKeys(b, incomingEdges).map(key => ranks.get(key)).filter(Number.isFinite);
                const ar = core.median(aRanks, originalIndex.get(a.id));
                const br = core.median(bRanks, originalIndex.get(b.id));
                return ar - br || originalIndex.get(a.id) - originalIndex.get(b.id) || a.id.localeCompare(b.id);
            });
        }

        const oldBlockIndex = new Map(blocks.map((block, index) => [block.key, index]));
        blocks.sort((a, b) =>
            a.sourceRank - b.sourceRank ||
            oldBlockIndex.get(a.key) - oldBlockIndex.get(b.key) ||
            a.key.localeCompare(b.key)
        );

        return { blocks };
    }

    function flattenBlocks(blocks) {
        return blocks.flatMap(block => block.units);
    }

    function crossingCostForRows(rows, gens, rowIndex, candidateRow, edges) {
        let cost = 0;
        const gen = gens[rowIndex];
        const candidateIds = rowIds(candidateRow);

        if (rowIndex > 0) {
            const upper = rows.get(gens[rowIndex - 1]);
            const layerEdges = edges.filter(edge =>
                edge.parentUnit.gen === gens[rowIndex - 1] && edge.childUnit.gen === gen
            );
            cost += core.countCrossings(layerEdges, rowIds(upper), candidateIds);
        }
        if (rowIndex < gens.length - 1) {
            const lower = rows.get(gens[rowIndex + 1]);
            const layerEdges = edges.filter(edge =>
                edge.parentUnit.gen === gen && edge.childUnit.gen === gens[rowIndex + 1]
            );
            cost += core.countCrossings(layerEdges, candidateIds, rowIds(lower));
        }
        return cost;
    }

    function improveBlockOrder(rows, gens, rowIndex, blocks, edges) {
        if (blocks.length <= 1) return blocks;
        const cost = candidateBlocks => crossingCostForRows(
            rows,
            gens,
            rowIndex,
            flattenBlocks(candidateBlocks),
            edges
        );

        const result = blocks.length <= EXACT_BLOCK_LIMIT
            ? core.exactBestOrder(blocks, cost, { maxItems: EXACT_BLOCK_LIMIT })
            : core.bestInsertionOrder(blocks, cost, { maxPasses: blocks.length * 2 });
        return result.order;
    }

    function improveUnitsInsideBlocks(rows, gens, rowIndex, blocks, edges) {
        for (const block of blocks) {
            if (block.units.length <= 1) continue;
            const cost = candidateUnits => {
                const candidateBlocks = blocks.map(value =>
                    value === block ? { ...value, units: candidateUnits } : value
                );
                return crossingCostForRows(rows, gens, rowIndex, flattenBlocks(candidateBlocks), edges);
            };
            const result = block.units.length <= EXACT_BLOCK_LIMIT
                ? core.exactBestOrder(block.units, cost, { maxItems: EXACT_BLOCK_LIMIT })
                : core.bestInsertionOrder(block.units, cost, { maxPasses: block.units.length * 2 });
            block.units = result.order;
        }
    }

    function optimizeOrders(rows) {
        const gens = [...rows.keys()].sort((a, b) => a - b);

        for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
            placeMembersOnly();
            let edges = semanticEdges();

            // Top-down: source/union order is a hard structural hint for descendant blocks.
            for (let gi = 1; gi < gens.length; gi++) {
                const upper = rows.get(gens[gi - 1]);
                const row = rows.get(gens[gi]);
                const incoming = incomingEdgesFor(row, edges);
                let { blocks } = buildAttachmentBlocks(row, upper, incoming);
                improveUnitsInsideBlocks(rows, gens, gi, blocks, edges);
                blocks = improveBlockOrder(rows, gens, gi, blocks, edges);
                rows.set(gens[gi], flattenBlocks(blocks));
            }

            placeMembersOnly();
            edges = semanticEdges();

            // Bottom-up exact/local improvement considers both adjacent layers, but only
            // whole attachment blocks (and members inside the same block) may move.
            for (let gi = gens.length - 2; gi >= 0; gi--) {
                const row = rows.get(gens[gi]);
                const upper = gi > 0 ? rows.get(gens[gi - 1]) : null;
                const incoming = incomingEdgesFor(row, edges);
                let { blocks } = buildAttachmentBlocks(row, upper, incoming);
                improveUnitsInsideBlocks(rows, gens, gi, blocks, edges);
                blocks = improveBlockOrder(rows, gens, gi, blocks, edges);
                rows.set(gens[gi], flattenBlocks(blocks));
            }
        }
        return gens;
    }

    function blockLayout(block) {
        const units = block.units;
        if (!units.length) return { ...block, width: 0, offsets: new Map() };
        if (units.length === 1) return { ...block, width: units[0].width, offsets: new Map([[units[0], 0]]) };

        const centers = [units[0].width / 2];
        for (let i = 1; i < units.length; i++) {
            centers.push(centers[i - 1] + unitSeparation(units[i - 1], units[i]));
        }
        const left = centers[0] - units[0].width / 2;
        const right = centers[centers.length - 1] + units[units.length - 1].width / 2;
        const center = (left + right) / 2;
        return {
            ...block,
            width: right - left,
            offsets: new Map(units.map((unit, index) => [unit, centers[index] - center]))
        };
    }

    function targetForBlock(block, incomingEdges, outgoingEdges) {
        const ids = new Set(block.units.map(unit => unit.id));
        const incoming = incomingEdges
            .filter(edge => ids.has(edge.targetUnitId))
            .map(edge => edge.sourceX)
            .filter(Number.isFinite);
        if (incoming.length) return core.median(incoming, 0);

        const outgoing = outgoingEdges
            .filter(edge => ids.has(edge.sourceUnitId))
            .map(edge => edge.targetX)
            .filter(Number.isFinite);
        if (outgoing.length) return core.median(outgoing, 0);

        return core.median(block.units.map(unit => unit.centerX), 0);
    }

    function packBlocks(blocks, targets) {
        const layouts = blocks.map(blockLayout);
        if (!layouts.length) return;
        const positions = layouts.map((layout, index) => targets[index]);

        for (let i = 1; i < layouts.length; i++) {
            const minimum = positions[i - 1] + layouts[i - 1].width / 2 + BLOCK_GAP + layouts[i].width / 2;
            positions[i] = Math.max(positions[i], minimum);
        }
        for (let i = layouts.length - 2; i >= 0; i--) {
            const maximum = positions[i + 1] - layouts[i].width / 2 - BLOCK_GAP - layouts[i + 1].width / 2;
            positions[i] = Math.min(positions[i], maximum);
        }

        const delta = core.median(targets.map((target, index) => target - positions[index]), 0);
        layouts.forEach((layout, index) => {
            const center = positions[index] + delta;
            for (const unit of layout.units) {
                unit.centerX = center + (layout.offsets.get(unit) || 0);
            }
        });
    }

    function blocksForPlacement(row, upperRow, edges) {
        const incoming = incomingEdgesFor(row, edges);
        const blocks = buildAttachmentBlocks(row, upperRow, incoming).blocks;
        const index = new Map(row.map((unit, i) => [unit.id, i]));
        for (const block of blocks) {
            block.units.sort((a, b) => index.get(a.id) - index.get(b.id));
        }
        blocks.sort((a, b) =>
            Math.min(...a.units.map(unit => index.get(unit.id))) -
            Math.min(...b.units.map(unit => index.get(unit.id)))
        );
        return blocks;
    }

    function positionRows(rows, gens) {
        for (let pass = 0; pass < POSITION_SWEEPS; pass++) {
            placeMembersOnly();
            let edges = semanticEdges();

            // Top-down: keep each descendant block near its actual parent/union source.
            for (let gi = 0; gi < gens.length; gi++) {
                const row = rows.get(gens[gi]);
                const upper = gi > 0 ? rows.get(gens[gi - 1]) : null;
                const blocks = blocksForPlacement(row, upper, edges);
                const incoming = incomingEdgesFor(row, edges);
                const outgoing = outgoingEdgesFor(row, edges);
                const targets = blocks.map(block => targetForBlock(block, incoming, outgoing));
                packBlocks(blocks, targets);
                placeMembersOnly();
                edges = semanticEdges();
            }

            // Bottom-up: parents are allowed to move toward their child spans, but row and
            // block order are frozen, so this cannot introduce a topological crossing.
            for (let gi = gens.length - 1; gi >= 0; gi--) {
                const row = rows.get(gens[gi]);
                const upper = gi > 0 ? rows.get(gens[gi - 1]) : null;
                const blocks = blocksForPlacement(row, upper, edges);
                const incoming = incomingEdgesFor(row, edges);
                const outgoing = outgoingEdgesFor(row, edges);
                const targets = blocks.map(block => {
                    const blockIds = new Set(block.units.map(unit => unit.id));
                    const inXs = incoming.filter(edge => blockIds.has(edge.targetUnitId))
                        .map(edge => edge.sourceX).filter(Number.isFinite);
                    const outXs = outgoing.filter(edge => blockIds.has(edge.sourceUnitId))
                        .map(edge => edge.targetX).filter(Number.isFinite);
                    return core.median([...inXs, ...outXs], targetForBlock(block, incoming, outgoing));
                });
                packBlocks(blocks, targets);
                placeMembersOnly();
                edges = semanticEdges();
            }
        }

        const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
        const delta = CANVAS_PAD_X - minLeft;
        if (Number.isFinite(delta) && Math.abs(delta) > EPSILON) {
            globalUnits.forEach(unit => unit.centerX += delta);
            placeMembersOnly();
        }
    }

    function layerCrossings(rows, gens, edges) {
        const details = [];
        for (let gi = 0; gi < gens.length - 1; gi++) {
            const upper = rows.get(gens[gi]);
            const lower = rows.get(gens[gi + 1]);
            const layerEdges = edges.filter(edge =>
                edge.parentUnit.gen === gens[gi] && edge.childUnit.gen === gens[gi + 1]
            );
            const pairs = core.crossingPairs(layerEdges, rowIds(upper), rowIds(lower));
            if (pairs.length) details.push({ upperGen: gens[gi], lowerGen: gens[gi + 1], pairs });
        }
        return details;
    }

    function segmentIntersectsRect(segment, rect) {
        const [a, b] = segment;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);

        if (Math.abs(a.x - b.x) < EPSILON) {
            return a.x > rect.left + EPSILON && a.x < rect.right - EPSILON &&
                maxY > rect.top + EPSILON && minY < rect.bottom - EPSILON;
        }
        if (Math.abs(a.y - b.y) < EPSILON) {
            return a.y > rect.top + EPSILON && a.y < rect.bottom - EPSILON &&
                maxX > rect.left + EPSILON && minX < rect.right - EPSILON;
        }
        return false;
    }

    function routeDiagnostics(edges) {
        const cardRects = new Map(globalNodes.map(node => [node.id, {
            left: node.x - node.cardWidth / 2,
            right: node.x + node.cardWidth / 2,
            top: node.targetY,
            bottom: node.targetY + node.cardHeight
        }]));
        const violations = [];

        for (const edge of edges) {
            // Multi-partner routes may originate on a dedicated lane below the spouse row;
            // their topology is validated above, but card-intersection geometry belongs to
            // the union router itself rather than this ordinary corridor approximation.
            if (edge.parentUnit.multiPartner) continue;
            const child = globalNodeMap.get(edge.childId);
            if (!child) continue;
            const sourceY = edge.parentUnit.members.length > 1
                ? generationCenterY(edge.parentUnit)
                : Math.max(...edge.parentUnit.members.map(member => member.targetY + member.cardHeight));
            const targetY = child.targetY;
            const midY = sourceY + Math.max(48, (targetY - sourceY) * 0.52);
            const segments = Math.abs(edge.sourceX - child.x) < EPSILON
                ? [[{ x: edge.sourceX, y: sourceY }, { x: child.x, y: targetY }]]
                : [
                    [{ x: edge.sourceX, y: sourceY }, { x: edge.sourceX, y: midY }],
                    [{ x: edge.sourceX, y: midY }, { x: child.x, y: midY }],
                    [{ x: child.x, y: midY }, { x: child.x, y: targetY }]
                ];

            for (const [nodeId, rect] of cardRects) {
                if (nodeId === child.id || edge.parentUnit.members.some(member => member.id === nodeId)) continue;
                if (segments.some(segment => segmentIntersectsRect(segment, rect))) {
                    violations.push({ edge, nodeId });
                }
            }
        }
        return violations;
    }

    function validatePlanarity(rows, gens) {
        const edges = semanticEdges();
        const crossingLayers = layerCrossings(rows, gens, edges);
        const cardIntersections = routeDiagnostics(edges);
        const crossingCount = crossingLayers.reduce((sum, layer) => sum + layer.pairs.length, 0);

        window.__familyLayoutDiagnostics = {
            crossingCount,
            crossingLayers,
            cardIntersectionCount: cardIntersections.length,
            cardIntersections,
            planar: crossingCount === 0 && cardIntersections.length === 0,
            checkedAt: new Date().toISOString()
        };

        if (crossingCount) {
            console.error('Family layout crossing invariant violated:', crossingCount, crossingLayers);
        }
        if (cardIntersections.length) {
            console.error('Family connector/card intersection invariant violated:', cardIntersections.length, cardIntersections);
        }
        return window.__familyLayoutDiagnostics;
    }

    function planarizeCurrentLayout() {
        if (!globalNodes?.length || !globalUnits?.length) return null;
        const rows = rowsByGeneration();
        const gens = optimizeOrders(rows);
        positionRows(rows, gens);
        updateCanvasBounds();
        syncCardPositions();
        return { rows, gens };
    }

    function installPlanarWrapper() {
        if (installed) return;
        installed = true;
        const BASE_LAYOUT = layoutAndRender;

        layoutAndRender = function crossingSafeLayoutAndRender() {
            BASE_LAYOUT();
            if (!globalNodes?.length || !globalUnits?.length || !graphDocument) return;

            const result = planarizeCurrentLayout();
            if (!result) return;

            // Existing BASE_LAYOUT callbacks may still be queued. Register the final draw
            // after them so the validated coordinates are authoritative for screen and PDF.
            requestAnimationFrame(() => {
                drawSVGLines();
                assertLayout();
                validatePlanarity(result.rows, result.gens);
            });
        };

        // Structural writes and polling flow through loadTree. Refresh relationship indexes
        // before the next validated layout so multiple parents/partners stay authoritative.
        const BASE_LOAD_TREE = loadTree;
        loadTree = async function planarAwareLoadTree(...args) {
            const result = await BASE_LOAD_TREE(...args);
            try { await refreshGraph(true); }
            catch (error) { console.warn('Unable to refresh planar relationship graph:', error); }
            const force = args[1] === true;
            if ((force || lastRefreshChanged) && globalNodes?.length) {
                try { layoutAndRender(); }
                catch (error) { console.warn('Unable to reflow crossing-safe family layout:', error); }
            }
            return result;
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!globalNodes?.length) return;
                try { layoutAndRender(); }
                catch (error) { console.warn('Unable to initialize crossing-safe family layout:', error); }
            });
        });
    }

    async function waitForMultiPartnerLayer() {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (window.__familyMultiPartnerRefinement) return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        console.warn('Multi-partner layout layer did not initialize before planar layout');
    }

    Promise.all([waitForMultiPartnerLayer(), refreshGraph(true)])
        .then(installPlanarWrapper)
        .catch(error => console.warn('Unable to initialize planar family layout:', error));
})();
