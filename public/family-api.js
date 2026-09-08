// Explicit browser transport for family API requests.
// Owns native fetch access, mutation revision events, and the small resilient media catalogs.
(() => {
    if (window.FamilyApi) return;

    const nativeFetch = window.fetch.bind(window);
    const MEDIA_PREFIX = 'family-tree.media-catalog.v1:';
    const PREFERRED_FACES_KEY = 'family-tree.preferred-faces.v1';

    function finiteRevision(value) {
        const result = Number(value);
        return Number.isInteger(result) && result >= 1 ? result : null;
    }

    function revisionFromResponse(response) {
        return finiteRevision(
            response?.headers?.get('X-Family-Graph-Revision') ||
            response?.headers?.get('X-Family-Revision')
        );
    }

    function requestUrl(input) {
        try {
            const raw = input instanceof Request ? input.url : String(input);
            return new URL(raw, window.location.href);
        } catch (_) {
            return null;
        }
    }

    function requestMethod(input, init) {
        return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    }

    function mutationInfo(input, init) {
        const method = requestMethod(input, init);
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
        const url = requestUrl(input);
        if (!url || url.origin !== window.location.origin) return null;

        let scope = null;
        if (url.pathname === '/api/graph' || url.pathname === '/api/tree' || url.pathname.startsWith('/api/nodes')) {
            scope = 'graph';
        } else if (url.pathname === '/api/media' || url.pathname.startsWith('/api/media/')) {
            scope = 'media';
        } else if (url.pathname === '/api/faces' || url.pathname.startsWith('/api/faces/')) {
            scope = 'faces';
        }
        return scope ? { method, path: url.pathname, scope } : null;
    }

    function resilientCatalogInfo(input, init) {
        if (requestMethod(input, init) !== 'GET') return null;
        const url = requestUrl(input);
        if (!url || url.origin !== window.location.origin) return null;

        if (url.pathname === '/api/media') {
            const personId = String(url.searchParams.get('person') || '').trim();
            if (!personId) return null;
            return { kind: 'media', key: `${MEDIA_PREFIX}${encodeURIComponent(personId)}` };
        }
        if (url.pathname === '/api/faces/preferred') {
            return { kind: 'preferred-faces', key: PREFERRED_FACES_KEY };
        }
        return null;
    }

    function validCatalog(kind, payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
        if (!Array.isArray(payload.items)) return false;
        if (kind === 'media' && payload.storageConfigured !== undefined &&
            typeof payload.storageConfigured !== 'boolean') return false;
        return true;
    }

    function saveCatalog(info, payload) {
        if (!info || !validCatalog(info.kind, payload)) return;
        try {
            localStorage.setItem(info.key, JSON.stringify({ savedAt: Date.now(), payload }));
        } catch (_) {}
    }

    function loadCatalog(info) {
        if (!info) return null;
        try {
            const parsed = JSON.parse(localStorage.getItem(info.key) || 'null');
            if (!parsed || !Number.isFinite(parsed.savedAt) || !validCatalog(info.kind, parsed.payload)) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function cachedCatalogResponse(entry) {
        return new Response(JSON.stringify(entry.payload), {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'Cache-Control': 'no-store',
                'X-Family-Media-Stale': '1',
                'X-Family-Media-Saved-At': String(entry.savedAt)
            }
        });
    }

    function emitMutation(info, response) {
        if (!info || !response?.ok) return;
        window.dispatchEvent(new CustomEvent('family-api-mutation', {
            detail: {
                ...info,
                revision: revisionFromResponse(response),
                at: Date.now()
            }
        }));
    }

    async function request(input, init) {
        const resilient = resilientCatalogInfo(input, init);
        const mutation = mutationInfo(input, init);

        try {
            const response = await nativeFetch(input, init);
            emitMutation(mutation, response);

            if (!resilient) return response;
            if (response.ok) {
                try {
                    const payload = await response.clone().json();
                    if (validCatalog(resilient.kind, payload)) {
                        saveCatalog(resilient, payload);
                        return response;
                    }
                } catch (_) {}
            }

            const cached = loadCatalog(resilient);
            return cached ? cachedCatalogResponse(cached) : response;
        } catch (error) {
            const cached = loadCatalog(resilient);
            if (cached) return cachedCatalogResponse(cached);
            throw error;
        }
    }

    async function json(input, init) {
        const response = await request(input, init);
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }

    window.FamilyApi = Object.freeze({
        request,
        json,
        revisionFromResponse,
        finiteRevision,
        nativeFetch: (...args) => nativeFetch(...args)
    });
})();
