// Final horizontal refinement: compact descendant branches where row order allows, then move parents
// above the effective span of those settled subtrees using the same attachment anchors as the router.
(() => {
    const Controller = window.FamilyRenderController;
    const Store = window.FamilyGraphStore;
    if (!Controller || !Store) return;

    const EPSILON = 0.5;

    function subtreeGap() {
        return typeof geometryMobileQuery !== 'undefined' && geometryMobileQuery.matches
            ? MOBILE_UNIT_GAP
            : UNIT_GAP;
    }

    function averageValues(values, fallback = 0) {
        const finite = values.filter(Number.isFinite);
        return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : fallback;
    }

    function directChildUnits(unit) {
        return [...unit.children].filter(child => child.gen === unit.gen + 1);
    }

    function primaryParentUnit(unit) {
        for (const member of unit.members || []) {
            const parentId = member.parent_id;
            const parent = parentId ? unitByNodeId.get(parentId) : null;
            if (parent && parent !== unit && parent.gen === unit.gen - 1) return parent;
        }
        const parents = [...unit.parents].filter(parent => parent.gen === unit.gen - 1);
        if (parents.length === 1) return parents[0];
        if (!parents.length) return null;
        return [...parents].sort((a, b) =>
            Math.abs(a.centerX - unit.centerX) - Math.abs(b.centerX - unit.centerX) ||
            a.id.localeCompare(b.id)
        )[0];
    }

    function ownedChildren(unit) {
        return directChildUnits(unit)
            .filter(child => primaryParentUnit(child) === unit)
            .sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
    }

    function collectSubtree(unit, target = new Set()) {
        if (!unit || target.has(unit)) return target;
        target.add(unit);
        for (const child of ownedChildren(unit)) collectSubtree(child, target);
        return target;
    }

    function subtreeBounds(unit) {
        const units = [...collectSubtree(unit)];
        if (!units.length) return { left: unit.centerX, right: unit.centerX };
        return {
            left: Math.min(...units.map(item => item.centerX - item.width / 2)),
            right: Math.max(...units.map(item => item.centerX + item.width / 2))
        };
    }

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function parentIdsForMember(member, parentUnit) {
        const indexes = Store.snapshot().indexes;
        const parentsByChild = indexes?.parentsByChild || new Map();
        const spousesByPerson = indexes?.spousesByPerson || new Map();
        const explicit = [...(parentsByChild.get(member.id) || [])]
            .filter(id => unitByNodeId.get(id) === parentUnit);
        const result = new Set(explicit);

        if (explicit.length === 1) {
            const partners = [...(spousesByPerson.get(explicit[0]) || [])]
                .filter(id => unitByNodeId.get(id) === parentUnit);
            if (partners.length === 1) result.add(partners[0]);
        }
        if (!result.size && member.parent_id && unitByNodeId.get(member.parent_id) === parentUnit) {
            result.add(member.parent_id);
        }
        return [...result].sort();
    }

    function sourceForParentIds(parentUnit, parentIds) {
        const nodes = parentIds.map(id => globalNodeMap.get(id)).filter(Boolean);
        const spouseSet = Store.snapshot().indexes?.spousesByPerson || new Map();
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                if (!spouseSet.get(a.id)?.has(b.id)) continue;
                const left = a.x <= b.x ? a : b;
                const right = left === a ? b : a;
                return {
                    key: `union:${pairKey(a.id, b.id)}`,
                    parentIds: [a.id, b.id].sort(),
                    anchor: ((left.x + left.cardWidth / 2) + (right.x - right.cardWidth / 2)) / 2
                };
            }
        }
        if (nodes.length) {
            return {
                key: `parent:${nodes[0].id}`,
                parentIds: [nodes[0].id],
                anchor: nodes[0].x
            };
        }
        return { key: `unit:${parentUnit.id}`, parentIds: [], anchor: parentUnit.centerX };
    }

    function sourceForChildUnit(childUnit, parentUnit) {
        const sources = [];
        const targetIds = [];
        for (const member of childUnit.members || []) {
            const parentIds = parentIdsForMember(member, parentUnit);
            if (!parentIds.length) continue;
            sources.push(sourceForParentIds(parentUnit, parentIds));
            targetIds.push(member.id);
        }

        const unique = new Map();
        for (const source of sources) if (!unique.has(source.key)) unique.set(source.key, source);
        const values = [...unique.values()];
        if (values.length === 1) return { ...values[0], targetIds };
        if (values.length > 1) {
            return {
                key: `mixed:${values.map(source => source.key).sort().join('+')}`,
                parentIds: [...new Set(values.flatMap(source => source.parentIds))].sort(),
                anchor: averageValues(values.map(source => source.anchor), parentUnit.centerX),
                targetIds,
                mixed: true
            };
        }
        return { key: `unit:${parentUnit.id}`, parentIds: [], anchor: parentUnit.centerX, targetIds };
    }

    function childSourceGroups(parentUnit) {
        const groups = new Map();
        for (const child of ownedChildren(parentUnit)) {
            const source = sourceForChildUnit(child, parentUnit);
            if (!groups.has(source.key)) {
                groups.set(source.key, {
                    key: source.key,
                    parentIds: [...source.parentIds],
                    mixed: !!source.mixed,
                    children: [],
                    targetIds: []
                });
            }
            const group = groups.get(source.key);
            group.children.push(child);
            group.targetIds.push(...source.targetIds);
        }
        return [...groups.values()];
    }

    function sourceForGroup(parentUnit, group) {
        if (group.mixed) {
            const sources = [];
            for (const child of group.children) {
                const source = sourceForChildUnit(child, parentUnit);
                if (source.mixed) {
                    const memberSources = [];
                    for (const member of child.members || []) {
                        const ids = parentIdsForMember(member, parentUnit);
                        if (ids.length) memberSources.push(sourceForParentIds(parentUnit, ids));
                    }
                    sources.push(...memberSources);
                } else {
                    sources.push(source);
                }
            }
            return {
                key: group.key,
                parentIds: [...group.parentIds],
                anchor: averageValues(sources.map(source => source.anchor), parentUnit.centerX)
            };
        }
        return sourceForParentIds(parentUnit, group.parentIds);
    }

    function groupSpan(group) {
        if (!group.children.length) return null;
        const bounds = group.children.map(subtreeBounds);
        const left = Math.min(...bounds.map(item => item.left));
        const right = Math.max(...bounds.map(item => item.right));
        return { left, right, center: (left + right) / 2, width: right - left };
    }

    function groupTargetAxis(group, fallback = null) {
        const xs = [...new Set(group.targetIds)]
            .map(id => globalNodeMap.get(id)?.x)
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        if (!xs.length) return fallback;
        const middle = Math.floor(xs.length / 2);
        return xs.length % 2
            ? xs[middle]
            : (xs[middle - 1] + xs[middle]) / 2;
    }

    function translateUnit(unit, dx) {
        if (!Number.isFinite(dx) || Math.abs(dx) < 0.001) return;
        unit.centerX += dx;
        for (const member of unit.members || []) {
            if (Number.isFinite(member.x)) member.x += dx;
        }
    }

    function maxSafeScale(shifts) {
        let scale = 1;
        const byGen = new Map();
        for (const unit of globalUnits) {
            if (!byGen.has(unit.gen)) byGen.set(unit.gen, []);
            byGen.get(unit.gen).push(unit);
        }
        for (const units of byGen.values()) {
            units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
            for (let i = 1; i < units.length; i++) {
                const left = units[i - 1];
                const right = units[i];
                const currentGap = right.centerX - left.centerX;
                const minimum = unitSeparation(left, right);
                const rate = (shifts.get(right) || 0) - (shifts.get(left) || 0);
                if (rate >= -EPSILON) continue;
                const slack = Math.max(0, currentGap - minimum);
                scale = Math.min(scale, slack / -rate);
            }
        }
        return Math.max(0, Math.min(1, scale));
    }

    function compactChildGroup(group) {
        if (group.mixed || group.children.length < 2) return null;
        const items = group.children.map(child => {
            const units = [...collectSubtree(child)];
            const bounds = subtreeBounds(child);
            return {
                child,
                units,
                bounds,
                center: (bounds.left + bounds.right) / 2,
                width: bounds.right - bounds.left
            };
        }).sort((a, b) => a.center - b.center || a.child.id.localeCompare(b.child.id));

        const seen = new Set();
        for (const item of items) {
            for (const unit of item.units) {
                if (seen.has(unit)) return null;
                seen.add(unit);
            }
        }

        const beforeLeft = Math.min(...items.map(item => item.bounds.left));
        const beforeRight = Math.max(...items.map(item => item.bounds.right));
        const beforeCenter = (beforeLeft + beforeRight) / 2;
        const gap = subtreeGap();
        const packedWidth = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
        let cursor = beforeCenter - packedWidth / 2;
        const shifts = new Map();
        for (const item of items) {
            const desiredCenter = cursor + item.width / 2;
            const dx = desiredCenter - item.center;
            for (const unit of item.units) shifts.set(unit, dx);
            cursor += item.width + gap;
        }

        const scale = maxSafeScale(shifts);
        if (scale > 0.001) {
            for (const [unit, dx] of shifts) translateUnit(unit, dx * scale);
        }
        const after = groupSpan(group);
        return {
            childCount: group.children.length,
            requestedReduction: Math.max(0, (beforeRight - beforeLeft) - packedWidth),
            appliedReduction: after ? Math.max(0, (beforeRight - beforeLeft) - after.width) : 0,
            scale
        };
    }

    function desiredParentShift(parentUnit) {
        const groups = childSourceGroups(parentUnit);
        if (!groups.length) return null;
        let weighted = 0;
        let totalWeight = 0;
        for (const group of groups) {
            const span = groupSpan(group);
            if (!span) continue;
            const source = sourceForGroup(parentUnit, group);
            const targetAxis = groupTargetAxis(group, span.center);
            const weight = Math.max(1, span.width);
            weighted += (targetAxis - source.anchor) * weight;
            totalWeight += weight;
        }
        return totalWeight ? weighted / totalWeight : null;
    }

    function placeGeneration(units, targets) {
        if (!units.length) return;
        units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
        if (units.length === 1) {
            const target = targets.get(units[0]);
            if (Number.isFinite(target)) translateUnit(units[0], target - units[0].centerX);
            return;
        }

        const positions = units.map(unit => {
            const target = targets.get(unit);
            return Number.isFinite(target) ? target : unit.centerX;
        });
        for (let i = 1; i < units.length; i++) {
            positions[i] = Math.max(
                positions[i],
                positions[i - 1] + unitSeparation(units[i - 1], units[i])
            );
        }
        for (let i = units.length - 2; i >= 0; i--) {
            positions[i] = Math.min(
                positions[i],
                positions[i + 1] - unitSeparation(units[i], units[i + 1])
            );
        }

        const requested = units.map((unit, index) => {
            const target = targets.get(unit);
            return Number.isFinite(target) ? target : positions[index];
        });
        const rowShift = averageValues(requested.map((value, index) => value - positions[index]));
        units.forEach((unit, index) => {
            const next = positions[index] + rowShift;
            translateUnit(unit, next - unit.centerX);
        });
    }

    function unitLabel(unit) {
        return (unit.members || []).map(member => member.name || member.id).join(' + ');
    }

    function remainingAvoidableGap(group) {
        if (group.children.length < 2) return 0;
        const bounds = group.children.map(subtreeBounds)
            .sort((a, b) => (a.left + a.right) - (b.left + b.right));
        const gap = subtreeGap();
        let total = 0;
        for (let i = 1; i < bounds.length; i++) {
            total += Math.max(0, bounds[i].left - bounds[i - 1].right - gap);
        }
        return total;
    }

    function diagnosticsFor(parentUnit, group) {
        const span = groupSpan(group);
        if (!span) return null;
        const source = sourceForGroup(parentUnit, group);
        const targets = group.targetIds
            .map(id => globalNodeMap.get(id)?.x)
            .filter(Number.isFinite);
        const targetAxis = groupTargetAxis(group, span.center);
        const connectorXs = [source.anchor, ...targets];
        const connectorLeft = Math.min(...connectorXs);
        const connectorRight = Math.max(...connectorXs);
        return {
            gen: parentUnit.gen,
            parents: unitLabel(parentUnit),
            sourceKey: group.key,
            parentIds: [...group.parentIds],
            children: group.children.map(unitLabel).join(' | '),
            childCount: group.children.length,
            targetCount: targets.length,
            unionAnchor: Math.round(source.anchor),
            childAxis: Math.round(targetAxis),
            axisOffset: Math.round(source.anchor - targetAxis),
            subtreeCenter: Math.round(span.center),
            offset: Math.round(source.anchor - span.center),
            subtreeWidth: Math.round(span.width),
            connectorWidth: Math.round(connectorRight - connectorLeft),
            maxArm: Math.round(Math.max(...targets.map(x => Math.abs(x - source.anchor)), 0)),
            avoidableGap: Math.round(remainingAvoidableGap(group)),
            mixedSource: !!group.mixed
        };
    }

    function normalizeHorizontalBounds() {
        if (!globalUnits.length) return;
        const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
        const delta = CANVAS_PAD_X - minLeft;
        if (!Number.isFinite(delta) || Math.abs(delta) < EPSILON) return;
        globalUnits.forEach(unit => translateUnit(unit, delta));
    }

    function refineLayoutBottomUp() {
        if (!globalUnits.length) return;
        const byGen = new Map();
        for (const unit of globalUnits) {
            if (!byGen.has(unit.gen)) byGen.set(unit.gen, []);
            byGen.get(unit.gen).push(unit);
        }
        const gens = [...byGen.keys()].sort((a, b) => b - a);

        // Settle one generation at a time from the leaves upward. Compact each parent's already-
        // settled child subtrees first, then move that parent row over the result. When the next
        // generation compacts these units it moves their whole subtrees rigidly, preserving the
        // lower-level centering that was just established.
        const compactionMoves = [];
        for (let gi = 1; gi < gens.length; gi++) {
            const units = byGen.get(gens[gi]) || [];
            for (const unit of units) {
                for (const group of childSourceGroups(unit)) {
                    const result = compactChildGroup(group);
                    if (result && result.appliedReduction > EPSILON) {
                        compactionMoves.push({ parentUnit: unit.id, sourceKey: group.key, ...result });
                    }
                }
            }

            const targets = new Map();
            for (const unit of units) {
                const shift = desiredParentShift(unit);
                if (Number.isFinite(shift)) targets.set(unit, unit.centerX + shift);
            }
            placeGeneration(units, targets);
        }

        normalizeHorizontalBounds();

        const groups = globalUnits.flatMap(unit =>
            childSourceGroups(unit).map(group => diagnosticsFor(unit, group)).filter(Boolean)
        ).sort((a, b) =>
            a.gen - b.gen || Math.abs(b.axisOffset) - Math.abs(a.axisOffset) ||
            Math.abs(b.offset) - Math.abs(a.offset) || b.connectorWidth - a.connectorWidth
        );
        window.__familySubtreeLayoutDiagnostics = {
            groups,
            maxAxisOffset: groups.length ? Math.max(...groups.map(item => Math.abs(item.axisOffset))) : 0,
            maxOffset: groups.length ? Math.max(...groups.map(item => Math.abs(item.offset))) : 0,
            maxConnectorWidth: groups.length ? Math.max(...groups.map(item => item.connectorWidth)) : 0,
            remainingAvoidableGap: groups.reduce((sum, item) => sum + item.avoidableGap, 0),
            compactionMoves,
            checkedAt: new Date().toISOString()
        };
    }

    Controller.registerLayoutStage({
        name: 'relationship-compaction',
        order: 60,
        run() {
            if (!globalNodes.length || !globalUnits.length) return;
            refineLayoutBottomUp();
            updateCanvasBounds();
            syncCardPositions();
        }
    });
})();
