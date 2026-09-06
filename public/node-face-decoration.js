// Slice F graph decoration: show a small circular crop for the preferred (or fallback)
// tagged face without changing card geometry or triggering a graph relayout.
(() => {
    if (window.__familyNodeFaceDecorationInstalled) return;
    window.__familyNodeFaceDecorationInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    let preferredByPerson = new Map();
    let refreshSerial = 0;
    let applyFrame = 0;

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card .node-face-avatar {
            position: absolute;
            left: 7px;
            bottom: -12px;
            width: 28px;
            height: 28px;
            box-sizing: border-box;
            overflow: hidden;
            border: 2px solid rgba(255,255,255,.98);
            border-radius: 999px;
            background: #eef1eb;
            box-shadow: 0 2px 7px rgba(52,78,65,.22);
            z-index: 44;
            pointer-events: none;
        }
        #cards-layer .absolute-card.graph-root .node-face-avatar {
            width: 30px;
            height: 30px;
            bottom: -13px;
        }
        #cards-layer .absolute-card .node-face-avatar img {
            position: absolute;
            display: block;
            max-width: none !important;
            max-height: none !important;
            margin: 0 !important;
            transform: none !important;
            transform-origin: 0 0;
        }
        @media print {
            #cards-layer .absolute-card .node-face-avatar { display: none !important; }
        }
    `;
    document.head.appendChild(style);

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function faceSignature(face) {
        return [face.id, face.mediaId, face.x, face.y, face.width, face.height].join('|');
    }

    function applyCrop(image, face) {
        const sourceWidth = Number(face.sourceWidth) || image.naturalWidth;
        const sourceHeight = Number(face.sourceHeight) || image.naturalHeight;
        if (!sourceWidth || !sourceHeight) return;

        const faceWidth = Math.max(1, face.width * sourceWidth);
        const faceHeight = Math.max(1, face.height * sourceHeight);
        const cropSize = Math.min(
            Math.min(sourceWidth, sourceHeight),
            Math.max(faceWidth, faceHeight) * 1.38
        );
        const centerX = (face.x + face.width / 2) * sourceWidth;
        const centerY = (face.y + face.height / 2) * sourceHeight;
        const cropLeft = clamp(centerX - cropSize / 2, 0, sourceWidth - cropSize);
        const cropTop = clamp(centerY - cropSize / 2, 0, sourceHeight - cropSize);

        image.style.width = `${(sourceWidth / cropSize) * 100}%`;
        image.style.height = `${(sourceHeight / cropSize) * 100}%`;
        image.style.left = `${-(cropLeft / cropSize) * 100}%`;
        image.style.top = `${-(cropTop / cropSize) * 100}%`;
    }

    function avatarFor(face) {
        const avatar = document.createElement('span');
        avatar.className = 'node-face-avatar';
        avatar.dataset.faceSignature = faceSignature(face);
        avatar.setAttribute('aria-hidden', 'true');

        const image = document.createElement('img');
        image.alt = '';
        image.src = face.contentUrl || `/api/media/${encodeURIComponent(face.mediaId)}/content`;
        image.addEventListener('load', () => applyCrop(image, face), { once: true });
        avatar.appendChild(image);
        if (image.complete && image.naturalWidth) requestAnimationFrame(() => applyCrop(image, face));
        return avatar;
    }

    function apply() {
        for (const card of cardsLayer.querySelectorAll('.absolute-card[data-node-id]')) {
            const entry = preferredByPerson.get(card.dataset.nodeId);
            const face = entry?.face || null;
            const existing = card.querySelector('.node-face-avatar');
            if (!face) {
                existing?.remove();
                continue;
            }

            const signature = faceSignature(face);
            if (existing?.dataset.faceSignature === signature) continue;
            existing?.remove();
            card.appendChild(avatarFor(face));
        }
    }

    function queueApply() {
        if (applyFrame) cancelAnimationFrame(applyFrame);
        applyFrame = requestAnimationFrame(() => {
            applyFrame = 0;
            apply();
        });
    }

    async function refresh() {
        const serial = ++refreshSerial;
        try {
            const response = await fetch('/api/faces/preferred', { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            if (serial !== refreshSerial) return;
            preferredByPerson = new Map(
                (Array.isArray(payload.items) ? payload.items : [])
                    .map(item => [item.personId, item])
            );
            apply();
        } catch (error) {
            console.warn('Unable to load preferred faces:', error);
        }
    }

    new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.type === 'childList')) queueApply();
    }).observe(cardsLayer, { childList: true, subtree: false });

    window.addEventListener('family-faces-changed', () => void refresh());
    window.addEventListener('family-face-primary-changed', () => void refresh());
    window.addEventListener('family-person-pane-saved', event => {
        if (event.detail?.field === 'metadata') void refresh();
    });

    requestAnimationFrame(() => requestAnimationFrame(() => void refresh()));
})();
