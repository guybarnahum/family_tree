// Opt-in mobile input/focus diagnostics. Activate with ?debug=input.
(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('debug') !== 'input') return;
    if (window.__familyMobileInputDebugInstalled) return;
    window.__familyMobileInputDebugInstalled = true;

    const started = performance.now();
    const events = [];
    const MAX_EVENTS = 28;
    let copying = false;

    const panel = document.createElement('section');
    panel.id = 'family-mobile-input-debug';
    panel.setAttribute('aria-label', 'Mobile input diagnostics; tap to copy');
    panel.setAttribute('role', 'button');
    panel.tabIndex = 0;
    panel.style.cssText = [
        'position:fixed',
        'top:max(4px, env(safe-area-inset-top))',
        'left:4px',
        'right:4px',
        'z-index:100000',
        'max-height:42dvh',
        'overflow:auto',
        'padding:7px 8px',
        'border-radius:8px',
        'background:rgba(12,16,14,.92)',
        'color:#d9f7df',
        'font:10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
        'direction:ltr',
        'text-align:left',
        'white-space:pre-wrap',
        'pointer-events:auto',
        'touch-action:manipulation',
        'user-select:none',
        '-webkit-user-select:none',
        'cursor:copy',
        'box-shadow:0 4px 18px rgba(0,0,0,.3)'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:700;color:#fff;margin-bottom:4px';
    const defaultHeader = 'INPUT DEBUG · TAP TO COPY';
    header.textContent = defaultHeader;
    const output = document.createElement('div');
    panel.append(header, output);
    document.body.appendChild(panel);

    function describeElement(element) {
        if (!(element instanceof Element)) return 'none';
        const parts = [element.tagName.toLowerCase()];
        if (element.id) parts.push(`#${element.id}`);
        const className = typeof element.className === 'string'
            ? element.className.trim().split(/\s+/u).filter(Boolean).slice(0, 2)
            : [];
        if (className.length) parts.push(`.${className.join('.')}`);
        if (element.getAttribute('contenteditable') === 'true') parts.push('[ce]');
        if (element.dataset?.field) parts.push(`[field=${element.dataset.field}]`);
        if (element.dataset?.metaKey) parts.push(`[meta=${element.dataset.metaKey}]`);
        if (element instanceof HTMLInputElement) parts.push(`[type=${element.type}]`);
        return parts.join('');
    }

    function viewportSummary() {
        const vv = window.visualViewport;
        return `wh=${window.innerWidth}x${window.innerHeight}` +
            (vv ? ` vv=${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : '') +
            ` focus=${document.hasFocus() ? 1 : 0}`;
    }

    function traceText() {
        return events.join('\n');
    }

    function log(kind, detail = '') {
        const active = describeElement(document.activeElement);
        const elapsed = Math.round(performance.now() - started);
        events.push(`${String(elapsed).padStart(5)} ${kind.padEnd(12)} ${detail} active=${active} ${viewportSummary()}`.trim());
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
        output.textContent = traceText();
        panel.scrollTop = panel.scrollHeight;
        window.__familyMobileInputDebug = [...events];
    }

    async function copyTrace() {
        if (copying) return;
        copying = true;
        const value = traceText();
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                const area = document.createElement('textarea');
                area.value = value;
                area.readOnly = true;
                area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                document.body.appendChild(area);
                area.select();
                document.execCommand('copy');
                area.remove();
            }
            header.textContent = 'COPIED ✓';
        } catch (_) {
            header.textContent = 'COPY FAILED';
        } finally {
            setTimeout(() => {
                header.textContent = defaultHeader;
                copying = false;
            }, 900);
        }
    }

    panel.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void copyTrace();
    });
    panel.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        void copyTrace();
    });

    function eventDetail(event) {
        const target = describeElement(event.target);
        const related = describeElement(event.relatedTarget);
        return `${target}${event.relatedTarget ? ` -> ${related}` : ''}`;
    }

    for (const type of ['pointerdown', 'touchstart', 'focusin', 'focusout', 'click', 'input', 'change']) {
        document.addEventListener(type, event => {
            if (copying || panel.contains(event.target)) return;
            log(type, eventDetail(event));
        }, {
            capture: true,
            passive: type === 'touchstart'
        });
    }

    for (const type of ['focus', 'blur', 'resize', 'orientationchange']) {
        window.addEventListener(type, () => {
            if (!copying) log(`window:${type}`);
        }, { capture: true, passive: true });
    }

    window.visualViewport?.addEventListener('resize', () => {
        if (!copying) log('vv:resize');
    }, { passive: true });
    window.visualViewport?.addEventListener('scroll', () => {
        if (!copying) log('vv:scroll');
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!copying) log('visibility', document.visibilityState);
    }, true);

    for (const type of [
        'family-selection-changed',
        'family-graph-rendered',
        'family-person-pane-saved',
        'family-graph-synced',
        'family-draft-expired'
    ]) {
        window.addEventListener(type, event => {
            if (copying) return;
            const detail = event.detail || {};
            const reason = detail.reason || detail.source || '';
            const id = detail.id || detail.rootId || detail.personId || '';
            log(type.replace('family-', ''), `${reason}${id ? ` ${id}` : ''}`.trim());
        }, true);
    }

    const watchPane = () => {
        const body = document.querySelector('#person-pane .person-pane-body');
        if (!body || body.dataset.inputDebugObserved === 'true') return;
        body.dataset.inputDebugObserved = 'true';
        new MutationObserver(mutations => {
            if (copying) return;
            const structural = mutations.some(mutation => mutation.type === 'childList' &&
                (mutation.addedNodes.length || mutation.removedNodes.length));
            if (structural) log('pane:mutate');
        }).observe(body, { childList: true, subtree: true });
        log('pane:observe');
    };

    new MutationObserver(watchPane).observe(document.body, { childList: true, subtree: true });
    watchPane();
    log('debug:start');
})();
