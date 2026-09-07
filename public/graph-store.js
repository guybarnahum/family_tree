// M3 canonical client graph store.
//
// One browser-side owner for the canonical graph document, revision/dirty/stale state,
// persistent cache, shared topology indexes, and /api/graph reads. Legacy algorithm modules
// may still fetch('/api/graph'), but those reads are transparently served from this same store.
(() => {
    if (window.FamilyGraphStore) return;

    const STORAGE_KEY = 'family-tree.graph-cache.v1';
    const nativeFetch = window.fetch.bind(window);

    let graph = null;
    let savedAt = null;
    let revision = null;
    let serverRevision = null;
    let stale = false;
    let dirty = false;
    let source = 'empty';
    let structuralSignature = '';
    let generation = 0;
    let networkPromise = null;

    let peopleById = new Map();
    let parentsByChild = new Map();
    let childrenByParent = new Map();
    let spousesByPerson = new Map();

    const diagnostics = {
        cacheLoads: 0,
        cacheWrites: 0,
        memoryReads: 0,
        networkReads: 0,
        fallbackReads: 0,
        networkErrors: 0,
        graphReplacements: 0,
        personUpdates: 0,
        lastFetchSource: '',
        lastFetchAt: null,
        lastFetchLatencyMs: null,
        lastChangeReason: '',
        lastStructuralChanged: false
    };

    function isGraphDocument(value) {
        return !!value && typeof value === 'object' &&
            Array.isArray(value.people) && Array.isArray(value.relationships);
    }

    function finiteRevision(value) {
        const result = Number(value);
        return Number.isInteger(result) && result >= 1 ? result : null;
    }

    function addSet(map, key, value) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    }

    function structureOf(value) {
        return JSON.stringify([
            (value?.people || []).map(person => [person.id, person.name]),
            (value?.relationships || []).map(relation => [
                relation.id || '', relation.type, relation.person1Id, relation.person2Id
            ])
        ]);
    }

    function rebuildIndexes() {
        peopleById = new Map((graph?.people || []).map(person => [person.id, person]));
        parentsByChild = new Map();
        childrenByParent = new Map();
        spousesByPerson = new Map();

        for (const relation of graph?.relationships || []) {
            if (relation.type === 'parent') {
                addSet(parentsByChild, relation.person2Id, relation.person1Id);
                addSet(childrenByParent, relation.person1Id, relation.person2Id);
            } else if (relation.type === 'spouse') {
                addSet(spousesByPerson, relation.person1Id, relation.person2Id);
                addSet(spousesByPerson, relation.person2Id, relation.person1Id);
            }
        }
    }

    function snapshot() {
        return {
            graph,
            savedAt,
            revision,
            serverRevision,
            stale,
            dirty,
            source,
            generation,
            structuralSignature,
            indexes: {
                peopleById,
                parentsByChild,
                childrenByParent,
                spousesByPerson
            }
        };
    }

    function expose() {
        window.__familyGraphStoreDiagnostics = {
            ...diagnostics,
            generation,
            revision,
            serverRevision,
            stale,
            dirty,
            source,
            savedAt,
            people: graph?.people?.length || 0,
            relationships: graph?.relationships?.length || 0
        };
    }

    function persistentEntry() {
        return graph ? {
            savedAt: savedAt || Date.now(),
            revision,
            serverRevision,
            stale,
            dirty,
            graph
        } : null;
    }

    function persist() {
        const entry = persistentEntry();
        if (!entry) return false;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
            diagnostics.cacheWrites += 1;
            expose();
            return true;
        } catch (_) {
            return false;
        }
    }

    function emitStoreChange(reason, { structuralChanged = false, scope = 'graph' } = {}) {
        diagnostics.lastChangeReason = reason || 'graph-change';
        diagnostics.lastStructuralChanged = !!structuralChanged;
        expose();
        window.dispatchEvent(new CustomEvent('family-graph-store-changed', {
            detail: {
                reason: diagnostics.lastChangeReason,
                scope,
                structuralChanged: !!structuralChanged,
                generation,
                revision,
                serverRevision,
                stale,
                dirty
            }
        }));
    }

    function emitFetch(detail) {
        const payload = { ...detail, at: detail.at || Date.now() };
        diagnostics.lastFetchSource = payload.source || '';
        diagnostics.lastFetchAt = payload.at;
        if (Number.isFinite(payload.latencyMs)) diagnostics.lastFetchLatencyMs = payload.latencyMs;
        expose();
        window.dispatchEvent(new CustomEvent('family-graph-store-fetch', { detail: payload }));
    }

    function acceptGraph(value, {
        revision: nextRevision = null,
        source: nextSource = 'local',
        clean = true,
        reason = 'graph-replace',
        emit = true
    } = {}) {
        if (!isGraphDocument(value)) throw new Error('Invalid family graph document');
        const before = structuralSignature;
        graph = value;
        structuralSignature = structureOf(value);
        const structuralChanged = before !== structuralSignature;
        revision = finiteRevision(nextRevision) || revision;
        if (clean) {
            serverRevision = revision || serverRevision;
            stale = false;
            dirty = false;
        }
        source = nextSource;
        savedAt = Date.now();
        generation += 1;
        diagnostics.graphReplacements += 1;
        rebuildIndexes();
        persist();
        if (emit) emitStoreChange(reason, { structuralChanged });
        return snapshot();
    }

    function loadPersisted() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const entry = JSON.parse(raw);
            if (!entry || !Number.isFinite(entry.savedAt) || !isGraphDocument(entry.graph)) {
                localStorage.removeItem(STORAGE_KEY);
                return false;
            }
            graph = entry.graph;
            savedAt = entry.savedAt;
            revision = finiteRevision(entry.revision);
            serverRevision = finiteRevision(entry.serverRevision) || revision;
            stale = !!entry.stale;
            dirty = !!entry.dirty;
            source = 'persistent-cache';
            structuralSignature = structureOf(graph);
            generation = 1;
            diagnostics.cacheLoads += 1;
            rebuildIndexes();
            expose();
            return true;
        } catch (_) {
            return false;
        }
    }

    function markStale(nextServerRevision = null) {
        if (!graph) return false;
        stale = true;
        const value = finiteRevision(nextServerRevision);
        if (value) serverRevision = value;
        persist();
        expose();
        return true;
    }

    function markDirty(nextServerRevision = null) {
        if (!graph) return false;
        dirty = true;
        const value = finiteRevision(nextServerRevision);
        if (value) serverRevision = value;
        persist();
        expose();
        return true;
    }

    function markClean(nextRevision = null) {
        if (!graph) return false;
        const value = finiteRevision(nextRevision) || revision;
        revision = value;
        serverRevision = value || serverRevision;
        stale = false;
        dirty = false;
        persist();
        expose();
        return true;
    }

    function acknowledgeRevision(nextRevision, { graphDirty = false } = {}) {
        const value = finiteRevision(nextRevision);
        if (!value) return false;
        serverRevision = value;
        if (graphDirty) dirty = true;
        persist();
        expose();
        return true;
    }

    function clear() {
        graph = null;
        savedAt = null;
        revision = null;
        serverRevision = null;
        stale = false;
        dirty = false;
        source = 'empty';
        structuralSignature = '';
        generation += 1;
        rebuildIndexes();
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        emitStoreChange('clear', { structuralChanged: true });
    }

    function ageMs(value = snapshot()) {
        const timestamp = value?.savedAt;
        return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : null;
    }

    function graphRequestInfo(input, init) {
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'GET') return null;
        try {
            const raw = input instanceof Request ? input.url : String(input);
            const url = new URL(raw, window.location.href);
            if (url.origin !== window.location.origin || url.pathname !== '/api/graph') return null;
            return { url };
        } catch (_) {
            return null;
        }
    }

    function revisionFromResponse(response) {
        return finiteRevision(
            response?.headers?.get('X-Family-Graph-Revision') ||
            response?.headers?.get('X-Family-Revision')
        );
    }

    function graphResponse({ fallback = false } = {}) {
        if (!graph) return null;
        const headers = new Headers({
            'Content-Type': 'application/json; charset=UTF-8',
            'Cache-Control': 'no-store',
            'X-Family-Graph-Cache': fallback ? 'fallback' : 'hit'
        });
        if (revision) headers.set('X-Family-Graph-Revision', String(revision));
        if (fallback) headers.set('X-Family-Graph-Stale', '1');
        return new Response(JSON.stringify(graph), { status: 200, headers });
    }

    function showFailure(error) {
        const Status = window.FamilyGraphStatus;
        if (!Status || !graph) return;
        const classified = Status.classify(error);
        Status.show({
            kind: classified.kind,
            mode: 'banner',
            savedAt,
            retry: () => refresh({ authoritative: false, reason: 'retry' }),
            title: `מוצג עותק שמור ${Status.ageLabel(savedAt)}`,
            description: classified.kind === 'quota'
                ? 'מסד הנתונים הגיע למגבלת השימוש; העץ המוצג הוא מהטעינה האחרונה.'
                : 'לא ניתן לרענן כרגע; העץ המוצג הוא מהטעינה האחרונה.',
            details: { status: classified, text: classified.text }
        });
    }

    async function fetchGraph(input = '/api/graph', init = { cache: 'no-store' }, {
        forceNetwork = false,
        authoritative = false,
        reason = 'graph-read'
    } = {}) {
        if (graph && !forceNetwork && !stale && !dirty) {
            diagnostics.memoryReads += 1;
            emitFetch({
                source: 'store',
                revision,
                people: graph.people.length,
                relationships: graph.relationships.length
            });
            return graphResponse();
        }

        if (networkPromise) return networkPromise.then(result => result.clone());

        const started = performance.now();
        networkPromise = (async () => {
            try {
                const response = await nativeFetch(input, init);
                if (!response.ok) {
                    let body = '';
                    try { body = await response.clone().text(); } catch (_) {}
                    const error = new Error(body || `HTTP ${response.status}`);
                    error.status = response.status;
                    error.body = body;
                    throw error;
                }
                const value = await response.clone().json();
                if (!isGraphDocument(value)) throw new Error('Graph response was not valid graph JSON');
                const nextRevision = revisionFromResponse(response) || serverRevision || revision;
                acceptGraph(value, {
                    revision: nextRevision,
                    source: 'network',
                    clean: true,
                    reason
                });
                diagnostics.networkReads += 1;
                emitFetch({
                    source: 'network',
                    revision: nextRevision,
                    people: value.people.length,
                    relationships: value.relationships.length,
                    latencyMs: Math.round(performance.now() - started)
                });
                window.FamilyGraphStatus?.clear?.();
                return response;
            } catch (error) {
                diagnostics.networkErrors += 1;
                if (graph) {
                    stale = true;
                    persist();
                    showFailure(error);
                    diagnostics.fallbackReads += 1;
                    emitFetch({ source: 'error', kind: window.FamilyGraphStatus?.classify?.(error)?.kind || 'network' });
                    if (!authoritative) return graphResponse({ fallback: true });
                }
                throw error;
            } finally {
                networkPromise = null;
                expose();
            }
        })();
        return networkPromise.then(result => result.clone());
    }

    async function read({ refresh: forceNetwork = false, authoritative = false, reason = 'graph-read' } = {}) {
        const response = await fetchGraph('/api/graph', { cache: 'no-store' }, {
            forceNetwork,
            authoritative,
            reason
        });
        if (authoritative && response.headers.get('X-Family-Graph-Stale') === '1') {
            throw new Error('Authoritative graph is unavailable');
        }
        return snapshot();
    }

    async function refresh({ serverRevision: nextServerRevision = null, authoritative = false, reason = 'refresh' } = {}) {
        markStale(nextServerRevision);
        return read({ refresh: true, authoritative, reason });
    }

    function updatePerson(personId, patch, { revision: nextRevision = null, reason = 'person-update' } = {}) {
        const person = peopleById.get(personId);
        if (!person || !patch || typeof patch !== 'object') return false;
        Object.assign(person, patch);
        const value = finiteRevision(nextRevision);
        if (value) {
            revision = value;
            serverRevision = value;
            stale = false;
            dirty = false;
        }
        savedAt = Date.now();
        generation += 1;
        diagnostics.personUpdates += 1;
        structuralSignature = structureOf(graph);
        persist();
        emitStoreChange(reason, { structuralChanged: Object.prototype.hasOwnProperty.call(patch, 'name'), scope: 'person' });
        return true;
    }

    function noteMutation({ scope = 'data', revision: nextRevision = null } = {}) {
        const value = finiteRevision(nextRevision);
        if (value) serverRevision = value;
        if (scope === 'graph') dirty = true;
        persist();
        expose();
    }

    loadPersisted();

    window.fetch = async function graphStoreFetch(input, init) {
        if (!graphRequestInfo(input, init)) return nativeFetch(input, init);
        return fetchGraph(input, init || { cache: 'no-store' });
    };

    window.FamilyGraphStore = Object.freeze({
        snapshot,
        read,
        refresh,
        replace: (value, options = {}) => acceptGraph(value, options),
        indexes: () => snapshot().indexes,
        person: id => peopleById.get(id) || null,
        updatePerson,
        markStale,
        markDirty,
        markClean,
        acknowledgeRevision,
        noteMutation,
        clear,
        ageMs,
        isGraphDocument,
        finiteRevision,
        nativeFetch: (...args) => nativeFetch(...args)
    });

    expose();
})();
