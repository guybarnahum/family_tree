// Mobile/touch presentation and interaction for the person-centric family graph.
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

            /* Non-root cards use their whole body as the selection target. */
            .absolute-card:not(.graph-root) .graph-select-zone {
                display: none !important;
            }

            /* The selected person becomes a complete desktop-like card. Its transform is
               lifted by half of its extra height so selection expands around the prior
               card center instead of growing only downward. */
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
                transform: translate(-50%, calc(-1 * var(--mobile-root-lift, 0px))) !important;
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

            /* Touch actions belong to the selected/full card only. */
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

            /* Match the desktop selected-card footer rather than using a mobile-only
               transparent approximation. */
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
                top: 58% !important;
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

    // Load card presentation polish on every device. This script contains shared desktop
    // hover behavior plus the mobile root-centering correction and mobile node borders.
    if (!document.querySelector('script[data-family-presentation]')) {
        const presentation = document.createElement('script');
        const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';
        presentation.src = `/presentation-refinement.js?v=${encodeURIComponent(build)}`;
        presentation.dataset.familyPresentation = 'true';
        document.body.appendChild(presentation);
    }

    if (!mobileQuery.matches) return;

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

        assignVerticalPositions = function mobileVerticalPositions(byGen) {
            const gens = [...byGen.keys()].sort((a, b) => a - b);
            let y = 150;
            const generationGap = 112;

            for (const gen of gens) {
                const units = byGen.get(gen);
                const bandHeight = Math.max(...units.map(unit => unit.height), 92);
                units.forEach(unit => unit.members.forEach(member => member.targetY = y));
                y += bandHeight + generationGap;
            }
        };
    } catch (error) {
        console.warn('Unable to install compact mobile layout:', error);
    }

    function rootId() {
        const fromUrl = new URL(window.location.href).searchParams.get('person');
        if (fromUrl) return fromUrl;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function updateRootLift() {
        const root = cardsLayer.querySelector('.absolute-card.graph-root');
        if (!root) return;

        const contextHeights = [...cardsLayer.querySelectorAll('.absolute-card:not(.graph-root)')]
            .map(card => card.offsetHeight)
            .filter(height => height > 0)
            .sort((a, b) => a - b);
        const normalHeight = contextHeights.length
            ? contextHeights[Math.floor(contextHeights.length / 2)]
            : 100;
        const extraHeight = Math.max(0, root.offsetHeight - normalHeight);
        const lift = Math.min(56, extraHeight / 2);
        root.style.setProperty('--mobile-root-lift', `${lift}px`);
    }

    function cardBounds(node) {
        const card = document.getElementById(`card-${node.id}`);
        if (!card) {
            return {
                left: node.x - node.cardWidth / 2,
                right: node.x + node.cardWidth / 2,
                top: node.targetY,
                bottom: node.targetY + node.cardHeight,
                width: node.cardWidth,
                height: node.cardHeight,
                centerX: node.x,
                centerY: node.targetY + node.cardHeight / 2
            };
        }

        const canvasRect = canvas.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        const left = rect.left - canvasRect.left;
        const top = rect.top - canvasRect.top;
        return {
            left,
            right: left + rect.width,
            top,
            bottom: top + rect.height,
            width: rect.width,
            height: rect.height,
            centerX: left + rect.width / 2,
            centerY: top + rect.height / 2
        };
    }

    function coupleLineY(left, right) {
        const leftBox = cardBounds(left);
        const rightBox = cardBounds(right);
        const overlapTop = Math.max(leftBox.top, rightBox.top);
        const overlapBottom = Math.min(leftBox.bottom, rightBox.bottom);
        const preferred = overlapTop + Math.min(32, Math.min(leftBox.height, rightBox.height) / 2);
        return Math.max(overlapTop + 8, Math.min(preferred, overlapBottom - 8));
    }

    // Use the visible card rectangles for connector endpoints on touch. This matters because
    // the selected card is deliberately lifted around its center; SVG stems now stop exactly
    // at the visible border and remain hidden beneath the opaque card body.
    const desktopDrawSVGLines = drawSVGLines;
    drawSVGLines = function mobileAwareDrawSVGLines() {
        if (!mobileQuery.matches) return desktopDrawSVGLines();

        updateRootLift();
        let svgHTML = '';

        for (const unit of globalUnits) {
            if (unit.members.length !== 2) continue;
            const [left, right] = unit.members;
            const leftBox = cardBounds(left);
            const rightBox = cardBounds(right);
            const y = coupleLineY(left, right);
            svgHTML += svgPath(`M ${leftBox.right} ${y} L ${rightBox.left} ${y}`, 2.5);
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

            let startX, startY;
            if (unit.members.length === 2) {
                const [left, right] = unit.members;
                startX = unit.centerX;
                startY = coupleLineY(left, right);
            } else {
                const parentBox = cardBounds(unit.members[0]);
                startX = parentBox.centerX;
                startY = parentBox.bottom;
            }

            const childBoxes = new Map(childNodes.map(child => [child.id, cardBounds(child)]));
            const childTop = Math.min(...childNodes.map(child => childBoxes.get(child.id).top));
            const midY = startY + Math.max(48, (childTop - startY) * 0.52);

            childNodes.forEach(child => {
                const childBox = childBoxes.get(child.id);
                const childX = childBox.centerX;
                const childY = childBox.top;

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
    };

    // First tap on editable text in a non-root card selects it. Once selected, the same
    // text behaves as a normal editor, matching the desktop selected-card model.
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
                updateRootLift();
                layoutAndRender();
                requestAnimationFrame(() => drawSVGLines());
                const root = globalNodeMap.get(rootId());
                if (root?.x != null && root?.targetY != null) {
                    viewport.scrollLeft = Math.max(0, root.x - viewport.clientWidth / 2);
                    const headerClearance = Math.min(150, viewport.clientHeight * 0.22);
                    viewport.scrollTop = Math.max(0, root.targetY - headerClearance);
                }
            } catch (error) {
                console.warn('Unable to apply mobile family layout:', error);
            }
        });
    });
})();
