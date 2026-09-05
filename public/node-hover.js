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

    function appendScript(src, dataKey, build) {
        if (document.querySelector(`script[${dataKey}]`)) return;
        const script = document.createElement('script');
        script.src = `${src}?v=${encodeURIComponent(build)}`;
        script.setAttribute(dataKey, 'true');
        script.async = false;
        document.body.appendChild(script);
    }

    function loadRouterWhenMemberOrderReady(build, attempt = 0) {
        if (document.querySelector('script[data-family-planar-router]')) return;
        const memberOrderReady = typeof layoutAndRender === 'function' &&
            (layoutAndRender.name === 'lineageAwareLayoutAndRender' ||
             layoutAndRender.name === 'bridgeCompactedLayoutAndRender');
        if (!memberOrderReady && attempt < 150) {
            setTimeout(() => loadRouterWhenMemberOrderReady(build, attempt + 1), 20);
            return;
        }
        if (!memberOrderReady) {
            console.warn('Lineage-aware member ordering did not initialize before planar routing');
        }
        appendScript('/planar-router.js', 'data-family-planar-router', build);
    }

    function loadMemberOrderWhenPlanarReady(build, attempt = 0) {
        if (document.querySelector('script[data-family-member-order]')) {
            appendScript('/bridge-compaction.js', 'data-family-bridge-compaction', build);
            loadRouterWhenMemberOrderReady(build);
            return;
        }
        const planarReady = typeof layoutAndRender === 'function' &&
            layoutAndRender.name === 'crossingSafeLayoutAndRender';
        if (!planarReady && attempt < 150) {
            setTimeout(() => loadMemberOrderWhenPlanarReady(build, attempt + 1), 20);
            return;
        }
        if (!planarReady) {
            console.warn('Crossing-safe planar layout did not initialize before member ordering');
            loadRouterWhenMemberOrderReady(build, 150);
            return;
        }
        appendScript('/member-order-refinement.js', 'data-family-member-order', build);
        // Bridge compaction waits internally for lineageAwareLayoutAndRender, so it is safe
        // to inject immediately after the member-order script without another loader race.
        appendScript('/bridge-compaction.js', 'data-family-bridge-compaction', build);
        loadRouterWhenMemberOrderReady(build);
    }

    // Late refinements depend on controls/layout layers injected after this script. Load
    // them once the page is complete. Row planarity is established first, then people inside
    // spouse units are lineage-oriented; dangling bridge branches are compacted toward their
    // attachment; final orthogonal routing draws the resulting geometry.
    function loadLateRefinements() {
        const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';

        appendScript('/print-polish.js', 'data-family-print-polish', build);
        appendScript('/print-refinement.js', 'data-family-print', build);
        appendScript('/planar-core.js', 'data-family-planar-core', build);
        appendScript('/planar-layout.js', 'data-family-planar-layout', build);
        loadMemberOrderWhenPlanarReady(build);
    }

    if (document.readyState === 'complete') loadLateRefinements();
    else window.addEventListener('load', loadLateRefinements, { once: true });
})();
