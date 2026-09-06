// Keep the desktop Slice A person pane below the actual rendered title/search/control card.
// This intentionally measures the header instead of relying on a hard-coded top offset,
// because search/import/export controls can change the title card's height.
(() => {
    if (window.__familyPersonPanePositionInstalled) return;
    window.__familyPersonPanePositionInstalled = true;

    const pane = document.getElementById('person-pane');
    if (!pane) return;

    const desktopQuery = window.matchMedia('(min-width: 769px) and (hover: hover) and (pointer: fine)');
    const GAP = 12;

    function titleCard() {
        return document.querySelector('.family-title-card') || document.querySelector('h1')?.parentElement || null;
    }

    function positionPane() {
        if (!desktopQuery.matches) {
            pane.style.removeProperty('top');
            return;
        }

        const title = titleCard();
        if (!title) {
            pane.style.top = '108px';
            return;
        }

        const rect = title.getBoundingClientRect();
        if (!Number.isFinite(rect.bottom)) return;
        pane.style.top = `${Math.ceil(rect.bottom + GAP)}px`;
    }

    let frame = 0;
    function queuePosition() {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            frame = 0;
            positionPane();
        });
    }

    const title = titleCard();
    const resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(queuePosition)
        : null;
    if (title) resizeObserver?.observe(title);

    // Import/export/search controls may be attached after the title card itself exists.
    const mutationObserver = title ? new MutationObserver(queuePosition) : null;
    mutationObserver?.observe(title, { childList: true, subtree: true, attributes: true });

    window.addEventListener('resize', queuePosition, { passive: true });
    window.addEventListener('orientationchange', queuePosition, { passive: true });
    desktopQuery.addEventListener?.('change', queuePosition);

    queuePosition();
    setTimeout(queuePosition, 80);
    setTimeout(queuePosition, 240);
})();