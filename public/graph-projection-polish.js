// Root-relative projection polish and face-avatar footprint spacing.
//
// The canonical graph/view remains owned by graph-view.js. This layer only refines visual
// emphasis and horizontal clearance:
//   - the selected person's siblings are peers, not gray context;
//   - a selected person's spouse's other unions are contextual, together with those unions'
//     descendant branches;
//   - the circular portrait is centered exactly on the card edge and layout separation reserves
//     its half-diameter so neighboring family units do not crowd it.
(() => {
    if (window.__familyGraphProjectionPolishInstalled) return;
    window.__familyGraphProjectionPolishInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const Cache = window.FamilyGraphCache;
    if (!cardsLayer || !Cache) return;

    const AVATAR_DIAMETER = 40;
    const ROOT_AVATAR_DIAMETER = 44;
    const MAX_AVATAR_OVERHANG = ROOT_AVATAR_DIAMETER / 2;

    const style = document.createElement('style');
    style.textContent = `
        /* The portrait center sits exactly on the left card edge. */
        #cards-layer .absolute-card .node-face-avatar {
            left: -${AVATAR_DIAMETER / 2}px !important;
        }
        #cards-layer .absolute-card.graph-root .node-face-avatar {
            left: -${ROOT_AVATAR_DIAMETER / 2}px !important;
        }
    `;
    document.head.appendChild(style);

    let applyQueued = false;
    let applying = false;
    let spacingInstalled = false;

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function graphIndexes(graph) {
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

    function descendantsOf(seedId, childrenByParent) {
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

    function siblingsOf(personId, parentsByChild, childrenByParent) {
        const siblings = new Set();
        for (const parentId of parentsByChild.get(personId) || []) {
            for (const childId of childrenByParent.get(parentId) || []) {
                if (childId !== personId) siblings.add(childId);
            }
        }
        return siblings;
    }

    function sharedChildren(a, b, childrenByParent) {
        const result = [];
        const aChildren = childrenByParent.get(a) || new Set();
        const bChildren = childrenByParent.get(b) || new Set();
        for (const childId of aChildren) {
            if (bChildren.has(childId)) result.push(childId);
        }
        return result;
    }

    function currentRootId() {
        const card = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        if (card?.dataset.nodeId) return card.dataset.nodeId;
        const urlId = new URL(window.location.href).searchParams.get('person');
        if (urlId) return urlId;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function contextualBranchIds(graph, rootId) {
        const { parentsByChild, childrenByParent, spousesByPerson } = graphIndexes(graph);
        const rootSpouses = new Set(spousesByPerson.get(rootId) || []);
        const rootDescendants = descendantsOf(rootId, childrenByParent);
        const rootSiblings = siblingsOf(rootId, parentsByChild, childrenByParent);
        const protectedIds = new Set([rootId, ...rootSpouses, ...rootDescendants, ...rootSiblings]);
        const context = new Set();

        // A spouse of the selected person is primary. Other spouses of that spouse describe
        // different unions relative to the selected person, so those unions are contextual.
        for (const spouseId of rootSpouses) {
            for (const otherSpouseId of spousesByPerson.get(spouseId) || []) {
                if (otherSpouseId === rootId || rootSpouses.has(otherSpouseId)) continue;
                context.add(otherSpouseId);

                // Only take the subtree belonging to this exact spouse pair. Do not pull in
                // unrelated children that the other spouse may have with somebody else.
                for (const childId of sharedChildren(spouseId, otherSpouseId, childrenByParent)) {
                    context.add(childId);
                    for (const descendantId of descendantsOf(childId, childrenByParent)) {
                        context.add(descendantId);
                    }
                }
            }
        }

        // Partners of people inside a contextual descendant branch belong visually to that
        // branch too. Repeat to closure, but never dim the selected person's protected cone.
        let changed = true;
        while (changed) {
            changed = false;
            for (const personId of [...context]) {
                if (personId === rootId) continue;
                for (const spouseId of spousesByPerson.get(personId) || []) {
                    if (protectedIds.has(spouseId) || context.has(spouseId)) continue;
                    context.add(spouseId);
                    changed = true;
                }
            }
        }

        for (const id of protectedIds) context.delete(id);
        return { context, rootSiblings };
    }

    function applyContextPolicy() {
        if (applying) return;
        applying = true;
        try {
            const entry = Cache.load();
            const rootId = currentRootId();
            if (!entry?.graph || !rootId) return;

            const { context, rootSiblings } = contextualBranchIds(entry.graph, rootId);
            for (const card of cardsLayer.querySelectorAll('.absolute-card[data-node-id]')) {
                const id = card.dataset.nodeId;

                // Remove only a class that this layer forced during a prior application.
                if (card.dataset.familyContextForced === 'true' && !context.has(id)) {
                    card.classList.remove('graph-context');
                    delete card.dataset.familyContextForced;
                }

                if (rootSiblings.has(id)) {
                    card.classList.remove('graph-context');
                    card.dataset.familyContextRole = 'root-sibling';
                    continue;
                }

                if (context.has(id)) {
                    card.classList.add('graph-context');
                    card.dataset.familyContextForced = 'true';
                    card.dataset.familyContextRole = 'other-union';
                } else {
                    delete card.dataset.familyContextRole;
                }
            }
        } finally {
            applying = false;
        }
    }

    function queueApply() {
        if (applyQueued) return;
        applyQueued = true;
        requestAnimationFrame(() => {
            applyQueued = false;
            applyContextPolicy();
        });
    }

    function installSpacing() {
        if (spacingInstalled) return true;
        try {
            if (typeof unitSeparation !== 'function') return false;
            const baseUnitSeparation = unitSeparation;
            if (baseUnitSeparation.__familyAvatarFootprint) {
                spacingInstalled = true;
                return true;
            }

            const wrapped = function avatarAwareUnitSeparation(left, right) {
                // Portraits protrude only from the left side of cards. In left-to-right layout
                // geometry that means the right-hand unit needs one extra half-diameter before it.
                return baseUnitSeparation(left, right) + MAX_AVATAR_OVERHANG;
            };
            wrapped.__familyAvatarFootprint = true;
            wrapped.__familyAvatarFootprintBase = baseUnitSeparation;
            unitSeparation = wrapped;
            window.unitSeparation = wrapped;
            spacingInstalled = true;

            window.__familyNodeFootprintDiagnostics = {
                avatarDiameter: AVATAR_DIAMETER,
                rootAvatarDiameter: ROOT_AVATAR_DIAMETER,
                reservedLeftOverhang: MAX_AVATAR_OVERHANG,
                installedAt: new Date().toISOString()
            };

            if (typeof layoutAndRender === 'function' && globalNodes?.length) {
                requestAnimationFrame(() => {
                    try { layoutAndRender(); }
                    catch (error) { console.warn('Unable to apply avatar footprint spacing:', error); }
                });
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function waitForFinalSpacingLayer(attempt = 0) {
        // Mobile/multi-partner refinements may replace unitSeparation during startup. Install
        // after the final router stack is present so the footprint rule remains authoritative.
        if (window.__familyPlanarRouterInstalled && installSpacing()) return;
        if (attempt < 240) setTimeout(() => waitForFinalSpacingLayer(attempt + 1), 50);
        else if (!installSpacing()) console.warn('Unable to install avatar footprint spacing');
    }

    new MutationObserver(mutations => {
        if (applying) return;
        if (mutations.some(mutation => mutation.type === 'childList' || mutation.type === 'attributes')) {
            queueApply();
        }
    }).observe(cardsLayer, {
        childList: true,
        subtree: false,
        attributes: true,
        attributeFilter: ['class']
    });

    window.addEventListener('family-graph-synced', queueApply);
    window.addEventListener('family-person-pane-saved', queueApply);
    window.addEventListener('popstate', queueApply);

    waitForFinalSpacingLayer();
    requestAnimationFrame(() => requestAnimationFrame(queueApply));
})();
