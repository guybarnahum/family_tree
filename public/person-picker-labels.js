// Shared presentation layer for person pickers. Unique names remain untouched; only true
// normalized-name collisions receive a muted, gender-neutral disambiguation line.
(() => {
    if (window.FamilyPersonPickerLabels) return;

    const Identity = window.FamilyPersonIdentity;
    if (!Identity) {
        console.warn('Person picker labels require FamilyPersonIdentity');
        return;
    }

    const style = document.createElement('style');
    style.textContent = `
        .person-picker-primary {
            display: block;
            min-width: 0;
        }
        .person-picker-qualifier {
            display: block;
            margin-top: 2px;
            color: #8a8a84;
            font-size: 9px;
            font-weight: 400;
            line-height: 1.2;
        }
        .face-person-result .person-picker-qualifier {
            color: #879087;
            font-size: 9px;
            text-align: right;
        }
    `;
    document.head.appendChild(style);

    function decorateSelectOption(option) {
        if (!(option instanceof HTMLOptionElement) || !option.value) return;
        const item = Identity.describe(option.value);
        const next = item.display || item.name;
        if (option.textContent !== next) option.textContent = next;
        option.dataset.personName = item.name;
        option.dataset.personQualifier = item.qualifier || '';
    }

    function decorateResult(button) {
        if (!(button instanceof HTMLElement)) return;
        const personId = button.dataset.personId;
        if (!personId) return;
        const item = Identity.describe(personId);

        if (button.classList.contains('face-person-result')) {
            button.replaceChildren();
            const primary = document.createElement('span');
            primary.className = 'person-picker-primary';
            primary.textContent = item.name;
            button.appendChild(primary);
            if (item.ambiguous && item.qualifier) {
                const qualifier = document.createElement('small');
                qualifier.className = 'person-picker-qualifier';
                qualifier.textContent = item.qualifier;
                button.appendChild(qualifier);
            }
            return;
        }

        if (button.classList.contains('graph-search-result')) {
            let primary = button.querySelector(':scope > .person-picker-primary');
            if (!primary) {
                const firstSpan = button.querySelector(':scope > span');
                primary = firstSpan || document.createElement('span');
                primary.classList.add('person-picker-primary');
                if (!firstSpan) button.prepend(primary);
            }
            primary.textContent = item.name;

            let qualifier = button.querySelector(':scope > .person-picker-qualifier');
            if (item.ambiguous && item.qualifier) {
                if (!qualifier) {
                    qualifier = document.createElement('small');
                    qualifier.className = 'person-picker-qualifier';
                    primary.after(qualifier);
                }
                qualifier.textContent = item.qualifier;
            } else {
                qualifier?.remove();
            }
        }
    }

    function decorate(root = document) {
        if (root instanceof HTMLOptionElement) decorateSelectOption(root);
        if (root instanceof HTMLElement && root.matches('.graph-search-result[data-person-id], .face-person-result[data-person-id]')) {
            decorateResult(root);
        }

        root.querySelectorAll?.('.face-person-select option[value]').forEach(decorateSelectOption);
        root.querySelectorAll?.('.graph-search-result[data-person-id], .face-person-result[data-person-id]').forEach(decorateResult);
    }

    let queued = false;
    function queueDecorate() {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            decorate(document);
        });
    }

    new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.type === 'childList')) queueDecorate();
    }).observe(document.body, { childList: true, subtree: true });

    window.addEventListener('family-person-disambiguation-updated', queueDecorate);

    window.FamilyPersonPickerLabels = Object.freeze({ decorate, refresh: queueDecorate });
    decorate(document);
})();
