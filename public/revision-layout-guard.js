// During one remote revision reconciliation, several observers may independently request the
// same layout. Keep the first layout authoritative and suppress duplicate passes with the same
// data signature for a short render window. Normal user-driven layouts are untouched.
(() => {
    if (window.__familyRevisionLayoutGuardInstalled) return;
    window.__familyRevisionLayoutGuardInstalled = true;

    function activeToken() {
        const token = window.__familyRevisionReconcileToken;
        if (!token || token.phase !== 'render') return null;
        if (!Number.isFinite(token.until) || performance.now() > token.until) return null;
        return token;
    }

    function dispatchSuppressed(token) {
        try {
            window.dispatchEvent(new CustomEvent('family-revision-layout-suppressed', {
                detail: {
                    reconciliationId: token.id,
                    suppressedLayouts: token.suppressedLayouts || 0,
                    signature: token.layoutSignature || ''
                }
            }));
        } catch (_) {}
    }

    function install() {
        if (!window.__familyPlanarRouterInstalled || typeof layoutAndRender !== 'function') return false;
        const current = layoutAndRender;
        if (current.__familyRevisionLayoutGuard) return true;

        const guarded = function revisionGuardedLayoutAndRender(...args) {
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
