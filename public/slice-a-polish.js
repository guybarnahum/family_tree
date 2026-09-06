// Person-pane interaction polish shared by Slice A-C:
// - desktop pane starts directly with the editable name
// - pane blur saves only when a value actually changed
// - metadata edits never relayout the graph
// - name edits relayout once because only name can change graph-card geometry
// - title subtitle remains a generic navigation hint and search stays an empty search box
(() => {
    if (window.__familySliceAPolishInstalled) return;
    window.__familySliceAPolishInstalled = true;

    const pane = document.getElementById('person-pane');
    const cardsLayer = document.getElementById('cards-layer');
    if (!pane || !cardsLayer) return;

    const Metadata = window.FamilyPersonMetadata || {
        metadataObject: value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
        withField(metadata, key, value) {
            const next = { ...(metadata || {}) };
            const text = String(value ?? '').trim();
            if (text) next[key] = text;
            else delete next[key];
            return next;
        }
    };

    const style = document.createElement('style');
    style.textContent = `
        .person-pane-kicker { display: none !important; }

        @media (min-width: 769px) and (hover: hover) and (pointer: fine) {
            #person-pane .person-pane-handle {
                display: none !important;
            }

            #person-pane .person-pane-body {
                height: 100% !important;
                padding-top: 18px !important;
            }
        }
    `;
    document.head.appendChild(style);

    const originalValues = new WeakMap();
    const NAV_HINT = 'דורות של אהבה • גרור כדי לנווט';

    function editableTarget(target) {
        return target instanceof HTMLElement &&
            target.hasAttribute('contenteditable') &&
            target.dataset.id && target.dataset.field;
    }

    function fieldValue(element) {
        return element.innerText.trim();
    }

    function rootCardName(id) {
        return document.getElementById(`card-${id}`)?.querySelector('h2[data-field="name"]') || null;
    }

    function localPerson(id) {
        return globalNodeMap?.get(id) || null;
    }

    function metadataFor(person) {
        return Metadata.metadataObject(person?.metadata);
    }

    function restoreNamePresentation(id, value) {
        const cardName = rootCardName(id);
        if (cardName) cardName.textContent = value || 'שם';
        const mobileName = pane.querySelector('.person-pane-mobile-name');
        if (mobileName) mobileName.textContent = value || 'ללא שם';
    }

    function relayoutNameChange(id) {
        if (!globalNodes?.length) return;
        const anchor = typeof captureAnchor === 'function' ? captureAnchor(id) : null;
        requestAnimationFrame(() => {
            try {
                layoutAndRender();
                if (anchor && typeof restoreAnchor === 'function') {
                    requestAnimationFrame(() => restoreAnchor(anchor));
                }
            } catch (error) {
                console.warn('Unable to reflow graph after name edit:', error);
            }
        });
    }

    async function savePaneField(element, original) {
        const id = element.dataset.id;
        const field = element.dataset.field;
        const metadataKey = element.dataset.metaKey || null;
        const metadataKind = element.dataset.metaKind || 'text';
        const value = fieldValue(element);
        if (value === original) return;

        const person = localPerson(id);
        const priorMetadata = metadataFor(person);
        let payload;
        let nextMetadata = null;

        if (field === 'metadata') {
            if (!metadataKey) return;
            nextMetadata = Metadata.withField(priorMetadata, metadataKey, value, metadataKind);
            payload = { metadata: nextMetadata };
        } else {
            payload = { [field]: value };
        }

        showStatus('שומר...');
        try {
            const response = await fetch(`/api/nodes/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(await response.text());

            if (person) {
                if (field === 'metadata') person.metadata = nextMetadata;
                else person[field] = value;
            }

            originalValues.set(element, value);
            element.dataset.personPaneSavedValue = value;

            if (field === 'name') {
                restoreNamePresentation(id, value);
                relayoutNameChange(id);
            }

            window.dispatchEvent(new CustomEvent('family-person-pane-saved', {
                detail: field === 'metadata'
                    ? { id, field, key: metadataKey, kind: metadataKind, value, metadata: nextMetadata }
                    : { id, field, value }
            }));
            showStatus('נשמר בהצלחה');
        } catch (error) {
            console.error('Failed to save person detail:', error);
            element.textContent = original;
            if (person) {
                if (field === 'metadata') person.metadata = priorMetadata;
                else person[field] = original;
            }
            if (field === 'name') restoreNamePresentation(id, original);
            showStatus('שגיאה בשמירה');
        }
    }

    pane.addEventListener('focusin', event => {
        if (!editableTarget(event.target)) return;
        originalValues.set(event.target, fieldValue(event.target));
    }, true);

    // Stop pane blur before the legacy body-level saveEdit() handler sees it. Metadata is
    // deliberately independent of graph geometry, and unchanged focus/blur is a true no-op.
    pane.addEventListener('focusout', event => {
        if (!editableTarget(event.target)) return;
        event.stopPropagation();
        if (typeof isEditing !== 'undefined') isEditing = false;
        const original = originalValues.get(event.target) ?? fieldValue(event.target);
        void savePaneField(event.target, original);
    }, true);

    function cleanHeaderChrome() {
        const titleCard = document.querySelector('.family-title-card') || document.querySelector('h1')?.parentElement;
        const subtitle = titleCard?.querySelector('p');
        if (subtitle && subtitle.textContent !== NAV_HINT) subtitle.textContent = NAV_HINT;

        const search = document.querySelector('.graph-search-input');
        if (search && document.activeElement !== search && search.value) search.value = '';
    }

    let cleanFrame = 0;
    function queueChromeCleanup() {
        if (cleanFrame) cancelAnimationFrame(cleanFrame);
        cleanFrame = requestAnimationFrame(() => {
            cleanFrame = 0;
            cleanHeaderChrome();
        });
    }

    const titleCard = document.querySelector('.family-title-card') || document.querySelector('h1')?.parentElement;
    if (titleCard) {
        new MutationObserver(queueChromeCleanup).observe(titleCard, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }
    new MutationObserver(queueChromeCleanup).observe(cardsLayer, { childList: true });
    window.addEventListener('popstate', queueChromeCleanup);
    window.addEventListener('family-person-pane-saved', queueChromeCleanup);

    queueChromeCleanup();
    setTimeout(queueChromeCleanup, 80);
})();
