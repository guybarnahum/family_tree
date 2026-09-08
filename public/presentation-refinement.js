// Presentation polish shared by desktop and mobile person-centric views.
// M4-B: presentation owns CSS only; RenderController owns geometry + viewport commits.
(() => {
    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');

    const style = document.createElement('style');
    style.textContent = `
        .absolute-card h2[data-field="name"] {
            text-align: center !important;
            width: 100%;
            transition: transform 0.18s ease;
            will-change: transform;
        }

        .absolute-card p[data-field="dates"],
        .absolute-card p[data-field="description"] {
            transition: opacity 0.16s ease, transform 0.18s ease;
        }

        .absolute-card:not(.graph-root):not(:hover):not(:focus-within) h2[data-field="name"] {
            transform: translateY(var(--idle-name-shift, 16px));
        }

        .absolute-card:not(.graph-root):not(:hover):not(:focus-within) p[data-field="dates"],
        .absolute-card:not(.graph-root):not(:hover):not(:focus-within) p[data-field="description"] {
            opacity: 0;
            transform: translateY(6px);
            pointer-events: none;
        }

        .absolute-card:hover h2[data-field="name"],
        .absolute-card:focus-within h2[data-field="name"],
        .absolute-card.graph-root h2[data-field="name"] {
            transform: translateY(0);
        }

        .absolute-card:hover p[data-field="dates"],
        .absolute-card:hover p[data-field="description"],
        .absolute-card:focus-within p[data-field="dates"],
        .absolute-card:focus-within p[data-field="description"],
        .absolute-card.graph-root p[data-field="dates"],
        .absolute-card.graph-root p[data-field="description"] {
            opacity: 1;
            transform: translateY(0);
        }

        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            .absolute-card {
                min-width: 150px !important;
                max-width: 192px !important;
                border: 1px solid rgba(88, 129, 87, 0.32) !important;
                border-top: 3px solid rgba(88, 129, 87, 0.82) !important;
                background: rgba(255, 255, 255, 0.98) !important;
            }

            .absolute-card.graph-root {
                min-width: min(220px, calc(100vw - 44px)) !important;
                width: min(248px, calc(100vw - 44px)) !important;
                max-width: min(272px, calc(100vw - 32px)) !important;
                padding: 12px 14px 18px !important;
                border-color: rgba(52, 78, 65, 0.78) !important;
                border-top-color: #344e41 !important;
            }

            .absolute-card h2[data-field="name"] {
                text-align: center !important;
                direction: inherit;
            }

            .absolute-card.graph-root h2[data-field="name"] {
                font-size: 1.25rem !important;
                line-height: 1.12 !important;
                margin-bottom: 5px !important;
            }

            .absolute-card.graph-root p[data-field="dates"] {
                font-size: 11px !important;
                line-height: 1.3 !important;
                margin-bottom: 5px !important;
            }

            .absolute-card.graph-root p[data-field="description"] {
                font-size: 11px !important;
                line-height: 1.38 !important;
            }

            .absolute-card:not(.graph-root) h2[data-field="name"] {
                transform: translateY(var(--idle-name-shift, 14px)) !important;
            }

            .absolute-card:not(.graph-root) p[data-field="dates"],
            .absolute-card:not(.graph-root) p[data-field="description"] {
                opacity: 0 !important;
                transform: translateY(5px) !important;
                pointer-events: none !important;
            }

            .absolute-card.graph-root h2[data-field="name"] {
                transform: translateY(0) !important;
            }

            .absolute-card.graph-root p[data-field="dates"],
            .absolute-card.graph-root p[data-field="description"] {
                opacity: 1 !important;
                transform: translateY(0) !important;
            }

            .absolute-card.graph-context {
                border-color: rgba(88, 129, 87, 0.22) !important;
                border-top-color: rgba(88, 129, 87, 0.50) !important;
            }
        }
    `;
    document.head.appendChild(style);

    function updateIdleNameShift(card) {
        const name = card.querySelector('h2[data-field="name"]');
        if (!name) return;
        const cardHeight = card.clientHeight;
        const nameCenter = name.offsetTop + name.offsetHeight / 2;
        const desiredCenter = cardHeight / 2;
        const shift = Math.max(0, Math.min(48, desiredCenter - nameCenter));
        card.style.setProperty('--idle-name-shift', `${shift}px`);
    }

    function updateCards() {
        cardsLayer.querySelectorAll('.absolute-card[data-node-id]').forEach(updateIdleNameShift);
    }

    let cardUpdateQueued = false;
    function queueCardUpdate() {
        if (cardUpdateQueued) return;
        cardUpdateQueued = true;
        requestAnimationFrame(() => {
            cardUpdateQueued = false;
            updateCards();
        });
    }

    window.addEventListener('family-graph-rendered', queueCardUpdate);
    window.addEventListener('resize', queueCardUpdate, { passive: true });
    mobileQuery.addEventListener?.('change', () => {
        queueCardUpdate();
        if (!globalNodes?.length) return;
        void window.FamilyRenderController?.requestLayout?.({
            reason: 'presentation-breakpoint',
            preserveAnchor: false,
            recenter: true
        });
    });

    queueCardUpdate();
})();