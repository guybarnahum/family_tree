// Union-aware child action presentation.
// Structural mutation ownership lives in FamilyMutations; this module only renders union buttons.
(() => {
    if (window.FamilyUnionChildActions) return;

    const cardsLayer = document.getElementById('cards-layer');
    const Store = window.FamilyGraphStore;
    const Mutations = window.FamilyMutations;
    if (!cardsLayer || !Store || !Mutations) return;

    const UNION_LANE_CLEARANCE = 18;
    const UNION_LANE_STEP = 16;
    let spouseMap = new Map();

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card[data-child-union-required="true"] [data-action="add-child"] {
            display: none !important;
        }

        #family-union-child-actions {
            position: absolute;
            inset: 0;
            z-index: 58;
            pointer-events: none;
        }

        #family-union-child-actions .family-union-child-action {
            position: absolute;
            transform: translate(-50%, -50%);
            min-height: 23px;
            padding: 2px 8px;
            border: 1px solid rgba(88,129,87,.36);
            border-radius: 999px;
            background: rgba(255,255,255,.97);
            box-shadow: 0 2px 7px rgba(52,78,65,.13);
            color: #588157;
            font: 600 8px/1 Inter, sans-serif;
            white-space: nowrap;
            cursor: pointer;
            pointer-events: auto;
            transition: background-color .14s ease, border-color .14s ease, transform .14s ease;
        }

        #family-union-child-actions .family-union-child-action:hover,
        #family-union-child-actions .family-union-child-action:focus-visible {
            background: #fff;
            border-color: #588157;
            outline: none;
            transform: translate(-50%, -50%) scale(1.04);
        }

        @media (max-width:768px), (hover:none) and (pointer:coarse) {
            #family-union-child-actions .family-union-child-action {
                min-height: 30px;
                padding: 4px 10px;
                font-size: 10px;
            }
        }

        @media print { #family-union-child-actions { display: none !important; } }
    `;
    document.head.appendChild(style);

    function refreshFromStore() {
        spouseMap = Store.snapshot().indexes?.spousesByPerson || new Map();
    }

    function spouseIds(personId) {
        return [...(spouseMap.get(personId) || [])];
    }

    function pairKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function currentRootId() {
        return window.FamilySelectionController?.getSelectedPersonId?.() || null;
    }

    function personName(id) {
        return String(Store.person(id)?.name || '').trim() || 'ללא שם';
    }

    function generationY(unit) {
        if (Number.isFinite(unit?.generationCenterY)) return unit.generationCenterY;
        const member = unit?.members?.[0];
        return member ? member.targetY + member.cardHeight / 2 : null;
    }

    function unionPoint(unit, aId, bId) {
        if (!unit?.members?.length || typeof globalNodeMap === 'undefined') return null;
        const a = globalNodeMap.get(aId);
        const b = globalNodeMap.get(bId);
        if (!a || !b) return null;

        const index = new Map(unit.members.map((member, i) => [member.id, i]));
        if (!index.has(aId) || !index.has(bId)) return null;
        const centerY = generationY(unit);
        if (!Number.isFinite(centerY)) return null;

        const left = a.x <= b.x ? a : b;
        const right = left === a ? b : a;
        const x = ((left.x + left.cardWidth / 2) + (right.x - right.cardWidth / 2)) / 2;
        if (Math.abs(index.get(aId) - index.get(bId)) === 1) return { x, y: centerY };

        const routedKeys = [];
        for (const member of unit.members) {
            for (const spouseId of spouseIds(member.id)) {
                if (!index.has(spouseId) || member.id >= spouseId) continue;
                if (Math.abs(index.get(member.id) - index.get(spouseId)) > 1) {
                    routedKeys.push(pairKey(member.id, spouseId));
                }
            }
        }
        routedKeys.sort((a, b) => a.localeCompare(b));
        const laneIndex = Math.max(0, routedKeys.indexOf(pairKey(aId, bId)));
        const maxBottom = Math.max(...unit.members.map(member => member.targetY + member.cardHeight));
        return { x, y: maxBottom + UNION_LANE_CLEARANCE + laneIndex * UNION_LANE_STEP };
    }

    function ensureOverlay() {
        let overlay = document.getElementById('family-union-child-actions');
        if (overlay?.parentElement === cardsLayer) return overlay;
        overlay?.remove();
        overlay = document.createElement('div');
        overlay.id = 'family-union-child-actions';
        cardsLayer.appendChild(overlay);
        return overlay;
    }

    function applyPersonChildPolicy() {
        cardsLayer.querySelectorAll('.absolute-card[data-node-id]').forEach(card => {
            if (spouseIds(card.dataset.nodeId).length > 1) card.dataset.childUnionRequired = 'true';
            else card.removeAttribute('data-child-union-required');
        });
    }

    function refresh() {
        refreshFromStore();
        applyPersonChildPolicy();
        const overlay = ensureOverlay();
        overlay.replaceChildren();

        const rootId = currentRootId();
        if (!rootId || spouseIds(rootId).length <= 1) return;
        if (typeof unitByNodeId === 'undefined' || typeof globalNodeMap === 'undefined') return;
        const unit = unitByNodeId.get(rootId);
        if (!unit) return;

        for (const spouseId of spouseIds(rootId)) {
            if (!globalNodeMap.has(spouseId) || unitByNodeId.get(spouseId) !== unit) continue;
            const point = unionPoint(unit, rootId, spouseId);
            if (!point) continue;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'family-union-child-action';
            button.dataset.unionParent1 = rootId;
            button.dataset.unionParent2 = spouseId;
            button.style.left = `${point.x}px`;
            button.style.top = `${point.y}px`;
            button.textContent = '+ ילד';
            button.title = `הוסף ילד עם ${personName(spouseId)}`;
            button.setAttribute('aria-label', button.title);
            overlay.appendChild(button);
        }
    }

    cardsLayer.addEventListener('click', event => {
        const button = event.target.closest('.family-union-child-action');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        void Mutations.addChildToUnion(button.dataset.unionParent1, button.dataset.unionParent2);
    }, true);

    window.FamilyUnionChildActions = Object.freeze({
        refresh,
        addChildToUnion: (a, b) => Mutations.addChildToUnion(a, b),
        spouseIds: personId => [...spouseIds(personId)]
    });
})();
