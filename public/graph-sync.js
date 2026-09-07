// Cheap stale detection for all family data. A one-row D1 revision check runs every 5s while
// the user is active, every 15m while the visible page is idle, and never while blurred/hidden.
// Revision discovery is intentionally faster than UI reconciliation: remote changes are
// coalesced and the page catches up at most once every 30s during a burst of edits.
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
    const RECONCILE_MIN_INTERVAL_MS = 30 * 1000;
    const POINTER_MOVE_THROTTLE_MS = 1000;
    const REVISION_SESSION_KEY = 'family-tree.data-revision.v1';

    // graph-resilience.js is already installed when this file loads. Keep that fetch wrapper
    // as the transport beneath revision checks and mutation observation.
    const baseFetch = window.fetch.bind(window);
    const sessionStartedAt = Date.now();
    let lastActivityAt = Date.now();
    let lastPointerMoveAt = 0;
    let nextCheckAt = null;
    let timer = null;
    let inFlight = false;
    let started = false;
    let revisionFailureVisible = false;

    // Capture graph-view's direct loadTree before late layout refinements wrap it. Remote
    // reconciliation can then update the canonical graph once without walking the historical
    // loadTree wrapper chain that used to multiply layouts.
    let directLoadTree = null;

    let reconcileTimer = null;
    let nextReconcileAt = null;
    let reconcileInFlight = false;
    let lastReconcileAt = 0;
    let pendingRevision = null;
    let pendingReason = '';
    let reconcileSerial = 0;
    let lastMismatchRevision = null;

    const initialCache = Cache.load();

    function finiteRevision(value) {
        return Cache.finiteRevision?.(value) || null;
    }

    function readSessionRevision() {
        try { return finiteRevision(sessionStorage.getItem(REVISION_SESSION_KEY)); }
        catch (_) { return null; }
    }

    function writeSessionRevision(revision) {
        const value = finiteRevision(revision);
        if (!value) return;
        try { sessionStorage.setItem(REVISION_SESSION_KEY, String(value)); }
        catch (_) {}
    }

    let knownRevision = readSessionRevision() || initialCache?.revision || null;

    const metrics = {
        revisionChecks: 0,
        revisionChanges: 0,
        bootstrapRefreshes: 0,
        stateRepairs: 0,
        revisionErrors: 0,
        reconciliations: 0,
        coalescedRevisionChanges: 0,
        revisionLayouts: 0,
        dataOnlyReconciliations: 0,
        suppressedLayouts: 0,
        reconcileErrors: 0,
        graphNetworkFetches: 0,
        graphCacheHits: 0,
        graphFetchErrors: 0,
        graphMutations: 0,
        dataMutations: 0,
        lastRevisionCheckAt: null,
        lastRevisionLatencyMs: null,
        lastRevisionError: '',
        lastGraphFetchAt: null,
        lastGraphFetchLatencyMs: null,
        lastGraphFetchSource: '',
        lastMutationAt: null,
        lastMutationRevision: null,
        lastMutationMethod: '',
        lastMutationPath: '',
        lastMutationScope: '',
        lastReconcileAt: null,
        lastReconcileRevision: null,
        lastReconcileReason: '',
        serverRevision: initialCache?.serverRevision || initialCache?.revision || null
    };

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
            serverRevision: entry?.serverRevision || null,
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
            reconcileMinIntervalMs: RECONCILE_MIN_INTERVAL_MS,
            visible: document.visibilityState === 'visible',
            focused: document.hasFocus(),
            lastActivityAt,
            activityAgeMs: Math.max(0, now - lastActivityAt),
            nextCheckAt,
            nextCheckInMs: nextCheckAt ? Math.max(0, nextCheckAt - now) : null,
            nextReconcileAt,
            nextReconcileInMs: nextReconcileAt ? Math.max(0, nextReconcileAt - now) : null,
            pendingRevision,
            pendingReason,
            knownRevision,
            inFlight,
            reconcileInFlight,
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

    function clearReconcileTimer() {
        if (reconcileTimer) clearTimeout(reconcileTimer);
        reconcileTimer = null;
        nextReconcileAt = null;
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

    function captureDirectLoader() {
        try {
            if (typeof loadTree === 'function') directLoadTree = loadTree;
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', captureDirectLoader, { once: true });
    } else {
        queueMicrotask(captureDirectLoader);
    }

    function twoAnimationFrames() {
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    function clearReconcileTokenLater(token) {
        setTimeout(() => {
            if (window.__familyRevisionReconcileToken === token) {
                window.__familyRevisionReconcileToken = null;
            }
        }, 320);
    }

    async function reconcileNow() {
        if (reconcileInFlight || !pendingRevision || !pageAvailable()) return null;

        clearReconcileTimer();
        reconcileInFlight = true;
        const targetRevision = pendingRevision;
        const reason = pendingReason || 'remote-revision';
        pendingRevision = null;
        pendingReason = '';
        lastReconcileAt = Date.now();
        metrics.lastReconcileAt = lastReconcileAt;
        metrics.lastReconcileRevision = targetRevision;
        metrics.lastReconcileReason = reason;

        const token = {
            id: ++reconcileSerial,
            phase: 'fetch',
            until: Infinity,
            layoutCount: 0,
            layoutSignature: '',
            suppressedLayouts: 0
        };
        window.__familyRevisionReconcileToken = token;
        const beforeDataSignature = typeof dataSignature === 'string' ? dataSignature : '';

        emitMetrics();
        try {
            // Mark stale only when the coalesced reconciliation actually runs. Merely seeing a
            // newer revision must never make incidental /api/graph callers redraw early.
            Cache.markStale(targetRevision);

            if (directLoadTree) {
                await directLoadTree(null, false);
            } else if (typeof window.startFamilyGraph === 'function') {
                // Startup-only fallback. Under normal operation DOMContentLoaded captured the
                // direct graph-view loader before any refinement wrappers were installed.
                await window.startFamilyGraph();
            } else {
                const response = await baseFetch('/api/graph', { cache: 'no-store' });
                if (!response.ok) throw revisionError(await response.text(), response.status);
                const graph = await response.json();
                if (!Cache.isGraphDocument(graph)) throw new Error('Refreshed graph was malformed');
                const revision = finiteRevision(
                    response.headers.get('X-Family-Revision') ||
                    response.headers.get('X-Family-Graph-Revision')
                ) || targetRevision;
                Cache.save(graph, { revision });
            }

            // graph-view schedules its layout with requestAnimationFrame. Arm the duplicate
            // layout guard after the fetch/load promise resolves but before that frame runs.
            token.phase = 'render';
            token.until = performance.now() + 280;
            await twoAnimationFrames();

            const refreshed = Cache.load();
            if (!refreshed || refreshed.stale) {
                throw new Error('Graph reconciliation did not obtain a fresh canonical graph');
            }

            const reconciledRevision = refreshed.revision || targetRevision;
            knownRevision = reconciledRevision;
            writeSessionRevision(knownRevision);
            metrics.serverRevision = Math.max(metrics.serverRevision || 0, reconciledRevision);
            metrics.reconciliations += 1;

            const afterDataSignature = typeof dataSignature === 'string' ? dataSignature : '';
            const rendered = (token.layoutCount || 0) > 0 ||
                (!!beforeDataSignature && !!afterDataSignature && beforeDataSignature !== afterDataSignature);
            if (rendered) metrics.revisionLayouts += 1;
            else metrics.dataOnlyReconciliations += 1;
            metrics.suppressedLayouts += token.suppressedLayouts || 0;

            window.dispatchEvent(new CustomEvent('family-graph-synced', {
                detail: {
                    revision: reconciledRevision,
                    targetRevision,
                    reason: 'coalesced-revision',
                    sourceReason: reason,
                    rendered,
                    suppressedLayouts: token.suppressedLayouts || 0
                }
            }));

            if (revisionFailureVisible) {
                Status?.clear();
                revisionFailureVisible = false;
            }
            return reconciledRevision;
        } catch (error) {
            metrics.reconcileErrors += 1;
            metrics.lastRevisionError = String(error?.message || error);
            // Do not acknowledge a revision that we failed to reconcile. Keep the newest target
            // pending so a later check/focus/retry can catch up without losing changes.
            if (!pendingRevision || targetRevision > pendingRevision) pendingRevision = targetRevision;
            if (!pendingReason) pendingReason = reason;
            showRevisionFailure(error);
            return null;
        } finally {
            token.phase = 'render';
            token.until = Math.max(token.until || 0, performance.now() + 120);
            clearReconcileTokenLater(token);
            reconcileInFlight = false;
            if (pendingRevision && pageAvailable()) queueReconciliation(pendingRevision, pendingReason || 'coalesced');
            emitMetrics();
        }
    }

    function queueReconciliation(revision, reason = 'remote-revision', { immediate = false } = {}) {
        const next = finiteRevision(revision);
        if (!next) return;

        if (pendingRevision && next !== pendingRevision) metrics.coalescedRevisionChanges += 1;
        pendingRevision = pendingRevision ? Math.max(pendingRevision, next) : next;
        pendingReason = reason || pendingReason;

        if (!pageAvailable() || reconcileInFlight) {
            emitMetrics();
            return;
        }

        const now = Date.now();
        const earliest = immediate || !lastReconcileAt
            ? now
            : lastReconcileAt + RECONCILE_MIN_INTERVAL_MS;
        const dueAt = Math.max(now, earliest);

        // Keep an already scheduled earlier reconciliation; newer revisions simply replace the
        // pending target and will be folded into that one fetch/render.
        if (reconcileTimer && nextReconcileAt && nextReconcileAt <= dueAt) {
            emitMetrics();
            return;
        }

        clearReconcileTimer();
        nextReconcileAt = dueAt;
        reconcileTimer = setTimeout(() => {
            reconcileTimer = null;
            nextReconcileAt = null;
            void reconcileNow();
        }, Math.max(0, dueAt - now));
        emitMetrics();
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
            const serverRevision = finiteRevision(
                payload?.revision ||
                response.headers.get('X-Family-Revision') ||
                response.headers.get('X-Family-Graph-Revision')
            );
            if (!serverRevision) throw new Error('Graph revision response was invalid');

            metrics.serverRevision = serverRevision;
            metrics.lastRevisionLatencyMs = Math.round(performance.now() - startedAt);
            if (revisionFailureVisible) {
                Status?.clear();
                revisionFailureVisible = false;
            }

            const cached = Cache.load();
            if (!knownRevision) knownRevision = cached?.revision || null;

            if (!knownRevision) {
                metrics.bootstrapRefreshes += 1;
                queueReconciliation(serverRevision, 'bootstrap', { immediate: true });
            } else if (knownRevision !== serverRevision) {
                if (lastMismatchRevision !== serverRevision) {
                    metrics.revisionChanges += 1;
                    lastMismatchRevision = serverRevision;
                }
                queueReconciliation(serverRevision, reason === 'retry' ? 'retry' : 'remote-revision', {
                    immediate: reason === 'retry'
                });
            } else {
                lastMismatchRevision = null;
                // Dirty/stale means a local graph write has not yet been folded into the cache,
                // or a prior authoritative read failed. Do not erase the flag merely because
                // the scalar revision matches; schedule one canonical reconciliation instead.
                if (cached?.dirty || cached?.stale) {
                    queueReconciliation(serverRevision, cached.dirty ? 'local-dirty' : 'stale-cache', {
                        immediate: reason === 'retry'
                    });
                }
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
        clearReconcileTimer();
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

    function mutationInfo(input, init) {
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
        try {
            const raw = input instanceof Request ? input.url : String(input);
            const url = new URL(raw, window.location.href);
            if (url.origin !== window.location.origin) return null;

            let scope = null;
            if (url.pathname === '/api/graph' || url.pathname === '/api/tree' || url.pathname.startsWith('/api/nodes')) {
                scope = 'graph';
            } else if (url.pathname === '/api/media' || url.pathname.startsWith('/api/media/')) {
                scope = 'media';
            } else if (url.pathname === '/api/faces' || url.pathname.startsWith('/api/faces/')) {
                scope = 'faces';
            }
            return scope ? { method, path: url.pathname, scope } : null;
        } catch (_) {
            return null;
        }
    }

    // Every successful user-visible data write receives the shared revision header. A write in
    // this tab is already known locally, so acknowledge that revision here rather than waiting
    // for the next poll to rediscover our own change. Only graph writes dirty the graph cache.
    window.fetch = async function graphSyncFetch(input, init) {
        const mutation = mutationInfo(input, init);
        const response = await baseFetch(input, init);
        if (response.ok && mutation) {
            const revision = finiteRevision(
                response.headers.get('X-Family-Revision') ||
                response.headers.get('X-Family-Graph-Revision')
            );
            if (revision) {
                knownRevision = revision;
                writeSessionRevision(revision);
                metrics.serverRevision = revision;
            }
            if (mutation.scope === 'graph') {
                Cache.markDirty(revision);
                metrics.graphMutations += 1;
            }
            metrics.dataMutations += 1;
            metrics.lastMutationAt = Date.now();
            metrics.lastMutationRevision = revision;
            metrics.lastMutationMethod = mutation.method;
            metrics.lastMutationPath = mutation.path;
            metrics.lastMutationScope = mutation.scope;
            emitMetrics();
        }
        return response;
    };

    // Right-pane edits already update the canonical graph object in memory. Once the PATCH
    // succeeds, mirror that known change into the persistent cache and advance it to the
    // returned revision. No graph download or redraw is necessary.
    window.addEventListener('family-person-pane-saved', event => {
        const detail = event.detail || {};
        const revision = finiteRevision(metrics.lastMutationRevision);
        const entry = Cache.load();
        if (!entry || !revision || !detail.id) return;
        const person = entry.graph?.people?.find(candidate => candidate.id === detail.id);
        if (!person) return;

        if (detail.field === 'name') {
            person.name = detail.value;
        } else if (detail.field === 'metadata' && detail.metadata && typeof detail.metadata === 'object') {
            person.metadata = { ...detail.metadata };
        } else {
            return;
        }

        Cache.save(entry.graph, { revision });
        knownRevision = revision;
        writeSessionRevision(revision);
        metrics.serverRevision = revision;
        emitMetrics();
    });

    window.addEventListener('family-graph-fetch', event => {
        const detail = event.detail || {};
        metrics.lastGraphFetchAt = detail.at || Date.now();
        metrics.lastGraphFetchSource = detail.source || '';
        if (Number.isFinite(detail.latencyMs)) metrics.lastGraphFetchLatencyMs = detail.latencyMs;
        if (detail.source === 'network') metrics.graphNetworkFetches += 1;
        else if (detail.source === 'cache') metrics.graphCacheHits += 1;
        else if (detail.source === 'error') metrics.graphFetchErrors += 1;

        const revision = finiteRevision(detail.revision);
        if (revision) {
            metrics.serverRevision = Math.max(metrics.serverRevision || 0, revision);
            // A successful authoritative graph fetch is itself a reconciliation point. Cache
            // hits do not prove that the server is still at the cached revision.
            if (detail.source === 'network') {
                knownRevision = revision;
                writeSessionRevision(revision);
            }
        }
        emitMetrics();
    });

    window.addEventListener('family-revision-layout-suppressed', event => {
        const count = Number(event.detail?.suppressedLayouts);
        if (Number.isFinite(count)) {
            // The reconciliation token reports the cumulative count; the final reconciliation
            // accounting records it exactly. Emit metrics here only for live debug visibility.
            emitMetrics();
        }
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

    function start() {
        if (started) return;
        started = true;
        captureDirectLoader();
        if (pageAvailable()) void checkRevision('startup');
        else pause();
    }

    window.FamilyGraphSync = Object.freeze({
        checkNow: () => checkRevision('manual'),
        reconcileNow: () => {
            if (metrics.serverRevision) queueReconciliation(metrics.serverRevision, 'manual-reconcile', { immediate: true });
            return reconcileNow();
        },
        noteActivity: () => noteActivity(),
        snapshot,
        constants: Object.freeze({
            activeIntervalMs: ACTIVE_INTERVAL_MS,
            activeWindowMs: ACTIVE_WINDOW_MS,
            idleIntervalMs: IDLE_INTERVAL_MS,
            reconcileMinIntervalMs: RECONCILE_MIN_INTERVAL_MS
        })
    });

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
