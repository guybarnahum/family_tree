// Interaction/presentation refinements for the person-centric family graph.
(() => {
    if (window.__familyInteractionRefinementInstalled) return;
    window.__familyInteractionRefinementInstalled = true;

    const viewportEl = document.getElementById('scroll-viewport');
    const cardsLayerEl = document.getElementById('cards-layer');
    const Selection = window.FamilySelectionController;
    if (!viewportEl || !cardsLayerEl || !Selection) return;

    viewportEl.style.cursor = 'default';
    viewportEl.addEventListener('mousedown', event => {
        try { isDragging = false; } catch (_) {}
        if (!event.target.closest('.absolute-card')) event.stopImmediatePropagation();
    }, true);

    const style = document.createElement('style');
    style.textContent = `
        #scroll-viewport,
        #scroll-viewport:active { cursor: default !important; }

        .absolute-card { padding-bottom: 30px !important; }

        .graph-select-zone {
            position: absolute;
            left: 8px;
            right: 8px;
            bottom: 5px;
            height: 21px;
            border: 0;
            border-top: 1px solid rgba(88, 129, 87, 0.16);
            background: transparent;
            color: #6f7f72;
            font: 600 9px/20px Inter, sans-serif;
            letter-spacing: 0.02em;
            text-align: center;
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
            transform: translateY(2px);
            border-radius: 0 0 6px 6px;
            transition: opacity 0.13s ease, transform 0.13s ease, background-color 0.13s ease;
        }

        .absolute-card:hover .graph-select-zone,
        .absolute-card:focus-within .graph-select-zone,
        .graph-select-zone:focus-visible {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
        }

        .graph-select-zone:hover,
        .graph-select-zone:focus-visible {
            background: rgba(163, 177, 138, 0.13);
            color: #344e41;
            outline: none;
        }

        .absolute-card.graph-root {
            outline: 3px solid rgba(88, 129, 87, 0.58) !important;
            outline-offset: 3px;
            box-shadow: 0 12px 28px rgba(52, 78, 65, 0.24) !important;
            border-top-color: #344e41 !important;
            background: #fff !important;
            opacity: 1 !important;
            filter: none !important;
        }

        .absolute-card.graph-root .graph-select-zone {
            background: rgba(163, 177, 138, 0.20);
            color: #344e41;
        }

        .absolute-card.graph-spouse-parent {
            opacity: 0.60;
            filter: saturate(0.58);
        }

        .absolute-card.graph-spouse-ancestor-deep {
            opacity: 0.34;
            filter: saturate(0.38);
        }

        .absolute-card.graph-spouse-parent:hover,
        .absolute-card.graph-spouse-parent:focus-within,
        .absolute-card.graph-spouse-ancestor-deep:hover,
        .absolute-card.graph-spouse-ancestor-deep:focus-within {
            opacity: 0.88;
            filter: saturate(0.78);
        }
    `;
    document.head.appendChild(style);

    function ensureSelectZone(card) {
        let zone = card.querySelector('.graph-select-zone');
        if (!zone) {
            zone = document.createElement('button');
            zone.type = 'button';
            zone.className = 'graph-select-zone';
            zone.setAttribute('aria-label', 'Center family view on this person');
            card.appendChild(zone);
        }

        const isRoot = card.dataset.nodeId === Selection.getSelectedPersonId?.();
        zone.textContent = isRoot ? '● מרכז נוכחי' : '◎ מרכז כאן';
        zone.title = isRoot ? 'Current center person' : 'Center family view on this person';
    }

    function decorate() {
        cardsLayerEl.querySelectorAll('.absolute-card[data-node-id]').forEach(ensureSelectZone);
    }

    window.addEventListener('family-selection-changed', decorate);
    window.addEventListener('family-graph-rendered', decorate);
    decorate();
})();
