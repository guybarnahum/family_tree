// Responsive/touch styling only. Geometry belongs to family-core; viewport commits belong to RenderController.
(() => {
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

            #cards-layer .absolute-card.graph-root {
                min-width: min(228px, calc(100vw - 46px)) !important;
                width: min(264px, calc(100vw - 40px)) !important;
                max-width: min(286px, calc(100vw - 28px)) !important;
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

            #cards-layer .absolute-card.graph-root .default-node-text { opacity: 0.58 !important; }

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
})();
