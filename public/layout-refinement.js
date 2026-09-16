// Final horizontal refinement: descendants keep their settled geometry; parents move above them.
// Earlier stages own topology, ordering and planarity. This stage only translates parent rows.
(() => {
    const Controller = window.FamilyRenderController;
    const Store = window.FamilyGraphStore;
    if (!Controller || !Store) return;

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

    function childSubtreeSpan(parentUnit) {
        const children = ownedChildren(parentUnit);
        if (!children.length) return null;
        const bounds = children.map(subtreeBounds);
        const left = Math.min(...bounds.map(item => item.left));
        const right = Math.max(...bounds.map(item => item.right));
        return { children, left, right, center: (left + right) / 2 };
    }

    function explicitParentIdsForChild(childUnit, parentUnit) {
        const indexes = Store.snapshot().indexes;
        const parentsByChild = indexes?.parentsByChild || new Map();
        const spousesByPerson = indexes?.spousesByPerson || new Map();
        const result = new Set();

        for (const member of childUnit.members || []) {
            const explicit = [...(parentsByChild.get(member.id) || [])]
                .filter(id => unitByNodeId.get(id) === parentUnit);
            for (const id of explicit) result.add(id);

            if (explicit.length === 1) {
                const partners = [...(spousesByPerson.get(explicit[0]) || [])]
                    .filter(id => unitByNodeId.get(id) === parentUnit);
                if (partners.length === 1) result.add(partners[0]);
            }
        }

        if (!result.size) {
            for (const member of childUnit.members || []) {
                if (member.parent_id && unitByNodeId.get(member.parent_id) === parentUnit) {
                    result.add(member.parent_id);
                }
            }
        }
        return [...result].sort();
    }

    function anchorForParentIds(parentUnit, parentIds) {
        const nodes = parentIds.map(id => globalNodeMap.get(id)).filter(Boolean);
        if (!nodes.length) return parentUnit.centerX;
        if (nodes.length === 1) return nodes[0].x;

        const spouseSet = Store.snapshot().indexes?.spousesByPerson || new Map();
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                if (!spouseSet.get(a.id)?.has(b.id)) continue;
                const left = a.x <= b.x ? a : b;
                const right = left === a ? b : a;
                return ((left.x + left.cardWidth / 2) + (right.x - right.cardWidth / 2)) / 2;
            }
        }

        return nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
    }

    function outgoingAnchor(parentUnit, children) {
        const ids = new Set();
        for (const child of children) {
            for (const id of explicitParentIdsForChild(child, parentUnit)) ids.add(id);
        }
        const parentIds = [...ids];
        if (parentIds.length <= 2) return anchorForParentIds(parentUnit, parentIds);

        // Multi-partner units can have more than one outgoing union. A rigid translation cannot
        // satisfy every union independently, so center the whole unit over the aggregate child span.
        return parentUnit.centerX;
    }

    function translateUnit(unit, dx) {
        if (!Number.isFinite(dx) || Math.abs(dx) < 0.001) return;
        unit.centerX += dx;
        for (const member of unit.members || []) {
            if (Number.isFinite(member.x)) member.x += dx;
        }
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
        const rowShift = average(requested.map((value, index) => value - positions[index]));

        units.forEach((unit, index) => {
            const next = positions[index] + rowShift;
            translateUnit(unit, next - unit.centerX);
        });
    }

    function unitLabel(unit) {
        return (unit.members || []).map(member => member.name || member.id).join(' + ');
    }

    function childLabels(unit) {
        return ownedChildren(unit).map(unitLabel).join(' | ');
    }

    function normalizeHorizontalBounds() {
        if (!globalUnits.length) return;
        const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
        const delta = CANVAS_PAD_X - minLeft;
        if (Math.abs(delta) < 0.5) return;
        globalUnits.forEach(unit => translateUnit(unit, delta));
    }

    function diagnosticsFor(unit) {
        const span = childSubtreeSpan(unit);
        if (!span) return null;
        const anchor = outgoingAnchor(unit, span.children);
        return {
            gen: unit.gen,
            parents: unitLabel(unit),
            children: childLabels(unit),
            unionAnchor: Math.round(anchor),
            subtreeCenter: Math.round(span.center),
            offset: Math.round(anchor - span.center),
            subtreeWidth: Math.round(span.right - span.left)
        };
    }

    function refineParentsBottomUp() {
        if (!globalUnits.length) return;

        const byGen = new Map();
        for (const unit of globalUnits) {
            if (!byGen.has(unit.gen)) byGen.set(unit.gen, []);
            byGen.get(unit.gen).push(unit);
        }
        const gens = [...byGen.keys()].sort((a, b) => b - a);

        // Descendant rows stay fixed. Starting at the leaves, move only the parent generation
        // above the center of the already-settled child subtrees. This is intentionally the inverse
        // of top-down compaction and may create longer horizontal sibling arms.
        for (let gi = 1; gi < gens.length; gi++) {
            const units = byGen.get(gens[gi]) || [];
            const targets = new Map();
            for (const unit of units) {
                const span = childSubtreeSpan(unit);
                if (!span) continue;
                const anchor = outgoingAnchor(unit, span.children);
                targets.set(unit, unit.centerX + (span.center - anchor));
            }
            placeGeneration(units, targets);
        }

        normalizeHorizontalBounds();

        const groups = globalUnits
            .map(diagnosticsFor)
            .filter(Boolean)
            .sort((a, b) => a.gen - b.gen || Math.abs(b.offset) - Math.abs(a.offset));
        window.__familySubtreeLayoutDiagnostics = {
            groups,
            maxOffset: groups.length ? Math.max(...groups.map(item => Math.abs(item.offset))) : 0,
            checkedAt: new Date().toISOString()
        };
    }

    Controller.registerLayoutStage({
        name: 'relationship-compaction',
        order: 60,
        run() {
            if (!globalNodes.length || !globalUnits.length) return;
            refineParentsBottomUp();
            updateCanvasBounds();
            syncCardPositions();
        }
    });
})();
