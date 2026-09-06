// Optional GeoNames-backed autocomplete for Slice C place fields.
// Free-form text remains fully supported: selecting a suggestion enriches the place with
// country/geoname/coordinates, while simply typing and leaving the field stores the text.
(() => {
    if (window.__familyPlaceAutocompleteInstalled) return;
    window.__familyPlaceAutocompleteInstalled = true;

    const pane = document.getElementById('person-pane');
    if (!pane) return;

    const Metadata = window.FamilyPersonMetadata || {};
    const MIN_QUERY_LENGTH = 3;
    const DEBOUNCE_MS = 450;
    const clientCache = new Map();
    const resultsByMenu = new WeakMap();
    let timer = 0;
    let requestSerial = 0;
    let controller = null;
    let composing = false;
    let openMenu = null;

    const style = document.createElement('style');
    style.textContent = `
        #person-pane .person-pane-place {
            position: relative;
        }

        .person-place-suggestions {
            position: absolute;
            top: calc(100% + 4px);
            right: -7px;
            left: 22px;
            z-index: 260;
            overflow: hidden;
            border: 1px solid rgba(163, 177, 138, 0.34);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.99);
            box-shadow: 0 10px 24px rgba(52, 78, 65, 0.14);
            direction: rtl;
        }

        .person-place-suggestion {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            border: 0;
            border-bottom: 1px solid rgba(163, 177, 138, 0.16);
            background: transparent;
            color: #344e41;
            padding: 7px 9px;
            text-align: right;
            cursor: pointer;
        }

        .person-place-suggestion:hover,
        .person-place-suggestion:focus-visible {
            background: rgba(163, 177, 138, 0.13);
            outline: none;
        }

        .person-place-suggestion-flag {
            flex: 0 0 22px;
            font-size: 17px;
            text-align: center;
        }

        .person-place-suggestion-label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font: 500 11px/1.35 Inter, sans-serif;
        }

        .person-place-attribution {
            padding: 4px 9px 5px;
            color: #9aa19a;
            font: 400 8px/1.2 Inter, sans-serif;
            text-align: left;
            direction: ltr;
        }

        .person-place-attribution a {
            color: inherit;
            text-decoration: none;
        }

        .person-place-attribution a:hover {
            text-decoration: underline;
        }
    `;
    document.head.appendChild(style);

    function isPlaceEditor(target) {
        return target instanceof HTMLElement &&
            target.dataset.field === 'metadata' &&
            target.dataset.metaKind === 'place' &&
            !!target.dataset.metaKey;
    }

    function closeSuggestions() {
        if (openMenu) openMenu.remove();
        openMenu = null;
    }

    function placeFlag(editor) {
        return editor.parentElement?.querySelector('.person-pane-place-flag') || null;
    }

    function setFlag(editor, code) {
        const flag = placeFlag(editor);
        if (!flag) return;
        const normalized = String(code || '').trim().toUpperCase();
        flag.textContent = Metadata.flagEmoji?.(normalized) || '';
        flag.title = normalized
            ? (Metadata.countryName?.(normalized, document.documentElement.lang || 'he') || normalized)
            : '';
    }

    function storedPlace(editor) {
        const person = globalNodeMap?.get(editor.dataset.id);
        return person?.metadata?.[editor.dataset.metaKey] || null;
    }

    function syncStoredFlag(editor) {
        if (!isPlaceEditor(editor)) return;
        const place = storedPlace(editor);
        const code = Metadata.placeCountryCode?.(place) ||
            Metadata.inferCountryCode?.(editor.innerText.trim()) || null;
        setFlag(editor, code);
    }

    function syncAllStoredFlags() {
        pane.querySelectorAll('[data-field="metadata"][data-meta-kind="place"]')
            .forEach(syncStoredFlag);
    }

    function resultPlace(result) {
        const place = {
            text: String(result?.name || '').trim()
        };
        if (result?.countryCode) place.countryCode = String(result.countryCode).toUpperCase();
        if (Number.isFinite(Number(result?.geonameId))) place.geonameId = Number(result.geonameId);
        if (Number.isFinite(Number(result?.latitude))) place.latitude = Number(result.latitude);
        if (Number.isFinite(Number(result?.longitude))) place.longitude = Number(result.longitude);
        return place;
    }

    function chooseResult(editor, result) {
        const place = resultPlace(result);
        if (!place.text) return;

        editor.textContent = place.text;
        editor.dataset.placeSelection = JSON.stringify(place);
        setFlag(editor, place.countryCode || null);
        closeSuggestions();
        requestAnimationFrame(() => editor.blur());
    }

    function renderSuggestions(editor, results) {
        closeSuggestions();
        if (!Array.isArray(results) || !results.length || !document.contains(editor)) return;

        const menu = document.createElement('div');
        menu.className = 'person-place-suggestions';
        menu.setAttribute('role', 'listbox');
        resultsByMenu.set(menu, results);

        results.forEach((result, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'person-place-suggestion';
            button.dataset.placeResultIndex = String(index);
            button.setAttribute('role', 'option');

            const flag = document.createElement('span');
            flag.className = 'person-place-suggestion-flag';
            flag.textContent = Metadata.flagEmoji?.(result.countryCode) || '';

            const label = document.createElement('span');
            label.className = 'person-place-suggestion-label';
            label.textContent = result.label || result.name || '';

            button.appendChild(flag);
            button.appendChild(label);
            menu.appendChild(button);
        });

        const attribution = document.createElement('div');
        attribution.className = 'person-place-attribution';
        const link = document.createElement('a');
        link.href = 'https://www.geonames.org/';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'GeoNames';
        attribution.append('Places: ', link);
        menu.appendChild(attribution);

        editor.parentElement?.appendChild(menu);
        openMenu = menu;
    }

    async function requestSuggestions(editor, query) {
        const cacheKey = `${document.documentElement.lang || 'en'}:${query.toLocaleLowerCase()}`;
        if (clientCache.has(cacheKey)) {
            renderSuggestions(editor, clientCache.get(cacheKey));
            return;
        }

        controller?.abort();
        controller = new AbortController();
        const serial = ++requestSerial;
        try {
            const params = new URLSearchParams({
                q: query,
                lang: (document.documentElement.lang || 'en').slice(0, 12)
            });
            const response = await fetch(`/api/places?${params}`, {
                signal: controller.signal
            });
            if (!response.ok) return;
            const payload = await response.json();
            if (serial !== requestSerial || !document.contains(editor)) return;
            const results = Array.isArray(payload?.results) ? payload.results : [];
            clientCache.set(cacheKey, results);
            renderSuggestions(editor, results);
        } catch (error) {
            if (error?.name !== 'AbortError') console.warn('Place autocomplete unavailable:', error);
        }
    }

    function queueSuggestions(editor) {
        clearTimeout(timer);
        closeSuggestions();
        if (composing) return;

        const query = editor.innerText.trim().replace(/\s+/g, ' ');
        if (query.length < MIN_QUERY_LENGTH) return;
        timer = setTimeout(() => requestSuggestions(editor, query), DEBOUNCE_MS);
    }

    pane.addEventListener('compositionstart', event => {
        if (isPlaceEditor(event.target)) composing = true;
    });

    pane.addEventListener('compositionend', event => {
        if (!isPlaceEditor(event.target)) return;
        composing = false;
        delete event.target.dataset.placeSelection;
        queueSuggestions(event.target);
    });

    pane.addEventListener('input', event => {
        if (!isPlaceEditor(event.target)) return;
        delete event.target.dataset.placeSelection;
        queueSuggestions(event.target);
    });

    pane.addEventListener('focusin', event => {
        if (isPlaceEditor(event.target)) syncStoredFlag(event.target);
    });

    pane.addEventListener('focusout', event => {
        if (!isPlaceEditor(event.target)) return;
        setTimeout(() => {
            if (!openMenu?.contains(document.activeElement)) closeSuggestions();
        }, 80);
    });

    pane.addEventListener('pointerdown', event => {
        const button = event.target.closest?.('[data-place-result-index]');
        if (!button) return;
        const menu = button.closest('.person-place-suggestions');
        const results = resultsByMenu.get(menu) || [];
        const result = results[Number(button.dataset.placeResultIndex)];
        const editor = menu?.parentElement?.querySelector('[data-field="metadata"][data-meta-kind="place"]');
        if (!result || !editor) return;

        // Keep the contenteditable focused until the selected structured value has been
        // attached; blur immediately afterwards so the normal pane save path persists it.
        event.preventDefault();
        event.stopPropagation();
        chooseResult(editor, result);
    });

    const body = pane.querySelector('.person-pane-body');
    if (body) {
        new MutationObserver(() => requestAnimationFrame(syncAllStoredFlags))
            .observe(body, { childList: true, subtree: true });
    }

    window.addEventListener('family-person-pane-saved', () => requestAnimationFrame(syncAllStoredFlags));
    requestAnimationFrame(syncAllStoredFlags);
})();
