// Media resilience for D1 outages. R2 keeps the image bytes, while D1 holds the
// person/media and preferred-face metadata needed to discover those images. Cache only
// those small JSON catalogs locally so an outage does not make existing photos vanish.
(() => {
    if (window.__familyMediaResilienceInstalled) return;
    window.__familyMediaResilienceInstalled = true;

    const nativeFetch = window.fetch.bind(window);
    const MEDIA_PREFIX = 'family-tree.media-catalog.v1:';
    const PREFERRED_FACES_KEY = 'family-tree.preferred-faces.v1';

    function requestInfo(input, init) {
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'GET') return null;

        try {
            const raw = input instanceof Request ? input.url : String(input);
            const url = new URL(raw, window.location.href);
            if (url.origin !== window.location.origin) return null;

            if (url.pathname === '/api/media') {
                const personId = String(url.searchParams.get('person') || '').trim();
                if (!personId) return null;
                return {
                    kind: 'media',
                    key: `${MEDIA_PREFIX}${encodeURIComponent(personId)}`
                };
            }

            if (url.pathname === '/api/faces/preferred') {
                return { kind: 'preferred-faces', key: PREFERRED_FACES_KEY };
            }
        } catch (_) {}
        return null;
    }

    function validPayload(kind, payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
        if (!Array.isArray(payload.items)) return false;
        if (kind === 'media' && payload.storageConfigured !== undefined &&
            typeof payload.storageConfigured !== 'boolean') return false;
        return true;
    }

    function save(key, kind, payload) {
        if (!validPayload(kind, payload)) return;
        try {
            localStorage.setItem(key, JSON.stringify({
                savedAt: Date.now(),
                payload
            }));
        } catch (_) {}
    }

    function load(key, kind) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || 'null');
            if (!parsed || !Number.isFinite(parsed.savedAt) || !validPayload(kind, parsed.payload)) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function cachedResponse(entry) {
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

    window.fetch = async function resilientMediaFetch(input, init) {
        const info = requestInfo(input, init);
        if (!info) return nativeFetch(input, init);

        try {
            const response = await nativeFetch(input, init);
            if (response.ok) {
                try {
                    const payload = await response.clone().json();
                    if (validPayload(info.kind, payload)) {
                        save(info.key, info.kind, payload);
                        return response;
                    }
                } catch (_) {}
            }

            const cached = load(info.key, info.kind);
            return cached ? cachedResponse(cached) : response;
        } catch (error) {
            const cached = load(info.key, info.kind);
            if (cached) return cachedResponse(cached);
            throw error;
        }
    };
})();