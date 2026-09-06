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
    const baseShowStatus = typeof window.showStatus === 'function'
        ? window.showStatus.bind(window)
        : null;
    let retryInFlight = false;
    let lastGraphFailure = null;
    const FAILURE_CLASSIFICATION_TTL_MS = 15000;

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

    async function readSuccessfulGraph(response) {
        try {
            const graph = await response.clone().json();
            return Cache.isGraphDocument(graph) ? graph : null;
        } catch (_) {
            return null;
        }
    }

    window.fetch = async function resilientFetch(input, init) {
        if (!isGraphRequest(input, init)) return nativeFetch(input, init);

        try {
            const response = await nativeFetch(input, init);
            if (response.ok) {
                const graph = await readSuccessfulGraph(response);
                if (graph) {
                    Cache.save(graph);
                    lastGraphFailure = null;
                    Status.clear();
                    return response;
                }

                const malformed = new Error('Graph response was not valid graph JSON');
                const classified = Status.classify(malformed);
                const cached = Cache.load();
                showFailure(classified, { cached, detail: malformed.message });
                return cached ? cachedResponse(cached) : response;
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

    // graph-view catches projection/layout/JSON failures internally and collapses them into
    // one legacy Hebrew status string. If that string immediately follows a real /api/graph
    // failure, preserve the real classification instead of incorrectly relabeling an infra
    // outage as a logical/data bug. Only use `data` when no recent transport failure exists.
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