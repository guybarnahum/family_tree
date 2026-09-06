// Graph resilience controller. Intercepts only canonical /api/graph GETs so the existing
// graph projection/layout code stays unchanged. Successful documents are cached; failed
// requests fall back to the last good graph and surface a degraded-state status.
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
    let retryInFlight = false;

    function isGraphRequest(input, init) {
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'GET') return false;
        try {
            const raw = input instanceof Request ? input.url : String(input);
            const url = new URL(raw, window.location.href);
            return url.origin === window.location.origin && url.pathname === '/api/graph';
        } catch (_) {
            return false;
        }
    }

    async function retryGraph() {
        if (retryInFlight) return;
        retryInFlight = true;
        try {
            if (typeof window.startFamilyGraph === 'function') {
                await window.startFamilyGraph();
                return;
            }
            // During very early startup graph-view may not have installed its entrypoint yet.
            // A reload is the only safe fallback and is still preferable to a dead retry.
            window.location.reload();
        } finally {
            retryInFlight = false;
        }
    }

    function showFailure(classified, { cached = null, detail = '' } = {}) {
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

    function cachedResponse(entry) {
        return new Response(JSON.stringify(entry.graph), {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'Cache-Control': 'no-store',
                'X-Family-Graph-Stale': '1'
            }
        });
    }

    async function captureSuccessfulGraph(response) {
        try {
            const graph = await response.clone().json();
            if (Cache.isGraphDocument(graph)) Cache.save(graph);
        } catch (_) {
            // The normal graph loader will report malformed JSON as a data/render failure.
        }
    }

    window.fetch = async function resilientFetch(input, init) {
        if (!isGraphRequest(input, init)) return nativeFetch(input, init);

        try {
            const response = await nativeFetch(input, init);
            if (response.ok) {
                await captureSuccessfulGraph(response);
                Status.clear();
                return response;
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
            return cached ? cachedResponse(cached) : response;
        } catch (error) {
            const classified = Status.classify(error);
            const cached = Cache.load();
            showFailure(classified, { cached });
            if (cached) return cachedResponse(cached);
            throw error;
        }
    };

    window.addEventListener('online', () => {
        if (document.querySelector('.graph-status-full.open, .graph-status-banner.open')) {
            void retryGraph();
        }
    });
})();
