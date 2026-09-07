// Developer-only graph synchronization tray. Toggle with F1 (or Ctrl+Shift+D).
(() => {
    if (window.FamilyGraphDebug) return;

    const Sync = window.FamilyGraphSync;
    if (!Sync) {
        console.warn('Graph debug sync dependency did not load');
        return;
    }

    const style = document.createElement('style');
    style.textContent = `
        #family-graph-debug {
            position: fixed;
            left: 12px;
            right: 12px;
            bottom: 12px;
            z-index: 12000;
            display: none;
            max-height: min(46vh, 430px);
            overflow: auto;
            box-sizing: border-box;
            padding: 12px 14px 10px;
            border: 1px solid rgba(52,78,65,.28);
            border-radius: 14px;
            background: rgba(247,248,244,.97);
            box-shadow: 0 16px 48px rgba(25,35,28,.22);
            color: #344e41;
            direction: ltr;
            text-align: left;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            line-height: 1.35;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }
        #family-graph-debug.open { display: block; }
        .family-graph-debug-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
        }
        .family-graph-debug-title {
            display: flex;
            align-items: baseline;
            gap: 9px;
            min-width: 0;
            font-weight: 700;
            font-size: 12px;
        }
        .family-graph-debug-title small {
            color: #7f8a80;
            font-weight: 500;
            font-size: 9px;
        }
        .family-graph-debug-close {
            width: 27px;
            height: 27px;
            flex: 0 0 27px;
            border: 1px solid rgba(52,78,65,.18);
            border-radius: 999px;
            background: rgba(255,255,255,.75);
            color: #344e41;
            cursor: pointer;
            font: 700 15px/1 Inter, sans-serif;
        }
        .family-graph-debug-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 7px;
        }
        .family-graph-debug-cell {
            min-width: 0;
            padding: 7px 8px;
            border-radius: 8px;
            background: rgba(52,78,65,.045);
        }
        .family-graph-debug-label {
            display: block;
            margin-bottom: 2px;
            color: #879087;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: .035em;
            text-transform: uppercase;
        }
        .family-graph-debug-value {
            display: block;
            overflow-wrap: anywhere;
            color: #344e41;
            font-size: 11px;
            font-weight: 650;
        }
        .family-graph-debug-wide { grid-column: span 2; }
        .family-graph-debug-error .family-graph-debug-value { color: #8d4a4a; }
        .family-graph-debug-foot {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 16px;
            margin-top: 9px;
            padding-top: 8px;
            border-top: 1px solid rgba(52,78,65,.10);
            color: #8a948b;
            font-size: 9px;
        }
        @media (max-width: 760px) {
            #family-graph-debug {
                left: 7px;
                right: 7px;
                bottom: max(7px, env(safe-area-inset-bottom));
                max-height: 58vh;
                padding: 10px;
            }
            .family-graph-debug-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media print { #family-graph-debug { display: none !important; } }
    `;
    document.head.appendChild(style);

    const pane = document.createElement('aside');
    pane.id = 'family-graph-debug';
    pane.setAttribute('aria-hidden', 'true');
    pane.innerHTML = `
        <div class="family-graph-debug-head">
            <div class="family-graph-debug-title">
                <span>Family graph sync</span>
                <small>F1 · Ctrl+Shift+D</small>
            </div>
            <button type="button" class="family-graph-debug-close" aria-label="Close debug information">×</button>
        </div>
        <div class="family-graph-debug-grid"></div>
        <div class="family-graph-debug-foot">
            <span>revision endpoint: /api/graph/revision</span>
            <span>one-row D1 revision query per check</span>
            <span class="family-graph-debug-build"></span>
        </div>
    `;
    document.body.appendChild(pane);

    const grid = pane.querySelector('.family-graph-debug-grid');
    const buildNode = pane.querySelector('.family-graph-debug-build');
    let visible = false;
    let renderTimer = null;

    const cells = new Map();
    const definitions = [
        ['mode', 'Sync state'],
        ['frequency', 'Revision frequency'],
        ['page', 'Page'],
        ['next', 'Next check'],
        ['revisions', 'Revisions'],
        ['cacheState', 'Cache state'],
        ['cacheAge', 'Cache age'],
        ['graphSize', 'Cached graph'],
        ['checks', 'Revision checks'],
        ['rows', 'Est. revision rows'],
        ['changes', 'Server revision changes'],
        ['bootstrap', 'Bootstrap refreshes'],
        ['repairs', 'Local state repairs'],
        ['latency', 'Last check latency'],
        ['graphReads', 'Full graph fetches'],
        ['cacheHits', 'Graph cache hits'],
        ['graphRows', 'Est. full graph rows'],
        ['mutations', 'Graph mutations'],
        ['lastMutation', 'Last graph mutation', 'wide'],
        ['activity', 'Last activity'],
        ['lastCheck', 'Last revision check'],
        ['lastGraph', 'Last graph fetch'],
        ['session', 'Session age'],
        ['legacy', 'Legacy 5s graph poll'],
        ['error', 'Last revision error', 'wide error']
    ];

    for (const [key, label, flags = ''] of definitions) {
        const cell = document.createElement('div');
        cell.className = 'family-graph-debug-cell';
        if (flags.includes('wide')) cell.classList.add('family-graph-debug-wide');
        if (flags.includes('error')) cell.classList.add('family-graph-debug-error');
        const labelNode = document.createElement('span');
        labelNode.className = 'family-graph-debug-label';
        labelNode.textContent = label;
        const valueNode = document.createElement('span');
        valueNode.className = 'family-graph-debug-value';
        valueNode.textContent = '—';
        cell.append(labelNode, valueNode);
        grid.appendChild(cell);
        cells.set(key, valueNode);
    }

    function set(key, value) {
        const node = cells.get(key);
        if (node) node.textContent = value ?? '—';
    }

    function duration(ms) {
        if (ms == null || !Number.isFinite(ms)) return '—';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        const seconds = ms / 1000;
        if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
        const minutes = seconds / 60;
        if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
        const hours = minutes / 60;
        return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
    }

    function clock(timestamp) {
        if (!timestamp) return '—';
        try { return new Date(timestamp).toLocaleTimeString([], { hour12: false }); }
        catch (_) { return '—'; }
    }

    function frequency(snapshot) {
        if (snapshot.mode === 'paused') return 'stopped';
        if (snapshot.mode === 'active') return '5s';
        if (snapshot.mode === 'idle') return '15m';
        return duration(snapshot.intervalMs);
    }

    function render() {
        if (!visible) return;
        const s = Sync.snapshot();
        const cache = s.cache || {};
        const cacheState = !cache.present
            ? 'missing'
            : cache.dirty
                ? 'DIRTY'
                : cache.stale
                    ? 'STALE'
                    : 'clean';

        set('mode', String(s.mode || '—').toUpperCase());
        set('frequency', frequency(s));
        set('page', `${s.visible ? 'visible' : 'hidden'} / ${s.focused ? 'focused' : 'blurred'}`);
        set('next', s.nextCheckInMs == null ? '—' : duration(s.nextCheckInMs));
        set('revisions', `local ${cache.revision ?? '—'} · server ${s.serverRevision ?? cache.serverRevision ?? '—'}`);
        set('cacheState', cacheState);
        set('cacheAge', duration(cache.ageMs));
        set('graphSize', `${cache.people || 0} people · ${cache.relationships || 0} rels`);
        set('checks', String(s.revisionChecks || 0));
        set('rows', `~${s.estimatedRevisionRowsRead || 0}`);
        set('changes', String(s.revisionChanges || 0));
        set('bootstrap', String(s.bootstrapRefreshes || 0));
        set('repairs', String(s.stateRepairs || 0));
        set('latency', duration(s.lastRevisionLatencyMs));
        set('graphReads', String(s.graphNetworkFetches || 0));
        set('cacheHits', String(s.graphCacheHits || 0));
        set('graphRows', `~${s.estimatedFullGraphRowsRead || 0}`);
        set('mutations', String(s.graphMutations || 0));
        set('lastMutation', s.lastMutationAt
            ? `${s.lastMutationMethod || '?'} ${s.lastMutationPath || '?'} · rev ${s.lastMutationRevision ?? '—'} @ ${clock(s.lastMutationAt)}`
            : 'none');
        set('activity', `${duration(s.activityAgeMs)} ago`);
        set('lastCheck', clock(s.lastRevisionCheckAt));
        set('lastGraph', s.lastGraphFetchAt
            ? `${s.lastGraphFetchSource || '?'} @ ${clock(s.lastGraphFetchAt)}`
            : '—');
        set('session', duration(s.sessionAgeMs));
        set('legacy', window.loadTree?.__familyRevisionAware ? 'suppressed' : 'unknown');
        set('error', s.lastRevisionError || 'none');

        const build = document.querySelector('meta[name="family-tree-build"]')?.content || 'dev';
        buildNode.textContent = `build ${build}`;
    }

    function startRenderLoop() {
        if (renderTimer) return;
        render();
        renderTimer = setInterval(render, 500);
    }

    function stopRenderLoop() {
        if (!renderTimer) return;
        clearInterval(renderTimer);
        renderTimer = null;
    }

    function setVisible(next) {
        visible = !!next;
        pane.classList.toggle('open', visible);
        pane.setAttribute('aria-hidden', visible ? 'false' : 'true');
        if (visible) startRenderLoop();
        else stopRenderLoop();
    }

    function toggle() {
        setVisible(!visible);
    }

    pane.querySelector('.family-graph-debug-close').addEventListener('click', () => setVisible(false));

    window.addEventListener('keydown', event => {
        const f1 = event.key === 'F1';
        const fallback = event.ctrlKey && event.shiftKey && String(event.key).toLowerCase() === 'd';
        if (!f1 && !fallback) return;
        event.preventDefault();
        event.stopPropagation();
        toggle();
    }, true);

    window.addEventListener('family-graph-sync-metrics', () => {
        if (visible) render();
    });

    window.FamilyGraphDebug = Object.freeze({
        toggle,
        show: () => setVisible(true),
        hide: () => setVisible(false),
        isVisible: () => visible
    });
})();
