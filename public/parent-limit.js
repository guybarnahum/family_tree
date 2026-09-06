// Slice D parent invariant: a person may have at most two effective parents.
// One explicit parent plus that parent's sole spouse is already a complete visible pair.
(() => {
    if (window.__familyParentLimitInstalled) return;
    window.__familyParentLimitInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const explicitParents = new Map();
    const spouses = new Map();
    let refreshPromise = null;
    let refreshTimer = 0;
    let wrapped = false;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card[data-parent-limit="full"] [data-action="add-parent"] {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function rebuild(documentValue) {
        explicitParents.clear();
        spouses.clear();
        for (const relation of documentValue.relationships || []) {
            if (relation.type === 'parent') {
                addSet(explicitParents, relation.person2Id, relation.person1Id);
            } else if (relation.type === 'spouse') {
                addSet(spouses, relation.person1Id, relation.person2Id);
                addSet(spouses, relation.person2Id, relation.person1Id);
            }
        }
    }

    function effectiveParentCount(childId) {
        const parents = explicitParents.get(childId) || new Set();
        if (parents.size !== 1) return parents.size;
        const [parentId] = [...parents];
        const partners = spouses.get(parentId) || new Set();
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
                // Remove it as well as hiding it. If a later card pass reconstructs the
                // action, the data attribute keeps it hidden until this guard reapplies.
                card.querySelector('[data-action="add-parent"]')?.remove();
            }
        });
    }

    async function refresh(force = false) {
        if (refreshPromise && !force) return refreshPromise;
        refreshPromise = fetch('/api/graph', { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error(await response.text());
                return response.json();
            })
            .then(documentValue => {
                rebuild(documentValue);
                apply();
                return documentValue;
            })
            .catch(error => {
                console.warn('Unable to refresh parent limit:', error);
                return null;
            })
            .finally(() => { refreshPromise = null; });
        return refreshPromise;
    }

    function queueRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refresh(false), 80);
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

    window.FamilyParentLimit = { canAddParent, effectiveParentCount, refresh, apply };

    new MutationObserver(mutations => {
        if (!mutations.some(mutation => mutation.type === 'childList')) return;
        apply();
        queueRefresh();
    }).observe(cardsLayer, { childList: true, subtree: true });

    void refresh(true);
    installAddParentGuard();
})();
