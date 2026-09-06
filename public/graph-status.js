// Graph resilience status UI. This owns only degraded-state presentation and error
// classification; graph projection/layout remain completely unaware of network/D1 state.
(() => {
    if (window.FamilyGraphStatus) return;

    const viewport = document.getElementById('scroll-viewport');
    if (!viewport) return;

    let retryHandler = null;

    const style = document.createElement('style');
    style.textContent = `
        .graph-status-full,
        .graph-status-banner {
            direction: rtl;
            font-family: Inter, sans-serif;
            color: #344e41;
            box-sizing: border-box;
        }

        .graph-status-full {
            position: fixed;
            left: 50%;
            top: 52%;
            width: min(520px, calc(100vw - 32px));
            transform: translate(-50%, -50%);
            z-index: 500;
            display: none;
            padding: 30px 30px 26px;
            border: 1px solid rgba(163,177,138,.38);
            border-radius: 22px;
            background: rgba(253,251,247,.97);
            box-shadow: 0 18px 55px rgba(52,78,65,.12);
            text-align: center;
            pointer-events: auto;
        }
        .graph-status-full.open { display: block; }
        .graph-status-icon {
            width: 64px;
            height: 64px;
            margin: 0 auto 16px;
            display: grid;
            place-items: center;
            border-radius: 999px;
            background: rgba(163,177,138,.13);
            color: #588157;
        }
        .graph-status-icon svg { width: 34px; height: 34px; display: block; }

        /* D1 quota failures are a product/service bug state, not a server glyph.
           Give that state a much stronger visual anchor without changing other errors. */
        .graph-status-full[data-kind="quota"] .graph-status-icon {
            width: 168px;
            height: 168px;
            margin-bottom: 14px;
            background: transparent;
        }
        .graph-status-full[data-kind="quota"] .graph-status-icon svg {
            width: 128px;
            height: 128px;
        }

        .graph-status-title {
            margin: 0 0 8px;
            font: 700 24px/1.3 "Frank Ruhl Libre", serif;
            color: #344e41;
        }
        .graph-status-description {
            margin: 0 auto;
            max-width: 430px;
            color: #667168;
            font: 400 14px/1.65 Inter, sans-serif;
        }
        .graph-status-actions {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-top: 19px;
        }
        .graph-status-retry {
            min-height: 38px;
            padding: 0 18px;
            border: 1px solid #588157;
            border-radius: 999px;
            background: #588157;
            color: white;
            cursor: pointer;
            font: 600 12px/1 Inter, sans-serif;
        }
        .graph-status-retry:disabled { opacity: .5; cursor: default; }
        .graph-status-details {
            margin-top: 16px;
            color: #8b948c;
            font: 400 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .graph-status-details summary {
            cursor: pointer;
            list-style: none;
            font-family: Inter, sans-serif;
            font-weight: 500;
        }
        .graph-status-details summary::-webkit-details-marker { display: none; }
        .graph-status-details pre {
            margin: 8px 0 0;
            padding: 9px 11px;
            border-radius: 9px;
            background: rgba(52,78,65,.05);
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            direction: ltr;
            text-align: left;
        }

        .graph-status-banner {
            position: fixed;
            left: 50%;
            top: 118px;
            width: min(680px, calc(100vw - 28px));
            transform: translateX(-50%);
            z-index: 480;
            display: none;
            align-items: center;
            gap: 10px;
            padding: 9px 11px 9px 14px;
            border: 1px solid rgba(156,123,48,.28);
            border-radius: 13px;
            background: rgba(255,250,236,.97);
            box-shadow: 0 8px 24px rgba(52,78,65,.10);
            pointer-events: auto;
        }
        .graph-status-banner.open { display: flex; }
        .graph-status-banner-icon {
            flex: 0 0 28px;
            width: 28px;
            height: 28px;
            display: grid;
            place-items: center;
            color: #8b6e27;
        }
        .graph-status-banner-icon svg { width: 22px; height: 22px; }
        .graph-status-banner-copy { flex: 1 1 auto; min-width: 0; }
        .graph-status-banner-title { font: 600 12px/1.35 Inter, sans-serif; }
        .graph-status-banner-description {
            margin-top: 2px;
            color: #807765;
            font: 400 10px/1.35 Inter, sans-serif;
        }
        .graph-status-banner .graph-status-retry {
            flex: 0 0 auto;
            min-height: 31px;
            padding: 0 12px;
            background: transparent;
            color: #6e5927;
            border-color: rgba(139,110,39,.35);
            font-size: 10px;
        }

        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            .graph-status-full {
                top: 47%;
                width: calc(100dvw - 28px);
                padding: 25px 20px 22px;
                border-radius: 20px;
            }
            .graph-status-full[data-kind="quota"] .graph-status-icon {
                width: 140px;
                height: 140px;
                margin-bottom: 10px;
            }
            .graph-status-full[data-kind="quota"] .graph-status-icon svg {
                width: 108px;
                height: 108px;
            }
            .graph-status-title { font-size: 22px; }
            .graph-status-description { font-size: 13px; }
            .graph-status-banner {
                top: 136px;
                width: calc(100dvw - 22px);
                align-items: flex-start;
            }
            .graph-status-banner-description { display: none; }
        }

        @media print {
            .graph-status-full, .graph-status-banner { display: none !important; }
        }
    `;
    document.head.appendChild(style);

    const full = document.createElement('section');
    full.className = 'graph-status-full';
    full.setAttribute('role', 'status');
    full.setAttribute('aria-live', 'polite');
    full.innerHTML = `
        <div class="graph-status-icon" aria-hidden="true"></div>
        <h2 class="graph-status-title"></h2>
        <p class="graph-status-description"></p>
        <div class="graph-status-actions">
            <button type="button" class="graph-status-retry">נסה שוב</button>
        </div>
        <details class="graph-status-details">
            <summary>פרטים</summary>
            <pre></pre>
        </details>
    `;
    document.body.appendChild(full);

    const banner = document.createElement('section');
    banner.className = 'graph-status-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
        <div class="graph-status-banner-icon" aria-hidden="true"></div>
        <div class="graph-status-banner-copy">
            <div class="graph-status-banner-title"></div>
            <div class="graph-status-banner-description"></div>
        </div>
        <button type="button" class="graph-status-retry">נסה שוב</button>
    `;
    document.body.appendChild(banner);

    const BUG_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9 7.5 7 5.5M15 7.5l2-2M8 12H4.5M19.5 12H16M9 16.5l-2 2M15 16.5l2 2"/><rect x="8" y="7" width="8" height="10" rx="4"/><path d="M12 7V4M12 17v3"/></svg>`;

    const ICONS = {
        connectivity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2.8 8.9a14.3 14.3 0 0 1 18.4 0"/><path d="M6.2 12.4a9.2 9.2 0 0 1 11.6 0"/><path d="M9.5 15.8a4.3 4.3 0 0 1 5 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/></svg>`,
        quota: BUG_ICON,
        server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><circle cx="7.5" cy="7" r=".8" fill="currentColor" stroke="none"/><circle cx="7.5" cy="17" r=".8" fill="currentColor" stroke="none"/><path d="M11 7h6M11 17h6"/></svg>`,
        configuration: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M14.8 6.2a4 4 0 0 0-5 5L4.3 16.7a2.1 2.1 0 1 0 3 3l5.5-5.5a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z"/></svg>`,
        data: BUG_ICON
    };

    const COPY = {
        connectivity: {
            title: 'אין חיבור לרשת',
            description: 'לא ניתן להגיע לשרת כרגע. בדקו את החיבור ונסו שוב.'
        },
        quota: {
            title: 'מסד הנתונים אינו זמין כרגע',
            description: 'הגענו למגבלת השימוש של Cloudflare D1. עץ המשפחה עצמו לא נפגע; אפשר לנסות שוב מאוחר יותר.'
        },
        server: {
            title: 'שגיאה זמנית בשרת',
            description: 'לא הצלחנו לטעון את עץ המשפחה כרגע. נסו שוב בעוד רגע.'
        },
        configuration: {
            title: 'השירות אינו זמין',
            description: 'נדרשת בדיקה של תצורת השרת לפני שניתן יהיה לטעון את הנתונים.'
        },
        data: {
            title: 'לא ניתן להציג את עץ המשפחה',
            description: 'הנתונים לא נטענו או לא ניתנים להצגה כרגע. אפשר לנסות שוב.'
        }
    };

    function classify(error) {
        const status = Number(error?.status) || null;
        const text = String(error?.body || error?.message || error || '');
        const lower = text.toLowerCase();

        if (navigator.onLine === false || error?.name === 'TypeError' && !status) {
            return { kind: 'connectivity', transient: true, status, text };
        }
        if (status === 429 || /d1/.test(lower) && /(limit|quota|free.?tier|too many|exceeded)/.test(lower) ||
            /(quota|free.?tier|daily limit|request limit|exceeded)/.test(lower)) {
            return { kind: 'quota', transient: true, status, text };
        }
        if (status === 401 || status === 403 || /binding missing|configuration|not configured/.test(lower)) {
            return { kind: 'configuration', transient: false, status, text };
        }
        if (status && status >= 500) {
            return { kind: 'server', transient: true, status, text };
        }
        return { kind: 'data', transient: false, status, text };
    }

    function ageLabel(savedAt) {
        if (!Number.isFinite(savedAt)) return '';
        const minutes = Math.max(0, Math.round((Date.now() - savedAt) / 60000));
        if (minutes < 1) return 'מהטעינה האחרונה';
        if (minutes < 60) return `מלפני ${minutes} דקות`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `מלפני ${hours} שעות`;
        const days = Math.round(hours / 24);
        return `מלפני ${days} ימים`;
    }

    function technicalDetails(status, details) {
        const lines = [];
        if (status?.status) lines.push(`HTTP ${status.status}`);
        if (status?.text) lines.push(status.text.slice(0, 900));
        if (details) lines.push(String(details).slice(0, 900));
        lines.push(new Date().toISOString());
        return lines.join('\n');
    }

    async function retry(button) {
        if (typeof retryHandler !== 'function') return;
        button.disabled = true;
        try { await retryHandler(); }
        finally { button.disabled = false; }
    }

    full.querySelector('.graph-status-retry').addEventListener('click', event => void retry(event.currentTarget));
    banner.querySelector('.graph-status-retry').addEventListener('click', event => void retry(event.currentTarget));

    function show({ kind = 'data', mode = 'full', title, description, details, retry: onRetry, savedAt } = {}) {
        retryHandler = typeof onRetry === 'function' ? onRetry : null;
        const copy = COPY[kind] || COPY.data;
        const icon = ICONS[kind] || ICONS.data;
        const retryVisible = !!retryHandler;

        full.dataset.kind = kind;
        banner.dataset.kind = kind;

        if (mode === 'banner') {
            full.classList.remove('open');
            banner.querySelector('.graph-status-banner-icon').innerHTML = icon;
            banner.querySelector('.graph-status-banner-title').textContent = title ||
                (savedAt ? `מוצג עותק שמור ${ageLabel(savedAt)}` : copy.title);
            banner.querySelector('.graph-status-banner-description').textContent = description || copy.description;
            banner.querySelector('.graph-status-retry').hidden = !retryVisible;
            banner.classList.add('open');
            return;
        }

        banner.classList.remove('open');
        full.querySelector('.graph-status-icon').innerHTML = icon;
        full.querySelector('.graph-status-title').textContent = title || copy.title;
        full.querySelector('.graph-status-description').textContent = description || copy.description;
        full.querySelector('.graph-status-retry').hidden = !retryVisible;
        const detailsNode = full.querySelector('.graph-status-details');
        const text = technicalDetails({ kind, ...details?.status }, details?.text || details);
        detailsNode.hidden = !text;
        detailsNode.querySelector('pre').textContent = text;
        full.classList.add('open');
    }

    function clear() {
        retryHandler = null;
        full.classList.remove('open');
        banner.classList.remove('open');
    }

    window.FamilyGraphStatus = Object.freeze({ show, clear, classify, ageLabel });
})();