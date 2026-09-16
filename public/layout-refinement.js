// Final horizontal refinement: pack whole descendant branches beneath their actual parent/union anchors.
// Earlier stages own topology, member order and planarity; this stage only translates settled subtrees.
(() => {
    const Controller = window.FamilyRenderController;
    const Store = window.FamilyGraphStore;
    if (!Controller || !Store) return;

    const DESKTOP_SUBTREE_GAP = 68;

    function subtreeGap() {
        return typeof geometryMobileQuery !== 'undefined' && geometryMobileQuery.matches
            ? MOBILE_UNIT_GAP
            : DESKTOP_SUBTREE_GAP;
    }

    function directParentUnits(unit) {
        return [...unit.parents].filter(parent => parent.gen === unit.gen - 1);
    }

    function directChildUnits(unit) {
        return [...unit.children].filter(child => child.gen === unit.gen + 1);
    }

    // A child unit may technically be connected to more than one parent unit through bridge
    // marriages. Keep the planar stage's chosen parent_id authoritative so every unit belongs to
    // exactly one movable subtree for this refinement.
    function primaryParentUnit(unit) {
        for (const member of unit.members || []) {
            const parentId = member.parent_id;
            const parent = parentId ? unitByNodeId.get(parentId) : null;
            if (parent && parent !== unit && parent.gen === unit.gen - 1) return parent;
        }
        const parents = directParentUnits(unit);
        if (parents.length === 1) return parents[0];
        if (!parents.length) return null;
        return [...parents].sort((a, b) =>
            Math.abs(a.centerX - unit.centerX) - Math.abs(b.centerX - unit.centerX) ||
            a.id.localeCompare(b.id)
        )[0];
    }

    function ownedChildren(unit) {
        return directChildUnits(unit)
            .filter(child => primaryParentUnit(child) === unit)
            .sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
    }

    function collectSubtree(unit, target = new Set()) {
        if (!unit || target.has(unit)) return target;
        target.add(unit);
        for (const child of ownedChildren(unit)) collectSubtree(child, target);
        return target;
    }

    function subtreeBounds(unit) {
        const units = [...collectSubtree(unit)];
        if (!units.length) return { left: unit.centerX, right: unit.centerX };
        return {
            left: Math.min(...units.map(item => item.centerX - item.width / 2)),
            right: Math.max(...units.map(item => item.centerX + item.width / 2))
        };
    }

    function translateUnit(unit, dx) {
        if (!Number.isFinite(dx) || Math.abs(dx) < 0.001) return;
        unit.centerX += dx;
        for (const member of unit.members || []) {
            if (Number.isFinite(member.x)) member.x += dx;
        }
    }

    function translateSubtree(unit, dx) {
        if (!Number.isFinite(dx) || Math.abs(dx) < 0.001) return;
        for (const item of collectSubtree(unit)) translateUnit(item, dx);
    }

    function explicitParentIdsForChild(childUnit, parentUnit) {
        const indexes = Store.snapshot().indexes;
        const parentsByChild = indexes?.parentsByChild || new Map();
        const spousesByPerson = indexes?.spousesByPerson || new Map();
        const result = new Set();

        for (const member of childUnit.members || []) {
            const explicit = [...(parentsByChild.get(member.id) || [])]
                .filter(id => unitByNodeId.get(id) === parentUnit);
            for (const id of explicit) result.add(id);

            // Match GraphView's conservative legacy normalization: one explicit parent with one
            // spouse in this unit behaves as a two-parent union for visual attachment.
            if (explicit.length === 1) {
                const partners = [...(spousesByPerson.get(explicit[0]) || [])]
                    .filter(id => unitByNodeId.get(id) === parentUnit);
                if (partners.length === 1) result.add(partners[0]);
            }
        }

        if (!result.size) {
            for (const member of childUnit.members || []) {
                if (member.parent_id && unitByNodeId.get(member.parent_id) === parentUnit) {
                    result.add(member.parent_id);
                }
            }
        }
        return [...result].sort();
    }

    function anchorForParentIds(parentUnit, parentIds) {
        const nodes = parentIds.map(id => globalNodeMap.get(id)).filter(Boolean);
        if (!nodes.length) return parentUnit.centerX;
        if (nodes.length === 1) return nodes[0].x;

        // Children have at most two explicit parents. For a spouse union, the connector anchor is
        // the midpoint of the facing card edges, not the bounding-box center of the whole unit.
        const [a, b] = nodes.slice(0, 2).sort((x, y) => x.x - y.x);
        const leftEdge = a.x + a.cardWidth / 2;
        const rightEdge = b.x - b.cardWidth / 2;
        return (leftEdge + rightEdge) / 2;
    }

    function groupChildrenByAnchor(parentUnit) {
        const groups = new Map();
        for (const child of ownedChildren(parentUnit)) {
            const parentIds = explicitParentIdsForChild(child, parentUnit);
            const key = parentIds.join('|') || `unit:${parentUnit.id}`;
            if (!groups.has(key)) groups.set(key, { parentIds, children: [] });
            groups.get(key).children.push(child);
        }
        return [...groups.values()];
    }

    function packChildren(children) {
        if (!children.length) return null;
        children.sort((a, b) => {
            const ab = subtreeBounds(a);
            const bb = subtreeBounds(b);
            const ac = (ab.left + ab.right) / 2;
            const bc = (bb.left + bb.right) / 2;
            return ac - bc || a.id.localeCompare(b.id);
        });

        let cursor = null;
        for (const child of children) {
            const bounds = subtreeBounds(child);
            if (cursor == null) {
                cursor = bounds.right;
                continue;
            }
            const desiredLeft = cursor + subtreeGap();
            translateSubtree(child, desiredLeft - bounds.left);
            cursor = subtreeBounds(child).right;
        }

        const left = Math.min(...children.map(child => subtreeBounds(child).left));
        const right = Math.max(...children.map(child => subtreeBounds(child).right));
        return { left, right, center: (left + right) / 2 };
    }

    function centerChildGroups(parentUnit) {
        const groups = groupChildrenByAnchor(parentUnit);
        if (!groups.length) return [];
        const diagnostics = [];

        for (const group of groups) {
            const packed = packChildren(group.children);
            if (!packed) continue;
            const anchor = anchorForParentIds(parentUnit, group.parentIds);
            const dx = anchor - packed.center;
            for (const child of group.children) translateSubtree(child, dx);
            const after = packChildren(group.children) || packed;
            diagnostics.push({
                parentUnit: parentUnit.id,
                parentIds: [...group.parentIds],
                childCount: group.children.length,
                anchor: Math.round(anchor),
                center: Math.round(after.center),
                offset: Math.round(anchor - after.center),
                width: Math.round(after.right - after.left)
            });
        }
        return diagnostics;
    }

    function normalizeHorizontalBounds() {
        if (!globalUnits.length) return;
        const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
        const delta = CANVAS_PAD_X - minLeft;
        if (Math.abs(delta) < 0.5) return;
        globalUnits.forEach(unit => translateUnit(unit, delta));
    }

    function refineSubtrees() {
        if (!globalUnits.length) return;

        // Member-order and bridge-compaction are authoritative for topology and internal union
        // geometry. Settle member positions once, then never call positionMembers again after
        // subtree translation or it can undo the anchor alignment.
        positionMembers();

        const byGen = new Map();
        for (const unit of globalUnits) {
            if (!byGen.has(unit.gen)) byGen.set(unit.gen, []);
            byGen.get(unit.gen).push(unit);
        }
        const generations = [...byGen.keys()].sort((a, b) => b - a);
        const diagnostics = [];

        // Bottom-up is important: first compact every child branch internally, then let its parent
        // treat that finished branch as one block. Ancestor translations subsequently move the
        // already-centered branch as a whole and preserve all lower-level alignment.
        for (const gen of generations) {
            const parents = [...(byGen.get(gen) || [])]
                .sort((a, b) => a.centerX - b.centerX || a.id.localeCompare(b.id));
            for (const parent of parents) diagnostics.push(...centerChildGroups(parent));
        }

        normalizeHorizontalBounds();
        window.__familySubtreeLayoutDiagnostics = {
            groups: diagnostics,
            maxOffset: diagnostics.length
                ? Math.max(...diagnostics.map(item => Math.abs(item.offset)))
                : 0,
            checkedAt: new Date().toISOString()
        };
    }

    Controller.registerLayoutStage({
        name: 'relationship-compaction',
        // Run after member-order (40) and bridge-compaction (50); no later layout stage may move
        // child branches after they have been packed under their actual union anchors.
        order: 60,
        run() {
            if (!globalNodes.length || !globalUnits.length) return;
            refineSubtrees();
            updateCanvasBounds();
            syncCardPositions();
        }
    });
})();
