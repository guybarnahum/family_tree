// Revision synchronization for the canonical FamilyGraphStore.
// Transport and mutation observation are owned by FamilyApi; sync only schedules revision checks
// and coalesced graph reconciliation.
(() => {
    if (window.FamilyGraphSync) return;

    const Store = window.FamilyGraphStore;
    const Api = window.FamilyApi;
    const Status = window.FamilyGraphStatus;
    if (!Store || !Api) return console.warn('Graph sync dependencies did not load');

    const ACTIVE_INTERVAL_MS = 5000;
    const ACTIVE_WINDOW_MS = 60 * 1000;
    const IDLE_INTERVAL_MS = 15 * 60 * 1000;
    const RECONCILE_MIN_INTERVAL_MS = 30 * 1000;
    const POINTER_MOVE_THROTTLE_MS = 1000;
    const REVISION_SESSION_KEY = 'family-tree.data-revision.v1';

    const sessionStartedAt = Date.now();
    let lastActivityAt = Date.now();
    let lastPointerMoveAt = 0;
    let nextCheckAt = null;
    let timer = null;
    let inFlight = false;
    let started = false;
    let revisionFailureVisible = false;
    let reconcileTimer = null;
    let nextReconcileAt = null;
    let reconcileInFlight = false;
    let lastReconcileAt = 0;
    let pendingRevision = null;
    let pendingReason = '';
    let lastMismatchRevision = null;

    const finiteRevision = value => Store.finiteRevision?.(value) || null;
    const readSessionRevision = () => {
        try { return finiteRevision(sessionStorage.getItem(REVISION_SESSION_KEY)); }
        catch (_) { return null; }
    };
    function writeSessionRevision(value) {
        const next = finiteRevision(value);
        if (!next) return;
        try { sessionStorage.setItem(REVISION_SESSION_KEY, String(next)); } catch (_) {}
    }

    const initialStore = Store.snapshot();
    let knownRevision = readSessionRevision() || initialStore.revision || null;
    const metrics = {
        revisionChecks: 0, revisionChanges: 0, bootstrapRefreshes: 0, revisionErrors: 0,
        reconciliations: 0, coalescedRevisionChanges: 0, revisionLayouts: 0,
        dataOnlyReconciliations: 0, reconcileErrors: 0,
        graphNetworkFetches: 0, graphCacheHits: 0, graphFetchErrors: 0,
        graphMutations: 0, dataMutations: 0,
        lastRevisionCheckAt: null, lastRevisionLatencyMs: null, lastRevisionError: '',
        lastGraphFetchAt: null, lastGraphFetchLatencyMs: null, lastGraphFetchSource: '',
        lastMutationAt: null, lastMutationRevision: null, lastMutationMethod: '',
        lastMutationPath: '', lastMutationScope: '',
        lastReconcileAt: null, lastReconcileRevision: null, lastReconcileReason: '',
        serverRevision: initialStore.serverRevision || initialStore.revision || null
    };

    const pageAvailable = () => document.visibilityState === 'visible' && document.hasFocus();
    const modeAt = (now = Date.now()) => !pageAvailable()
        ? 'paused'
        : (now - lastActivityAt <= ACTIVE_WINDOW_MS ? 'active' : 'idle');
    const intervalFor = (mode = modeAt()) => mode === 'active'
        ? ACTIVE_INTERVAL_MS
        : (mode === 'idle' ? IDLE_INTERVAL_MS : null);

    function storeSummary() {
        const current = Store.snapshot();
        return {
            present: !!current.graph,
            savedAt: current.savedAt || null,
            ageMs: current.graph ? Store.ageMs(current) : null,
            revision: current.revision || null,
            serverRevision: current.serverRevision || null,
            stale: !!current.stale,
            dirty: !!current.dirty,
            people: current.graph?.people?.length || 0,
            relationships: current.graph?.relationships?.length || 0,
            generation: current.generation || 0,
            source: current.source || ''
        };
    }

    function snapshot() {
        const now = Date.now();
        const mode = modeAt(now);
        const store = storeSummary();
        return {
            ...metrics, mode, intervalMs: intervalFor(mode),
            activeWindowMs: ACTIVE_WINDOW_MS, idleIntervalMs: IDLE_INTERVAL_MS,
            reconcileMinIntervalMs: RECONCILE_MIN_INTERVAL_MS,
            visible: document.visibilityState === 'visible', focused: document.hasFocus(),
            lastActivityAt, activityAgeMs: Math.max(0, now - lastActivityAt),
            nextCheckAt, nextCheckInMs: nextCheckAt ? Math.max(0, nextCheckAt - now) : null,
            nextReconcileAt, nextReconcileInMs: nextReconcileAt ? Math.max(0, nextReconcileAt - now) : null,
            pendingRevision, pendingReason, knownRevision, inFlight, reconcileInFlight,
            sessionStartedAt, sessionAgeMs: now - sessionStartedAt,
            store, cache: store,
            estimatedRevisionRowsRead: metrics.revisionChecks,
            estimatedFullGraphRowsRead: metrics.graphNetworkFetches *
                Math.max(0, store.people + store.relationships + 1)
        };
    }

    const emitMetrics = () => window.dispatchEvent(
        new CustomEvent('family-graph-sync-metrics', { detail: snapshot() })
    );

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
        const interval = delay ?? intervalFor();
        if (interval == null) return emitMetrics();
        nextCheckAt = Date.now() + interval;
        timer = setTimeout(() => void checkRevision('timer'), interval);
        emitMetrics();
    }

    function showRevisionFailure(error) {
        if (!Status) return;
        const current = Store.snapshot();
        if (!current.graph) return;
        const classified = Status.classify(error);
        Status.show({
            kind: classified.kind,
            mode: 'banner',
            savedAt: current.savedAt,
            retry: () => checkRevision('retry'),
            title: `מוצג עותק שמור ${Status.ageLabel(current.savedAt)}`,
            description: classified.kind === 'quota'
                ? 'מסד הנתונים הגיע למגבלת השימוש; העץ המוצג הוא מהטעינה האחרונה.'
                : 'לא ניתן לבדוק כרגע אם העץ השתנה; מוצג העותק האחרון שנשמר.',
            details: { status: classified, text: classified.text }
        });
        revisionFailureVisible = true;
    }

    async function reconcileGraph(targetRevision) {
        Store.markStale(targetRevision);
        const before = typeof dataSignature === 'string' ? dataSignature : '';
        let result = null;
        if (typeof loadTree === 'function') result = await loadTree(null, false);
        else if (typeof window.startFamilyGraph === 'function') result = await window.startFamilyGraph();
        else await Store.read({ refresh: true, reason: 'sync-reconcile' });

        const refreshed = Store.snapshot();
        if (!refreshed.graph || refreshed.stale) {
            throw new Error('Graph reconciliation did not obtain a fresh canonical graph');
        }
        const after = typeof dataSignature === 'string' ? dataSignature : '';
        return {
            refreshed,
            rendered: !!result?.committed || (!!before && !!after && before !== after)
        };
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
        emitMetrics();

        try {
            const { refreshed, rendered } = await reconcileGraph(targetRevision);
            const reconciledRevision = refreshed.revision || targetRevision;
            knownRevision = reconciledRevision;
            writeSessionRevision(knownRevision);
            metrics.serverRevision = Math.max(metrics.serverRevision || 0, reconciledRevision);
            metrics.reconciliations += 1;
            if (rendered) metrics.revisionLayouts += 1;
            else metrics.dataOnlyReconciliations += 1;
            window.dispatchEvent(new CustomEvent('family-graph-synced', {
                detail: {
                    revision: reconciledRevision,
                    targetRevision,
                    reason: 'coalesced-revision',
                    sourceReason: reason,
                    rendered
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
            pendingRevision = pendingRevision ? Math.max(pendingRevision, targetRevision) : targetRevision;
            if (!pendingReason) pendingReason = reason;
            showRevisionFailure(error);
            return null;
        } finally {
            reconcileInFlight = false;
            if (pendingRevision && pageAvailable()) queueReconciliation(pendingRevision, pendingReason || 'coalesced');
            emitMetrics();
        }
    }

    function queueReconciliation(value, reason = 'remote-revision', { immediate = false } = {}) {
        const next = finiteRevision(value);
        if (!next) return;
        if (pendingRevision && next !== pendingRevision) metrics.coalescedRevisionChanges += 1;
        pendingRevision = pendingRevision ? Math.max(pendingRevision, next) : next;
        pendingReason = reason || pendingReason;
        if (!pageAvailable() || reconcileInFlight) return emitMetrics();

        const now = Date.now();
        const earliest = immediate || !lastReconcileAt ? now : lastReconcileAt + RECONCILE_MIN_INTERVAL_MS;
        const dueAt = Math.max(now, earliest);
        if (reconcileTimer && nextReconcileAt && nextReconcileAt <= dueAt) return emitMetrics();
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
            const response = await Api.request('/api/graph/revision', { cache: 'no-store' });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                const error = new Error(body || `HTTP ${response.status}`);
                error.status = response.status;
                error.body = body;
                throw error;
            }
            const payload = await response.json();
            const server = finiteRevision(payload?.revision) || Api.revisionFromResponse(response);
            if (!server) throw new Error('Graph revision response was invalid');

            metrics.serverRevision = server;
            metrics.lastRevisionLatencyMs = Math.round(performance.now() - startedAt);
            Store.acknowledgeRevision(server);
            if (revisionFailureVisible) {
                Status?.clear();
                revisionFailureVisible = false;
            }

            const current = Store.snapshot();
            if (!knownRevision) knownRevision = current.revision || null;
            if (!knownRevision) {
                metrics.bootstrapRefreshes += 1;
                queueReconciliation(server, 'bootstrap', { immediate: true });
            } else if (knownRevision !== server) {
                if (lastMismatchRevision !== server) {
                    metrics.revisionChanges += 1;
                    lastMismatchRevision = server;
                }
                queueReconciliation(server, reason === 'retry' ? 'retry' : 'remote-revision', {
                    immediate: reason === 'retry'
                });
            } else {
                lastMismatchRevision = null;
                if (current.dirty || current.stale) {
                    queueReconciliation(server, current.dirty ? 'local-dirty' : 'stale-store', {
                        immediate: reason === 'retry'
                    });
                }
            }
            return server;
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
        if (pageAvailable() && previousMode === 'idle') return void checkRevision('activity');
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
        if (!pageAvailable()) return pause();
        void checkRevision(reason);
    }

    window.addEventListener('family-api-mutation', event => {
        const detail = event.detail || {};
        const nextRevision = finiteRevision(detail.revision);
        if (nextRevision) {
            knownRevision = nextRevision;
            writeSessionRevision(nextRevision);
            metrics.serverRevision = nextRevision;
        }
        if (detail.scope === 'graph') metrics.graphMutations += 1;
        metrics.dataMutations += 1;
        metrics.lastMutationAt = detail.at || Date.now();
        metrics.lastMutationRevision = nextRevision;
        metrics.lastMutationMethod = detail.method || '';
        metrics.lastMutationPath = detail.path || '';
        metrics.lastMutationScope = detail.scope || '';
        emitMetrics();
    });

    window.addEventListener('family-graph-store-fetch', event => {
        const detail = event.detail || {};
        metrics.lastGraphFetchAt = detail.at || Date.now();
        metrics.lastGraphFetchSource = detail.source || '';
        if (Number.isFinite(detail.latencyMs)) metrics.lastGraphFetchLatencyMs = detail.latencyMs;
        if (detail.source === 'network') metrics.graphNetworkFetches += 1;
        else if (detail.source === 'store') metrics.graphCacheHits += 1;
        else if (detail.source === 'error') metrics.graphFetchErrors += 1;
        const nextRevision = finiteRevision(detail.revision);
        if (nextRevision) {
            metrics.serverRevision = Math.max(metrics.serverRevision || 0, nextRevision);
            if (detail.source === 'network') {
                knownRevision = nextRevision;
                writeSessionRevision(nextRevision);
            }
        }
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

    function start() {
        if (started) return;
        started = true;
        if (pageAvailable()) void checkRevision('startup');
        else pause();
    }

    window.FamilyGraphSync = Object.freeze({
        checkNow: () => checkRevision('manual'),
        reconcileNow: () => {
            if (metrics.serverRevision) {
                queueReconciliation(metrics.serverRevision, 'manual-reconcile', { immediate: true });
            }
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
