import worker from './worker.js';
import { handlePlacesApi } from './places.js';
import { handleMediaApi } from './media.js';
import { handleFacesApi } from './faces.js';
import { normalizeParentUnions } from './graph-invariants.js';

async function readGraphRevision(env) {
  const row = await env.DB.prepare('SELECT revision FROM graph_state WHERE id = 1').first();
  const revision = Number(row?.revision);
  return Number.isFinite(revision) && revision >= 1 ? revision : 1;
}

async function bumpGraphRevision(env) {
  await env.DB.prepare(`
    UPDATE graph_state
    SET revision = revision + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run();
  return readGraphRevision(env);
}

function withRevisionHeader(response, revision) {
  const headers = new Headers(response.headers);
  headers.set('X-Family-Graph-Revision', String(revision));
  headers.set('X-Family-Revision', String(revision));
  headers.delete('Content-Length');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isMutationMethod(method) {
  const value = String(method || 'GET').toUpperCase();
  return value !== 'GET' && value !== 'HEAD' && value !== 'OPTIONS';
}

function isRevisionMutation(request, url) {
  if (!isMutationMethod(request.method)) return false;
  return url.pathname === '/api/graph' ||
    url.pathname === '/api/tree' ||
    url.pathname.startsWith('/api/nodes') ||
    url.pathname === '/api/media' ||
    url.pathname.startsWith('/api/media/') ||
    url.pathname === '/api/faces' ||
    url.pathname.startsWith('/api/faces/');
}

async function normalizeGraphMutationRequest(request, url) {
  if (url.pathname !== '/api/graph' || request.method.toUpperCase() !== 'PUT') return request;
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) return request;
  try {
    const payload = await request.clone().json();
    const normalized = normalizeParentUnions(payload);
    const headers = new Headers(request.headers);
    headers.set('Content-Type', 'application/json');
    headers.delete('Content-Length');
    return new Request(request, { headers, body: JSON.stringify(normalized) });
  } catch (_) {
    return request;
  }
}

async function attachMutationRevision(response, env, request, url) {
  if (!env.DB || !response.ok || !isRevisionMutation(request, url)) return response;
  try {
    const revision = await bumpGraphRevision(env);
    return withRevisionHeader(response, revision);
  } catch (error) {
    console.error('Unable to bump family data revision:', error);
    return response;
  }
}

function buildInfo(env) {
  const sha = typeof env.BUILD_SHA === 'string' && env.BUILD_SHA ? env.BUILD_SHA : 'unknown';
  const deployedAt = typeof env.BUILD_TIME === 'string' && env.BUILD_TIME ? env.BUILD_TIME : null;
  return { sha, short: sha.slice(0, 8), deployedAt };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function handleFrontendAsset(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  const contentType = assetResponse.headers.get('Content-Type') || '';
  const build = buildInfo(env);

  if (!contentType.includes('text/html')) {
    const headers = new Headers(assetResponse.headers);
    headers.set('X-Family-Tree-Build', build.short);
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    });
  }

  let html = await assetResponse.text();
  const foundationalScripts = [
    ['/family-core.js', 'data-family-core'],
    ['/selection-controller.js', 'data-family-selection-controller'],
    ['/family-api.js', 'data-family-api'],
    ['/graph-store.js', 'data-family-graph-store'],
    ['/graph-status.js', 'data-family-graph-status'],
    ['/family-mutations.js', 'data-family-mutations'],
    ['/person-identity.js', 'data-family-person-identity'],
    ['/graph-view.js', 'data-family-graph-view'],
    ['/runtime-bootstrap.js', 'data-family-runtime-bootstrap']
  ];

  const scripts = foundationalScripts
    .filter(([path, dataKey]) => !html.includes(dataKey) && !html.includes(`src="${path}`))
    .map(([path, dataKey]) =>
      `<script src="${path}?v=${encodeURIComponent(build.short)}" ${dataKey} data-family-bootstrap-loaded="true"></script>`
    )
    .join('\n');
  if (scripts) html = html.replace('</body>', `${scripts}\n</body>`);

  if (!html.includes('name="family-tree-build"')) {
    html = html.replace(
      '</head>',
      `<meta name="family-tree-build" content="${escapeHtml(build.short)}">\n</head>`
    );
  }

  if (!html.includes('id="family-tree-build"')) {
    const buildTitle = build.deployedAt
      ? `Build ${build.sha} · deployed ${build.deployedAt}`
      : `Build ${build.sha}`;
    const badge = `<div id="family-tree-build" title="${escapeHtml(buildTitle)}" style="position:fixed;right:10px;bottom:8px;z-index:9999;font:10px/1.2 Inter,sans-serif;color:#8b8b84;opacity:.72;pointer-events:none;direction:ltr">v ${escapeHtml(build.short)}</div>`;
    html = html.replace('</body>', `${badge}\n</body>`);
  }

  const headers = new Headers(assetResponse.headers);
  headers.delete('Content-Length');
  headers.set('Content-Type', 'text/html; charset=UTF-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Family-Tree-Build', build.short);
  return new Response(html, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/graph/revision') {
      if (!env.DB) return new Response('DB binding missing', { status: 500 });
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      try {
        const revision = await readGraphRevision(env);
        return Response.json(
          { revision },
          {
            headers: {
              'Cache-Control': 'no-store',
              'X-Family-Graph-Revision': String(revision),
              'X-Family-Revision': String(revision)
            }
          }
        );
      } catch (error) {
        console.error('Graph revision API failed:', error);
        return new Response(`Graph Revision API Error: ${error.message}`, { status: 500 });
      }
    }

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
        const response = await handleMediaApi(request, env, url);
        return await attachMutationRevision(response, env, request, url);
      } catch (error) {
        console.error('Media API failed:', error);
        return new Response(`Media API Error: ${error.message}`, { status: 500 });
      }
    }

    if (url.pathname === '/api/faces' || url.pathname.startsWith('/api/faces/')) {
      try {
        const response = await handleFacesApi(request, env, url);
        return await attachMutationRevision(response, env, request, url);
      } catch (error) {
        console.error('Faces API failed:', error);
        return new Response(`Faces API Error: ${error.message}`, { status: 500 });
      }
    }

    if (!url.pathname.startsWith('/api/')) {
      return handleFrontendAsset(request, env);
    }

    const effectiveRequest = await normalizeGraphMutationRequest(request, url);
    let response = await worker.fetch(effectiveRequest, env, ctx);

    if (env.DB && response.ok && isRevisionMutation(effectiveRequest, url)) {
      response = await attachMutationRevision(response, env, effectiveRequest, url);
    } else if (env.DB && response.ok && url.pathname === '/api/graph' && effectiveRequest.method === 'GET') {
      try {
        const revision = await readGraphRevision(env);
        response = withRevisionHeader(response, revision);
      } catch (error) {
        console.error('Unable to attach graph revision:', error);
      }
    }
    return response;
  }
};