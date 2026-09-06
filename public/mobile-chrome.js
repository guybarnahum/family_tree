// Small viewport/chrome refinements that must win over the older mobile stylesheet.
(() => {
    if (window.__familyMobileChromeInstalled) return;
    window.__familyMobileChromeInstalled = true;

    const style = document.createElement('style');
    style.textContent = `
        /* The whole card is already the select/reroot target. Never reserve a second
           select-to-center strip, including on the selected mobile card. */
        #cards-layer .absolute-card .graph-select-zone,
        #cards-layer .absolute-card.graph-root .graph-select-zone {
            display: none !important;
        }

        /* Keep the build marker available for debugging without leaving permanent chrome.
           Its invisible text box is the hover target; hover grows/fades it into view. */
        #family-tree-build {
            opacity: 0 !important;
            pointer-events: auto !important;
            transform: scale(0.72) !important;
            transform-origin: right bottom !important;
            transition: opacity 150ms ease, transform 150ms ease, background-color 150ms ease !important;
            padding: 4px 6px !important;
            border-radius: 6px !important;
            background: rgba(253, 251, 247, 0) !important;
        }

        #family-tree-build:hover {
            opacity: 0.78 !important;
            transform: scale(1) !important;
            background: rgba(253, 251, 247, 0.92) !important;
        }

        @media (hover: none), (pointer: coarse) {
            #family-tree-build {
                opacity: 0 !important;
                pointer-events: none !important;
            }
        }

        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            /* This is a viewport overlay, not part of the horizontally pannable graph.
               Keep an 8px margin on phones and cap the sheet on wider touch devices. */
            #person-pane {
                position: fixed !important;
                top: auto !important;
                bottom: 0 !important;
                left: 50% !important;
                right: auto !important;
                width: min(430px, calc(100vw - 16px)) !important;
                width: min(430px, calc(100dvw - 16px)) !important;
                max-width: none !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
                transform: translate(-50%, calc(100% - 58px)) !important;
                height: min(68dvh, 590px) !important;
                max-height: calc(100dvh - 8px) !important;
            }

            #person-pane.person-pane-open {
                transform: translate(-50%, 0) !important;
            }

            #person-pane .person-pane-body {
                overflow-x: hidden !important;
                overscroll-behavior: contain;
                touch-action: pan-y;
                padding-bottom: calc(18px + env(safe-area-inset-bottom)) !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
