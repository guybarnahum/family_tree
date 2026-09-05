// Presentation polish shared by desktop and mobile person-centric views.
(() => {
    const viewport = document.getElementById('scroll-viewport');
    const cardsLayer = document.getElementById('cards-layer');
    if (!viewport || !cardsLayer) return;

    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');

    const style = document.createElement('style');
    style.textContent = `
        .absolute-card h2[data-field="name"] {
            transition: transform 0.18s ease;
            will-change: transform;
        }

        .absolute-card p[data-field="dates"],
        .absolute-card p[data-field="description"] {
            transition: opacity 0.16s ease, transform 0.18s ease;
        }

        /* Unselected cards read as clean name tiles. Their details stay in layout so the
           measured card rectangle never changes when hover reveals them. */
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
            /* Touch has no dependable hover. Non-root = compact name tile; root = expanded. */
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

            /* Give every node a real perimeter on mobile; the root highlight sits above it. */
            .absolute-card {
                border: 1px solid rgba(88, 129, 87, 0.32) !important;
                border-top: 3px solid rgba(88, 129, 87, 0.82) !important;
                background: rgba(255, 255, 255, 0.98) !important;
            }

            .absolute-card.graph-context {
                border-color: rgba(88, 129, 87, 0.22) !important;
                border-top-color: rgba(88, 129, 87, 0.50) !important;
            }

            .absolute-card.graph-root {
                border-color: rgba(52, 78, 65, 0.78) !important;
                border-top-color: #344e41 !important;
            }
        }
    `;
    document.head.appendChild(style);

    function updateIdleNameShift(card) {
        const dates = card.querySelector('[data-field="dates"]');
        const description = card.querySelector('[data-field="description"]');
        const detailsHeight = (dates?.getBoundingClientRect().height || 0) +
            (description?.getBoundingClientRect().height || 0) + 4;
        const shift = Math.max(10, Math.min(30, detailsHeight / 2));
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

    function currentRootId() {
        const urlId = new URL(window.location.href).searchParams.get('person');
        if (urlId) return urlId;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function centerSelectedPerson() {
        if (!mobileQuery.matches) return;
        const rootId = currentRootId();
        if (!rootId) return;
        const card = document.getElementById(`card-${rootId}`);
        if (!card) return;

        const viewportRect = viewport.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        if (!cardRect.width || !cardRect.height) return;

        const cardCenterX = cardRect.left + cardRect.width / 2;
        const cardCenterY = cardRect.top + cardRect.height / 2;
        const viewportCenterX = viewportRect.left + viewportRect.width / 2;
        const viewportCenterY = viewportRect.top + viewportRect.height / 2;

        const nextLeft = Math.max(0, viewport.scrollLeft + (cardCenterX - viewportCenterX));
        const nextTop = Math.max(0, viewport.scrollTop + (cardCenterY - viewportCenterY));
        viewport.scrollTo({ left: nextLeft, top: nextTop, behavior: 'auto' });
    }

    let centerFrame = 0;
    let centerTimer = 0;
    function queueMobileCenter() {
        if (!mobileQuery.matches) return;
        if (centerFrame) cancelAnimationFrame(centerFrame);
        if (centerTimer) clearTimeout(centerTimer);

        // Layout/refinement uses multiple animation frames. Wait until those settle, then
        // correct using the actual rendered rectangle. The short delayed pass handles font
        // metrics / mobile browser viewport settling without polling or a busy loop.
        centerFrame = requestAnimationFrame(() => {
            centerFrame = requestAnimationFrame(() => {
                centerFrame = requestAnimationFrame(() => {
                    centerFrame = 0;
                    centerSelectedPerson();
                });
            });
        });
        centerTimer = window.setTimeout(centerSelectedPerson, 120);
    }

    const observer = new MutationObserver(mutations => {
        if (!mutations.some(mutation => mutation.type === 'childList')) return;
        queueCardUpdate();
        queueMobileCenter();
    });
    observer.observe(cardsLayer, { childList: true });

    // Root changes replace the card set, but history events give us an additional reliable
    // signal when selection comes from search/autocomplete.
    const priorReplaceState = history.replaceState.bind(history);
    history.replaceState = function presentationReplaceState(...args) {
        const result = priorReplaceState(...args);
        queueMobileCenter();
        return result;
    };

    const priorPushState = history.pushState.bind(history);
    history.pushState = function presentationPushState(...args) {
        const result = priorPushState(...args);
        queueMobileCenter();
        return result;
    };

    window.addEventListener('popstate', queueMobileCenter);
    window.addEventListener('resize', queueMobileCenter, { passive: true });
    window.addEventListener('orientationchange', queueMobileCenter, { passive: true });
    mobileQuery.addEventListener?.('change', () => {
        queueCardUpdate();
        queueMobileCenter();
    });

    queueCardUpdate();
    queueMobileCenter();
})();
