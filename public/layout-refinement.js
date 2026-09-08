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

    function directChildNodes(parentUnit) {
        return globalNodes
            .filter(child => {
                if (!child.parent_id || child.gen !== parentUnit.gen + 1) return false;
                return unitByNodeId.get(child.parent_id) === parentUnit;
            })
            .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    }

    function alignmentTarget(parentUnit) {
        const children = directChildNodes(parentUnit);
        if (!children.length) return relationshipTarget(parentUnit);
        if (children.length === 1) return children[0].x;
        const xs = children.map(child => child.x);
        return (Math.min(...xs) + Math.max(...xs)) / 2;
    }

    function compactRelationshipRow(units) {
        if (!units?.length) return;
        units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
        reorderSafeSiblingCohorts(units);
        const targets = new Map();
        for (const unit of units) targets.set(unit, relationshipTarget(unit));
        compactGeneration(units, targets);
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
            for (let gi = gens.length - 2; gi >= 0; gi--) {
                const units = byGen.get(gens[gi]);
                units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
                const targets = new Map();
                for (const unit of units) targets.set(unit, alignmentTarget(unit));
                compactGeneration(units, targets);
                positionMembers();
            }
        }

        for (let gi = 1; gi < gens.length; gi++) {
            compactRelationshipRow(byGen.get(gens[gi]));
            positionMembers();
        }
        normalizeHorizontalBounds();
        positionMembers();
    }

    Controller.registerLayoutStage({
        name: 'relationship-compaction',
        order: 20,
        run() {
            if (!globalNodes.length || !globalUnits.length) return;
            straightenRelationshipRows();
            updateCanvasBounds();
            syncCardPositions();
        }
    });
})();
