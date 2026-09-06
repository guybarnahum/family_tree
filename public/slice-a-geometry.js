// Slice A geometry cleanup for name-only graph cards.
// Keeps topology controls out of each other's way and reduces generation spacing now that
// biography fields no longer contribute to card height.
(() => {
    if (window.__familySliceAGeometryInstalled) return;
    window.__familySliceAGeometryInstalled = true;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');
    const DESKTOP_GENERATION_GAP = 96;
    const MOBILE_GENERATION_GAP = 84;
    const COMPACT_BAND_FALLBACK = 56;
    const MOBILE_TOP_PADDING = 150;

    const style = document.createElement('style');
    style.textContent = `
        /* Put the partner pill on the physical top-right corner. Using left:100% with
           translate(-50%,-50%) centers the pill exactly on that corner, away from the
           centered add-parent action. */
        #cards-layer .absolute-card [data-action="add-spouse"],
        #cards-layer .absolute-card.graph-root [data-action="add-spouse"] {
            top: 0 !important;
            left: 100% !important;
            right: auto !important;
            transform: translate(-50%, -50%) !important;
            white-space: nowrap !important;
        }

        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            /* The old selected card reserved biography height. Slice A moved biography to
               the pane, so that invisible 138px minimum is no longer appropriate. */
            #cards-layer .absolute-card.graph-root {
                min-height: 0 !important;
            }
        }
    `;
    document.head.appendChild(style);

    function compactGenerationVerticalPositions(byGen) {
        const gens = [...byGen.keys()].sort((a, b) => a - b);
        const generationGap = mobileQuery.matches
            ? MOBILE_GENERATION_GAP
            : DESKTOP_GENERATION_GAP;
        const topPadding = mobileQuery.matches
            ? MOBILE_TOP_PADDING
            : (typeof CANVAS_PAD_TOP === 'number' ? CANVAS_PAD_TOP : 180);
        let bandTop = topPadding;

        for (const gen of gens) {
            const units = byGen.get(gen);
            const bandHeight = Math.max(
                ...units.map(unit => unit.height),
                COMPACT_BAND_FALLBACK
            );
            const centerY = bandTop + bandHeight / 2;

            for (const unit of units) {
                unit.generationCenterY = centerY;
                for (const member of unit.members) {
                    member.generationCenterY = centerY;
                    member.targetY = centerY - member.cardHeight / 2;
                }
            }

            bandTop += bandHeight + generationGap;
        }
    }

    function installCompactSpacing() {
        if (typeof assignVerticalPositions !== 'function') return false;
        assignVerticalPositions = compactGenerationVerticalPositions;
        window.__familyGenerationGeometry = {
            desktopGap: DESKTOP_GENERATION_GAP,
            mobileGap: MOBILE_GENERATION_GAP,
            fallbackBandHeight: COMPACT_BAND_FALLBACK
        };
        return true;
    }

    let relayoutFrame = 0;
    function queueRelayout() {
        if (relayoutFrame) cancelAnimationFrame(relayoutFrame);
        relayoutFrame = requestAnimationFrame(() => {
            relayoutFrame = 0;
            if (!installCompactSpacing() || !globalNodes?.length) return;
            try { layoutAndRender(); }
            catch (error) { console.warn('Unable to apply compact Slice A generation spacing:', error); }
        });
    }

    installCompactSpacing();
    mobileQuery.addEventListener?.('change', queueRelayout);
    requestAnimationFrame(() => requestAnimationFrame(queueRelayout));
})();
