// Treat the circular node portrait as part of the node's horizontal footprint.
// The portrait is centered exactly on the card's left edge, so half its diameter extends
// outside the card. Layout measurement reserves that outside radius when a portrait exists.
(() => {
    if (window.__familyNodeFaceFootprintInstalled) return;
    window.__familyNodeFaceFootprintInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card .node-face-avatar {
            left: -20px !important;
        }
        #cards-layer .absolute-card.graph-root .node-face-avatar {
            left: -22px !important;
        }
    `;
    document.head.appendChild(style);

    let installedMeasure = false;
    let lastAvatarSignature = '';
    let checkQueued = false;
    let relayoutQueued = false;

    function avatarOutset(card) {
        const avatar = card?.querySelector('.node-face-avatar');
        if (!avatar) return 0;
        const width = parseFloat(getComputedStyle(avatar).width);
        return Number.isFinite(width) && width > 0 ? width / 2 : 20;
    }

    function installMeasureWrapper() {
        if (installedMeasure || typeof measureCards !== 'function') return false;
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
                // Only the outside half-circle enlarges the node footprint. Keeping cardWidth
                // as the footprint width lets all existing row/unit packers honor it naturally.
                node.cardWidth = bodyWidth + outset;
            }
            return result;
        };
        window.measureCards = measureCards;
        installedMeasure = true;
        return true;
    }

    function avatarSignature() {
        return [...cardsLayer.querySelectorAll('.absolute-card[data-node-id]')]
            .filter(card => card.querySelector('.node-face-avatar'))
            .map(card => card.dataset.nodeId)
            .sort()
            .join('|');
    }

    function queueRelayout() {
        if (relayoutQueued || typeof layoutAndRender !== 'function' || !globalNodes?.length) return;
        relayoutQueued = true;
        requestAnimationFrame(() => {
            relayoutQueued = false;
            try { layoutAndRender(); }
            catch (error) { console.warn('Unable to reflow node face footprint:', error); }
        });
    }

    function checkAvatarSet() {
        checkQueued = false;
        installMeasureWrapper();
        const signature = avatarSignature();
        if (signature === lastAvatarSignature) return;
        const hadPrevious = !!lastAvatarSignature;
        const hasCurrent = !!signature;
        lastAvatarSignature = signature;
        // A portrait set change changes horizontal footprint. One coalesced layout pass is
        // enough; crop/primary-face changes for the same people do not cause a reflow.
        if (hadPrevious || hasCurrent) queueRelayout();
    }

    function queueCheck() {
        if (checkQueued) return;
        checkQueued = true;
        requestAnimationFrame(() => requestAnimationFrame(checkAvatarSet));
    }

    const observer = new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.type === 'childList')) queueCheck();
    });
    observer.observe(cardsLayer, { childList: true, subtree: true });

    window.addEventListener('family-faces-changed', queueCheck);
    window.addEventListener('family-face-primary-changed', queueCheck);
    window.addEventListener('family-graph-synced', queueCheck);

    installMeasureWrapper();
    lastAvatarSignature = '';
    queueCheck();
})();
