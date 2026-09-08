// Canonical browser-side owner for selected-person persistence and history.
// M4-A keeps one active history owner even while legacy feature modules are still loaded.
(() => {
    if (window.__familySelectionControllerInstalled) return;
    window.__familySelectionControllerInstalled = true;

    const STORAGE_KEY = 'family-tree.anchor-person';
    const nativeReplaceState = history.replaceState.bind(history);
    const nativePushState = history.pushState.bind(history);
    let selectedId = null;
    let historyOwnerInstallations = 0;

    const diagnostics = {
        changes: 0,
        restored: false,
        lastPersonId: null,
        lastSource: null,
        lastChangedAt: null,
        historyOwnerInstallations: 0
    };

    function normalizeId(value) {
        const id = String(value ?? '').trim();
        return id || null;
    }

    function readStored() {
        try { return normalizeId(localStorage.getItem(STORAGE_KEY)); }
        catch (_) { return null; }
    }

    function writeStored(personId) {
        const id = normalizeId(personId);
        if (!id) return;
        try { localStorage.setItem(STORAGE_KEY, id); }
        catch (_) {}
    }

    function locationPersonId(url = window.location.href) {
        try { return normalizeId(new URL(String(url), window.location.href).searchParams.get('person')); }
        catch (_) { return null; }
    }

    function rootFromHistoryArgs(args) {
        const target = args?.[2];
        if (target === undefined || target === null || target === '') return null;
        return locationPersonId(target);
    }

    function dispatch(name, detail) {
        try { window.dispatchEvent(new CustomEvent(name, { detail })); }
        catch (_) {}
    }

    function expose() {
        diagnostics.historyOwnerInstallations = historyOwnerInstallations;
        window.__familySelectionDiagnostics = {
            ...diagnostics,
            selectedId,
            urlPersonId: locationPersonId(),
            storedPersonId: readStored(),
            activeReplaceOwner: history.replaceState?.name || '',
            activePushOwner: history.pushState?.name || ''
        };
    }

    function commit(personId, { source = 'unknown', persist = true, notify = true } = {}) {
        const id = normalizeId(personId);
        if (!id) return false;
        const previousId = selectedId;
        selectedId = id;
        if (persist) writeStored(id);

        diagnostics.lastPersonId = id;
        diagnostics.lastSource = source;
        if (previousId !== id) {
            diagnostics.changes += 1;
            diagnostics.lastChangedAt = new Date().toISOString();
            if (notify) dispatch('family-selection-changed', {
                personId: id,
                previousPersonId: previousId,
                source
            });
        }
        expose();
        return true;
    }

    function beforeChange(nextId, source) {
        const previousId = selectedId || locationPersonId() || readStored();
        if (!nextId || nextId === previousId) return;
        dispatch('family-selection-will-change', {
            personId: nextId,
            previousPersonId: previousId,
            source
        });
    }

    function familySelectionReplaceState(...args) {
        const nextId = rootFromHistoryArgs(args);
        beforeChange(nextId, 'replaceState');
        const result = nativeReplaceState(...args);
        if (nextId) commit(nextId, { source: 'replaceState' });
        return result;
    }

    function familySelectionPushState(...args) {
        const nextId = rootFromHistoryArgs(args);
        beforeChange(nextId, 'pushState');
        const result = nativePushState(...args);
        if (nextId) commit(nextId, { source: 'pushState' });
        return result;
    }

    function installHistoryOwner() {
        history.replaceState = familySelectionReplaceState;
        history.pushState = familySelectionPushState;
        historyOwnerInstallations += 1;
        expose();
    }

    function replaceUrlPerson(personId, { source = 'selection-request', persist = true, notify = true } = {}) {
        const id = normalizeId(personId);
        if (!id) return false;
        const previousId = selectedId || locationPersonId() || readStored();
        if (id !== previousId) beforeChange(id, source);
        const url = new URL(window.location.href);
        url.searchParams.set('person', id);
        nativeReplaceState(history.state, '', url);
        commit(id, { source, persist, notify });
        return true;
    }

    function restoreSelection() {
        const explicit = locationPersonId();
        if (explicit) {
            commit(explicit, { source: 'startup-url', notify: false });
            diagnostics.restored = true;
            expose();
            return explicit;
        }

        const stored = readStored();
        if (!stored) {
            diagnostics.restored = true;
            expose();
            return null;
        }

        const url = new URL(window.location.href);
        url.searchParams.set('person', stored);
        nativeReplaceState(history.state, '', url);
        commit(stored, { source: 'startup-storage', notify: false });
        diagnostics.restored = true;
        expose();
        return stored;
    }

    function renderedRootId() {
        return normalizeId(
            document.querySelector('#cards-layer .absolute-card.graph-root[data-node-id]')?.dataset.nodeId
        );
    }

    function syncFromRenderedRoot({ source = 'graph-render', updateUrl = true } = {}) {
        const rootId = renderedRootId();
        if (!rootId) return null;
        if (updateUrl && locationPersonId() !== rootId) {
            replaceUrlPerson(rootId, { source });
        } else {
            commit(rootId, { source });
        }
        return rootId;
    }

    function getSelectedPersonId() {
        return selectedId || locationPersonId() || readStored() || null;
    }

    function selectPerson(personId, { source = 'explicit-select' } = {}) {
        const id = normalizeId(personId);
        if (!id) return false;
        const card = document.getElementById(`card-${id}`);
        if (!card) return false;
        replaceUrlPerson(id, { source });
        card.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));
        return true;
    }

    // Capture ordinary card selection before graph-view's bubble listener. Selection intent,
    // URL and LocalStorage therefore become coherent before projection/render starts.
    document.getElementById('cards-layer')?.addEventListener('click', event => {
        if (event.target.closest('[data-action], [data-graph-expand], [data-graph-collapse], .graph-frontier')) return;
        if (event.target.closest('[contenteditable="true"]')) return;
        const card = event.target.closest('.absolute-card[data-node-id]');
        if (!card) return;
        replaceUrlPerson(card.dataset.nodeId, { source: 'card-click' });
    }, true);

    window.addEventListener('popstate', () => {
        const nextId = locationPersonId() || readStored();
        if (!nextId) return;
        beforeChange(nextId, 'popstate');
        commit(nextId, { source: 'popstate' });
    });

    // Some still-loaded legacy feature files assign history wrappers during bootstrap. They are
    // inert after readiness: the canonical controller deliberately takes the two methods back.
    window.addEventListener('family-runtime-ready', installHistoryOwner);

    window.FamilySelectionController = Object.freeze({
        restoreSelection,
        syncFromRenderedRoot,
        getSelectedPersonId,
        selectPerson,
        select: selectPerson,
        replaceUrlPerson,
        installHistoryOwner,
        persist: personId => commit(personId, { source: 'explicit-persist', notify: false }),
        diagnostics: () => ({ ...window.__familySelectionDiagnostics })
    });

    installHistoryOwner();
    expose();
})();