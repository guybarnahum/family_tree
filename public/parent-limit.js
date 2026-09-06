// Slice D parent invariant: a person may have at most two explicit parent relationships.
// Projection-only inferred co-parents do not count toward this limit.
(() => {
    if (window.__familyParentLimitInstalled) return;
    window.__familyParentLimitInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const counts = new Map();
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

    function apply() {
        cardsLayer.querySelectorAll('.absolute-card[data-node-id]').forEach(card => {
            const count = counts.get(card.dataset.nodeId) || 0;
            if (count >= 2) card.dataset.parentLimit = 'full';
            else card.removeAttribute('data-parent-limit');
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
                counts.clear();
                for (const relation of documentValue.relationships || []) {
                    if (relation.type !== 'parent') continue;
                    counts.set(relation.person2Id, (counts.get(relation.person2Id) || 0) + 1);
                }
                apply();
                return counts;
            })
            .catch(error => {
                console.warn('Unable to refresh explicit parent counts:', error);
                return counts;
            })
            .finally(() => { refreshPromise = null; });
        return refreshPromise;
    }

    function queueRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => refresh(false), 80);
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
            if ((counts.get(childId) || 0) >= 2) {
                showStatus('כבר יש שני הורים');
                apply();
                return;
            }
            await baseAddParent(childId);
            await refresh(true);
        };
        wrapped = true;
    }

    new MutationObserver(mutations => {
        if (!mutations.some(mutation => mutation.type === 'childList')) return;
        apply();
        queueRefresh();
    }).observe(cardsLayer, { childList: true, subtree: true });

    window.addEventListener('family-person-pane-saved', apply);
    void refresh(true);
    installAddParentGuard();
})();
