// Keep the desktop Slice A title card and person pane aligned as one right-side column.
// The pane remains below the actual rendered title/search/control card, so header growth
// never causes overlap and both surfaces keep the same width/right edge.
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

    function clearDesktopAlignment(title) {
        pane.style.removeProperty('top');
        if (!title) return;
        title.style.removeProperty('width');
        title.style.removeProperty('max-width');
        title.style.removeProperty('box-sizing');
        title.parentElement?.style.removeProperty('padding-right');
    }

    function alignTitleToPane(title) {
        const paneRect = pane.getBoundingClientRect();
        if (!paneRect.width) return;

        const width = `${Math.round(paneRect.width)}px`;
        if (title.style.getPropertyValue('width') !== width) {
            title.style.setProperty('width', width, 'important');
            title.style.setProperty('max-width', width, 'important');
            title.style.setProperty('box-sizing', 'border-box', 'important');
        }

        // The title lives in the fixed top toolbar. Match that toolbar's right inset to the
        // pane's actual fixed right edge, then RTL flex layout keeps both right edges exact.
        const wrapper = title.parentElement;
        if (wrapper) {
            const rightInset = `${Math.max(0, Math.round(window.innerWidth - paneRect.right))}px`;
            if (wrapper.style.getPropertyValue('padding-right') !== rightInset) {
                wrapper.style.setProperty('padding-right', rightInset, 'important');
            }
        }
    }

    function positionPane() {
        const title = titleCard();
        if (!desktopQuery.matches) {
            clearDesktopAlignment(title);
            return;
        }

        if (!title) {
            pane.style.top = '108px';
            return;
        }

        alignTitleToPane(title);
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
    resizeObserver?.observe(pane);

    // Import/export/search controls may be attached after the title card itself exists.
    // ResizeObserver handles geometry; child/text mutations catch content arriving late
    // without observing the style attribute we update ourselves.
    const mutationObserver = title ? new MutationObserver(queuePosition) : null;
    mutationObserver?.observe(title, {
        childList: true,
        subtree: true,
        characterData: true
    });

    window.addEventListener('resize', queuePosition, { passive: true });
    window.addEventListener('orientationchange', queuePosition, { passive: true });
    desktopQuery.addEventListener?.('change', queuePosition);

    queuePosition();
    setTimeout(queuePosition, 80);
    setTimeout(queuePosition, 240);
})();
