// Keep family cards visually clean: controls and placeholder/default text are
// hidden until the user interacts with a card. Real family data remains visible.
(() => {
    const DEFAULT_TEXT = {
        name: 'שם',
        dates: 'תאריכים',
        description: 'תיאור'
    };

    const style = document.createElement('style');
    style.textContent = `
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

    // renderCards() replaces the card DOM after structural edits and polling.
    // Re-mark new cards without coupling this behavior to the renderer itself.
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                markDefaultText(cardsLayer);
                break;
            }
        }
    });
    observer.observe(cardsLayer, { childList: true, subtree: true });
})();
