// Parent invariant UI: one explicit parent plus that parent's sole spouse is already complete.
(() => {
    if (window.__familyParentLimitInstalled) return;
    window.__familyParentLimitInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const Store = window.FamilyGraphStore;
    if (!cardsLayer || !Store) return;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card[data-parent-limit="full"] [data-action="add-parent"] {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    function effectiveParentCount(childId) {
        const { parentsByChild, spousesByPerson } = Store.snapshot().indexes;
        const parents = parentsByChild.get(childId) || new Set();
        if (parents.size !== 1) return parents.size;
        const [parentId] = parents;
        return (spousesByPerson.get(parentId) || new Set()).size === 1 ? 2 : 1;
    }

    function canAddParent(childId) {
        return effectiveParentCount(childId) < 2;
    }

    function apply() {
        cardsLayer.querySelectorAll('.absolute-card[data-node-id]').forEach(card => {
            const full = !canAddParent(card.dataset.nodeId);
            card.toggleAttribute('data-parent-limit', full);
            if (full) card.dataset.parentLimit = 'full';
            else card.removeAttribute('data-parent-limit');
            if (full) card.querySelector('[data-action="add-parent"]')?.remove();
        });
    }

    window.FamilyParentLimit = Object.freeze({ canAddParent, effectiveParentCount, apply });
    window.addEventListener('family-graph-store-changed', apply);
    window.addEventListener('family-graph-rendered', apply);
    apply();
})();
