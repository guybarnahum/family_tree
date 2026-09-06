import worker from './worker.js';
import { handlePlacesApi } from './places.js';
import { handleMediaApi } from './media.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/places') {
      if (!env.DB) return new Response('DB binding missing', { status: 500 });
      try {
        return await handlePlacesApi(request, env, url);
      } catch (error) {
        console.error('Place search API failed:', error);
        return Response.json(
          { results: [], source: 'error' },
          { status: 200, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }

    if (url.pathname === '/api/media' || url.pathname.startsWith('/api/media/')) {
      try {
        return await handleMediaApi(request, env, url);
      } catch (error) {
        console.error('Media API failed:', error);
        return new Response(`Media API Error: ${error.message}`, { status: 500 });
      }
    }

    return worker.fetch(request, env, ctx);
  }
};
