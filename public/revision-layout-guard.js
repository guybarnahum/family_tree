// Several legacy observers/refinement layers may independently request the same layout after
// one logical data change. Keep the first layout authoritative for a short reconciliation or
// mutation window and suppress duplicate passes with the same data signature. Also ignore
// window resize events that did not actually change the graph viewport geometry.
(() => {
    if (window.__familyRevisionLayoutGuardInstalled) return;
    window.__familyRevisionLayoutGuardInstalled = true;

    const viewport = document.getElementById('scroll-viewport');
    let lastViewportWidth = viewport?.clientWidth || 0;
    let lastViewportHeight = viewport?.clientHeight || 0;
    let noopResizeActive = false;

    window.addEventListener('resize', () => {
        const width = viewport?.clientWidth || 0;
        const height = viewport?.clientHeight || 0;
        noopResizeActive = width === lastViewportWidth && height === lastViewportHeight;
        if (!noopResizeActive) {
            lastViewportWidth = width;
            lastViewportHeight = height;
        }
        queueMicrotask(() => { noopResizeActive = false; });
    }, { capture: true, passive: true });

    function tokenIsActive(token) {
        return !!token && token.phase === 'render' &&
            Number.isFinite(token.until) && performance.now() <= token.until;
    }

    function activeToken() {
        const revision = window.__familyRevisionReconcileToken;
        if (tokenIsActive(revision)) return revision;
        const mutation = window.__familyGraphMutationLayoutToken;
        if (tokenIsActive(mutation)) return mutation;
        return null;
    }

    function dispatchSuppressed(token, reason = 'duplicate') {
        try {
            window.dispatchEvent(new CustomEvent('family-revision-layout-suppressed', {
                detail: {
                    tokenId: token?.id || null,
                    kind: token?.kind || 'revision',
                    reason,
                    suppressedLayouts: token?.suppressedLayouts || 0,
                    signature: token?.layoutSignature || ''
                }
            }));
        } catch (_) {}
    }

    function install() {
        if (!window.__familyPlanarRouterInstalled || typeof layoutAndRender !== 'function') return false;
        const current = layoutAndRender;
        if (current.__familyRevisionLayoutGuard) return true;

        const guarded = function revisionGuardedLayoutAndRender(...args) {
            if (noopResizeActive) {
                try {
                    window.dispatchEvent(new CustomEvent('family-noop-resize-layout-suppressed'));
                } catch (_) {}
                return;
            }

            const token = activeToken();
            if (token) {
                const signature = typeof dataSignature === 'string' ? dataSignature : '';
                if ((token.layoutCount || 0) > 0 && token.layoutSignature === signature) {
                    token.suppressedLayouts = (token.suppressedLayouts || 0) + 1;
                    dispatchSuppressed(token);
                    return;
                }
                token.layoutCount = (token.layoutCount || 0) + 1;
                token.layoutSignature = signature;
            }
            return current.apply(this, args);
        };

        guarded.__familyRevisionLayoutGuard = true;
        guarded.__familyRevisionLayoutBase = current;
        layoutAndRender = guarded;
        window.layoutAndRender = guarded;
        return true;
    }

    let attempts = 0;
    function waitForFinalLayout() {
        if (install()) return;
        attempts += 1;
        if (attempts < 240) setTimeout(waitForFinalLayout, 50);
        else console.warn('Revision layout guard could not find the final layout stack');
    }

    waitForFinalLayout();
})();
