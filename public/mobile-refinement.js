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

            .family-title-card > p {
                display: none;
            }

            .graph-search-wrap {
                width: 100% !important;
                max-width: none !important;
                margin-top: 7px !important;
            }

            .graph-search-input {
                height: 42px;
                padding: 8px 13px !important;
                font-size: 16px !important; /* Prevent iOS focus zoom. */
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

            .graph-search-result small {
                font-size: 11px !important;
            }

            /* Hover cannot expose title actions on touch; keep compact icon actions available. */
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
            }

            .absolute-card h2 {
                font-size: 1.08rem !important;
                line-height: 1.08 !important;
            }

            .absolute-card p {
                font-size: 10px !important;
                line-height: 1.22 !important;
            }

            /* On touch the whole non-root card is the recenter affordance. */
            .graph-select-zone {
                display: none !important;
            }

            .absolute-card.graph-root {
                outline-width: 3px !important;
                outline-offset: 2px !important;
                box-shadow: 0 10px 24px rgba(52, 78, 65, 0.23) !important;
            }

            /* Desktop hover controls become available only on the selected person. */
            .absolute-card [data-action] {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            .absolute-card.graph-root [data-action],
            .absolute-card.graph-root:focus-within [data-action] {
                opacity: 1 !important;
                pointer-events: auto !important;
            }

            .absolute-card.graph-root [data-action="delete"] {
                width: 28px !important;
                height: 28px !important;
                font-size: 12px !important;
                top: -10px !important;
                left: -10px !important;
            }

            .absolute-card.graph-root [data-action="add-parent"],
            .absolute-card.graph-root [data-action="add-spouse"],
            .absolute-card.graph-root [data-action="add-child"] {
                min-height: 28px;
                padding: 5px 9px !important;
                font-size: 10px !important;
                white-space: nowrap;
            }

            .graph-frontier {
                min-width: 34px !important;
                height: 34px !important;
                right: -20px !important;
                line-height: 32px !important;
                font-size: 11px !important;
                opacity: 0.92 !important;
                touch-action: manipulation;
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

    if (!mobileQuery.matches) return;

    // Tighter graph geometry on narrow/touch screens. Function declarations from the
    // legacy layout are writable globals; override only while this mobile page is alive.
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

    // Most of a card is editable text on desktop. On touch, the first tap anywhere on a
    // non-root card should select/recenter it. Once selected, taps on text edit normally.
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

    // The responsive CSS changes measured card sizes and the mobile geometry functions.
    // Re-layout once after CSS has applied, preserving the current anchor as center.
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
