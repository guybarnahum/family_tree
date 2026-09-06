// Slice E manual face tagging. Face rectangles are normalized to the displayed image and
// persisted independently from media/person metadata so one photo can contain many faces.
(() => {
    if (window.__familyFaceTaggingInstalled) return;
    window.__familyFaceTaggingInstalled = true;

    const modal = document.getElementById('person-media-modal');
    const image = modal?.querySelector('.person-media-full');
    if (!modal || !image) return;

    const MIN_SIZE = 0.01;
    let mediaId = null;
    let faces = [];
    let people = [];
    let selectedFaceId = null;
    let drawMode = false;
    let operation = null;
    let activationSerial = 0;

    const style = document.createElement('style');
    style.textContent = `
        .face-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0 0 9px;
            direction: rtl;
        }
        .face-draw-button {
            border: 1px solid rgba(88,129,87,.28);
            border-radius: 999px;
            background: rgba(163,177,138,.10);
            color: #4f7650;
            padding: 7px 11px;
            font: 600 11px/1 Inter,sans-serif;
            cursor: pointer;
        }
        .face-draw-button.active {
            background: #588157;
            border-color: #588157;
            color: #fff;
        }
        .face-toolbar-hint {
            color: #8e978f;
            font: 400 10px/1.3 Inter,sans-serif;
        }
        .face-stage {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 80px;
            border-radius: 11px;
            background: #f4f5f1;
            overflow: hidden;
            touch-action: pan-y;
        }
        .face-stage .person-media-full {
            width: auto !important;
            max-width: 100% !important;
            max-height: 64vh;
            margin: 0 auto;
            background: transparent !important;
            border-radius: 0 !important;
        }
        .face-overlay {
            position: absolute;
            left: 0;
            top: 0;
            width: 0;
            height: 0;
            pointer-events: none;
            touch-action: none;
        }
        .face-overlay.drawing {
            pointer-events: auto;
            cursor: crosshair;
        }
        .face-box {
            position: absolute;
            box-sizing: border-box;
            border: 2px solid rgba(255,255,255,.96);
            outline: 2px solid rgba(52,78,65,.86);
            outline-offset: -1px;
            background: rgba(88,129,87,.06);
            cursor: move;
            pointer-events: auto;
            touch-action: none;
        }
        .face-box.selected {
            outline-color: #2f6b36;
            background: rgba(88,129,87,.13);
        }
        .face-box.preview {
            border-style: dashed;
            outline-color: #588157;
            pointer-events: none;
        }
        .face-label {
            position: absolute;
            right: -2px;
            top: calc(100% + 4px);
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding: 3px 6px;
            border-radius: 999px;
            background: rgba(52,78,65,.90);
            color: #fff;
            font: 600 9px/1 Inter,sans-serif;
            pointer-events: none;
        }
        .face-handle {
            position: absolute;
            width: 12px;
            height: 12px;
            border: 2px solid #fff;
            border-radius: 999px;
            background: #588157;
            box-shadow: 0 1px 3px rgba(0,0,0,.25);
        }
        .face-handle[data-handle="nw"] { left: -7px; top: -7px; cursor: nwse-resize; }
        .face-handle[data-handle="ne"] { right: -7px; top: -7px; cursor: nesw-resize; }
        .face-handle[data-handle="sw"] { left: -7px; bottom: -7px; cursor: nesw-resize; }
        .face-handle[data-handle="se"] { right: -7px; bottom: -7px; cursor: nwse-resize; }
        .face-editor {
            display: none;
            align-items: center;
            gap: 9px;
            margin: 10px 4px 0;
            padding: 9px 10px;
            border: 1px solid rgba(163,177,138,.25);
            border-radius: 10px;
            background: rgba(163,177,138,.07);
            direction: rtl;
        }
        .face-editor.open { display: flex; }
        .face-person-select {
            flex: 1 1 auto;
            min-width: 0;
            height: 34px;
            border: 1px solid rgba(88,129,87,.25);
            border-radius: 8px;
            background: #fff;
            color: #344e41;
            padding: 0 8px;
            font: 500 12px/1 Inter,sans-serif;
        }
        .face-delete {
            flex: 0 0 auto;
            border: 0;
            border-radius: 999px;
            background: rgba(148,67,67,.09);
            color: #8d4a4a;
            padding: 8px 10px;
            font: 600 10px/1 Inter,sans-serif;
            cursor: pointer;
        }
        @media (max-width: 640px) {
            .face-stage .person-media-full { max-height: 48vh; }
            .face-toolbar { align-items: flex-start; }
            .face-toolbar-hint { flex: 1 1 auto; }
            .face-editor { align-items: stretch; flex-direction: column; }
            .face-person-select { width: 100%; flex-basis: 38px; }
            .face-delete { align-self: flex-start; }
        }
        @media print { .face-toolbar, .face-overlay, .face-editor { display: none !important; } }
    `;
    document.head.appendChild(style);

    const toolbar = document.createElement('div');
    toolbar.className = 'face-toolbar';
    toolbar.innerHTML = `
        <button type="button" class="face-draw-button">סמן פנים</button>
        <span class="face-toolbar-hint">גרור מסגרת סביב פנים; לחץ על מסגרת כדי לזהות אדם</span>
    `;

    const stage = document.createElement('div');
    stage.className = 'face-stage';
    image.parentElement.insertBefore(toolbar, image);
    image.parentElement.insertBefore(stage, image);
    stage.appendChild(image);

    const overlay = document.createElement('div');
    overlay.className = 'face-overlay';
    stage.appendChild(overlay);

    const editor = document.createElement('div');
    editor.className = 'face-editor';
    editor.innerHTML = `
        <select class="face-person-select" aria-label="זהה אדם בתמונה"></select>
        <button type="button" class="face-delete">מחק סימון</button>
    `;
    stage.after(editor);

    const drawButton = toolbar.querySelector('.face-draw-button');
    const personSelect = editor.querySelector('.face-person-select');
    const deleteButton = editor.querySelector('.face-delete');

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
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

    function personName(personId) {
        if (!personId) return 'לא מזוהה';
        return people.find(person => person.id === personId)?.name || 'אדם לא זמין';
    }

    function selectedFace() {
        return faces.find(face => face.id === selectedFaceId) || null;
    }

    function syncOverlayGeometry() {
        if (!image.isConnected || !stage.isConnected) return;
        const stageRect = stage.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        if (!imageRect.width || !imageRect.height) return;
        overlay.style.left = `${imageRect.left - stageRect.left}px`;
        overlay.style.top = `${imageRect.top - stageRect.top}px`;
        overlay.style.width = `${imageRect.width}px`;
        overlay.style.height = `${imageRect.height}px`;
    }

    function applyBoxGeometry(box, face) {
        box.style.left = `${face.x * 100}%`;
        box.style.top = `${face.y * 100}%`;
        box.style.width = `${face.width * 100}%`;
        box.style.height = `${face.height * 100}%`;
    }

    function populatePeople() {
        const selected = selectedFace();
        const previous = selected?.personId || '';
        personSelect.innerHTML = '';

        const unknown = document.createElement('option');
        unknown.value = '';
        unknown.textContent = 'לא מזוהה';
        personSelect.appendChild(unknown);

        const sorted = [...people].sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), document.documentElement.lang || 'he') ||
            a.id.localeCompare(b.id)
        );
        for (const person of sorted) {
            const option = document.createElement('option');
            option.value = person.id;
            option.textContent = person.name || 'ללא שם';
            personSelect.appendChild(option);
        }

        if (previous && !people.some(person => person.id === previous)) {
            const missing = document.createElement('option');
            missing.value = previous;
            missing.textContent = `אדם לא זמין (${previous})`;
            personSelect.appendChild(missing);
        }
        personSelect.value = previous;
    }

    function renderEditor() {
        const face = selectedFace();
        editor.classList.toggle('open', !!face);
        if (!face) return;
        populatePeople();
    }

    function renderFaces() {
        overlay.querySelectorAll('.face-box').forEach(box => box.remove());
        for (const face of faces) {
            const box = document.createElement('div');
            box.className = `face-box${face.id === selectedFaceId ? ' selected' : ''}`;
            box.dataset.faceId = face.id;
            applyBoxGeometry(box, face);

            const label = document.createElement('span');
            label.className = 'face-label';
            label.textContent = personName(face.personId);
            box.appendChild(label);

            if (face.id === selectedFaceId) {
                for (const handle of ['nw', 'ne', 'sw', 'se']) {
                    const node = document.createElement('span');
                    node.className = 'face-handle';
                    node.dataset.handle = handle;
                    box.appendChild(node);
                }
            }
            overlay.appendChild(box);
        }
        renderEditor();
    }

    async function loadPeople() {
        if (people.length) return;
        const response = await fetch('/api/graph', { cache: 'no-store' });
        if (!response.ok) throw new Error(await response.text());
        const graph = await response.json();
        people = Array.isArray(graph.people) ? graph.people.map(person => ({ id: person.id, name: person.name })) : [];
    }

    async function loadFaces(id, serial) {
        const response = await fetch(`/api/faces?media=${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(await response.text());
        const payload = await response.json();
        if (serial !== activationSerial || id !== mediaId) return;
        faces = Array.isArray(payload.items) ? payload.items : [];
        if (!faces.some(face => face.id === selectedFaceId)) selectedFaceId = null;
        renderFaces();
    }

    async function activate() {
        if (!modal.classList.contains('open')) return;
        const id = currentMediaId();
        if (!id) return;
        mediaId = id;
        const serial = ++activationSerial;
        selectedFaceId = null;
        setDrawMode(false);
        syncOverlayGeometry();
        try {
            await Promise.all([loadPeople(), loadFaces(id, serial)]);
            if (serial === activationSerial) renderFaces();
        } catch (error) {
            console.warn('Unable to load face tags:', error);
        }
    }

    function deactivate() {
        activationSerial += 1;
        mediaId = null;
        faces = [];
        selectedFaceId = null;
        operation = null;
        setDrawMode(false);
        renderFaces();
    }

    function setDrawMode(enabled) {
        drawMode = !!enabled;
        drawButton.classList.toggle('active', drawMode);
        overlay.classList.toggle('drawing', drawMode);
        drawButton.textContent = drawMode ? 'בטל סימון' : 'סמן פנים';
    }

    function pointFromEvent(event) {
        const rect = overlay.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
            y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
        };
    }

    function normalizeDraft(a, b) {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        return {
            x,
            y,
            width: Math.abs(b.x - a.x),
            height: Math.abs(b.y - a.y)
        };
    }

    async function createFace(rect) {
        if (!mediaId || rect.width < MIN_SIZE || rect.height < MIN_SIZE) return;
        try {
            const response = await fetch('/api/faces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mediaId, ...rect })
            });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            faces.push(payload.item);
            selectedFaceId = payload.item.id;
            setDrawMode(false);
            renderFaces();
            showStatus('סימון הפנים נשמר');
        } catch (error) {
            console.error('Unable to create face tag:', error);
            showStatus('שגיאה בשמירת סימון הפנים');
        }
    }

    async function saveRect(face, before) {
        try {
            const response = await fetch(`/api/faces/${encodeURIComponent(face.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rect: {
                    x: face.x, y: face.y, width: face.width, height: face.height
                } })
            });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            Object.assign(face, payload.item || {});
        } catch (error) {
            Object.assign(face, before);
            renderFaces();
            console.error('Unable to update face rectangle:', error);
            showStatus('שגיאה בשמירת מסגרת הפנים');
        }
    }

    function resizedRect(start, handle, dx, dy) {
        let left = start.x;
        let top = start.y;
        let right = start.x + start.width;
        let bottom = start.y + start.height;

        if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_SIZE);
        if (handle.includes('e')) right = clamp(right + dx, left + MIN_SIZE, 1);
        if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SIZE);
        if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, 1);
        return { x: left, y: top, width: right - left, height: bottom - top };
    }

    drawButton.addEventListener('click', () => {
        selectedFaceId = null;
        renderFaces();
        setDrawMode(!drawMode);
    });

    overlay.addEventListener('pointerdown', event => {
        const point = pointFromEvent(event);
        if (!point) return;

        const box = event.target.closest('.face-box');
        if (box) {
            event.preventDefault();
            event.stopPropagation();
            const face = faces.find(item => item.id === box.dataset.faceId);
            if (!face) return;
            selectedFaceId = face.id;
            setDrawMode(false);
            renderFaces();

            const handle = event.target.closest('.face-handle')?.dataset.handle || null;
            operation = {
                kind: handle ? 'resize' : 'move',
                handle,
                pointerId: event.pointerId,
                startPoint: point,
                before: { x: face.x, y: face.y, width: face.width, height: face.height },
                faceId: face.id
            };
            overlay.setPointerCapture?.(event.pointerId);
            return;
        }

        if (!drawMode) {
            selectedFaceId = null;
            renderFaces();
            return;
        }

        event.preventDefault();
        const preview = document.createElement('div');
        preview.className = 'face-box preview';
        overlay.appendChild(preview);
        operation = {
            kind: 'draw',
            pointerId: event.pointerId,
            startPoint: point,
            preview
        };
        overlay.setPointerCapture?.(event.pointerId);
    });

    overlay.addEventListener('pointermove', event => {
        if (!operation || operation.pointerId !== event.pointerId) return;
        const point = pointFromEvent(event);
        if (!point) return;

        if (operation.kind === 'draw') {
            const draft = normalizeDraft(operation.startPoint, point);
            applyBoxGeometry(operation.preview, draft);
            return;
        }

        const face = faces.find(item => item.id === operation.faceId);
        if (!face) return;
        const dx = point.x - operation.startPoint.x;
        const dy = point.y - operation.startPoint.y;
        const next = operation.kind === 'resize'
            ? resizedRect(operation.before, operation.handle, dx, dy)
            : {
                ...operation.before,
                x: clamp(operation.before.x + dx, 0, 1 - operation.before.width),
                y: clamp(operation.before.y + dy, 0, 1 - operation.before.height)
            };
        Object.assign(face, next);
        const box = overlay.querySelector(`[data-face-id="${face.id}"]`);
        if (box) applyBoxGeometry(box, face);
    });

    overlay.addEventListener('pointerup', event => {
        if (!operation || operation.pointerId !== event.pointerId) return;
        const point = pointFromEvent(event);
        const finished = operation;
        operation = null;
        try { overlay.releasePointerCapture?.(event.pointerId); } catch (_) {}

        if (finished.kind === 'draw') {
            finished.preview?.remove();
            if (point) void createFace(normalizeDraft(finished.startPoint, point));
            return;
        }

        const face = faces.find(item => item.id === finished.faceId);
        if (!face) return;
        const changed = ['x', 'y', 'width', 'height'].some(key =>
            Math.abs(face[key] - finished.before[key]) > 0.000001
        );
        if (changed) void saveRect(face, finished.before);
    });

    overlay.addEventListener('pointercancel', () => {
        if (!operation) return;
        if (operation.kind === 'draw') operation.preview?.remove();
        else {
            const face = faces.find(item => item.id === operation.faceId);
            if (face) Object.assign(face, operation.before);
        }
        operation = null;
        renderFaces();
    });

    personSelect.addEventListener('change', async () => {
        const face = selectedFace();
        if (!face) return;
        const original = face.personId || null;
        const personId = personSelect.value || null;
        if (personId === original) return;
        try {
            const response = await fetch(`/api/faces/${encodeURIComponent(face.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personId })
            });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            Object.assign(face, payload.item || {});
            renderFaces();
            showStatus('זיהוי הפנים נשמר');
        } catch (error) {
            personSelect.value = original || '';
            console.error('Unable to assign face:', error);
            showStatus('שגיאה בזיהוי הפנים');
        }
    });

    deleteButton.addEventListener('click', async () => {
        const face = selectedFace();
        if (!face) return;
        try {
            const response = await fetch(`/api/faces/${encodeURIComponent(face.id)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await response.text());
            faces = faces.filter(item => item.id !== face.id);
            selectedFaceId = null;
            renderFaces();
            showStatus('סימון הפנים נמחק');
        } catch (error) {
            console.error('Unable to delete face tag:', error);
            showStatus('שגיאה במחיקת סימון הפנים');
        }
    });

    image.addEventListener('load', () => {
        syncOverlayGeometry();
        if (modal.classList.contains('open')) void activate();
    });
    window.addEventListener('resize', syncOverlayGeometry, { passive: true });
    window.visualViewport?.addEventListener('resize', syncOverlayGeometry, { passive: true });

    new MutationObserver(() => {
        if (modal.classList.contains('open')) requestAnimationFrame(() => void activate());
        else deactivate();
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });

    if (modal.classList.contains('open')) void activate();
})();
