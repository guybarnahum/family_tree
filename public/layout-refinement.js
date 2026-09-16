// Post-layout refinement: preserve planar family structure while reducing unnecessary
// horizontal connector length. The base layered layout is intentionally conservative
// about crossings; this pass adds local attachment pressure after branches are expanded.
(() => {
    const Controller = window.FamilyRenderController;
    if (!Controller) return;

    const ALIGNMENT_PASSES = 7;

    function generationRowsByCurrentX() {
        const byGen = new Map();
        for (const unit of globalUnits) {
            if (!byGen.has(unit.gen)) byGen.set(unit.gen, []);
            byGen.get(unit.gen).push(unit);
        }
        for (const units of byGen.values()) {
            units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
        }
        return byGen;
    }

    function median(values, fallback = 0) {
        const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!finite.length) return fallback;
        const middle = Math.floor(finite.length / 2);
        return finite.length % 2
            ? finite[middle]
            : (finite[middle - 1] + finite[middle]) / 2;
    }

    function directParentUnits(unit) {
        return [...unit.parents].filter(parent => parent.gen === unit.gen - 1);
    }

    function directChildUnits(unit) {
        return [...unit.children].filter(child => child.gen === unit.gen + 1);
    }

    function relationshipTarget(unit) {
        const parents = directParentUnits(unit);
        const children = directChildUnits(unit);
        const xs = [
            ...parents.map(parent => parent.centerX),
            ...children.map(child => child.centerX)
        ];
        return median(xs, unit.centerX);
    }

    function orderingTarget(unit) {
        const children = directChildUnits(unit);
        if (children.length) return median(children.map(child => child.centerX), unit.centerX);
        const parents = directParentUnits(unit);
        if (parents.length) return median(parents.map(parent => parent.centerX), unit.centerX);
        return unit.centerX;
    }

    function reorderSafeSiblingCohorts(units) {
        if (units.length < 2 || typeof siblingBlocks !== 'function') return;
        const blocks = siblingBlocks(units);
        const reordered = [];

        for (const block of blocks) {
            const hasMultiPartnerParent = block.members.some(unit =>
                directParentUnits(unit).some(parent => parent.multiPartner)
            );
            if (!hasMultiPartnerParent && block.members.length > 1) {
                const currentIndex = new Map(block.members.map((unit, index) => [unit, index]));
                block.members.sort((a, b) => {
                    const ax = orderingTarget(a);
                    const bx = orderingTarget(b);
                    return ax - bx ||
                        currentIndex.get(a) - currentIndex.get(b) ||
                        a.id.localeCompare(b.id);
                });
            }
            reordered.push(...block.members);
        }
        units.splice(0, units.length, ...reordered);
    }

    function descendantBounds(unit, seen = new Set()) {
        if (!unit || seen.has(unit)) {
            return {
                left: unit?.centerX ?? 0,
                right: unit?.centerX ?? 0
            };
        }
        seen.add(unit);
        let left = unit.centerX - unit.width / 2;
        let right = unit.centerX + unit.width / 2;
        for (const child of directChildUnits(unit)) {
            const bounds = descendantBounds(child, seen);
            left = Math.min(left, bounds.left);
            right = Math.max(right, bounds.right);
        }
        return { left, right };
    }

    function alignmentTarget(parentUnit) {
        const children = directChildUnits(parentUnit);
        if (!children.length) return relationshipTarget(parentUnit);
        let left = Infinity;
        let right = -Infinity;
        for (const child of children) {
            const bounds = descendantBounds(child, new Set());
            left = Math.min(left, bounds.left);
            right = Math.max(right, bounds.right);
        }
        return Number.isFinite(left) && Number.isFinite(right)
            ? (left + right) / 2
            : relationshipTarget(parentUnit);
    }

    function compactRelationshipRow(units) {
        if (!units?.length) return;
        units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
        reorderSafeSiblingCohorts(units);
        const targets = new Map();
        for (const unit of units) targets.set(unit, relationshipTarget(unit));
        compactGeneration(units, targets);
    }

    function spreadGenerationAroundTargets(units, targets) {
        if (!units?.length) return;
        units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
        const positions = units.map(unit => {
            const target = targets.get(unit);
            return Number.isFinite(target) ? target : unit.centerX;
        });
        const passes = Math.max(4, units.length * 4);
        for (let pass = 0; pass < passes; pass++) {
            let moved = false;
            for (let i = 1; i < units.length; i++) {
                const minimum = unitSeparation(units[i - 1], units[i]);
                const gap = positions[i] - positions[i - 1];
                if (gap >= minimum - 0.01) continue;
                const delta = (minimum - gap) / 2;
                positions[i - 1] -= delta;
                positions[i] += delta;
                moved = true;
            }
            if (!moved) break;
        }
        units.forEach((unit, index) => unit.centerX = positions[index]);
    }

    function alignParentsBottomUp(byGen, gens) {
        for (let gi = gens.length - 2; gi >= 0; gi--) {
            const units = byGen.get(gens[gi]);
            units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
            const targets = new Map();
            for (const unit of units) targets.set(unit, alignmentTarget(unit));
            // Parent rows are allowed to expand. Compressing them back into their previous width
            // is exactly what makes a wide descendant tree look top-heavy and off-center.
            spreadGenerationAroundTargets(units, targets);
            positionMembers();
        }
    }

    function normalizeHorizontalBounds() {
        if (!globalUnits.length) return;
        const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
        const delta = CANVAS_PAD_X - minLeft;
        if (Math.abs(delta) < 0.5) return;
        globalUnits.forEach(unit => unit.centerX += delta);
    }

    function straightenRelationshipRows() {
        if (!globalUnits.length) return;
        const byGen = generationRowsByCurrentX();
        const gens = [...byGen.keys()].sort((a, b) => a - b);

        for (let pass = 0; pass < ALIGNMENT_PASSES; pass++) {
            positionMembers();
            for (let gi = 1; gi < gens.length; gi++) {
                compactRelationshipRow(byGen.get(gens[gi]));
                positionMembers();
            }
            alignParentsBottomUp(byGen, gens);
        }

        // Final authority flows upward from the leaves. Each parent is centered over the full
        // horizontal span occupied by its child subtrees, not merely over direct child card centers.
        alignParentsBottomUp(byGen, gens);
        normalizeHorizontalBounds();
        positionMembers();
    }

    Controller.registerLayoutStage({
        name: 'relationship-compaction',
        // This must run after member-order (40) and bridge-compaction (50). Member-order owns the
        // earlier layout prefix, so an order-20 refinement is bypassed/overwritten on full renders.
        order: 60,
        run() {
            if (!globalNodes.length || !globalUnits.length) return;
            straightenRelationshipRows();
            updateCanvasBounds();
            syncCardPositions();
        }
    });
})();
