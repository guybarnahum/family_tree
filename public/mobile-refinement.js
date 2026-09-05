// Responsive/touch refinements for the person-centric family graph.
// This file also installs the shared generation-center vertical layout used by desktop.
(() => {
    const viewport = document.getElementById('scroll-viewport');
    const cardsLayer = document.getElementById('cards-layer');
    if (!viewport || !cardsLayer) return;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');

    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            html, body {
                width: 100%;
                height: 100dvh;
                min-height: 100%;
                overflow: hidden;
            }

            #scroll-viewport {
                width: 100vw;
                height: 100dvh;
                -webkit-overflow-scrolling: touch;
                touch-action: pan-x pan-y;
                overscroll-behavior: contain;
                scroll-behavior: smooth;
                scrollbar-width: none;
            }

            #scroll-viewport::-webkit-scrollbar { display: none; }

            body > .fixed.top-0.left-0.w-full {
                padding: max(8px, env(safe-area-inset-top)) 8px 0 8px !important;
            }

            .family-title-card {
                position: relative;
                width: min(100%, 430px);
                max-width: calc(100vw - 16px);
                padding: 9px 11px 10px !important;
                border-radius: 14px !important;
                background: rgba(255, 255, 255, 0.92) !important;
                backdrop-filter: blur(16px) saturate(1.15);
                -webkit-backdrop-filter: blur(16px) saturate(1.15);
                box-shadow: 0 5px 20px rgba(52, 78, 65, 0.10) !important;
            }

            .family-title-card h1 {
                font-size: 1.45rem !important;
                line-height: 1.05 !important;
                padding-inline-end: 66px;
            }

            .family-title-card > p { display: none; }

            .graph-search-wrap {
                width: 100% !important;
                max-width: none !important;
                margin-top: 7px !important;
            }

            .graph-search-input {
                height: 42px;
                padding: 8px 13px !important;
                font-size: 16px !important;
                border-radius: 12px !important;
                background: rgba(253, 251, 247, 0.96) !important;
            }

            .graph-search-results {
                top: calc(100% + 6px) !important;
                max-height: min(46dvh, 360px) !important;
                border-radius: 13px !important;
                box-shadow: 0 12px 30px rgba(52, 78, 65, 0.18) !important;
            }

            .graph-search-result {
                min-height: 48px;
                padding: 9px 12px !important;
                font-size: 14px !important;
            }

            .graph-search-result small { font-size: 11px !important; }

            .family-title-card .family-import-export {
                position: absolute;
                top: 8px;
                left: 8px;
                display: flex !important;
                gap: 4px !important;
                margin: 0 !important;
                opacity: 1 !important;
                max-height: 34px !important;
                overflow: visible !important;
                pointer-events: auto !important;
                transform: none !important;
            }

            .family-import-export button {
                min-width: 30px;
                min-height: 30px;
                padding: 4px 7px !important;
                font-size: 0 !important;
                border-radius: 9px !important;
            }

            .family-import-export button[data-tree-action="export"]::after {
                content: '⇩';
                font-size: 16px;
            }

            .family-import-export button[data-tree-action="import"]::after {
                content: '⇧';
                font-size: 16px;
            }

            .absolute-card {
                min-width: 132px !important;
                max-width: 176px !important;
                padding: 8px 10px 10px !important;
                border-radius: 10px !important;
                touch-action: pan-x pan-y;
                -webkit-tap-highlight-color: transparent;
                overflow: visible !important;
            }

            .absolute-card h2 {
                font-size: 1.08rem !important;
                line-height: 1.08 !important;
            }

            .absolute-card p {
                font-size: 10px !important;
                line-height: 1.22 !important;
            }

            .absolute-card:not(.graph-root) .graph-select-zone {
                display: none !important;
            }

            /* The layout itself centers every card on its generation line, so the selected
               card can grow naturally around its center without a separate visual lift. */
            #cards-layer .absolute-card.graph-root {
                min-width: min(228px, calc(100vw - 46px)) !important;
                width: min(264px, calc(100vw - 40px)) !important;
                max-width: min(286px, calc(100vw - 28px)) !important;
                min-height: 138px !important;
                padding: 20px 16px 40px !important;
                border-radius: 13px !important;
                outline-width: 3px !important;
                outline-offset: 3px !important;
                box-shadow: 0 12px 28px rgba(52, 78, 65, 0.24) !important;
                overflow: visible !important;
                transform: translateX(-50%) !important;
                transform-origin: center center !important;
                background: #fff !important;
            }

            #cards-layer .absolute-card.graph-root h2[data-field="name"] {
                margin-top: 2px !important;
                margin-bottom: 7px !important;
                font-size: 1.28rem !important;
                line-height: 1.15 !important;
                text-align: center !important;
            }

            #cards-layer .absolute-card.graph-root p[data-field="dates"] {
                margin-bottom: 7px !important;
                font-size: 11px !important;
                line-height: 1.35 !important;
                text-align: center !important;
            }

            #cards-layer .absolute-card.graph-root p[data-field="description"] {
                font-size: 11px !important;
                line-height: 1.45 !important;
                text-align: center !important;
            }

            #cards-layer .absolute-card.graph-root .default-node-text {
                opacity: 0.58 !important;
            }

            .absolute-card [data-action] {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            #cards-layer .absolute-card.graph-root [data-action] {
                opacity: 1 !important;
                pointer-events: auto !important;
                z-index: 60 !important;
                box-shadow: 0 3px 9px rgba(52, 78, 65, 0.16) !important;
                touch-action: manipulation;
                box-sizing: border-box !important;
            }

            #cards-layer .absolute-card.graph-root [data-action="delete"] {
                top: -17px !important;
                left: -17px !important;
                width: 34px !important;
                height: 34px !important;
                padding: 0 !important;
                border: 1px solid rgba(220, 38, 38, 0.16) !important;
                border-radius: 999px !important;
                background: #fff !important;
                color: #ef8f8f !important;
                font-size: 13px !important;
                line-height: 1 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            #cards-layer .absolute-card.graph-root [data-action="add-parent"],
            #cards-layer .absolute-card.graph-root [data-action="add-spouse"],
            #cards-layer .absolute-card.graph-root [data-action="add-child"] {
                height: 34px !important;
                min-height: 34px !important;
                padding: 0 12px !important;
                border-radius: 999px !important;
                font-size: 11px !important;
                line-height: 1 !important;
                white-space: nowrap;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            #cards-layer .absolute-card.graph-root [data-action="add-parent"] {
                top: -17px !important;
                left: 50% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
                background: #a3b18a !important;
                border: 1px solid #8fa178 !important;
                color: #fff !important;
            }

            #cards-layer .absolute-card.graph-root [data-action="add-spouse"] {
                top: -17px !important;
                right: 8px !important;
                left: auto !important;
                transform: none !important;
                background: #fce7f3 !important;
                border: 1px solid #f5bfd8 !important;
                color: #be185d !important;
            }

            #cards-layer .absolute-card.graph-root [data-action="add-child"] {
                bottom: -17px !important;
                left: 50% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
                background: #588157 !important;
                border: 1px solid #476d48 !important;
                color: #fff !important;
            }

            #cards-layer .absolute-card.graph-root .graph-select-zone {
                display: block !important;
                left: 8px !important;
                right: 8px !important;
                bottom: 5px !important;
                height: 21px !important;
                opacity: 1 !important;
                pointer-events: none !important;
                transform: none !important;
                background: rgba(163, 177, 138, 0.20) !important;
                border: 0 !important;
                border-top: 1px solid rgba(88, 129, 87, 0.16) !important;
                border-radius: 0 0 8px 8px !important;
                color: #344e41 !important;
                font-size: 9px !important;
                line-height: 20px !important;
            }

            .graph-frontier {
                min-width: 34px !important;
                height: 34px !important;
                right: -22px !important;
                line-height: 32px !important;
                font-size: 11px !important;
                opacity: 0.94 !important;
                z-index: 55 !important;
                touch-action: manipulation;
            }

            .absolute-card.graph-root .graph-frontier {
                right: -24px !important;
                top: 50% !important;
            }

            #status {
                left: max(8px, env(safe-area-inset-left)) !important;
                bottom: max(8px, env(safe-area-inset-bottom)) !important;
                font-size: 11px !important;
                z-index: 300 !important;
            }

            #family-tree-build {
                right: max(7px, env(safe-area-inset-right)) !important;
                bottom: max(6px, env(safe-area-inset-bottom)) !important;
                opacity: 0.45 !important;
            }
        }
    `;
    document.head.appendChild(style);

    if (!document.querySelector('script[data-family-presentation]')) {
        const presentation = document.createElement('script');
        const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';
        presentation.src = `/presentation-refinement.js?v=${encodeURIComponent(build)}`;
        presentation.dataset.familyPresentation = 'true';
        document.body.appendChild(presentation);
    }

    function installGenerationCenteredVerticalLayout(topPadding, generationGap, fallbackHeight) {
        assignVerticalPositions = function generationCenteredVerticalPositions(byGen) {
            const gens = [...byGen.keys()].sort((a, b) => a - b);
            let bandTop = topPadding;

            for (const gen of gens) {
                const units = byGen.get(gen);
                const bandHeight = Math.max(...units.map(unit => unit.height), fallbackHeight);
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
        };
    }

    function generationLineY(unit) {
        if (Number.isFinite(unit?.generationCenterY)) return unit.generationCenterY;
        const member = unit?.members?.[0];
        if (!member) return 0;
        return member.targetY + member.cardHeight / 2;
    }

    function generationCenteredDrawSVGLines() {
        let svgHTML = '';

        // Spouses always connect on the generation centerline. Different card heights are
        // centered around that same line, so the marriage connector is always horizontal.
        for (const unit of globalUnits) {
            if (unit.members.length !== 2) continue;
            const [left, right] = unit.members;
            const y = generationLineY(unit);
            const x1 = left.x + left.cardWidth / 2;
            const x2 = right.x - right.cardWidth / 2;
            svgHTML += svgPath(`M ${x1} ${y} L ${x2} ${y}`, 2.5);
        }

        for (const unit of globalUnits) {
            const childNodes = globalNodes
                .filter(child => {
                    if (!child.parent_id) return false;
                    const parentUnit = unitByNodeId.get(child.parent_id);
                    return parentUnit === unit && child.gen === unit.gen + 1;
                })
                .sort((a, b) => a.x - b.x);

            if (!childNodes.length) continue;

            let startX;
            let startY;
            if (unit.members.length === 2) {
                startX = unit.centerX;
                startY = generationLineY(unit);
            } else {
                const parent = unit.members[0];
                startX = parent.x;
                startY = parent.targetY + parent.cardHeight;
            }

            const childTop = Math.min(...childNodes.map(child => child.targetY));
            const midY = startY + Math.max(48, (childTop - startY) * 0.52);

            childNodes.forEach(child => {
                const childX = child.x;
                const childY = child.targetY;

                if (Math.abs(childX - startX) < 0.5) {
                    svgHTML += svgPath(`M ${startX} ${startY} L ${childX} ${childY}`);
                    return;
                }

                svgHTML += svgPath(roundedOrthogonalPath([
                    [startX, startY],
                    [startX, midY],
                    [childX, midY],
                    [childX, childY]
                ]));
            });
        }

        svgLayer.innerHTML = svgHTML;
    }

    // Install the shared desktop rule before the mobile early-return. Mobile replaces only
    // the spacing constants below; both devices use the same generation-center semantics.
    try {
        installGenerationCenteredVerticalLayout(CANVAS_PAD_TOP, GENERATION_GAP, CARD_FALLBACK_HEIGHT);
        drawSVGLines = generationCenteredDrawSVGLines;
    } catch (error) {
        console.warn('Unable to install generation-centered layout:', error);
    }

    // Load after the shared generation-center hooks are installed. Dynamic classic scripts
    // with async=false execute in insertion order after this script completes, so the
    // relationship layer can safely extend (rather than race) the ordinary/mobile layout.
    if (!document.querySelector('script[data-family-multi-partner]')) {
        const multiPartner = document.createElement('script');
        const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';
        multiPartner.src = `/multi-partner-refinement.js?v=${encodeURIComponent(build)}`;
        multiPartner.dataset.familyMultiPartner = 'true';
        multiPartner.async = false;
        document.body.appendChild(multiPartner);
    }

    if (!mobileQuery.matches) {
        if (globalNodes?.length) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                try { layoutAndRender(); }
                catch (error) { console.warn('Unable to reflow centered generations:', error); }
            }));
        }
        return;
    }

    try {
        unitSeparation = function mobileUnitSeparation(left, right) {
            return left.width / 2 + 48 + right.width / 2;
        };

        simplePack = function mobileSimplePack(units) {
            if (!units.length) return;
            const gap = 48;
            let cursor = 0;
            for (const unit of units) {
                unit.centerX = cursor + unit.width / 2;
                cursor += unit.width + gap;
            }
            const total = cursor - gap;
            units.forEach(unit => unit.centerX -= total / 2);
        };

        installGenerationCenteredVerticalLayout(150, 112, 92);
    } catch (error) {
        console.warn('Unable to install compact mobile layout:', error);
    }

    function rootId() {
        const fromUrl = new URL(window.location.href).searchParams.get('person');
        if (fromUrl) return fromUrl;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    let redispatching = false;
    cardsLayer.addEventListener('click', event => {
        if (redispatching) return;
        if (event.target.closest('[data-action], [data-graph-expand], [data-graph-collapse], .graph-frontier')) return;

        const editable = event.target.closest('[contenteditable="true"]');
        if (!editable) return;

        const card = editable.closest('.absolute-card[data-node-id]');
        if (!card || card.dataset.nodeId === rootId()) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            redispatching = true;
            card.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        } finally {
            redispatching = false;
        }
    }, true);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try {
                layoutAndRender();
                const root = globalNodeMap.get(rootId());
                if (root?.x != null && root?.targetY != null) {
                    viewport.scrollLeft = Math.max(0, root.x - viewport.clientWidth / 2);
                    const rootCenterY = root.targetY + root.cardHeight / 2;
                    const headerClearance = Math.min(150, viewport.clientHeight * 0.22);
                    viewport.scrollTop = Math.max(0, rootCenterY - viewport.clientHeight / 2 + headerClearance / 2);
                }
            } catch (error) {
                console.warn('Unable to apply mobile family layout:', error);
            }
        });
    });
})();
