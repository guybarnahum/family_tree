// Slice C selected-person pane. The graph stays topology-only; all biographical details
// live in nodes.metadata_json while the pane is both the view and the editor.
(() => {
    if (window.__familyPersonPaneInstalled) return;
    window.__familyPersonPaneInstalled = true;

    const cardsLayer = document.getElementById('cards-layer');
    const viewport = document.getElementById('scroll-viewport');
    if (!cardsLayer || !viewport) return;

    const Metadata = window.FamilyPersonMetadata || {
        metadataObject: value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
        placeText: value => typeof value === 'string' ? value.trim() : String(value?.text ?? '').trim(),
        placeCountryCode: () => null,
        inferCountryCode: () => null,
        flagEmoji: () => '',
        countryName: code => code || ''
    };

    const EMPTY_NAMES = new Set(['', 'שם']);
    const mobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');
    const FIELD_DEFS = [
        { key: 'birthDate', label: 'תאריך לידה', kind: 'text' },
        { key: 'birthPlace', label: 'מקום לידה', kind: 'place' },
        { key: 'residence', label: 'מקום מגורים', kind: 'place' },
        { key: 'deathDate', label: 'תאריך פטירה', kind: 'text' },
        { key: 'deathPlace', label: 'מקום פטירה', kind: 'place' },
        { key: 'bio', label: 'ביוגרפיה קצרה', kind: 'text' }
    ];

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
            margin: 0 -5px 18px;
            border-radius: 7px;
            min-height: 38px;
        }

        .person-pane-section {
            padding: 13px 0 11px;
            border-top: 1px solid rgba(163, 177, 138, 0.20);
        }

        .person-pane-section-title {
            display: block;
            margin: 0 0 7px;
            font: 600 10px/1.3 Inter, sans-serif;
            color: #7c8a7d;
            letter-spacing: 0.025em;
        }

        .person-pane-field {
            display: grid;
            grid-template-columns: minmax(58px, auto) minmax(0, 1fr);
            align-items: start;
            gap: 8px;
            margin: 3px 0;
        }

        .person-pane-field-label {
            padding-top: 7px;
            font: 500 10px/1.35 Inter, sans-serif;
            color: #98a098;
        }

        .person-pane-value {
            min-height: 28px;
            padding: 5px 7px;
            margin: 0 -7px;
            border-radius: 7px;
            font: 400 14px/1.5 Inter, sans-serif;
            color: #37423a;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .person-pane-field.person-pane-field-wide {
            display: block;
        }

        .person-pane-field-wide .person-pane-value {
            margin-top: 2px;
        }

        .person-pane-value.person-pane-bio {
            min-height: 72px;
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

        .person-pane-place {
            display: flex;
            align-items: flex-start;
            gap: 7px;
            min-width: 0;
        }

        .person-pane-place .person-pane-value {
            flex: 1 1 auto;
            min-width: 0;
        }

        .person-pane-place-flag {
            flex: 0 0 auto;
            min-width: 22px;
            padding-top: 5px;
            font-size: 18px;
            line-height: 1.2;
            text-align: center;
            user-select: none;
        }

        .person-pane-add-wrap {
            position: relative;
            padding-top: 13px;
            border-top: 1px solid rgba(163, 177, 138, 0.20);
        }

        .person-pane-add {
            border: 1px solid rgba(88, 129, 87, 0.24);
            border-radius: 999px;
            background: rgba(163, 177, 138, 0.09);
            color: #588157;
            padding: 6px 10px;
            font: 600 10px/1.2 Inter, sans-serif;
            cursor: pointer;
        }

        .person-pane-add:hover,
        .person-pane-add:focus-visible {
            background: rgba(163, 177, 138, 0.18);
            outline: none;
        }

        .person-pane-add-menu {
            display: none;
            margin-top: 7px;
            padding: 6px;
            border: 1px solid rgba(163, 177, 138, 0.28);
            border-radius: 11px;
            background: rgba(255, 255, 255, 0.98);
            box-shadow: 0 8px 20px rgba(52, 78, 65, 0.10);
        }

        .person-pane-add-menu.open {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
        }

        .person-pane-add-option {
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: #4d6552;
            padding: 7px 8px;
            font: 500 10px/1.25 Inter, sans-serif;
            text-align: right;
            cursor: pointer;
        }

        .person-pane-add-option:hover,
        .person-pane-add-option:focus-visible {
            background: rgba(163, 177, 138, 0.14);
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
                height: min(68vh, 590px);
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

    function textValue(value) {
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
        const metadata = Metadata.metadataObject(person.metadata);
        person.metadata = metadata;
        return metadata;
    }

    function metadataFieldValue(metadata, key, kind) {
        return kind === 'place' ? Metadata.placeText(metadata[key]) : textValue(metadata[key]);
    }

    function editable(field, value, {
        className = '', placeholder = '', metadataKey = null, metadataKind = 'text'
    } = {}) {
        const element = document.createElement('div');
        element.className = `person-pane-value ${className}`.trim();
        element.contentEditable = 'true';
        element.spellcheck = true;
        element.dataset.id = currentRootId() || '';
        element.dataset.field = field;
        if (metadataKey) element.dataset.metaKey = metadataKey;
        if (metadataKey) element.dataset.metaKind = metadataKind;
        element.dataset.placeholder = placeholder;
        element.textContent = value;
        return element;
    }

    function placeEditor(metadataKey, value) {
        const wrap = document.createElement('div');
        wrap.className = 'person-pane-place';

        const editor = editable('metadata', value, {
            metadataKey,
            metadataKind: 'place',
            placeholder: 'עיר, אזור או מדינה'
        });
        const flag = document.createElement('span');
        flag.className = 'person-pane-place-flag';
        flag.setAttribute('aria-hidden', 'true');
        wrap.appendChild(editor);
        wrap.appendChild(flag);
        updatePlaceFlag(editor);
        return wrap;
    }

    function updatePlaceFlag(editor) {
        if (!editor?.dataset || editor.dataset.metaKind !== 'place') return;
        const flag = editor.parentElement?.querySelector('.person-pane-place-flag');
        if (!flag) return;
        const code = Metadata.inferCountryCode(editor.innerText.trim());
        flag.textContent = Metadata.flagEmoji(code);
        flag.title = code ? Metadata.countryName(code, document.documentElement.lang || 'he') : '';
    }

    function fieldRow(label, metadataKey, value, {
        kind = 'text', className = '', placeholder = '', wide = false
    } = {}) {
        const row = document.createElement('div');
        row.className = `person-pane-field${wide ? ' person-pane-field-wide' : ''}`;

        if (!wide) {
            const fieldLabel = document.createElement('span');
            fieldLabel.className = 'person-pane-field-label';
            fieldLabel.textContent = label;
            row.appendChild(fieldLabel);
        }

        if (kind === 'place') {
            row.appendChild(placeEditor(metadataKey, value));
        } else {
            row.appendChild(editable('metadata', value, {
                className,
                placeholder,
                metadataKey,
                metadataKind: kind
            }));
        }
        return row;
    }

    function section(title, rows) {
        if (!rows.length) return null;
        const element = document.createElement('section');
        element.className = 'person-pane-section';
        const heading = document.createElement('span');
        heading.className = 'person-pane-section-title';
        heading.textContent = title;
        element.appendChild(heading);
        rows.forEach(row => element.appendChild(row));
        return element;
    }

    function fieldVisible(metadata, key, focusField) {
        const def = FIELD_DEFS.find(item => item.key === key);
        return focusField === key || !!metadataFieldValue(metadata, key, def?.kind || 'text');
    }

    function addDetailMenu(metadata) {
        const missing = FIELD_DEFS.filter(def => !metadataFieldValue(metadata, def.key, def.kind));
        if (!missing.length) return null;

        const wrap = document.createElement('div');
        wrap.className = 'person-pane-add-wrap';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'person-pane-add';
        trigger.dataset.togglePersonFields = 'true';
        trigger.setAttribute('aria-expanded', 'false');
        trigger.textContent = '+ הוסף פרט';
        wrap.appendChild(trigger);

        const menu = document.createElement('div');
        menu.className = 'person-pane-add-menu';
        for (const def of missing) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'person-pane-add-option';
            option.dataset.addPersonField = def.key;
            option.textContent = def.label;
            menu.appendChild(option);
        }
        wrap.appendChild(menu);
        return wrap;
    }

    function focusMetadataField(key) {
        requestAnimationFrame(() => {
            const target = body.querySelector(`[contenteditable="true"][data-meta-key="${key}"]`);
            target?.focus();
            if (!target || !document.createRange) return;
            const range = document.createRange();
            range.selectNodeContents(target);
            range.collapse(false);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        });
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

        const birthRows = [];
        if (fieldVisible(metadata, 'birthDate', focusField)) {
            birthRows.push(fieldRow('תאריך', 'birthDate', textValue(metadata.birthDate), {
                placeholder: 'שנה, תאריך או תיאור חופשי'
            }));
        }
        if (fieldVisible(metadata, 'birthPlace', focusField)) {
            birthRows.push(fieldRow('מקום', 'birthPlace', Metadata.placeText(metadata.birthPlace), { kind: 'place' }));
        }
        const birth = section('לידה', birthRows);
        if (birth) body.appendChild(birth);

        if (fieldVisible(metadata, 'residence', focusField)) {
            const residence = section('מקום מגורים', [
                fieldRow('', 'residence', Metadata.placeText(metadata.residence), { kind: 'place', wide: true })
            ]);
            if (residence) body.appendChild(residence);
        }

        const deathRows = [];
        if (fieldVisible(metadata, 'deathDate', focusField)) {
            deathRows.push(fieldRow('תאריך', 'deathDate', textValue(metadata.deathDate), {
                placeholder: 'שנה, תאריך או תיאור חופשי'
            }));
        }
        if (fieldVisible(metadata, 'deathPlace', focusField)) {
            deathRows.push(fieldRow('מקום', 'deathPlace', Metadata.placeText(metadata.deathPlace), { kind: 'place' }));
        }
        const death = section('פטירה', deathRows);
        if (death) body.appendChild(death);

        if (fieldVisible(metadata, 'bio', focusField)) {
            const about = section('ביוגרפיה קצרה', [
                fieldRow('', 'bio', textValue(metadata.bio), {
                    className: 'person-pane-bio',
                    placeholder: 'כמה מילים על האדם…',
                    wide: true
                })
            ]);
            if (about) body.appendChild(about);
        }

        const addMenu = addDetailMenu(metadata);
        if (addMenu) body.appendChild(addMenu);

        if (focusField) focusMetadataField(focusField);
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
        const toggle = event.target.closest('[data-toggle-person-fields]');
        if (toggle) {
            const menu = toggle.parentElement?.querySelector('.person-pane-add-menu');
            const open = menu?.classList.toggle('open') || false;
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            return;
        }

        const option = event.target.closest('[data-add-person-field]');
        if (!option) return;
        renderPerson({ focusField: option.dataset.addPersonField });
    });

    body.addEventListener('input', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.field === 'name') {
            const id = target.dataset.id;
            const cardName = document.getElementById(`card-${id}`)?.querySelector('h2[data-field="name"]');
            if (cardName) cardName.textContent = target.innerText.trim() || 'שם';
            mobileName.textContent = target.innerText.trim() || 'ללא שם';
        } else if (target.dataset.metaKind === 'place') {
            updatePlaceFlag(target);
        }
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

    window.addEventListener('family-person-pane-saved', event => {
        if (event.detail?.id !== currentRootId()) return;
        if (event.detail?.field === 'metadata') requestAnimationFrame(() => renderPerson());
    });

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
