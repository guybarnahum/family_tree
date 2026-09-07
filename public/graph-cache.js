// Graph cache: keep the last canonical graph locally and track whether it is known clean,
// locally dirty, or stale relative to the server revision.
(() => {
    if (window.FamilyGraphCache) return;

    const STORAGE_KEY = 'family-tree.graph-cache.v1';

    function isGraphDocument(value) {
        return !!value && typeof value === 'object' &&
            Array.isArray(value.people) && Array.isArray(value.relationships);
    }

    function finiteRevision(value) {
        const revision = Number(value);
        return Number.isInteger(revision) && revision >= 1 ? revision : null;
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.savedAt) || !isGraphDocument(parsed.graph)) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return {
                savedAt: parsed.savedAt,
                revision: finiteRevision(parsed.revision),
                serverRevision: finiteRevision(parsed.serverRevision),
                stale: !!parsed.stale,
                dirty: !!parsed.dirty,
                graph: parsed.graph
            };
        } catch (_) {
            return null;
        }
    }

    function write(entry) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
            return true;
        } catch (_) {
            return false;
        }
    }

    function save(graph, { revision = null } = {}) {
        if (!isGraphDocument(graph)) return false;
        const previous = load();
        const nextRevision = finiteRevision(revision) || previous?.revision || null;
        return write({
            savedAt: Date.now(),
            revision: nextRevision,
            serverRevision: nextRevision,
            stale: false,
            dirty: false,
            graph
        });
    }

    function markStale(serverRevision = null) {
        const entry = load();
        if (!entry) return false;
        entry.stale = true;
        const nextRevision = finiteRevision(serverRevision);
        if (nextRevision) entry.serverRevision = nextRevision;
        return write(entry);
    }

    function markDirty(serverRevision = null) {
        const entry = load();
        if (!entry) return false;
        entry.dirty = true;
        const nextRevision = finiteRevision(serverRevision);
        if (nextRevision) entry.serverRevision = nextRevision;
        return write(entry);
    }

    function markClean(revision = null) {
        const entry = load();
        if (!entry) return false;
        const nextRevision = finiteRevision(revision) || entry.revision;
        entry.revision = nextRevision;
        entry.serverRevision = nextRevision;
        entry.stale = false;
        entry.dirty = false;
        return write(entry);
    }

    function clear() {
        try { localStorage.removeItem(STORAGE_KEY); }
        catch (_) {}
    }

    function ageMs(entry) {
        return entry && Number.isFinite(entry.savedAt)
            ? Math.max(0, Date.now() - entry.savedAt)
            : null;
    }

    window.FamilyGraphCache = Object.freeze({
        load,
        save,
        markStale,
        markDirty,
        markClean,
        clear,
        ageMs,
        isGraphDocument,
        finiteRevision
    });
})();
