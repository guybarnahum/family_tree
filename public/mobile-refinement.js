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

            /* Higher specificity intentionally wins over the later presentation layer.
               A selected person on touch is a complete, roomy desktop-like card. */
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

            /* Empty fields should still look editable on the selected/full card. */
            #cards-layer .absolute-card.graph-root .default-node-text {
                opacity: 0.58 !important;
            }

            /* On touch, actions belong to the selected/full card only. */
            .absolute-card [data-action] {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            .absolute-card.graph-root [data-action] {
                opacity: 1 !important;
                pointer-events: auto !important;
                z-index: 60 !important;
                box-shadow: 0 3px 9px rgba(52, 78, 65, 0.16) !important;
                touch-action: manipulation;
            }

            .absolute-card.graph-root [data-action="delete"] {
                top: -14px !important;
                left: -14px !important;
                width: 34px !important;
                height: 34px !important;
                padding: 0 !important;
                border: 1px solid rgba(220, 38, 38, 0.16) !important;
                border-radius: 999px !important;
                background: rgba(255, 255, 255, 0.98) !important;
                font-size: 13px !important;
                line-height: 32px !important;
            }

            .absolute-card.graph-root [data-action="add-parent"] {
                top: -17px !important;
                left: 50% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
            }

            .absolute-card.graph-root [data-action="add-spouse"] {
                top: -17px !important;
                right: 8px !important;
                left: auto !important;
                transform: none !important;
            }

            .absolute-card.graph-root [data-action="add-child"] {
                bottom: -17px !important;
                left: 50% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
            }

            .absolute-card.graph-root [data-action="add-parent"],
            .absolute-card.graph-root [data-action="add-spouse"],
            .absolute-card.graph-root [data-action="add-child"] {
                min-height: 34px !important;
                padding: 7px 12px !important;
                border-radius: 999px !important;
                font-size: 11px !important;
                line-height: 18px !important;
                white-space: nowrap;
            }

            /* Selected-card marker mirrors desktop, but is informational on touch. */
            .absolute-card.graph-root .graph-select-zone {
                display: block !important;
                left: 16px !important;
                right: 16px !important;
                bottom: 7px !important;
                height: 23px !important;
                opacity: 0.78 !important;
                pointer-events: none !important;
                transform: none !important;
                background: transparent !important;
                border-top: 1px solid rgba(88, 129, 87, 0.14) !important;
                color: #526b58 !important;
                font-size: 9px !important;
                line-height: 22px !important;
            }

            /* Expansion markers sit outside the card without competing with CRUD pills. */
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

    // First tap on editable text in a non-root card selects it. Once selected, the same
    // text behaves as a normal editor, matching the desktop selected-card model.
    let redispatching = false;
    cardsLayer.addEventListener('click', event => {
        if (redispatching) return;
        if (event.target.closest('[data-action], [data-graph-expand], .graph-frontier')) return;

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
                    const headerClearance = Math.min(150, viewport.clientHeight * 0.22);
                    viewport.scrollTop = Math.max(0, root.targetY - headerClearance);
                }
            } catch (error) {
                console.warn('Unable to apply mobile family layout:', error);
            }
        });
    });
})();
