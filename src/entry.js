import worker from './worker.js';
import { handlePlacesApi } from './places.js';
import { handleMediaApi } from './media.js';
import { handleFacesApi } from './faces.js';

async function injectGraphResilience(response, env) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  const hasGraphResilience = html.includes('data-family-graph-resilience');
  const hasMediaResilience = html.includes('data-family-media-resilience');
  if (hasGraphResilience && hasMediaResilience) {
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  const build = typeof env.BUILD_SHA === 'string' && env.BUILD_SHA
    ? env.BUILD_SHA.slice(0, 8)
    : 'dev';
  const scripts = [
    !hasGraphResilience
      ? `<script src="/graph-cache.js?v=${encodeURIComponent(build)}" data-family-graph-cache></script>`
      : '',
    !hasGraphResilience
      ? `<script src="/graph-status.js?v=${encodeURIComponent(build)}" data-family-graph-status></script>`
      : '',
    !hasGraphResilience
      ? `<script src="/graph-resilience.js?v=${encodeURIComponent(build)}" data-family-graph-resilience></script>`
      : '',
    !hasMediaResilience
      ? `<script src="/media-resilience.js?v=${encodeURIComponent(build)}" data-family-media-resilience></script>`
      : ''
  ].filter(Boolean).join('\n');

  const graphViewPattern = /<script src="\/graph-view\.js(?:\?[^\"]*)?"[^>]*><\/script>/;
  const refinedHtml = graphViewPattern.test(html)
    ? html.replace(graphViewPattern, match => `${scripts}\n${match}`)
    : html.replace('</body>', `${scripts}\n</body>`);

  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.set('Content-Type', 'text/html; charset=UTF-8');
  return new Response(refinedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

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

    if (url.pathname === '/api/faces' || url.pathname.startsWith('/api/faces/')) {
      try {
        return await handleFacesApi(request, env, url);
      } catch (error) {
        console.error('Faces API failed:', error);
        return new Response(`Faces API Error: ${error.message}`, { status: 500 });
      }
    }

    const response = await worker.fetch(request, env, ctx);
    return injectGraphResilience(response, env);
  }
};