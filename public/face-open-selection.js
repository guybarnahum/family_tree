// When a photo opens with existing face tags, select a useful face immediately.
// Prefer the currently viewed person's tagged face; otherwise select the first face.
(() => {
    if (window.__familyFaceOpenSelectionInstalled) return;
    window.__familyFaceOpenSelectionInstalled = true;

    const modal = document.getElementById('person-media-modal');
    const image = modal?.querySelector('.person-media-full');
    const overlay = modal?.querySelector('.face-overlay');
    const cardsLayer = document.getElementById('cards-layer');
    if (!modal || !image || !overlay) return;

    let openSerial = 0;
    let selectedForOpen = null;

    function currentPersonId() {
        const root = cardsLayer?.querySelector('.absolute-card.graph-root[data-node-id]');
        if (root?.dataset.nodeId) return root.dataset.nodeId;
        const fromUrl = new URL(window.location.href).searchParams.get('person');
        if (fromUrl) return fromUrl;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function currentMediaId() {
        try {
            const url = new URL(image.currentSrc || image.src, window.location.href);
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] !== 'api' || parts[1] !== 'media' || parts[3] !== 'content') return null;
            return decodeURIComponent(parts[2] || '');
        } catch (_) {
            return null;
        }
    }

    function boxFor(faceId) {
        return [...overlay.querySelectorAll('.face-box[data-face-id]')]
            .find(box => box.dataset.faceId === faceId) || null;
    }

    function waitForBox(faceId, serial, attempt = 0) {
        if (serial !== openSerial || !modal.classList.contains('open')) return Promise.resolve(null);
        const box = boxFor(faceId);
        if (box) return Promise.resolve(box);
        if (attempt >= 90) return Promise.resolve(null);
        return new Promise(resolve => requestAnimationFrame(() => {
            resolve(waitForBox(faceId, serial, attempt + 1));
        }));
    }

    function synthesizeSelection(box) {
        if (!box?.isConnected || overlay.querySelector('.face-box.selected')) return;

        const rect = box.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const pointerId = 424242;
        const EventCtor = window.PointerEvent || window.MouseEvent;

        const hadOwnSet = Object.prototype.hasOwnProperty.call(overlay, 'setPointerCapture');
        const hadOwnRelease = Object.prototype.hasOwnProperty.call(overlay, 'releasePointerCapture');
        const originalSet = overlay.setPointerCapture;
        const originalRelease = overlay.releasePointerCapture;

        // Synthetic pointer events are not considered active browser pointers, so the native
        // setPointerCapture call would reject them. The core selection logic does not depend
        // on capture for this zero-movement selection gesture.
        overlay.setPointerCapture = () => {};
        overlay.releasePointerCapture = () => {};
        try {
            box.dispatchEvent(new EventCtor('pointerdown', {
                bubbles: true,
                cancelable: true,
                pointerId,
                pointerType: 'mouse',
                clientX: x,
                clientY: y,
                button: 0,
                buttons: 1
            }));
            overlay.dispatchEvent(new EventCtor('pointerup', {
                bubbles: true,
                cancelable: true,
                pointerId,
                pointerType: 'mouse',
                clientX: x,
                clientY: y,
                button: 0,
                buttons: 0
            }));
        } finally {
            if (hadOwnSet) overlay.setPointerCapture = originalSet;
            else delete overlay.setPointerCapture;
            if (hadOwnRelease) overlay.releasePointerCapture = originalRelease;
            else delete overlay.releasePointerCapture;
        }
    }

    async function selectInitialFace() {
        if (!modal.classList.contains('open')) return;
        const mediaId = currentMediaId();
        if (!mediaId || selectedForOpen === mediaId) return;

        const serial = openSerial;
        try {
            const response = await fetch(`/api/faces?media=${encodeURIComponent(mediaId)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            if (serial !== openSerial || !modal.classList.contains('open')) return;

            const faces = Array.isArray(payload.items) ? payload.items : [];
            if (!faces.length) return;
            const personId = currentPersonId();
            const target = faces.find(face => personId && face.personId === personId) || faces[0];
            const box = await waitForBox(target.id, serial);
            if (!box || serial !== openSerial) return;

            synthesizeSelection(box);
            selectedForOpen = mediaId;
        } catch (error) {
            console.warn('Unable to auto-select photo face:', error);
        }
    }

    function opened() {
        openSerial += 1;
        selectedForOpen = null;
        requestAnimationFrame(() => requestAnimationFrame(() => void selectInitialFace()));
    }

    new MutationObserver(() => {
        if (modal.classList.contains('open')) opened();
        else {
            openSerial += 1;
            selectedForOpen = null;
        }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });

    image.addEventListener('load', () => {
        if (modal.classList.contains('open')) requestAnimationFrame(() => void selectInitialFace());
    });

    if (modal.classList.contains('open')) opened();
})();
