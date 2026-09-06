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

            /* Photo viewer stays comfortably inside the visible mobile viewport instead of
               growing to nearly full-screen height. Its header remains reachable while the
               photo metadata/face controls scroll beneath it. */
            #person-media-modal {
                box-sizing: border-box !important;
                align-items: center !important;
                justify-content: center !important;
                padding:
                    max(10px, env(safe-area-inset-top))
                    max(10px, env(safe-area-inset-right))
                    max(10px, env(safe-area-inset-bottom))
                    max(10px, env(safe-area-inset-left)) !important;
            }

            #person-media-modal .person-media-dialog {
                width: min(430px, calc(100dvw - 20px)) !important;
                max-width: calc(100dvw - 20px) !important;
                max-height: min(72dvh, 620px) !important;
                padding: 10px !important;
                border-radius: 16px !important;
                overscroll-behavior: contain !important;
            }

            #person-media-modal .person-media-dialog-top {
                position: sticky !important;
                top: -10px !important;
                z-index: 10040 !important;
                margin: 0 0 7px !important;
                padding: 7px 2px 8px !important;
                background: rgba(255,255,255,.98) !important;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            }

            #person-media-modal .person-media-close {
                width: 36px !important;
                height: 36px !important;
                flex: 0 0 36px !important;
                font-size: 21px !important;
                touch-action: manipulation;
            }

            #person-media-modal .face-stage {
                min-height: 0 !important;
            }

            #person-media-modal .face-stage .person-media-full,
            #person-media-modal .person-media-full {
                max-height: min(34dvh, 300px) !important;
            }

            #person-media-modal .person-media-meta {
                padding-top: 10px !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
