// Refine graph emphasis relative to the selected/root person.
//
// graph-view.js decides which people are visible. This layer only adjusts the visual role:
//   - selected person's siblings are peers and remain fully emphasized;
//   - spouses directly attached to the selected person remain primary;
//   - a selected person's spouse's other spouse/union and that union's descendant subtree
//     are contextual (gray), without pulling unrelated descendants from other unions.
(() => {
    if (window.__familyRootContextRefinementInstalled) return;
    window.__familyRootContextRefinementInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const Cache = window.FamilyGraphCache;
    if (!cardsLayer || !Cache) return;

    let queued = false;
    let applying = false;

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function indexes(graph) {
        const parentsByChild = new Map();
        const childrenByParent = new Map();
        const spousesByPerson = new Map();

        for (const relation of graph?.relationships || []) {
            if (relation.type === 'parent') {
                addSet(parentsByChild, relation.person2Id, relation.person1Id);
                addSet(childrenByParent, relation.person1Id, relation.person2Id);
            } else if (relation.type === 'spouse') {
                addSet(spousesByPerson, relation.person1Id, relation.person2Id);
                addSet(spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }
        return { parentsByChild, childrenByParent, spousesByPerson };
    }

    function currentRootId() {
        const root = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        if (root?.dataset.nodeId) return root.dataset.nodeId;
        const fromUrl = new URL(window.location.href).searchParams.get('person');
        if (fromUrl) return fromUrl;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function descendants(seedId, childrenByParent) {
        const result = new Set();
        const queue = [...(childrenByParent.get(seedId) || [])];
        while (queue.length) {
            const id = queue.shift();
            if (result.has(id)) continue;
            result.add(id);
            for (const childId of childrenByParent.get(id) || []) queue.push(childId);
        }
        return result;
    }

    function siblings(personId, parentsByChild, childrenByParent) {
        const result = new Set();
        for (const parentId of parentsByChild.get(personId) || []) {
            for (const childId of childrenByParent.get(parentId) || []) {
                if (childId !== personId) result.add(childId);
            }
        }
        return result;
    }

    function sharedChildren(a, b, childrenByParent) {
        const aChildren = childrenByParent.get(a) || new Set();
        const bChildren = childrenByParent.get(b) || new Set();
        return [...aChildren].filter(id => bChildren.has(id));
    }

    function policy(graph, rootId) {
        const { parentsByChild, childrenByParent, spousesByPerson } = indexes(graph);
        const rootSpouses = new Set(spousesByPerson.get(rootId) || []);
        const rootDescendants = descendants(rootId, childrenByParent);
        const rootSiblings = siblings(rootId, parentsByChild, childrenByParent);

        // These people are always in the selected person's primary cone and must never be
        // dimmed just because they also touch another union.
        const protectedIds = new Set([
            rootId,
            ...rootSpouses,
            ...rootDescendants,
            ...rootSiblings
        ]);

        const context = new Set();

        for (const spouseId of rootSpouses) {
            for (const otherSpouseId of spousesByPerson.get(spouseId) || []) {
                if (otherSpouseId === rootId || rootSpouses.has(otherSpouseId)) continue;
                context.add(otherSpouseId);

                // Follow only children of this exact union, then all of their descendants.
                // This avoids graying unrelated children the other spouse may have elsewhere.
                for (const childId of sharedChildren(spouseId, otherSpouseId, childrenByParent)) {
                    context.add(childId);
                    for (const descendantId of descendants(childId, childrenByParent)) {
                        context.add(descendantId);
                    }
                }
            }
        }

        // Partners of contextual descendants visually belong to that subtree as well.
        // Expand to closure, while keeping the selected person's protected cone primary.
        let changed = true;
        while (changed) {
            changed = false;
            for (const id of [...context]) {
                for (const spouseId of spousesByPerson.get(id) || []) {
                    if (protectedIds.has(spouseId) || context.has(spouseId)) continue;
                    context.add(spouseId);
                    changed = true;
                }
            }
        }

        for (const id of protectedIds) context.delete(id);
        return { context, rootSiblings };
    }

    function apply() {
        if (applying) return;
        applying = true;
        try {
            const entry = Cache.load();
            const rootId = currentRootId();
            if (!entry?.graph || !rootId) return;

            const { context, rootSiblings } = policy(entry.graph, rootId);

            for (const card of cardsLayer.querySelectorAll('.absolute-card[data-node-id]')) {
                const id = card.dataset.nodeId;

                // If this layer had forced contextual styling for a previous root, undo only
                // our own override. A fresh graph-view render may still classify the card as
                // contextual for some other reason.
                if (card.dataset.familyRootContextForced === 'true' && !context.has(id)) {
                    card.classList.remove('graph-context');
                    delete card.dataset.familyRootContextForced;
                }

                if (rootSiblings.has(id)) {
                    card.classList.remove('graph-context');
                    card.dataset.familyRootContextRole = 'sibling';
                    continue;
                }

                if (context.has(id)) {
                    card.classList.add('graph-context');
                    card.dataset.familyRootContextForced = 'true';
                    card.dataset.familyRootContextRole = 'other-union';
                } else {
                    delete card.dataset.familyRootContextRole;
                }
            }

            window.__familyRootContextDiagnostics = {
                rootId,
                siblings: [...rootSiblings],
                contextual: [...context],
                appliedAt: new Date().toISOString()
            };
        } finally {
            applying = false;
        }
    }

    function queueApply() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            apply();
        });
    }

    new MutationObserver(mutations => {
        if (applying) return;
        if (mutations.some(mutation => mutation.type === 'childList' || mutation.type === 'attributes')) {
            queueApply();
        }
    }).observe(cardsLayer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    window.addEventListener('family-graph-synced', queueApply);
    window.addEventListener('family-person-pane-saved', queueApply);
    window.addEventListener('popstate', queueApply);

    window.FamilyRootContextRefinement = Object.freeze({
        refresh: queueApply,
        diagnostics: () => window.__familyRootContextDiagnostics || null
    });

    requestAnimationFrame(() => requestAnimationFrame(queueApply));
})();