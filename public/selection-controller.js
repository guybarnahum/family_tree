// Canonical selected-person owner: in-memory selection, URL, persistence and selection events.
(() => {
    if (window.__familySelectionControllerInstalled) return;
    window.__familySelectionControllerInstalled = true;

    const STORAGE_KEY = 'family-tree.anchor-person';
    const replaceState = history.replaceState.bind(history);
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

    function locationPersonId() {
        try { return normalizeId(new URL(window.location.href).searchParams.get('person')); }
        catch (_) { return null; }
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

    function beforeChange(nextId, source) {
        const previousId = selectedId || locationPersonId() || readStored();
        if (!nextId || nextId === previousId) return;
        dispatch('family-selection-will-change', {
            personId: nextId,
            previousPersonId: previousId,
            source
        });
    }

    function replaceUrlPerson(personId, { source = 'selection-request', persist = true, notify = true } = {}) {
        const id = normalizeId(personId);
        if (!id) return false;
        beforeChange(id, source);
        const url = new URL(window.location.href);
        url.searchParams.set('person', id);
        replaceState(history.state, '', url);
        return commit(id, { source, persist, notify });
    }

    function restoreSelection() {
        const id = locationPersonId() || readStored();
        if (id && locationPersonId() !== id) {
            const url = new URL(window.location.href);
            url.searchParams.set('person', id);
            replaceState(history.state, '', url);
        }
        if (id) commit(id, { source: locationPersonId() ? 'startup-url' : 'startup-storage', notify: false });
        diagnostics.restored = true;
        expose();
        return id;
    }

    function renderedRootId() {
        return normalizeId(
            document.querySelector('#cards-layer .absolute-card.graph-root[data-node-id]')?.dataset.nodeId
        );
    }

    function syncFromRenderedRoot({ source = 'graph-render', updateUrl = true } = {}) {
        const rootId = renderedRootId();
        if (!rootId) return null;
        if (updateUrl && locationPersonId() !== rootId) replaceUrlPerson(rootId, { source });
        else commit(rootId, { source });
        return rootId;
    }

    function getSelectedPersonId() {
        return selectedId || locationPersonId() || readStored();
    }

    function selectPerson(personId, { source = 'explicit-select' } = {}) {
        const id = normalizeId(personId);
        const card = id ? document.getElementById(`card-${id}`) : null;
        if (!card) return false;
        replaceUrlPerson(id, { source });
        card.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));
        return true;
    }

    document.getElementById('cards-layer')?.addEventListener('click', event => {
        if (event.target.closest('[data-action], [data-graph-expand], [data-graph-collapse], .graph-frontier')) return;
        if (event.target.closest('[contenteditable="true"]')) return;
        const card = event.target.closest('.absolute-card[data-node-id]');
        if (card) replaceUrlPerson(card.dataset.nodeId, { source: 'card-click' });
    }, true);

    window.addEventListener('popstate', () => {
        const nextId = locationPersonId() || readStored();
        if (!nextId) return;
        beforeChange(nextId, 'popstate');
        commit(nextId, { source: 'popstate' });
    });

    window.FamilySelectionController = Object.freeze({
        restoreSelection,
        syncFromRenderedRoot,
        getSelectedPersonId,
        selectPerson,
        select: selectPerson,
        replaceUrlPerson,
        persist: personId => commit(personId, { source: 'explicit-persist', notify: false }),
        diagnostics: () => ({ ...window.__familySelectionDiagnostics })
    });

    expose();
})();
