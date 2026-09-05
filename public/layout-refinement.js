// Post-layout refinement: preserve the planar generation order, then slide whole
// family units within each generation to make parent/child connectors vertical
// whenever the hard non-overlap constraints allow it.
//
// This deliberately runs after the main layered layout in index.html. It does not
// change generation assignment or left/right ordering; it only improves X positions.
(() => {
    const BASE_LAYOUT = layoutAndRender;
    const ALIGNMENT_PASSES = 6;

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
        if (!children.length) return parentUnit.centerX;

        // One child is the strongest case: align the parent-family midpoint exactly
        // over that child's actual card center (including when the child is one spouse
        // inside a married couple). This is the Anat / Leah+Yohanan case.
        if (children.length === 1) return children[0].x;

        // With siblings, no single vertical can reach every child. Put the family trunk
        // over the center of the occupied child span; the sibling bus then fans out with
        // the shortest, most symmetric horizontal segments possible.
        const xs = children.map(child => child.x);
        return (Math.min(...xs) + Math.max(...xs)) / 2;
    }

    function normalizeHorizontalBounds() {
        if (!globalUnits.length) return;
        const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
        const delta = CANVAS_PAD_X - minLeft;
        if (Math.abs(delta) < 0.5) return;
        globalUnits.forEach(unit => unit.centerX += delta);
    }

    function straightenParentRows() {
        if (!globalUnits.length) return;

        const byGen = generationRowsByCurrentX();
        const gens = [...byGen.keys()].sort((a, b) => a - b);

        // Iterate because moving an ancestry row can refine couple orientation, which
        // slightly changes the exact X of the spouse that receives the parent line.
        for (let pass = 0; pass < ALIGNMENT_PASSES; pass++) {
            positionMembers();

            // Bottom-up: children are the anchors; move their parents toward them.
            for (let gi = gens.length - 2; gi >= 0; gi--) {
                const units = byGen.get(gens[gi]);
                units.sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));

                const targets = new Map();
                for (const unit of units) {
                    targets.set(unit, alignmentTarget(unit));
                }

                // compactGeneration keeps this row's established planar order and
                // enforces measured rectangle spacing. When targets have enough room,
                // they are retained exactly; otherwise it makes the minimum displacement
                // necessary to avoid overlap.
                compactGeneration(units, targets);
                positionMembers();
            }
        }

        normalizeHorizontalBounds();
        positionMembers();
    }

    layoutAndRender = function layoutAndRenderWithStraightening() {
        BASE_LAYOUT();
        if (!globalNodes.length || !globalUnits.length) return;

        straightenParentRows();
        updateCanvasBounds();
        syncCardPositions();

        // BASE_LAYOUT has already queued a paint, but our refinement changed X values.
        // Queue a later redraw so connectors use the refined geometry.
        requestAnimationFrame(() => {
            drawSVGLines();
            assertLayout();
        });
    };

    // If the initial API load completed unusually quickly before this script executed,
    // immediately refine the already-rendered tree as well.
    requestAnimationFrame(() => {
        if (!globalNodes.length || !globalUnits.length) return;
        straightenParentRows();
        updateCanvasBounds();
        syncCardPositions();
        drawSVGLines();
        assertLayout();
    });
})();
