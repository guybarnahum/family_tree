// Slice E UX refinement: drawing directly on the photo creates a face rectangle, and
// person assignment uses name search while preserving the core face-tagging API/state.
(() => {
    if (window.__familyFaceTaggingUxInstalled) return;
    window.__familyFaceTaggingUxInstalled = true;

    const modal = document.getElementById('person-media-modal');
    const overlay = modal?.querySelector('.face-overlay');
    const editor = modal?.querySelector('.face-editor');
    const drawButton = modal?.querySelector('.face-draw-button');
    const personSelect = modal?.querySelector('.face-person-select');
    const hint = modal?.querySelector('.face-toolbar-hint');
    if (!modal || !overlay || !editor || !drawButton || !personSelect) return;

    const style = document.createElement('style');
    style.textContent = `
        /* Drawing is always available directly on empty image space; no explicit mode UI. */
        .face-draw-button { display: none !important; }
        .face-overlay {
            pointer-events: auto !important;
            cursor: crosshair;
        }
        .face-box { cursor: move; }

        /* Keep the native select only as the persistence bridge used by face-tagging.js. */
        .face-person-select {
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            padding: 0 !important;
            margin: -1px !important;
            border: 0 !important;
            opacity: 0 !important;
            overflow: hidden !important;
            pointer-events: none !important;
        }
        .face-person-search-wrap {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
        }
        .face-person-search {
            width: 100%;
            height: 36px;
            box-sizing: border-box;
            border: 1px solid rgba(88,129,87,.25);
            border-radius: 8px;
            background: #fff;
            color: #344e41;
            padding: 0 10px;
            font: 500 12px/1 Inter,sans-serif;
            outline: none;
        }
        .face-person-search:focus {
            border-color: rgba(88,129,87,.55);
            box-shadow: 0 0 0 2px rgba(88,129,87,.09);
        }
        .face-person-results {
            position: absolute;
            top: calc(100% + 5px);
            right: 0;
            left: 0;
            z-index: 10020;
            display: none;
            max-height: 220px;
            overflow: auto;
            padding: 5px;
            border: 1px solid rgba(163,177,138,.30);
            border-radius: 9px;
            background: rgba(255,255,255,.99);
            box-shadow: 0 10px 24px rgba(52,78,65,.16);
        }
        .face-person-results.open { display: block; }
        .face-person-result {
            display: block;
            width: 100%;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: #344e41;
            padding: 8px 9px;
            text-align: right;
            font: 500 12px/1.25 Inter,sans-serif;
            cursor: pointer;
        }
        .face-person-result:hover,
        .face-person-result:focus-visible {
            background: rgba(163,177,138,.14);
            outline: none;
        }
        .face-person-result.unknown { color: #7c887d; }
        .face-person-no-results {
            padding: 8px 9px;
            color: #929b93;
            font: 400 11px/1.3 Inter,sans-serif;
        }
        @media (max-width: 640px) {
            .face-person-search-wrap { width: 100%; }
            .face-person-results { max-height: 180px; }
        }
    `;
    document.head.appendChild(style);

    if (hint) hint.textContent = 'גרור ישירות מסגרת סביב פנים; לחץ על מסגרת כדי לזהות אדם';

    // face-tagging.js owns the actual draw operation. Turn its draw mode on just before an
    // empty-image pointerdown reaches that listener, then turn it back off after the gesture.
    let emptyPointerId = null;
    overlay.addEventListener('pointerdown', event => {
        if (event.target.closest('.face-box')) return;
        emptyPointerId = event.pointerId;
        if (!drawButton.classList.contains('active')) drawButton.click();
    }, true);

    function finishDirectDraw(event) {
        if (emptyPointerId !== event.pointerId) return;
        emptyPointerId = null;
        // The core pointerup handler has already captured the draft by the time this task runs.
        // Turning mode off here also cleans up tiny click-without-drag gestures.
        setTimeout(() => {
            if (drawButton.classList.contains('active')) drawButton.click();
        }, 0);
    }
    overlay.addEventListener('pointerup', finishDirectDraw, true);
    overlay.addEventListener('pointercancel', finishDirectDraw, true);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'face-person-search-wrap';
    searchWrap.innerHTML = `
        <input type="search" class="face-person-search" placeholder="חפש אדם…" autocomplete="off" aria-label="חפש אדם לזיהוי הפנים">
        <div class="face-person-results" role="listbox"></div>
    `;
    personSelect.before(searchWrap);

    const input = searchWrap.querySelector('.face-person-search');
    const results = searchWrap.querySelector('.face-person-results');

    function normalized(value) {
        return String(value || '').trim().toLocaleLowerCase(document.documentElement.lang || undefined);
    }

    function selectOptions() {
        return [...personSelect.options].map(option => ({
            id: option.value,
            label: option.textContent?.trim() || ''
        }));
    }

    function assignedLabel() {
        const option = personSelect.selectedOptions?.[0];
        return option?.value ? (option.textContent?.trim() || '') : '';
    }

    function syncSearchFromSelection() {
        if (document.activeElement !== input) input.value = assignedLabel();
    }

    function closeResults() {
        results.classList.remove('open');
        results.innerHTML = '';
    }

    function assign(id) {
        personSelect.value = id || '';
        personSelect.dispatchEvent(new Event('change', { bubbles: true }));
        const option = [...personSelect.options].find(item => item.value === (id || ''));
        input.value = id ? (option?.textContent?.trim() || '') : '';
        closeResults();
    }

    function renderResults() {
        const query = normalized(input.value);
        const options = selectOptions();
        const people = options
            .filter(option => option.id)
            .filter(option => !query || normalized(option.label).includes(query))
            .slice(0, 10);

        results.innerHTML = '';

        if (!query) {
            const unknown = document.createElement('button');
            unknown.type = 'button';
            unknown.className = 'face-person-result unknown';
            unknown.dataset.personId = '';
            unknown.textContent = 'לא מזוהה';
            results.appendChild(unknown);
        }

        for (const person of people) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'face-person-result';
            button.dataset.personId = person.id;
            button.textContent = person.label;
            results.appendChild(button);
        }

        if (!results.children.length) {
            const empty = document.createElement('div');
            empty.className = 'face-person-no-results';
            empty.textContent = 'לא נמצאו אנשים';
            results.appendChild(empty);
        }
        results.classList.add('open');
    }

    input.addEventListener('focus', renderResults);
    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeResults();
            input.blur();
            return;
        }
        if (event.key !== 'Enter') return;
        const first = results.querySelector('.face-person-result');
        if (!first) return;
        event.preventDefault();
        assign(first.dataset.personId || '');
    });

    results.addEventListener('mousedown', event => event.preventDefault());
    results.addEventListener('click', event => {
        const choice = event.target.closest('.face-person-result');
        if (!choice) return;
        assign(choice.dataset.personId || '');
    });

    document.addEventListener('pointerdown', event => {
        if (!searchWrap.contains(event.target)) closeResults();
    }, true);

    // The core editor repopulates the hidden select each time a face is selected.
    new MutationObserver(() => {
        syncSearchFromSelection();
        if (document.activeElement === input) renderResults();
    }).observe(personSelect, { childList: true, subtree: true, attributes: true });

    new MutationObserver(() => {
        if (editor.classList.contains('open')) syncSearchFromSelection();
        else {
            input.value = '';
            closeResults();
        }
    }).observe(editor, { attributes: true, attributeFilter: ['class'] });

    personSelect.addEventListener('change', () => requestAnimationFrame(syncSearchFromSelection));
    syncSearchFromSelection();
})();
