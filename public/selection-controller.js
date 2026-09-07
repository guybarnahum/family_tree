// Canonical browser-side ownership for selected/root person persistence and selection events.
// Graph-view still owns projection/reroot mechanics in M1; every URL/localStorage selection
// transition flows through this controller so feature modules consume one coherent selection.
(() => {
    if (window.__familySelectionControllerInstalled) return;
    window.__familySelectionControllerInstalled = true;

    const STORAGE_KEY = 'family-tree.anchor-person';
    const nativeReplaceState = history.replaceState.bind(history);
    const nativePushState = history.pushState.bind(history);
    let selectedId = null;

    const diagnostics = {
        changes: 0,
        restored: false,
        lastPersonId: null,
        lastSource: null,
        lastChangedAt: null
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
        window.__familySelectionDiagnostics = {
            ...diagnostics,
            selectedId,
            urlPersonId: locationPersonId(),
            storedPersonId: readStored()
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

    function beforeHistoryChange(nextId, source) {
        const previousId = selectedId || locationPersonId() || readStored();
        if (!nextId || nextId === previousId) return;
        dispatch('family-selection-will-change', {
            personId: nextId,
            previousPersonId: previousId,
            source
        });
    }

    history.replaceState = function familySelectionReplaceState(...args) {
        const nextId = rootFromHistoryArgs(args);
        beforeHistoryChange(nextId, 'replaceState');
        const result = nativeReplaceState(...args);
        if (nextId) commit(nextId, { source: 'replaceState' });
        return result;
    };

    history.pushState = function familySelectionPushState(...args) {
        const nextId = rootFromHistoryArgs(args);
        beforeHistoryChange(nextId, 'pushState');
        const result = nativePushState(...args);
        if (nextId) commit(nextId, { source: 'pushState' });
        return result;
    };

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
            const url = new URL(window.location.href);
            url.searchParams.set('person', rootId);
            history.replaceState(history.state, '', url);
        } else {
            commit(rootId, { source });
        }
        return rootId;
    }

    function getSelectedPersonId() {
        return selectedId || locationPersonId() || readStored() || renderedRootId();
    }

    function selectPerson(personId) {
        const id = normalizeId(personId);
        if (!id) return false;
        const card = document.getElementById(`card-${id}`);
        if (!card) return false;
        card.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));
        return true;
    }

    window.addEventListener('popstate', () => {
        const nextId = locationPersonId() || readStored();
        if (!nextId) return;
        beforeHistoryChange(nextId, 'popstate');
        commit(nextId, { source: 'popstate' });
    });

    window.FamilySelectionController = Object.freeze({
        restoreSelection,
        syncFromRenderedRoot,
        getSelectedPersonId,
        selectPerson,
        persist: personId => commit(personId, { source: 'explicit-persist', notify: false }),
        diagnostics: () => ({ ...window.__familySelectionDiagnostics })
    });

    expose();
})();