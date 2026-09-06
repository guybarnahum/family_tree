// Slice D photo gallery for the selected-person pane. Originals live in R2; D1 stores
// metadata and person associations. Face rectangles intentionally remain a Slice E concern.
(() => {
    if (window.__familyPersonMediaInstalled) return;
    window.__familyPersonMediaInstalled = true;

    const pane = document.getElementById('person-pane');
    const paneBody = pane?.querySelector('.person-pane-body');
    const cardsLayer = document.getElementById('cards-layer');
    if (!pane || !paneBody || !cardsLayer) return;

    const Metadata = window.FamilyPersonMetadata || {
        placeText: value => typeof value === 'string' ? value : String(value?.text || ''),
        placeFromText: value => String(value || '').trim() ? { text: String(value).trim() } : null,
        inferCountryCode: () => null,
        flagEmoji: () => ''
    };

    const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
    const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
    let renderSerial = 0;
    let selectedItem = null;
    const editOriginals = new WeakMap();

    const style = document.createElement('style');
    style.textContent = `
        .person-media-section { position: relative; }
        .person-media-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 9px;
        }
        .person-media-heading .person-pane-section-title { margin: 0; }
        .person-media-add {
            width: 27px;
            height: 27px;
            border: 1px solid rgba(88,129,87,.26);
            border-radius: 999px;
            background: rgba(163,177,138,.09);
            color: #588157;
            font: 600 18px/23px Inter, sans-serif;
            cursor: pointer;
        }
        .person-media-add:hover, .person-media-add:focus-visible {
            background: rgba(163,177,138,.18);
            outline: none;
        }
        .person-media-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 7px;
        }
        .person-media-tile {
            position: relative;
            aspect-ratio: 1;
            overflow: hidden;
            border: 0;
            border-radius: 9px;
            background: rgba(163,177,138,.12);
            padding: 0;
            cursor: pointer;
        }
        .person-media-tile img {
            width: 100%; height: 100%; object-fit: cover; display: block;
        }
        .person-media-empty, .person-media-note {
            margin: 0;
            color: #929b93;
            font: 400 11px/1.45 Inter, sans-serif;
        }
        .person-media-loading {
            height: 70px;
            border-radius: 9px;
            background: rgba(163,177,138,.08);
        }
        #person-media-modal {
            position: fixed;
            inset: 0;
            z-index: 10000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(20,29,23,.72);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            direction: rtl;
        }
        #person-media-modal.open { display: flex; }
        .person-media-dialog {
            width: min(920px, 94vw);
            max-height: 92vh;
            overflow: auto;
            border-radius: 16px;
            background: #fff;
            box-shadow: 0 24px 70px rgba(0,0,0,.28);
            padding: 14px;
        }
        .person-media-dialog-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
        }
        .person-media-close, .person-media-delete {
            border: 0;
            border-radius: 999px;
            cursor: pointer;
            font: 600 11px/1 Inter, sans-serif;
        }
        .person-media-close {
            width: 30px; height: 30px;
            background: rgba(163,177,138,.12);
            color: #344e41;
            font-size: 18px;
        }
        .person-media-delete {
            padding: 8px 11px;
            background: rgba(148,67,67,.08);
            color: #8d4a4a;
        }
        .person-media-full {
            display: block;
            width: 100%;
            max-height: 64vh;
            object-fit: contain;
            border-radius: 11px;
            background: #f4f5f1;
        }
        .person-media-meta {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px 16px;
            padding: 14px 4px 2px;
        }
        .person-media-meta-field { min-width: 0; }
        .person-media-meta-field-wide { grid-column: 1 / -1; }
        .person-media-meta-label {
            display: block;
            margin-bottom: 4px;
            color: #8a948b;
            font: 600 10px/1.3 Inter, sans-serif;
        }
        .person-media-meta-value {
            min-height: 30px;
            padding: 6px 8px;
            border-radius: 7px;
            color: #37423a;
            font: 400 14px/1.5 Inter, sans-serif;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }
        .person-media-meta-value:hover, .person-media-meta-value:focus {
            outline: none;
            background: rgba(163,177,138,.12);
        }
        .person-media-meta-value:empty::before {
            content: attr(data-placeholder);
            color: #a4aaa4;
            pointer-events: none;
        }
        .person-media-place-row { display: flex; gap: 7px; align-items: flex-start; }
        .person-media-place-row .person-media-meta-value { flex: 1 1 auto; min-width: 0; }
        .person-media-place-flag { min-width: 24px; padding-top: 5px; font-size: 18px; }
        @media (max-width: 640px) {
            #person-media-modal { padding: 8px; align-items: flex-end; }
            .person-media-dialog { width: 100%; max-height: 90vh; border-radius: 16px 16px 0 0; }
            .person-media-meta { grid-template-columns: 1fr; }
            .person-media-meta-field-wide { grid-column: auto; }
        }
        @media print { #person-media-modal, .person-media-section { display: none !important; } }
    `;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'person-media-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="person-media-dialog" role="dialog" aria-modal="true" aria-label="פרטי תמונה">
            <div class="person-media-dialog-top">
                <button type="button" class="person-media-delete">מחק תמונה</button>
                <button type="button" class="person-media-close" aria-label="סגור">×</button>
            </div>
            <img class="person-media-full" alt="">
            <div class="person-media-meta">
                <div class="person-media-meta-field person-media-meta-field-wide">
                    <span class="person-media-meta-label">כיתוב</span>
                    <div class="person-media-meta-value" contenteditable="true" data-media-field="caption" data-placeholder="הוסף כיתוב…"></div>
                </div>
                <div class="person-media-meta-field">
                    <span class="person-media-meta-label">תאריך</span>
                    <div class="person-media-meta-value" contenteditable="true" data-media-field="takenDate" data-placeholder="שנה, תאריך או תיאור חופשי"></div>
                </div>
                <div class="person-media-meta-field">
                    <span class="person-media-meta-label">מקום</span>
                    <div class="person-media-place-row">
                        <div class="person-media-meta-value" contenteditable="true" data-media-field="takenPlace" data-placeholder="עיר, אזור או מדינה"></div>
                        <span class="person-media-place-flag" aria-hidden="true"></span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const modalImage = modal.querySelector('.person-media-full');
    const modalPlace = modal.querySelector('[data-media-field="takenPlace"]');
    const modalFlag = modal.querySelector('.person-media-place-flag');

    function currentPersonId() {
        const card = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        if (card?.dataset.nodeId) return card.dataset.nodeId;
        const urlId = new URL(window.location.href).searchParams.get('person');
        if (urlId) return urlId;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function insertMediaSection(section) {
        const addDetails = paneBody.querySelector('.person-pane-add-wrap');
        if (addDetails) addDetails.before(section);
        else paneBody.appendChild(section);
    }

    function sectionShell(personId) {
        const section = document.createElement('section');
        section.className = 'person-pane-section person-media-section';
        section.dataset.personId = personId;
        section.innerHTML = `
            <div class="person-media-heading">
                <span class="person-pane-section-title">תמונות</span>
                <button type="button" class="person-media-add" aria-label="הוסף תמונה">+</button>
            </div>
            <div class="person-media-content"><div class="person-media-loading"></div></div>
            <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,image/avif">
        `;
        return section;
    }

    function renderItems(section, payload) {
        const content = section.querySelector('.person-media-content');
        const add = section.querySelector('.person-media-add');
        content.innerHTML = '';

        if (!payload.storageConfigured) {
            add.hidden = true;
            const note = document.createElement('p');
            note.className = 'person-media-note';
            note.textContent = 'אחסון התמונות עדיין לא הוגדר.';
            content.appendChild(note);
            return;
        }

        const items = Array.isArray(payload.items) ? payload.items : [];
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'person-media-empty';
            empty.textContent = 'אין תמונות עדיין.';
            content.appendChild(empty);
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'person-media-grid';
        for (const item of items) {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'person-media-tile';
            tile.dataset.mediaId = item.id;
            tile.title = item.caption || item.originalFilename || 'תמונה';
            const image = document.createElement('img');
            image.src = item.contentUrl;
            image.alt = item.caption || '';
            image.loading = 'lazy';
            tile.appendChild(image);
            tile.addEventListener('click', () => openMedia(item, section));
            grid.appendChild(tile);
        }
        content.appendChild(grid);
    }

    async function loadSection(section, serial) {
        const personId = section.dataset.personId;
        try {
            const response = await fetch(`/api/media?person=${encodeURIComponent(personId)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            if (serial !== renderSerial || !section.isConnected || currentPersonId() !== personId) return;
            section._mediaItems = payload.items || [];
            renderItems(section, payload);
        } catch (error) {
            console.warn('Unable to load person photos:', error);
            const content = section.querySelector('.person-media-content');
            if (content) content.innerHTML = '<p class="person-media-note">לא ניתן לטעון תמונות כרגע.</p>';
        }
    }

    async function dimensions(file) {
        if (typeof createImageBitmap !== 'function') return {};
        try {
            const bitmap = await createImageBitmap(file);
            const result = { width: bitmap.width, height: bitmap.height };
            bitmap.close?.();
            return result;
        } catch (_) {
            return {};
        }
    }

    async function upload(section, file) {
        if (!file) return;
        if (!ACCEPTED_TYPES.has(file.type)) {
            showStatus('סוג תמונה לא נתמך');
            return;
        }
        if (!file.size || file.size > MAX_UPLOAD_BYTES) {
            showStatus('התמונה גדולה מדי');
            return;
        }

        showStatus('מעלה תמונה...');
        try {
            const size = await dimensions(file);
            const form = new FormData();
            form.append('file', file);
            if (size.width) form.append('width', String(size.width));
            if (size.height) form.append('height', String(size.height));
            const response = await fetch(`/api/media?person=${encodeURIComponent(section.dataset.personId)}`, {
                method: 'POST',
                body: form
            });
            if (!response.ok) throw new Error(await response.text());
            showStatus('נשמר בהצלחה');
            const serial = ++renderSerial;
            await loadSection(section, serial);
        } catch (error) {
            console.error('Unable to upload photo:', error);
            showStatus('שגיאה בהעלאת תמונה');
        }
    }

    function wireSection(section) {
        const input = section.querySelector('input[type="file"]');
        section.querySelector('.person-media-add').addEventListener('click', () => {
            input.value = '';
            input.click();
        });
        input.addEventListener('change', () => void upload(section, input.files?.[0]));
    }

    function ensureSection() {
        const personId = currentPersonId();
        if (!personId) return;
        const existing = paneBody.querySelector('.person-media-section');
        if (existing?.dataset.personId === personId) return;
        existing?.remove();

        const section = sectionShell(personId);
        insertMediaSection(section);
        wireSection(section);
        const serial = ++renderSerial;
        void loadSection(section, serial);
    }

    function updateModalFlag() {
        const code = Metadata.inferCountryCode(modalPlace.innerText.trim());
        modalFlag.textContent = Metadata.flagEmoji(code);
    }

    function openMedia(item, section) {
        selectedItem = { ...item, _section: section };
        modalImage.src = item.contentUrl;
        modalImage.alt = item.caption || '';
        modal.querySelector('[data-media-field="caption"]').textContent = item.caption || '';
        modal.querySelector('[data-media-field="takenDate"]').textContent = item.takenDate || '';
        modalPlace.textContent = Metadata.placeText(item.takenPlace) || '';
        updateModalFlag();
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeMedia() {
        selectedItem = null;
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        modalImage.removeAttribute('src');
    }

    async function patchSelected(field, value, element, original) {
        if (!selectedItem || value === original) return;
        const payload = field === 'takenPlace'
            ? { takenPlace: Metadata.placeFromText(value) }
            : { [field]: value };
        try {
            const response = await fetch(`/api/media/${encodeURIComponent(selectedItem.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(await response.text());
            const result = await response.json();
            Object.assign(selectedItem, result.item || {});
            editOriginals.set(element, value);
            showStatus('נשמר בהצלחה');
            if (field === 'caption') modalImage.alt = value;
        } catch (error) {
            console.error('Unable to save photo detail:', error);
            element.textContent = original;
            if (field === 'takenPlace') updateModalFlag();
            showStatus('שגיאה בשמירה');
        }
    }

    modal.addEventListener('focusin', event => {
        const field = event.target?.dataset?.mediaField;
        if (!field) return;
        editOriginals.set(event.target, event.target.innerText.trim());
    }, true);

    modal.addEventListener('focusout', event => {
        const field = event.target?.dataset?.mediaField;
        if (!field) return;
        const value = event.target.innerText.trim();
        const original = editOriginals.get(event.target) ?? value;
        void patchSelected(field, value, event.target, original);
    }, true);

    modalPlace.addEventListener('input', updateModalFlag);
    modal.querySelector('.person-media-close').addEventListener('click', closeMedia);
    modal.addEventListener('click', event => {
        if (event.target === modal) closeMedia();
    });
    modal.querySelector('.person-media-delete').addEventListener('click', async () => {
        if (!selectedItem || !confirm('למחוק את התמונה?')) return;
        const item = selectedItem;
        try {
            const response = await fetch(`/api/media/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await response.text());
            closeMedia();
            showStatus('נמחק');
            if (item._section?.isConnected) {
                const serial = ++renderSerial;
                await loadSection(item._section, serial);
            }
        } catch (error) {
            console.error('Unable to delete photo:', error);
            showStatus('שגיאה במחיקה');
        }
    });
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal.classList.contains('open')) closeMedia();
    });

    let ensureFrame = 0;
    function queueEnsure() {
        if (ensureFrame) cancelAnimationFrame(ensureFrame);
        ensureFrame = requestAnimationFrame(() => {
            ensureFrame = 0;
            ensureSection();
        });
    }

    new MutationObserver(queueEnsure).observe(paneBody, { childList: true });
    window.addEventListener('popstate', queueEnsure);
    queueEnsure();
})();
