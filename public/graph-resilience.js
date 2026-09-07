// Graph resilience controller. Clean canonical graph reads are served from local cache;
// D1 is touched only when the cache is missing, dirty/stale, or a retry/revision refresh
// requires authoritative data. Failed authoritative reads fall back to the last good graph.
(() => {
    if (window.__familyGraphResilienceInstalled) return;
    window.__familyGraphResilienceInstalled = true;

    const Cache = window.FamilyGraphCache;
    const Status = window.FamilyGraphStatus;
    if (!Cache || !Status) {
        console.warn('Graph resilience dependencies did not load');
        return;
    }

    const nativeFetch = window.fetch.bind(window);
    const baseShowStatus = typeof window.showStatus === 'function'
        ? window.showStatus.bind(window)
        : null;
    let retryInFlight = false;
    let lastGraphFailure = null;
    const FAILURE_CLASSIFICATION_TTL_MS = 15000;

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

    function responseRevision(response) {
        return Cache.finiteRevision?.(response?.headers?.get('X-Family-Graph-Revision')) || null;
    }

    function emitFetch(detail) {
        window.dispatchEvent(new CustomEvent('family-graph-fetch', { detail }));
    }

    async function retryGraph() {
        if (retryInFlight) return;
        retryInFlight = true;
        try {
            Cache.markStale();
            if (typeof window.startFamilyGraph === 'function') {
                await window.startFamilyGraph();
                return;
            }
            window.location.reload();
        } finally {
            retryInFlight = false;
        }
    }

    function rememberFailure(classified, detail = '') {
        lastGraphFailure = {
            classified: { ...classified },
            detail: detail || classified?.text || '',
            at: Date.now()
        };
    }

    function recentFailure() {
        if (!lastGraphFailure) return null;
        if (Date.now() - lastGraphFailure.at > FAILURE_CLASSIFICATION_TTL_MS) {
            lastGraphFailure = null;
            return null;
        }
        return lastGraphFailure;
    }

    function showFailure(classified, { cached = null, detail = '' } = {}) {
        rememberFailure(classified, detail);
        if (cached) Cache.markStale(cached.serverRevision);

        const options = {
            kind: classified.kind,
            retry: retryGraph,
            details: {
                status: classified,
                text: detail || classified.text
            }
        };

        if (cached) {
            Status.show({
                ...options,
                mode: 'banner',
                savedAt: cached.savedAt,
                title: `מוצג עותק שמור ${Status.ageLabel(cached.savedAt)}`,
                description: classified.kind === 'quota'
                    ? 'מסד הנתונים הגיע למגבלת השימוש; העץ המוצג הוא מהטעינה האחרונה.'
                    : 'לא ניתן לרענן כרגע; העץ המוצג הוא מהטעינה האחרונה.'
            });
        } else {
            Status.show({ ...options, mode: 'full' });
        }
    }

    function cachedResponse(entry, { stale = false } = {}) {
        const headers = new Headers({
            'Content-Type': 'application/json; charset=UTF-8',
            'Cache-Control': 'no-store',
            'X-Family-Graph-Cache': stale ? 'fallback' : 'hit'
        });
        if (entry.revision) headers.set('X-Family-Graph-Revision', String(entry.revision));
        if (stale) headers.set('X-Family-Graph-Stale', '1');
        return new Response(JSON.stringify(entry.graph), { status: 200, headers });
    }

    async function readSuccessfulGraph(response) {
        try {
            const graph = await response.clone().json();
            return Cache.isGraphDocument(graph) ? graph : null;
        } catch (_) {
            return null;
        }
    }

    window.fetch = async function resilientFetch(input, init) {
        const graphRequest = graphRequestInfo(input, init);
        if (!graphRequest) return nativeFetch(input, init);

        const cachedBefore = Cache.load();
        if (cachedBefore && !cachedBefore.stale && !cachedBefore.dirty) {
            emitFetch({
                source: 'cache',
                revision: cachedBefore.revision,
                people: cachedBefore.graph.people.length,
                relationships: cachedBefore.graph.relationships.length,
                at: Date.now()
            });
            return cachedResponse(cachedBefore);
        }

        const started = performance.now();
        try {
            const response = await nativeFetch(input, init);
            if (response.ok) {
                const graph = await readSuccessfulGraph(response);
                if (graph) {
                    const revision = responseRevision(response) || cachedBefore?.serverRevision || cachedBefore?.revision || null;
                    Cache.save(graph, { revision });
                    lastGraphFailure = null;
                    Status.clear();
                    emitFetch({
                        source: 'network',
                        revision,
                        people: graph.people.length,
                        relationships: graph.relationships.length,
                        latencyMs: Math.round(performance.now() - started),
                        at: Date.now()
                    });
                    return response;
                }

                const malformed = new Error('Graph response was not valid graph JSON');
                const classified = Status.classify(malformed);
                const cached = Cache.load();
                showFailure(classified, { cached, detail: malformed.message });
                emitFetch({ source: 'error', kind: classified.kind, at: Date.now() });
                return cached ? cachedResponse(cached, { stale: true }) : response;
            }

            let body = '';
            try { body = await response.clone().text(); }
            catch (_) {}
            const error = new Error(body || `HTTP ${response.status}`);
            error.status = response.status;
            error.body = body;
            const classified = Status.classify(error);
            const cached = Cache.load();
            showFailure(classified, { cached, detail: body });
            emitFetch({ source: 'error', kind: classified.kind, status: response.status, at: Date.now() });
            return cached ? cachedResponse(cached, { stale: true }) : response;
        } catch (error) {
            const classified = Status.classify(error);
            const cached = Cache.load();
            showFailure(classified, { cached });
            emitFetch({ source: 'error', kind: classified.kind, at: Date.now() });
            if (cached) return cachedResponse(cached, { stale: true });
            throw error;
        }
    };

    // graph-view catches projection/layout/JSON failures internally and collapses them into
    // one legacy Hebrew status string. Preserve a recent transport classification so an
    // infra outage is not incorrectly relabeled as a logical/data bug.
    if (baseShowStatus) {
        window.showStatus = function resilientShowStatus(message, ...args) {
            if (String(message) === 'שגיאה בטעינת הגרף') {
                const cached = Cache.load();
                const recent = recentFailure();
                if (recent) {
                    showFailure(recent.classified, {
                        cached,
                        detail: recent.detail || recent.classified.text
                    });
                } else {
                    showFailure(
                        { kind: 'data', transient: false, status: null, text: 'Graph render/load failure' },
                        { cached, detail: 'Graph render/load failure' }
                    );
                }
                return;
            }
            return baseShowStatus(message, ...args);
        };
    }

    window.addEventListener('online', () => {
        if (document.querySelector('.graph-status-full.open, .graph-status-banner.open')) {
            void retryGraph();
        }
    });
})();
