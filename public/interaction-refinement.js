// Interaction refinements for the person-centric family graph.
(() => {
    const viewportEl = document.getElementById('scroll-viewport');
    const cardsLayerEl = document.getElementById('cards-layer');
    if (!viewportEl || !cardsLayerEl) return;

    // The old page supported mouse-drag panning. In the person-centric view, clicking
    // people is more important than drag-to-pan, so disable that handler while keeping
    // ordinary wheel/trackpad/scrollbar navigation intact.
    viewportEl.style.cursor = 'default';
    viewportEl.addEventListener('mousedown', event => {
        try { isDragging = false; } catch (_) {}
        if (!event.target.closest('.absolute-card')) {
            event.stopImmediatePropagation();
        }
    }, true);

    const style = document.createElement('style');
    style.textContent = `
        #scroll-viewport,
        #scroll-viewport:active {
            cursor: default !important;
        }

        .absolute-card {
            padding-bottom: 30px !important;
        }

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

    let graphCache = null;
    let graphFetchPromise = null;
    let initialRelayoutDone = false;

    function currentRootId() {
        return new URL(window.location.href).searchParams.get('person') ||
            (() => {
                try { return localStorage.getItem('family-tree.anchor-person'); }
                catch (_) { return null; }
            })();
    }

    async function loadGraphDocument(force = false) {
        if (graphCache && !force) return graphCache;
        if (graphFetchPromise && !force) return graphFetchPromise;

        graphFetchPromise = fetch('/api/graph', { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`Graph request failed: ${response.status}`);
                return response.json();
            })
            .then(documentValue => {
                graphCache = documentValue;
                return graphCache;
            })
            .catch(error => {
                console.warn('Unable to decorate spouse ancestry:', error);
                return null;
            })
            .finally(() => { graphFetchPromise = null; });

        return graphFetchPromise;
    }

    function relationshipIndexes(graph) {
        const parentsByChild = new Map();
        const spousesByPerson = new Map();

        const add = (map, key, value) => {
            if (!map.has(key)) map.set(key, new Set());
            map.get(key).add(value);
        };

        for (const relation of graph?.relationships || []) {
            if (relation.type === 'parent') {
                add(parentsByChild, relation.person2Id, relation.person1Id);
            } else if (relation.type === 'spouse') {
                add(spousesByPerson, relation.person1Id, relation.person2Id);
                add(spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }

        return { parentsByChild, spousesByPerson };
    }

    function spouseAncestorDepths(graph, rootId) {
        const result = new Map();
        if (!rootId || !graph) return result;

        const { parentsByChild, spousesByPerson } = relationshipIndexes(graph);
        const spouses = [...(spousesByPerson.get(rootId) || [])];
        const queue = [];

        for (const spouseId of spouses) {
            for (const parentId of parentsByChild.get(spouseId) || []) {
                queue.push({ id: parentId, depth: 1 });
            }
        }

        const walked = new Set();
        while (queue.length) {
            const { id, depth } = queue.shift();
            const key = `${id}:${depth}`;
            if (walked.has(key)) continue;
            walked.add(key);

            const previous = result.get(id);
            if (previous === undefined || depth < previous) result.set(id, depth);

            // Keep the ancestral couple visually together. A spouse of an ancestor gets
            // the same contextual depth even when only one parent edge exists in legacy data.
            for (const spouseId of spousesByPerson.get(id) || []) {
                const spousePrevious = result.get(spouseId);
                if (spousePrevious === undefined || depth < spousePrevious) {
                    result.set(spouseId, depth);
                }
            }

            for (const parentId of parentsByChild.get(id) || []) {
                queue.push({ id: parentId, depth: depth + 1 });
            }
        }

        return result;
    }

    function setTextIfChanged(element, value) {
        if (element.textContent !== value) element.textContent = value;
    }

    function ensureSelectZone(card) {
        let zone = card.querySelector('.graph-select-zone');
        if (!zone) {
            zone = document.createElement('button');
            zone.type = 'button';
            zone.className = 'graph-select-zone';
            zone.setAttribute('aria-label', 'Center family view on this person');
            card.appendChild(zone);
        }

        const isRoot = card.classList.contains('graph-root');
        setTextIfChanged(zone, isRoot ? '● מרכז נוכחי' : '◎ מרכז כאן');
        const nextTitle = isRoot ? 'Current center person' : 'Center family view on this person';
        if (zone.title !== nextTitle) zone.title = nextTitle;
    }

    async function decorate() {
        const rootId = currentRootId();
        const graph = await loadGraphDocument(false);
        const spouseDepths = spouseAncestorDepths(graph, rootId);

        cardsLayerEl.querySelectorAll('.absolute-card[data-node-id]').forEach(card => {
            ensureSelectZone(card);

            const id = card.dataset.nodeId;
            const depth = spouseDepths.get(id);
            card.classList.toggle('graph-spouse-parent', depth === 1);
            card.classList.toggle('graph-spouse-ancestor-deep', Number.isFinite(depth) && depth > 1);

            const zone = card.querySelector('.graph-select-zone');
            if (zone) {
                const isRoot = id === rootId || card.classList.contains('graph-root');
                setTextIfChanged(zone, isRoot ? '● מרכז נוכחי' : '◎ מרכז כאן');
            }
        });

        // The first time this script arrives, the original layout may already have
        // measured the cards. Re-measure once so connector endpoints include the footer.
        if (!initialRelayoutDone && cardsLayerEl.querySelector('.graph-select-zone')) {
            initialRelayoutDone = true;
            requestAnimationFrame(() => {
                try { layoutAndRender(); } catch (error) {
                    console.warn('Unable to re-measure selection zones:', error);
                }
            });
        }
    }

    let decorateQueued = false;
    function queueDecorate({ refreshGraph = false } = {}) {
        if (refreshGraph) graphCache = null;
        if (decorateQueued) return;
        decorateQueued = true;
        queueMicrotask(() => {
            decorateQueued = false;
            decorate();
        });
    }

    // Watch only direct card replacement in cards-layer. Watching the whole subtree
    // caused our own select-zone text/button mutations to trigger decorate() forever.
    const observer = new MutationObserver(() => queueDecorate());
    observer.observe(cardsLayerEl, { childList: true });

    // Root changes update the ?person= URL. Wrap History after the persistence layer so
    // selection styling and spouse-context styling follow search and card clicks.
    const priorReplaceState = history.replaceState.bind(history);
    history.replaceState = function refinedReplaceState(...args) {
        const result = priorReplaceState(...args);
        queueDecorate();
        return result;
    };

    const priorPushState = history.pushState.bind(history);
    history.pushState = function refinedPushState(...args) {
        const result = priorPushState(...args);
        queueDecorate();
        return result;
    };

    window.addEventListener('popstate', () => queueDecorate());

    // Structural edits can alter ancestry. Refresh the graph cache shortly after actions.
    cardsLayerEl.addEventListener('click', event => {
        if (event.target.closest('[data-action]')) {
            setTimeout(() => queueDecorate({ refreshGraph: true }), 250);
        }
    });

    queueDecorate({ refreshGraph: true });
})();
