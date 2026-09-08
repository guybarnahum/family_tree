// Keep family cards visually clean: controls and true placeholder/default text are hidden until
// the user interacts with a card. Placeholder state is presentation data, not a DOM lifecycle
// signal: classify from textContent after an authoritative render commit, never from innerText
// while the canvas may be hidden/measuring.
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

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const diagnostics = {
        passes: 0,
        defaults: 0,
        realValues: 0,
        lastAt: null
    };

    function normalizedText(element) {
        return String(element?.textContent ?? '').trim();
    }

    function markElement(element) {
        const expected = DEFAULT_TEXT[element.dataset.field];
        if (!expected) return;
        const value = normalizedText(element);
        element.classList.toggle('default-node-text', value === '' || value === expected);
    }

    function markDefaultText(root = cardsLayer) {
        const scope = root?.querySelectorAll ? root : cardsLayer;
        scope.querySelectorAll('[contenteditable="true"][data-field]').forEach(markElement);

        const fields = [...cardsLayer.querySelectorAll('[contenteditable="true"][data-field]')];
        diagnostics.passes += 1;
        diagnostics.defaults = fields.filter(element => element.classList.contains('default-node-text')).length;
        diagnostics.realValues = fields.length - diagnostics.defaults;
        diagnostics.lastAt = new Date().toISOString();
        window.__familyNodeTextDiagnostics = { ...diagnostics };
    }

    cardsLayer.addEventListener('input', event => {
        const field = event.target.closest?.('[contenteditable="true"][data-field]');
        if (!field || !cardsLayer.contains(field)) return;
        markElement(field);
    });

    // Cards are created by graph-view. React to its explicit committed lifecycle instead of
    // observing our own DOM mutations. textContent is intentionally used because innerText is
    // layout-sensitive and can report an empty value while RenderController hides/measures the canvas.
    window.addEventListener('family-graph-rendered', () => markDefaultText(cardsLayer));
    window.addEventListener('family-person-pane-saved', event => {
        if (event.detail?.field === 'name') markDefaultText(cardsLayer);
    });

    markDefaultText(cardsLayer);
})();
