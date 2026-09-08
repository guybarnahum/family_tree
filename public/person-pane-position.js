// Keep the desktop title card and person pane aligned as one right-side column.
(() => {
    if (window.__familyPersonPanePositionInstalled) return;
    window.__familyPersonPanePositionInstalled = true;

    const pane = document.getElementById('person-pane');
    const title = document.querySelector('.family-title-card') || document.querySelector('h1')?.parentElement;
    if (!pane || !title) return;

    const desktopQuery = window.matchMedia('(min-width: 769px) and (hover: hover) and (pointer: fine)');
    const GAP = 12;

    function clearDesktopAlignment() {
        pane.style.removeProperty('top');
        title.style.removeProperty('width');
        title.style.removeProperty('max-width');
        title.style.removeProperty('box-sizing');
        title.parentElement?.style.removeProperty('padding-right');
    }

    function positionPane() {
        if (!desktopQuery.matches) return clearDesktopAlignment();

        const paneRect = pane.getBoundingClientRect();
        if (!paneRect.width) return;
        const width = `${Math.round(paneRect.width)}px`;
        title.style.setProperty('width', width, 'important');
        title.style.setProperty('max-width', width, 'important');
        title.style.setProperty('box-sizing', 'border-box', 'important');

        const wrapper = title.parentElement;
        if (wrapper) {
            const rightInset = `${Math.max(0, Math.round(window.innerWidth - paneRect.right))}px`;
            wrapper.style.setProperty('padding-right', rightInset, 'important');
        }

        const rect = title.getBoundingClientRect();
        if (Number.isFinite(rect.bottom)) pane.style.top = `${Math.ceil(rect.bottom + GAP)}px`;
    }

    let frame = 0;
    function queuePosition() {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            frame = 0;
            positionPane();
        });
    }

    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(queuePosition);
        observer.observe(title);
        observer.observe(pane);
    }
    window.addEventListener('resize', queuePosition, { passive: true });
    window.addEventListener('orientationchange', queuePosition, { passive: true });
    desktopQuery.addEventListener?.('change', queuePosition);
    queuePosition();
})();
