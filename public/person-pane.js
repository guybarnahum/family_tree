// Selected-person details pane. Graph cards remain topology-only; biographical fields
// are backed by nodes.metadata_json (Slice B) while name remains a first-class column.
(() => {
    if (window.__familyPersonPaneInstalled) return;
    window.__familyPersonPaneInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const viewport = document.getElementById('scroll-viewport');
    if (!cardsLayer || !viewport) return;

    const EMPTY_NAMES = new Set(['', 'שם']);
    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');

    const style = document.createElement('style');
    style.textContent = `
        #cards-layer .absolute-card {
            padding: 11px 14px !important;
        }

        #cards-layer .absolute-card h2[data-field="name"] {
            margin: 0 !important;
            min-height: 28px !important;
            transform: none !important;
            text-align: center !important;
            cursor: pointer !important;
            user-select: none;
        }

        #cards-layer .absolute-card h2[data-field="name"].default-node-text {
            opacity: 1 !important;
            color: #9aa39a !important;
        }

        #cards-layer .absolute-card p[data-field="dates"],
        #cards-layer .absolute-card p[data-field="description"],
        #cards-layer .absolute-card .graph-select-zone {
            display: none !important;
        }

        #cards-layer .absolute-card.graph-root [data-action] {
            opacity: 1 !important;
            pointer-events: auto !important;
        }

        #person-pane {
            direction: rtl;
            position: fixed;
            z-index: 180;
            color: #344e41;
            background: rgba(255, 255, 255, 0.94);
            border: 1px solid rgba(163, 177, 138, 0.38);
            box-shadow: 0 18px 44px rgba(52, 78, 65, 0.14);
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
        }

        .person-pane-handle {
            width: 100%;
            border: 0;
            background: transparent;
            color: inherit;
            padding: 0;
            text-align: right;
        }

        .person-pane-header {
            min-height: 58px;
            padding: 13px 16px 11px;
            border-bottom: 1px solid rgba(163, 177, 138, 0.24);
        }

        .person-pane-kicker {
            display: block;
            font: 600 9px/1.2 Inter, sans-serif;
            color: #8a968b;
            letter-spacing: 0.08em;
            margin-bottom: 3px;
        }

        .person-pane-mobile-name {
            display: block;
            font: 700 18px/1.15 "Frank Ruhl Libre", serif;
            color: #344e41;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .person-pane-chevron {
            display: none;
            position: absolute;
            left: 17px;
            top: 20px;
            font: 600 15px/1 Inter, sans-serif;
            color: #718071;
            transition: transform 0.18s ease;
        }

        .person-pane-body {
            padding: 18px 18px 24px;
            overflow: auto;
            height: calc(100% - 58px);
        }

        .person-pane-name {
            font: 700 30px/1.08 "Frank Ruhl Libre", serif;
            color: #344e41;
            padding: 3px 5px 5px;
            margin: 0 -5px 20px;
            border-radius: 7px;
            min-height: 38px;
        }

        .person-pane-field {
            margin-bottom: 18px;
        }

        .person-pane-label {
            display: block;
            margin-bottom: 5px;
            font: 600 10px/1.3 Inter, sans-serif;
            color: #7c8a7d;
            letter-spacing: 0.025em;
        }

        .person-pane-value {
            min-height: 28px;
            padding: 6px 7px;
            margin: 0 -7px;
            border-radius: 7px;
            font: 400 14px/1.5 Inter, sans-serif;
            color: #37423a;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .person-pane-value.person-pane-bio {
            min-height: 62px;
        }

        .person-pane-name:hover,
        .person-pane-name:focus,
        .person-pane-value:hover,
        .person-pane-value:focus {
            background: rgba(163, 177, 138, 0.12);
            outline: none;
        }

        .person-pane-value:empty::before,
        .person-pane-name:empty::before {
            content: attr(data-placeholder);
            color: #a4aaa4;
            pointer-events: none;
        }

        .person-pane-additions {
            display: flex;
            flex-wrap: wrap;
            gap: 7px;
            padding-top: 2px;
        }

        .person-pane-add {
            border: 1px solid rgba(88, 129, 87, 0.24);
            border-radius: 999px;
            background: rgba(163, 177, 138, 0.09);
            color: #588157;
            padding: 5px 9px;
            font: 600 10px/1.2 Inter, sans-serif;
            cursor: pointer;
        }

        .person-pane-add:hover,
        .person-pane-add:focus-visible {
            background: rgba(163, 177, 138, 0.18);
            outline: none;
        }

        .person-pane-empty {
            color: #8c968d;
            font: 400 12px/1.5 Inter, sans-serif;
        }

        @media (min-width: 769px) and (hover: hover) and (pointer: fine) {
            #person-pane {
                top: 108px;
                right: 14px;
                bottom: 14px;
                width: 356px;
                border-radius: 15px;
            }

            #person-pane .person-pane-handle {
                cursor: default;
                pointer-events: none;
            }

            #scroll-viewport {
                width: calc(100vw - 384px) !important;
                margin-right: 384px !important;
            }
        }

        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            #person-pane {
                left: 8px;
                right: 8px;
                bottom: 0;
                height: min(62vh, 520px);
                border-radius: 16px 16px 0 0;
                transform: translateY(calc(100% - 58px));
                transition: transform 0.20s cubic-bezier(0.2, 0.8, 0.2, 1);
            }

            #person-pane.person-pane-open {
                transform: translateY(0);
            }

            #person-pane .person-pane-handle {
                cursor: pointer;
                position: relative;
            }

            #person-pane .person-pane-chevron {
                display: block;
            }

            #person-pane.person-pane-open .person-pane-chevron {
                transform: rotate(180deg);
            }

            #person-pane .person-pane-body {
                padding: 14px 16px 30px;
            }

            #person-pane .person-pane-name {
                font-size: 27px;
            }

            #scroll-viewport {
                width: 100vw !important;
                margin-right: 0 !important;
                padding-bottom: 58px;
            }

            #cards-layer .absolute-card.graph-root {
                min-width: min(190px, calc(100vw - 44px)) !important;
                width: auto !important;
                max-width: min(226px, calc(100vw - 32px)) !important;
                padding: 12px 14px !important;
            }
        }

        @media print {
            #person-pane { display: none !important; }
        }
    `;
    document.head.appendChild(style);

    const pane = document.createElement('aside');
    pane.id = 'person-pane';
    pane.setAttribute('aria-label', 'פרטי האדם הנבחר');
    pane.innerHTML = `
        <button type="button" class="person-pane-handle" aria-expanded="false">
            <div class="person-pane-header">
                <span class="person-pane-kicker">פרטי אדם</span>
                <span class="person-pane-mobile-name">—</span>
                <span class="person-pane-chevron">⌃</span>
            </div>
        </button>
        <div class="person-pane-body"></div>
    `;
    document.body.appendChild(pane);

    const body = pane.querySelector('.person-pane-body');
    const handle = pane.querySelector('.person-pane-handle');
    const mobileName = pane.querySelector('.person-pane-mobile-name');
    let renderedPersonId = null;
    let relayoutQueued = false;

    function cleanName(value) {
        const text = String(value ?? '').trim();
        return EMPTY_NAMES.has(text) ? '' : text;
    }

    function cleanMetadataText(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function currentRootId() {
        const card = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        if (card?.dataset.nodeId) return card.dataset.nodeId;
        const urlId = new URL(window.location.href).searchParams.get('person');
        if (urlId) return urlId;
        try { return localStorage.getItem('family-tree.anchor-person'); }
        catch (_) { return null; }
    }

    function currentPerson() {
        const id = currentRootId();
        if (!id) return null;
        return globalNodeMap?.get(id) || null;
    }

    function metadataForPerson(person) {
        if (!person) return {};
        if (Object.prototype.hasOwnProperty.call(person, 'metadata')) {
            return person.metadata && typeof person.metadata === 'object' && !Array.isArray(person.metadata)
                ? person.metadata
                : {};
        }

        // Compatibility only for a stale pre-Slice-B in-memory person. Once metadata is
        // present—even as {}—it is authoritative and legacy text is not reintroduced.
        const metadata = {};
        const dates = cleanMetadataText(person.dates);
        const description = cleanMetadataText(person.description);
        if (dates && dates !== 'תאריכים') metadata.lifeDates = dates;
        if (description && description !== 'תיאור') metadata.bio = description;
        person.metadata = metadata;
        return metadata;
    }

    function editable(field, value, { className = '', placeholder = '', metadataKey = null } = {}) {
        const personId = currentRootId();
        const element = document.createElement('div');
        element.className = `person-pane-value ${className}`.trim();
        element.contentEditable = 'true';
        element.spellcheck = true;
        element.dataset.id = personId || '';
        element.dataset.field = field;
        if (metadataKey) element.dataset.metaKey = metadataKey;
        element.dataset.placeholder = placeholder;
        element.textContent = value;
        return element;
    }

    function addField(metadataKey) {
        const person = currentPerson();
        if (!person) return;
        const metadata = { ...metadataForPerson(person) };
        if (!Object.prototype.hasOwnProperty.call(metadata, metadataKey)) metadata[metadataKey] = '';
        person.metadata = metadata;
        renderPerson({ focusField: metadataKey });
    }

    function fieldRow(label, metadataKey, value, { className = '', placeholder = '' } = {}) {
        const row = document.createElement('section');
        row.className = 'person-pane-field';
        const heading = document.createElement('span');
        heading.className = 'person-pane-label';
        heading.textContent = label;
        row.appendChild(heading);
        row.appendChild(editable('metadata', value, { className, placeholder, metadataKey }));
        return row;
    }

    function renderPerson({ focusField = null } = {}) {
        const person = currentPerson();
        renderedPersonId = person?.id || null;
        body.innerHTML = '';

        if (!person) {
            mobileName.textContent = 'עץ המשפחה';
            const empty = document.createElement('p');
            empty.className = 'person-pane-empty';
            empty.textContent = 'בחרו אדם בעץ כדי לראות ולערוך את פרטיו.';
            body.appendChild(empty);
            return;
        }

        const metadata = metadataForPerson(person);
        const nameValue = cleanName(person.name);
        const lifeDatesValue = cleanMetadataText(metadata.lifeDates);
        const bioValue = cleanMetadataText(metadata.bio);
        mobileName.textContent = nameValue || 'ללא שם';

        const name = document.createElement('div');
        name.className = 'person-pane-name';
        name.contentEditable = 'true';
        name.spellcheck = true;
        name.dataset.id = person.id;
        name.dataset.field = 'name';
        name.dataset.placeholder = 'שם';
        name.textContent = nameValue;
        body.appendChild(name);

        if (lifeDatesValue || focusField === 'lifeDates') {
            body.appendChild(fieldRow('תאריכים', 'lifeDates', lifeDatesValue, {
                placeholder: 'שנה, טווח או תיאור חופשי'
            }));
        }

        if (bioValue || focusField === 'bio') {
            body.appendChild(fieldRow('ביוגרפיה קצרה', 'bio', bioValue, {
                className: 'person-pane-bio',
                placeholder: 'כמה מילים על האדם…'
            }));
        }

        const missing = [];
        if (!lifeDatesValue && focusField !== 'lifeDates') missing.push(['lifeDates', '+ הוסף תאריכים']);
        if (!bioValue && focusField !== 'bio') missing.push(['bio', '+ הוסף ביוגרפיה קצרה']);
        if (missing.length) {
            const additions = document.createElement('div');
            additions.className = 'person-pane-additions';
            for (const [field, label] of missing) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'person-pane-add';
                button.dataset.addPersonField = field;
                button.textContent = label;
                additions.appendChild(button);
            }
            body.appendChild(additions);
        }

        if (focusField) {
            requestAnimationFrame(() => {
                const selector = focusField === 'name'
                    ? '[contenteditable="true"][data-field="name"]'
                    : `[contenteditable="true"][data-meta-key="${focusField}"]`;
                const target = body.querySelector(selector);
                target?.focus();
                if (target && document.createRange) {
                    const range = document.createRange();
                    range.selectNodeContents(target);
                    range.collapse(false);
                    const selection = window.getSelection();
                    selection?.removeAllRanges();
                    selection?.addRange(range);
                }
            });
        }
    }

    function ensureAction(card, action, label, className) {
        let button = card.querySelector(`[data-action="${action}"]`);
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.dataset.action = action;
            button.dataset.id = card.dataset.nodeId;
            button.className = className;
            card.appendChild(button);
        }
        button.textContent = label;
        return button;
    }

    function decorateCards() {
        let geometryChanged = false;
        cardsLayer.querySelectorAll('.absolute-card[data-node-id]').forEach(card => {
            const name = card.querySelector('h2[data-field="name"]');
            if (name?.hasAttribute('contenteditable')) {
                name.removeAttribute('contenteditable');
                name.removeAttribute('spellcheck');
                geometryChanged = true;
            }

            if (!card.querySelector('[data-action="add-parent"]')) {
                ensureAction(
                    card,
                    'add-parent',
                    '+ הורה',
                    'absolute -top-2.5 left-1/2 -translate-x-1/2 bg-leaf-light text-white text-[8px] px-2 py-0.5 rounded-full hover:bg-leaf shadow z-30 transition whitespace-nowrap'
                );
            }

            const spouse = card.querySelector('[data-action="add-spouse"]');
            if (spouse) spouse.textContent = '+ הוסף בן/בת זוג';
            const child = card.querySelector('[data-action="add-child"]');
            if (child) child.textContent = '+ ילד';
        });
        return geometryChanged;
    }

    function queueRelayout({ center = false } = {}) {
        if (relayoutQueued || !globalNodes?.length) return;
        relayoutQueued = true;
        requestAnimationFrame(() => {
            relayoutQueued = false;
            try {
                layoutAndRender();
                if (center) {
                    requestAnimationFrame(() => {
                        const person = currentPerson();
                        if (!person || !Number.isFinite(person.x)) return;
                        viewport.scrollLeft = Math.max(0, person.x - viewport.clientWidth / 2);
                    });
                }
            } catch (error) {
                console.warn('Unable to reflow name-only family cards:', error);
            }
        });
    }

    function refreshFromGraph({ center = false } = {}) {
        const changed = decorateCards();
        renderPerson();
        if (changed || center) queueRelayout({ center });
    }

    handle.addEventListener('click', () => {
        if (!mobileQuery.matches) return;
        const open = pane.classList.toggle('person-pane-open');
        handle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    body.addEventListener('click', event => {
        const button = event.target.closest('[data-add-person-field]');
        if (!button) return;
        addField(button.dataset.addPersonField);
    });

    body.addEventListener('input', event => {
        const field = event.target?.dataset?.field;
        if (field !== 'name') return;
        const id = event.target.dataset.id;
        const cardName = document.getElementById(`card-${id}`)?.querySelector('h2[data-field="name"]');
        if (cardName) cardName.textContent = event.target.innerText.trim() || 'שם';
        mobileName.textContent = event.target.innerText.trim() || 'ללא שם';
    });

    const cardObserver = new MutationObserver(mutations => {
        if (!mutations.some(mutation => mutation.type === 'childList')) return;
        requestAnimationFrame(() => refreshFromGraph());
    });
    cardObserver.observe(cardsLayer, { childList: true });

    const rootObserver = new MutationObserver(() => {
        const next = currentRootId();
        if (next !== renderedPersonId) renderPerson();
    });
    rootObserver.observe(cardsLayer, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    const priorReplaceState = history.replaceState.bind(history);
    history.replaceState = function personPaneReplaceState(...args) {
        const result = priorReplaceState(...args);
        requestAnimationFrame(() => renderPerson());
        return result;
    };
    const priorPushState = history.pushState.bind(history);
    history.pushState = function personPanePushState(...args) {
        const result = priorPushState(...args);
        requestAnimationFrame(() => renderPerson());
        return result;
    };
    window.addEventListener('popstate', () => requestAnimationFrame(() => renderPerson()));

    mobileQuery.addEventListener?.('change', () => {
        if (!mobileQuery.matches) {
            pane.classList.remove('person-pane-open');
            handle.setAttribute('aria-expanded', 'false');
        }
        queueRelayout({ center: true });
    });

    requestAnimationFrame(() => requestAnimationFrame(() => {
        decorateCards();
        renderPerson();
        queueRelayout({ center: true });
    }));
})();
