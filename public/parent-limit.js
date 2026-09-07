// Parent invariant UI: a person may have at most two effective parents.
// One explicit parent plus that parent's sole spouse is already a complete visible pair.
(() => {
    if (window.__familyParentLimitInstalled) return;
    window.__familyParentLimitInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const Store = window.FamilyGraphStore;
    if (!cardsLayer || !Store) return;

    let refreshPromise = null;
    let wrapped = false;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card[data-parent-limit="full"] [data-action="add-parent"] {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    function graphIndexes() {
        return Store.snapshot().indexes;
    }

    function effectiveParentCount(childId) {
        const { parentsByChild, spousesByPerson } = graphIndexes();
        const parents = parentsByChild.get(childId) || new Set();
        if (parents.size !== 1) return parents.size;
        const [parentId] = [...parents];
        const partners = spousesByPerson.get(parentId) || new Set();
        return partners.size === 1 ? 2 : 1;
    }

    function canAddParent(childId) {
        return effectiveParentCount(childId) < 2;
    }

    function apply() {
        cardsLayer.querySelectorAll('.absolute-card[data-node-id]').forEach(card => {
            if (canAddParent(card.dataset.nodeId)) {
                card.removeAttribute('data-parent-limit');
            } else {
                card.dataset.parentLimit = 'full';
                card.querySelector('[data-action="add-parent"]')?.remove();
            }
        });
    }

    async function refresh(force = false) {
        if (refreshPromise && !force) return refreshPromise;
        refreshPromise = Store.read({ reason: 'parent-limit' })
            .then(snapshot => {
                apply();
                return snapshot.graph;
            })
            .catch(error => {
                console.warn('Unable to refresh parent limit:', error);
                return null;
            })
            .finally(() => { refreshPromise = null; });
        return refreshPromise;
    }

    function installAddParentGuard(attempt = 0) {
        if (wrapped) return;
        const candidate = typeof addParent === 'function' ? addParent : null;
        const relationshipAware = candidate && candidate.name === 'relationshipAwareAddParent';
        if (!relationshipAware && attempt < 200) {
            setTimeout(() => installAddParentGuard(attempt + 1), 25);
            return;
        }
        if (!candidate) return;

        const baseAddParent = candidate;
        addParent = async function cappedAddParent(childId) {
            await refresh(true);
            if (!canAddParent(childId)) {
                showStatus('כבר יש שני הורים');
                apply();
                return;
            }
            await baseAddParent(childId);
            await refresh(true);
        };
        wrapped = true;
    }

    window.FamilyParentLimit = Object.freeze({ canAddParent, effectiveParentCount, refresh, apply });

    // Graph/card lifecycle is explicit in M3; do not infer it from DOM child mutations.
    window.addEventListener('family-graph-store-changed', apply);
    window.addEventListener('family-graph-rendered', apply);

    void refresh(true);
    installAddParentGuard();
})();
