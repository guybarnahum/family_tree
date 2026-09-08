// Reserve the half-avatar radius that extends beyond a card's left edge.
(() => {
    if (window.__familyNodeFaceFootprintInstalled) return;
    window.__familyNodeFaceFootprintInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card .node-face-avatar { left: -20px !important; }
        #cards-layer .absolute-card.graph-root .node-face-avatar { left: -22px !important; }
    `;
    document.head.appendChild(style);

    let installedMeasure = false;
    let lastAvatarSignature = '';
    let checkQueued = false;

    function avatarOutset(card) {
        const avatar = card?.querySelector('.node-face-avatar');
        if (!avatar) return 0;
        const width = parseFloat(getComputedStyle(avatar).width);
        return Number.isFinite(width) && width > 0 ? width / 2 : 20;
    }

    function installMeasureWrapper() {
        if (installedMeasure || typeof measureCards !== 'function') return;
        const baseMeasureCards = measureCards;
        measureCards = function faceFootprintMeasureCards(...args) {
            const result = baseMeasureCards.apply(this, args);
            for (const node of globalNodes || []) {
                const card = document.getElementById(`card-${node.id}`);
                if (!card) continue;
                const bodyWidth = Math.max(1, Number(node.cardWidth) || 1);
                const outset = avatarOutset(card);
                node.cardBodyWidth = bodyWidth;
                node.cardFaceOutset = outset;
                node.cardWidth = bodyWidth + outset;
            }
            return result;
        };
        window.measureCards = measureCards;
        installedMeasure = true;
    }

    function avatarSignature() {
        return [...cardsLayer.querySelectorAll('.absolute-card[data-node-id]')]
            .filter(card => card.querySelector('.node-face-avatar'))
            .map(card => card.dataset.nodeId)
            .sort()
            .join('|');
    }

    function checkAvatarSet() {
        checkQueued = false;
        installMeasureWrapper();
        const signature = avatarSignature();
        if (signature === lastAvatarSignature) return;
        const changedExistingLayout = !!lastAvatarSignature || !!signature;
        lastAvatarSignature = signature;
        if (changedExistingLayout && globalNodes?.length) {
            void window.FamilyRenderController?.requestLayout?.({
                reason: 'node-face-footprint',
                preserveAnchor: true
            });
        }
    }

    function queueCheck() {
        if (checkQueued) return;
        checkQueued = true;
        requestAnimationFrame(checkAvatarSet);
    }

    window.addEventListener('family-graph-rendered', queueCheck);
    window.addEventListener('family-faces-changed', queueCheck);
    window.addEventListener('family-face-primary-changed', queueCheck);
    window.addEventListener('family-graph-synced', queueCheck);

    installMeasureWrapper();
    queueCheck();
})();
