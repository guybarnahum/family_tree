// Translate committed GraphView roles plus spouse-ancestry policy into card classes.
(() => {
    if (window.__familyVisualRolesInstalled) return;
    window.__familyVisualRolesInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const Store = window.FamilyGraphStore;
    if (!cardsLayer || !Store) return;

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

    function sharedChildren(a, b, childrenByParent) {
        const aChildren = childrenByParent.get(a) || new Set();
        const bChildren = childrenByParent.get(b) || new Set();
        return [...aChildren].filter(id => bChildren.has(id));
    }

    function rootContextPolicy(rootId, { childrenByParent, spousesByPerson }) {
        const rootSpouses = new Set(spousesByPerson.get(rootId) || []);
        const protectedIds = new Set([rootId, ...rootSpouses, ...descendants(rootId, childrenByParent)]);
        const context = new Set();

        for (const spouseId of rootSpouses) {
            for (const otherSpouseId of spousesByPerson.get(spouseId) || []) {
                if (otherSpouseId === rootId || rootSpouses.has(otherSpouseId)) continue;
                context.add(otherSpouseId);
                for (const childId of sharedChildren(spouseId, otherSpouseId, childrenByParent)) {
                    context.add(childId);
                    descendants(childId, childrenByParent).forEach(id => context.add(id));
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

        protectedIds.forEach(id => context.delete(id));
        return { context, protectedIds };
    }

    function spouseAncestorDepths(rootId, { parentsByChild, spousesByPerson }) {
        const result = new Map();
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
            if (!result.has(id) || depth < result.get(id)) result.set(id, depth);
            for (const spouseId of spousesByPerson.get(id) || []) {
                if (!result.has(spouseId) || depth < result.get(spouseId)) result.set(spouseId, depth);
            }
            for (const parentId of parentsByChild.get(id) || []) queue.push({ id: parentId, depth: depth + 1 });
        }
        return result;
    }

    function apply(committedRootId) {
        const rootId = String(committedRootId ?? '').trim();
        if (!rootId) return false;

        const snapshot = Store.snapshot();
        const indexes = snapshot.indexes || {
            parentsByChild: new Map(),
            childrenByParent: new Map(),
            spousesByPerson: new Map()
        };
        const { context, protectedIds } = snapshot.graph
            ? rootContextPolicy(rootId, indexes)
            : { context: new Set(), protectedIds: new Set([rootId]) };
        const spouseDepths = snapshot.graph ? spouseAncestorDepths(rootId, indexes) : new Map();
        const siblingIds = new Set();
        const roles = {};

        for (const card of cardsLayer.querySelectorAll('.absolute-card[data-node-id]')) {
            const id = card.dataset.nodeId;
            const node = globalNodeMap?.get?.(id) || null;
            const isRoot = id === rootId;
            const isSibling = node?.viewRole === 'sibling';
            if (isSibling) siblingIds.add(id);

            const protectedFromDimming = isRoot || isSibling || protectedIds.has(id);
            const contextual = !protectedFromDimming && (node?.viewRole === 'context' || context.has(id));
            const depth = spouseDepths.get(id);
            const spouseParent = !protectedFromDimming && depth === 1;
            const spouseAncestorDeep = !protectedFromDimming && Number.isFinite(depth) && depth > 1;

            card.classList.toggle('graph-context', contextual);
            card.classList.toggle('graph-spouse-parent', spouseParent);
            card.classList.toggle('graph-spouse-ancestor-deep', spouseAncestorDeep);

            const role = isRoot ? 'root'
                : isSibling ? 'sibling'
                    : context.has(id) ? 'other-union-context'
                        : spouseAncestorDeep ? 'spouse-ancestor-deep'
                            : spouseParent ? 'spouse-parent'
                                : contextual ? 'context' : 'primary';
            card.dataset.familyVisualRole = role;
            roles[id] = role;
        }

        window.__familyVisualRoleDiagnostics = {
            rootId,
            siblings: [...siblingIds],
            contextual: [...context],
            roles
        };
        return true;
    }

    window.FamilyVisualRoles = Object.freeze({
        refreshNow: apply,
        diagnostics: () => window.__familyVisualRoleDiagnostics || null
    });
})();
