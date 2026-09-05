// Keep family cards visually clean: controls and placeholder/default text are
// hidden until the user interacts with a card. Real family data remains visible.
(() => {
    const ANCHOR_STORAGE_KEY = 'family-tree.anchor-person';
    const DEFAULT_TEXT = {
        name: 'שם',
        dates: 'תאריכים',
        description: 'תיאור'
    };

    function readStoredAnchor() {
        try { return localStorage.getItem(ANCHOR_STORAGE_KEY); }
        catch (_) { return null; }
    }

    function writeStoredAnchor(personId) {
        if (!personId) return;
        try { localStorage.setItem(ANCHOR_STORAGE_KEY, personId); }
        catch (_) {}
    }

    // node-hover is injected before graph-view.js. Restore the saved center directly into
    // the URL here so graph-view's first root choice is deterministic even if later startup
    // scripts load in a different order. An explicit ?person= always wins.
    const startupUrl = new URL(window.location.href);
    const explicitAnchor = startupUrl.searchParams.get('person');
    if (explicitAnchor) {
        writeStoredAnchor(explicitAnchor);
    } else {
        const storedAnchor = readStoredAnchor();
        if (storedAnchor) {
            startupUrl.searchParams.set('person', storedAnchor);
            history.replaceState(null, '', startupUrl);
        }
    }

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

    function persistCurrentRoot() {
        const rootCard = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        const personId = rootCard?.dataset.nodeId;
        if (!personId) return;

        writeStoredAnchor(personId);
        const url = new URL(window.location.href);
        if (url.searchParams.get('person') !== personId) {
            url.searchParams.set('person', personId);
            history.replaceState(null, '', url);
        }
    }

    markDefaultText(cardsLayer);
    persistCurrentRoot();

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
                persistCurrentRoot();
                break;
            }
        }
    });
    observer.observe(cardsLayer, { childList: true, subtree: true });

    // Root decoration can occasionally change after card insertion in a later animation
    // frame. Watch card class changes separately and mirror the authoritative .graph-root
    // back to both URL and localStorage. This also makes refresh robust on mobile.
    const rootObserver = new MutationObserver(() => persistCurrentRoot());
    rootObserver.observe(cardsLayer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
    window.addEventListener('pagehide', persistCurrentRoot);

    // Late refinements depend on controls/layout layers injected after this script. Load
    // them once the page is complete; the planar layer waits for multi-partner initialization
    // before wrapping the final layout function.
    function loadLateRefinements() {
        const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';

        if (!document.querySelector('script[data-family-print-polish]')) {
            const polish = document.createElement('script');
            polish.src = `/print-polish.js?v=${encodeURIComponent(build)}`;
            polish.dataset.familyPrintPolish = 'true';
            polish.async = false;
            document.body.appendChild(polish);
        }

        if (!document.querySelector('script[data-family-print]')) {
            const print = document.createElement('script');
            print.src = `/print-refinement.js?v=${encodeURIComponent(build)}`;
            print.dataset.familyPrint = 'true';
            print.async = false;
            document.body.appendChild(print);
        }

        if (!document.querySelector('script[data-family-planar-core]')) {
            const core = document.createElement('script');
            core.src = `/planar-core.js?v=${encodeURIComponent(build)}`;
            core.dataset.familyPlanarCore = 'true';
            core.async = false;
            document.body.appendChild(core);
        }

        if (!document.querySelector('script[data-family-planar-layout]')) {
            const planar = document.createElement('script');
            planar.src = `/planar-layout.js?v=${encodeURIComponent(build)}`;
            planar.dataset.familyPlanarLayout = 'true';
            planar.async = false;
            document.body.appendChild(planar);
        }
    }

    if (document.readyState === 'complete') loadLateRefinements();
    else window.addEventListener('load', loadLateRefinements, { once: true });
})();
