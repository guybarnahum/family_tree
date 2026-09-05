// Post-layout refinement: preserve planar family structure while reducing unnecessary
// horizontal connector length. The base layered layout is intentionally conservative
// about crossings; this pass adds local attachment pressure after branches are expanded.
//
// Safe sibling cohorts (same parent-family signature) may reorder internally according
// to their own descendant/parent targets. Different cohorts retain their established
// order, and multi-partner parent rows stay under the union-aware refinement.
(() => {
    const BASE_LAYOUT = layoutAndRender;
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

        // Manhattan/orthogonal connector length is minimized by the median of adjacent
        // relationship anchors. A leaf therefore wants to sit directly below its parent;
        // a branching unit settles between its parent and descendant subtrees.
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
            // Children of a multi-partner unit are grouped by actual union in
            // multi-partner-refinement.js. Do not second-guess that richer ordering here.
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

        // One child is the strongest case: align the parent-family midpoint exactly
        // over that child's actual card center (including when the child is one spouse
        // inside a married couple).
        if (children.length === 1) return children[0].x;

        // With siblings, place the trunk over the occupied child span. This is less
        // sensitive than an arithmetic mean to a dense subtree on only one side.
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

        // Alternate child-to-parent and parent-to-child pressure. The base layout already
        // found a planar ordering; repeated local compaction closes empty gaps introduced
        // by expanded subtrees without allowing unrelated family cohorts to cross.
        for (let pass = 0; pass < ALIGNMENT_PASSES; pass++) {
            positionMembers();

            // Top-down: leaves and child subtrees chase their actual attachment point.
            for (let gi = 1; gi < gens.length; gi++) {
                compactRelationshipRow(byGen.get(gens[gi]));
                positionMembers();
            }

            // Bottom-up: parents move back over the newly compacted child spans.
            for (let gi = gens.length - 2; gi >= 0; gi--) {
                const units = byGen.get(gens[gi]);
                units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));

                const targets = new Map();
                for (const unit of units) targets.set(unit, alignmentTarget(unit));
                compactGeneration(units, targets);
                positionMembers();
            }
        }

        // Final top-down pass prevents the last parent movement from reintroducing a long
        // leaf arm. Keep the current cohort order and only take available horizontal space.
        for (let gi = 1; gi < gens.length; gi++) {
            compactRelationshipRow(byGen.get(gens[gi]));
            positionMembers();
        }

        normalizeHorizontalBounds();
        positionMembers();
    }

    layoutAndRender = function layoutAndRenderWithRelationshipCompaction() {
        BASE_LAYOUT();
        if (!globalNodes.length || !globalUnits.length) return;

        straightenRelationshipRows();
        updateCanvasBounds();
        syncCardPositions();

        // BASE_LAYOUT has already queued a paint, but our refinement changed X values.
        requestAnimationFrame(() => {
            drawSVGLines();
            assertLayout();
        });
    };

    // If the initial API load completed unusually quickly before this script executed,
    // immediately refine the already-rendered tree as well.
    requestAnimationFrame(() => {
        if (!globalNodes.length || !globalUnits.length) return;
        straightenRelationshipRows();
        updateCanvasBounds();
        syncCardPositions();
        drawSVGLines();
        assertLayout();
    });
})();
