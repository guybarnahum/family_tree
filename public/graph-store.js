// Canonical browser-side family graph state. FamilyApi owns network transport.
(() => {
    if (window.FamilyGraphStore) return;
    const Api = window.FamilyApi;
    if (!Api) return console.warn('FamilyApi must load before FamilyGraphStore');

    const STORAGE_KEY = 'family-tree.graph-cache.v1';
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
        cacheLoads: 0, cacheWrites: 0, memoryReads: 0, networkReads: 0,
        fallbackReads: 0, networkErrors: 0, graphReplacements: 0,
        personUpdates: 0, observedMutations: 0, lastFetchSource: '',
        lastFetchAt: null, lastFetchLatencyMs: null, lastChangeReason: '',
        lastStructuralChanged: false
    };

    const finiteRevision = value => Api.finiteRevision(value);
    const isGraphDocument = value => !!value && typeof value === 'object' &&
        Array.isArray(value.people) && Array.isArray(value.relationships);

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
            graph, savedAt, revision, serverRevision, stale, dirty, source,
            generation, structuralSignature,
            indexes: { peopleById, parentsByChild, childrenByParent, spousesByPerson }
        };
    }

    function expose() {
        window.__familyGraphStoreDiagnostics = {
            ...diagnostics, generation, revision, serverRevision, stale, dirty, source, savedAt,
            people: graph?.people?.length || 0,
            relationships: graph?.relationships?.length || 0
        };
    }

    function persist() {
        if (!graph) return false;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                savedAt: savedAt || Date.now(), revision, serverRevision, stale, dirty, graph
            }));
            diagnostics.cacheWrites += 1;
            expose();
            return true;
        } catch (_) { return false; }
    }

    function emitStoreChange(reason, structuralChanged = false, scope = 'graph') {
        diagnostics.lastChangeReason = reason || 'graph-change';
        diagnostics.lastStructuralChanged = !!structuralChanged;
        expose();
        window.dispatchEvent(new CustomEvent('family-graph-store-changed', {
            detail: {
                reason: diagnostics.lastChangeReason, scope,
                structuralChanged: !!structuralChanged, generation,
                revision, serverRevision, stale, dirty
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

    function replace(value, options = {}) {
        if (!isGraphDocument(value)) throw new Error('Invalid family graph document');
        const before = structuralSignature;
        graph = value;
        structuralSignature = structureOf(value);
        const structuralChanged = before !== structuralSignature;
        revision = finiteRevision(options.revision) || revision;
        if (options.clean !== false) {
            serverRevision = revision || serverRevision;
            stale = false;
            dirty = false;
        }
        source = options.source || 'local';
        savedAt = Date.now();
        generation += 1;
        diagnostics.graphReplacements += 1;
        rebuildIndexes();
        persist();
        if (options.emit !== false) emitStoreChange(options.reason || 'graph-replace', structuralChanged);
        return snapshot();
    }

    function loadPersisted() {
        try {
            const entry = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (!entry || !Number.isFinite(entry.savedAt) || !isGraphDocument(entry.graph)) return false;
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
        } catch (_) { return false; }
    }

    function markStale(value = null) {
        if (!graph) return false;
        stale = true;
        serverRevision = finiteRevision(value) || serverRevision;
        persist(); expose(); return true;
    }

    function markDirty(value = null) {
        if (!graph) return false;
        dirty = true;
        serverRevision = finiteRevision(value) || serverRevision;
        persist(); expose(); return true;
    }

    function markClean(value = null) {
        if (!graph) return false;
        revision = finiteRevision(value) || revision;
        serverRevision = revision || serverRevision;
        stale = false; dirty = false;
        persist(); expose(); return true;
    }

    function acknowledgeRevision(value, { graphDirty = false } = {}) {
        const next = finiteRevision(value);
        if (!next) return false;
        serverRevision = next;
        if (graphDirty) dirty = true;
        persist(); expose(); return true;
    }

    function noteMutation({ scope = 'data', revision: value = null } = {}) {
        serverRevision = finiteRevision(value) || serverRevision;
        if (scope === 'graph') dirty = true;
        persist(); expose();
    }

    function graphResponse(fallback = false) {
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
        if (!Status) return;
        const classified = Status.classify(error);
        const retry = () => refresh({ reason: 'retry' });
        if (!graph) {
            Status.show({ kind: classified.kind, mode: 'full', retry,
                details: { status: classified, text: classified.text } });
            return;
        }
        Status.show({
            kind: classified.kind, mode: 'banner', savedAt, retry,
            title: `מוצג עותק שמור ${Status.ageLabel(savedAt)}`,
            description: classified.kind === 'quota'
                ? 'מסד הנתונים הגיע למגבלת השימוש; העץ המוצג הוא מהטעינה האחרונה.'
                : 'לא ניתן לרענן כרגע; העץ המוצג הוא מהטעינה האחרונה.',
            details: { status: classified, text: classified.text }
        });
    }

    async function networkRead({ authoritative = false, reason = 'graph-read' } = {}) {
        if (networkPromise) return networkPromise.then(response => response.clone());
        const started = performance.now();
        networkPromise = (async () => {
            try {
                const response = await Api.request('/api/graph', { cache: 'no-store' });
                if (!response.ok) {
                    const body = await response.clone().text().catch(() => '');
                    const error = new Error(body || `HTTP ${response.status}`);
                    error.status = response.status;
                    error.body = body;
                    throw error;
                }
                const value = await response.clone().json();
                if (!isGraphDocument(value)) throw new Error('Graph response was not valid graph JSON');
                const nextRevision = Api.revisionFromResponse(response) || serverRevision || revision;
                replace(value, { revision: nextRevision, source: 'network', reason });
                diagnostics.networkReads += 1;
                emitFetch({ source: 'network', revision: nextRevision,
                    people: value.people.length, relationships: value.relationships.length,
                    latencyMs: Math.round(performance.now() - started) });
                window.FamilyGraphStatus?.clear?.();
                return response;
            } catch (error) {
                diagnostics.networkErrors += 1;
                if (graph) { stale = true; diagnostics.fallbackReads += 1; persist(); }
                showFailure(error);
                emitFetch({ source: 'error', kind: window.FamilyGraphStatus?.classify?.(error)?.kind || 'network' });
                if (graph && !authoritative) return graphResponse(true);
                throw error;
            } finally {
                networkPromise = null;
                expose();
            }
        })();
        return networkPromise.then(response => response.clone());
    }

    async function read({ refresh: forceNetwork = false, authoritative = false, reason = 'graph-read' } = {}) {
        if (graph && !forceNetwork && !stale && !dirty) {
            diagnostics.memoryReads += 1;
            emitFetch({ source: 'store', revision,
                people: graph.people.length, relationships: graph.relationships.length });
            return snapshot();
        }
        const response = await networkRead({ authoritative, reason });
        if (authoritative && response.headers.get('X-Family-Graph-Stale') === '1') {
            throw new Error('Authoritative graph is unavailable');
        }
        return snapshot();
    }

    async function refresh({ serverRevision: value = null, authoritative = false, reason = 'refresh' } = {}) {
        markStale(value);
        return read({ refresh: true, authoritative, reason });
    }

    function updatePerson(personId, patch, { revision: value = null, reason = 'person-update' } = {}) {
        const person = peopleById.get(personId);
        if (!person || !patch || typeof patch !== 'object') return false;
        Object.assign(person, patch);
        const next = finiteRevision(value);
        if (next) {
            revision = next; serverRevision = next; stale = false; dirty = false;
        }
        savedAt = Date.now();
        generation += 1;
        diagnostics.personUpdates += 1;
        structuralSignature = structureOf(graph);
        persist();
        emitStoreChange(reason, Object.prototype.hasOwnProperty.call(patch, 'name'), 'person');
        return true;
    }

    function clear() {
        graph = null; savedAt = null; revision = null; serverRevision = null;
        stale = false; dirty = false; source = 'empty'; structuralSignature = '';
        generation += 1; rebuildIndexes();
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        emitStoreChange('clear', true);
    }

    function ageMs(value = snapshot()) {
        return Number.isFinite(value?.savedAt) ? Math.max(0, Date.now() - value.savedAt) : null;
    }

    loadPersisted();
    window.addEventListener('family-api-mutation', event => {
        diagnostics.observedMutations += 1;
        const detail = event.detail || {};
        noteMutation({ scope: detail.scope === 'graph' ? 'graph' : 'data', revision: detail.revision });
    });

    window.FamilyGraphStore = Object.freeze({
        snapshot, read, refresh, replace,
        indexes: () => snapshot().indexes,
        person: id => peopleById.get(id) || null,
        updatePerson, markStale, markDirty, markClean, acknowledgeRevision,
        noteMutation, clear, ageMs, isGraphDocument, finiteRevision
    });
    expose();
})();
