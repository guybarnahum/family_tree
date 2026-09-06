// Graph resilience: keep the last successfully fetched canonical graph locally so a
// temporary network/D1 failure does not turn the family tree into a blank page.
(() => {
    if (window.FamilyGraphCache) return;

    const STORAGE_KEY = 'family-tree.graph-cache.v1';

    function isGraphDocument(value) {
        return !!value && typeof value === 'object' &&
            Array.isArray(value.people) && Array.isArray(value.relationships);
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
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function save(graph) {
        if (!isGraphDocument(graph)) return false;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                savedAt: Date.now(),
                graph
            }));
            return true;
        } catch (_) {
            return false;
        }
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

    window.FamilyGraphCache = Object.freeze({ load, save, clear, ageMs, isGraphDocument });
})();
