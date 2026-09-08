// Single root-relative visual-role pass for family cards.
// Projection supplies node.viewRole; this module is the only refinement layer that converts
// canonical graph context into graph-context / spouse-ancestry dimming classes.
(() => {
    if (window.__familyVisualRolesInstalled) return;
    window.__familyVisualRolesInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const Store = window.FamilyGraphStore;
    if (!cardsLayer) return;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card.graph-root {
            opacity: 1 !important;
            filter: none !important;
        }
    `;
    document.head.appendChild(style);

    let queued = false;
    let applying = false;

    function selectedPersonId() {
        const selected = window.FamilySelectionController?.getSelectedPersonId?.();
        if (selected) return selected;
        const urlId = new URL(window.location.href).searchParams.get('person');
        if (urlId) return urlId;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function currentRootId() {
        // Visual roles describe the committed projection, not pending selection intent.
        // During reroot, SelectionController updates before graph-view replaces the cards.
        // Using that pending ID against the old projection can temporarily classify the
        // entire visible graph relative to a person that is not yet the rendered root.
        const rendered = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        if (rendered?.dataset.nodeId) return rendered.dataset.nodeId;
        return selectedPersonId();
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

    function rootContextPolicy(rootId, graphIndexes) {
        const { parentsByChild, childrenByParent, spousesByPerson } = graphIndexes;
        const rootSpouses = new Set(spousesByPerson.get(rootId) || []);
        const rootDescendants = descendants(rootId, childrenByParent);
        const rootSiblings = siblings(rootId, parentsByChild, childrenByParent);
        const protectedIds = new Set([rootId, ...rootSpouses, ...rootDescendants, ...rootSiblings]);
        const context = new Set();

        for (const spouseId of rootSpouses) {
            for (const otherSpouseId of spousesByPerson.get(spouseId) || []) {
                if (otherSpouseId === rootId || rootSpouses.has(otherSpouseId)) continue;
                context.add(otherSpouseId);
                for (const childId of sharedChildren(spouseId, otherSpouseId, childrenByParent)) {
                    context.add(childId);
                    for (const descendantId of descendants(childId, childrenByParent)) context.add(descendantId);
                }
            }
        }

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

    function spouseAncestorDepths(rootId, graphIndexes) {
        const { parentsByChild, spousesByPerson } = graphIndexes;
        const result = new Map();
        if (!rootId) return result;

        const queue = [];
        for (const spouseId of spousesByPerson.get(rootId) || []) {
            for (const parentId of parentsByChild.get(spouseId) || []) queue.push({ id: parentId, depth: 1 });
        }

        const walked = new Set();
        while (queue.length) {
            const { id, depth } = queue.shift();
            const key = `${id}:${depth}`;
            if (walked.has(key)) continue;
            walked.add(key);

            const previous = result.get(id);
            if (previous === undefined || depth < previous) result.set(id, depth);

            for (const spouseId of spousesByPerson.get(id) || []) {
                const spousePrevious = result.get(spouseId);
                if (spousePrevious === undefined || depth < spousePrevious) result.set(spouseId, depth);
            }
            for (const parentId of parentsByChild.get(id) || []) queue.push({ id: parentId, depth: depth + 1 });
        }
        return result;
    }

    function apply() {
        if (applying) return;
        applying = true;
        try {
            const rootId = currentRootId();
            if (!rootId) return;

            const snapshot = Store?.snapshot?.() || null;
            const graphIndexes = snapshot?.indexes || {
                parentsByChild: new Map(),
                childrenByParent: new Map(),
                spousesByPerson: new Map()
            };
            const hasGraph = !!snapshot?.graph;
            const { context, rootSiblings } = hasGraph
                ? rootContextPolicy(rootId, graphIndexes)
                : { context: new Set(), rootSiblings: new Set() };
            const spouseDepths = hasGraph ? spouseAncestorDepths(rootId, graphIndexes) : new Map();
            const roles = {};

            for (const card of cardsLayer.querySelectorAll('.absolute-card[data-node-id]')) {
                const id = card.dataset.nodeId;
                const node = globalNodeMap?.get?.(id) || null;
                const isRoot = id === rootId || card.classList.contains('graph-root');
                const baseContext = node?.viewRole === 'context';
                const contextual = !isRoot && !rootSiblings.has(id) && (baseContext || context.has(id));
                const depth = spouseDepths.get(id);
                const spouseParent = !isRoot && depth === 1;
                const spouseAncestorDeep = !isRoot && Number.isFinite(depth) && depth > 1;

                card.classList.toggle('graph-context', contextual);
                card.classList.toggle('graph-spouse-parent', spouseParent);
                card.classList.toggle('graph-spouse-ancestor-deep', spouseAncestorDeep);

                delete card.dataset.familyRootContextForced;
                if (isRoot) {
                    delete card.dataset.familyRootContextRole;
                    card.dataset.familyVisualRole = 'root';
                } else if (rootSiblings.has(id)) {
                    card.dataset.familyRootContextRole = 'sibling';
                    card.dataset.familyVisualRole = 'sibling';
                } else if (context.has(id)) {
                    card.dataset.familyRootContextRole = 'other-union';
                    card.dataset.familyVisualRole = 'other-union-context';
                } else if (spouseAncestorDeep) {
                    delete card.dataset.familyRootContextRole;
                    card.dataset.familyVisualRole = 'spouse-ancestor-deep';
                } else if (spouseParent) {
                    delete card.dataset.familyRootContextRole;
                    card.dataset.familyVisualRole = 'spouse-parent';
                } else if (contextual) {
                    delete card.dataset.familyRootContextRole;
                    card.dataset.familyVisualRole = 'context';
                } else {
                    delete card.dataset.familyRootContextRole;
                    card.dataset.familyVisualRole = 'primary';
                }
                roles[id] = card.dataset.familyVisualRole;
            }

            const appliedAt = new Date().toISOString();
            window.__familyVisualRoleDiagnostics = {
                rootId,
                selectedPersonId: selectedPersonId(),
                siblings: [...rootSiblings],
                contextual: [...context],
                roles,
                appliedAt
            };
            window.__familyRootContextDiagnostics = {
                rootId,
                selectedPersonId: selectedPersonId(),
                siblings: [...rootSiblings],
                contextual: [...context],
                appliedAt
            };
        } finally {
            applying = false;
        }
    }

    function queueApply() {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            apply();
        });
    }

    // Selection intent changes before graph-view commits the new projection. Do not style the
    // old card set against that pending root. RenderController calls refreshNow() during the
    // authoritative commit and then emits family-graph-rendered.
    window.addEventListener('family-graph-store-changed', queueApply);
    window.addEventListener('family-person-pane-saved', queueApply);
    window.addEventListener('family-graph-rendered', apply);

    window.FamilyVisualRoles = Object.freeze({
        refresh: queueApply,
        refreshNow: apply,
        diagnostics: () => window.__familyVisualRoleDiagnostics || null
    });

    queueApply();
})();
