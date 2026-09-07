// Cheap stale detection for the canonical graph. A one-row D1 revision check runs every
// 5s while the user is active, every 15m while the visible page is idle, and never while
// the page is blurred/hidden. Full graph data is fetched only when revisions differ.
(() => {
    if (window.FamilyGraphSync) return;

    const Cache = window.FamilyGraphCache;
    const Status = window.FamilyGraphStatus;
    if (!Cache) {
        console.warn('Graph sync cache dependency did not load');
        return;
    }

    const ACTIVE_INTERVAL_MS = 5000;
    const ACTIVE_WINDOW_MS = 60 * 1000;
    const IDLE_INTERVAL_MS = 15 * 60 * 1000;
    const POINTER_MOVE_THROTTLE_MS = 1000;

    const baseFetch = window.fetch.bind(window);
    const sessionStartedAt = Date.now();
    let lastActivityAt = Date.now();
    let lastPointerMoveAt = 0;
    let nextCheckAt = null;
    let timer = null;
    let inFlight = false;
    let started = false;
    let revisionFailureVisible = false;

    const metrics = {
        revisionChecks: 0,
        revisionChanges: 0,
        revisionErrors: 0,
        graphNetworkFetches: 0,
        graphCacheHits: 0,
        graphFetchErrors: 0,
        graphMutations: 0,
        lastRevisionCheckAt: null,
        lastRevisionLatencyMs: null,
        lastRevisionError: '',
        lastGraphFetchAt: null,
        lastGraphFetchLatencyMs: null,
        lastGraphFetchSource: '',
        lastMutationAt: null,
        lastMutationRevision: null,
        serverRevision: Cache.load()?.serverRevision || Cache.load()?.revision || null
    };

    function finiteRevision(value) {
        return Cache.finiteRevision?.(value) || null;
    }

    function pageAvailable() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    function modeAt(now = Date.now()) {
        if (!pageAvailable()) return 'paused';
        return now - lastActivityAt <= ACTIVE_WINDOW_MS ? 'active' : 'idle';
    }

    function intervalFor(mode = modeAt()) {
        if (mode === 'active') return ACTIVE_INTERVAL_MS;
        if (mode === 'idle') return IDLE_INTERVAL_MS;
        return null;
    }

    function cacheSnapshot() {
        const entry = Cache.load();
        return {
            present: !!entry,
            savedAt: entry?.savedAt || null,
            ageMs: entry ? Cache.ageMs(entry) : null,
            revision: entry?.revision || null,
            serverRevision: entry?.serverRevision || metrics.serverRevision || null,
            stale: !!entry?.stale,
            dirty: !!entry?.dirty,
            people: entry?.graph?.people?.length || 0,
            relationships: entry?.graph?.relationships?.length || 0
        };
    }

    function snapshot() {
        const now = Date.now();
        const mode = modeAt(now);
        const cache = cacheSnapshot();
        return {
            ...metrics,
            mode,
            intervalMs: intervalFor(mode),
            activeWindowMs: ACTIVE_WINDOW_MS,
            idleIntervalMs: IDLE_INTERVAL_MS,
            visible: document.visibilityState === 'visible',
            focused: document.hasFocus(),
            lastActivityAt,
            activityAgeMs: Math.max(0, now - lastActivityAt),
            nextCheckAt,
            nextCheckInMs: nextCheckAt ? Math.max(0, nextCheckAt - now) : null,
            inFlight,
            sessionStartedAt,
            sessionAgeMs: now - sessionStartedAt,
            cache,
            estimatedRevisionRowsRead: metrics.revisionChecks,
            estimatedFullGraphRowsRead: metrics.graphNetworkFetches *
                Math.max(0, cache.people + cache.relationships + 1)
        };
    }

    function emitMetrics() {
        window.dispatchEvent(new CustomEvent('family-graph-sync-metrics', { detail: snapshot() }));
    }

    function clearTimer() {
        if (timer) clearTimeout(timer);
        timer = null;
        nextCheckAt = null;
    }

    function schedule(delay = null) {
        clearTimer();
        const mode = modeAt();
        const interval = delay ?? intervalFor(mode);
        if (interval == null) {
            emitMetrics();
            return;
        }
        nextCheckAt = Date.now() + interval;
        timer = setTimeout(() => void checkRevision('timer'), interval);
        emitMetrics();
    }

    function revisionError(error, status = null, body = '') {
        const wrapped = error instanceof Error ? error : new Error(String(error || 'Revision check failed'));
        if (status) wrapped.status = status;
        if (body) wrapped.body = body;
        return wrapped;
    }

    function showRevisionFailure(error) {
        if (!Status) return;
        const cached = Cache.load();
        if (!cached) return;
        const classified = Status.classify(error);
        Status.show({
            kind: classified.kind,
            mode: 'banner',
            savedAt: cached.savedAt,
            retry: () => checkRevision('retry'),
            title: `מוצג עותק שמור ${Status.ageLabel(cached.savedAt)}`,
            description: classified.kind === 'quota'
                ? 'מסד הנתונים הגיע למגבלת השימוש; העץ המוצג הוא מהטעינה האחרונה.'
                : 'לא ניתן לבדוק כרגע אם העץ השתנה; מוצג העותק האחרון שנשמר.',
            details: { status: classified, text: classified.text }
        });
        revisionFailureVisible = true;
    }

    async function refreshGraph(serverRevision) {
        Cache.markStale(serverRevision);
        if (typeof window.startFamilyGraph === 'function') {
            await window.startFamilyGraph();
        } else {
            const response = await baseFetch('/api/graph', { cache: 'no-store' });
            if (!response.ok) throw revisionError(await response.text(), response.status);
            const graph = await response.json();
            if (!Cache.isGraphDocument(graph)) throw new Error('Refreshed graph was malformed');
            const revision = finiteRevision(response.headers.get('X-Family-Graph-Revision')) || serverRevision;
            Cache.save(graph, { revision });
        }

        const refreshed = Cache.load();
        window.dispatchEvent(new CustomEvent('family-graph-synced', {
            detail: {
                revision: refreshed?.revision || serverRevision,
                reason: 'remote-revision'
            }
        }));
    }

    async function checkRevision(reason = 'manual') {
        if (!pageAvailable() && reason !== 'retry') {
            schedule();
            return null;
        }
        if (inFlight) return null;

        inFlight = true;
        clearTimer();
        const startedAt = performance.now();
        metrics.revisionChecks += 1;
        metrics.lastRevisionCheckAt = Date.now();
        metrics.lastRevisionError = '';
        emitMetrics();

        try {
            const response = await baseFetch('/api/graph/revision', { cache: 'no-store' });
            let body = '';
            if (!response.ok) {
                try { body = await response.text(); } catch (_) {}
                throw revisionError(new Error(body || `HTTP ${response.status}`), response.status, body);
            }

            const payload = await response.json();
            const serverRevision = finiteRevision(payload?.revision || response.headers.get('X-Family-Graph-Revision'));
            if (!serverRevision) throw new Error('Graph revision response was invalid');

            metrics.serverRevision = serverRevision;
            metrics.lastRevisionLatencyMs = Math.round(performance.now() - startedAt);
            if (revisionFailureVisible) {
                Status?.clear();
                revisionFailureVisible = false;
            }

            const cached = Cache.load();
            const localRevision = cached?.revision || null;
            if (!localRevision || localRevision !== serverRevision || cached?.stale || cached?.dirty) {
                metrics.revisionChanges += 1;
                await refreshGraph(serverRevision);
            }
            return serverRevision;
        } catch (error) {
            metrics.revisionErrors += 1;
            metrics.lastRevisionLatencyMs = Math.round(performance.now() - startedAt);
            metrics.lastRevisionError = String(error?.message || error);
            showRevisionFailure(error);
            return null;
        } finally {
            inFlight = false;
            schedule();
        }
    }

    function noteActivity(event = null) {
        const now = Date.now();
        if (event?.type === 'pointermove') {
            if (now - lastPointerMoveAt < POINTER_MOVE_THROTTLE_MS) return;
            lastPointerMoveAt = now;
        }

        const previousMode = modeAt(now);
        lastActivityAt = now;
        if (pageAvailable() && previousMode === 'idle') {
            void checkRevision('activity');
            return;
        }
        if (pageAvailable() && !timer && !inFlight) schedule(ACTIVE_INTERVAL_MS);
        emitMetrics();
    }

    function pause() {
        clearTimer();
        emitMetrics();
    }

    function resume(reason) {
        lastActivityAt = Date.now();
        if (!pageAvailable()) {
            pause();
            return;
        }
        void checkRevision(reason);
    }

    function isGraphMutation(input, init) {
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
        try {
            const raw = input instanceof Request ? input.url : String(input);
            const url = new URL(raw, window.location.href);
            if (url.origin !== window.location.origin) return false;
            return url.pathname === '/api/graph' ||
                url.pathname === '/api/tree' ||
                url.pathname.startsWith('/api/nodes') ||
                url.pathname.startsWith('/api/faces');
        } catch (_) {
            return false;
        }
    }

    // Observe successful local writes. The server returns the revision in a header; mark
    // the cached graph dirty until the normal post-write graph refresh makes it clean.
    window.fetch = async function graphSyncFetch(input, init) {
        const response = await baseFetch(input, init);
        if (response.ok && isGraphMutation(input, init)) {
            const revision = finiteRevision(response.headers.get('X-Family-Graph-Revision'));
            Cache.markDirty(revision);
            metrics.graphMutations += 1;
            metrics.lastMutationAt = Date.now();
            metrics.lastMutationRevision = revision;
            if (revision) metrics.serverRevision = revision;
            emitMetrics();
        }
        return response;
    };

    window.addEventListener('family-graph-fetch', event => {
        const detail = event.detail || {};
        metrics.lastGraphFetchAt = detail.at || Date.now();
        metrics.lastGraphFetchSource = detail.source || '';
        if (Number.isFinite(detail.latencyMs)) metrics.lastGraphFetchLatencyMs = detail.latencyMs;
        if (detail.source === 'network') metrics.graphNetworkFetches += 1;
        else if (detail.source === 'cache') metrics.graphCacheHits += 1;
        else if (detail.source === 'error') metrics.graphFetchErrors += 1;
        if (detail.revision) metrics.serverRevision = detail.revision;
        emitMetrics();
    });

    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        window.addEventListener(type, noteActivity, { passive: true, capture: true });
    }
    window.addEventListener('pointermove', noteActivity, { passive: true, capture: true });
    window.addEventListener('scroll', noteActivity, { passive: true, capture: true });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resume('visible');
        else pause();
    });
    window.addEventListener('focus', () => resume('focus'));
    window.addEventListener('blur', pause);

    function suppressLegacyFullGraphPoll() {
        const current = window.loadTree;
        if (typeof current !== 'function' || current.__familyRevisionAware) return;
        const wrapped = async function revisionAwareLoadTree(anchorId = null, force = false) {
            if (!force) return;
            return current(anchorId, force);
        };
        wrapped.__familyRevisionAware = true;
        window.loadTree = wrapped;
        try { loadTree = wrapped; } catch (_) {}
    }

    function start() {
        if (started) return;
        started = true;
        suppressLegacyFullGraphPoll();
        if (pageAvailable()) void checkRevision('startup');
        else pause();
    }

    window.FamilyGraphSync = Object.freeze({
        checkNow: () => checkRevision('manual'),
        noteActivity: () => noteActivity(),
        snapshot,
        constants: Object.freeze({
            activeIntervalMs: ACTIVE_INTERVAL_MS,
            activeWindowMs: ACTIVE_WINDOW_MS,
            idleIntervalMs: IDLE_INTERVAL_MS
        })
    });

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
