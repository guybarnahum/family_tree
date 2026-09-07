// Keep family cards visually clean: controls and placeholder/default text are hidden until
// the user interacts with a card. Runtime bootstrapping and root persistence are owned by
// runtime-bootstrap.js and selection-controller.js respectively.
(() => {
    if (window.__familyNodeHoverInstalled) return;
    window.__familyNodeHoverInstalled = true;

    const DEFAULT_TEXT = {
        name: 'שם',
        dates: 'תאריכים',
        description: 'תיאור'
    };

    const style = document.createElement('style');
    style.textContent = `
        .family-title-card h1 {
            font-weight: 700 !important;
        }

        .absolute-card [data-action] {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.14s ease;
        }

        .absolute-card:hover [data-action],
        .absolute-card:focus-within [data-action] {
            opacity: 1;
            pointer-events: auto;
        }

        .absolute-card .default-node-text {
            opacity: 0;
            transition: opacity 0.14s ease;
        }

        .absolute-card:hover .default-node-text,
        .absolute-card:focus-within .default-node-text {
            opacity: 1;
        }
    `;
    document.head.appendChild(style);

    function markDefaultText(root = document) {
        const scope = root?.querySelectorAll ? root : document;
        scope.querySelectorAll('[contenteditable="true"][data-field]').forEach(element => {
            const expected = DEFAULT_TEXT[element.dataset.field];
            if (!expected) return;
            const value = element.innerText.trim();
            element.classList.toggle('default-node-text', value === '' || value === expected);
        });
    }

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    markDefaultText(cardsLayer);

    cardsLayer.addEventListener('input', event => {
        const card = event.target.closest?.('.absolute-card');
        markDefaultText(card || cardsLayer);
    });

    new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.type === 'childList')) markDefaultText(cardsLayer);
    }).observe(cardsLayer, { childList: true, subtree: true });
})();