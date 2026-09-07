import worker from './worker.js';
import { handlePlacesApi } from './places.js';
import { handleMediaApi } from './media.js';
import { handleFacesApi } from './faces.js';
import { normalizeParentUnions } from './graph-invariants.js';

let graphRevisionSchemaPromise = null;

async function ensureGraphRevisionSchema(env) {
  if (!graphRevisionSchemaPromise) {
    graphRevisionSchemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS graph_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          revision INTEGER NOT NULL DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      env.DB.prepare(`
        INSERT OR IGNORE INTO graph_state (id, revision)
        VALUES (1, 1)
      `)
    ]);
  }

  try {
    await graphRevisionSchemaPromise;
  } catch (error) {
    graphRevisionSchemaPromise = null;
    throw error;
  }
}

async function readGraphRevision(env) {
  await ensureGraphRevisionSchema(env);
  const row = await env.DB.prepare('SELECT revision FROM graph_state WHERE id = 1').first();
  const revision = Number(row?.revision);
  return Number.isFinite(revision) && revision >= 1 ? revision : 1;
}

async function bumpGraphRevision(env) {
  await ensureGraphRevisionSchema(env);
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
    return new Request(request, {
      headers,
      body: JSON.stringify(normalized)
    });
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

async function injectGraphResilience(response, env) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('text/html')) return response;

  const rawHtml = await response.text();
  const legacyGraphPoll = `        // Poll for multi-client edits, but unchanged data does not cause a relayout.\n        setInterval(() => {\n            if (!isEditing) loadTree(null, false);\n        }, 5000);\n`;
  const legacyGraphStart = '        loadTree(null, true);\n';
  const importExportPattern = /\s*<script src="\/import-export\.js(?:\?[^\"]*)?"[^>]*><\/script>/;

  let html = rawHtml
    .replace(
      legacyGraphPoll,
      '        // Multi-client synchronization is handled by graph-sync.js revision polling.\n'
    )
    .replace(
      legacyGraphStart,
      '        // Initial graph rendering is started by runtime-bootstrap.js after the final stack is installed.\n'
    )
    // worker.js still lists import-export for historical deployments. M1 moves it behind the
    // deterministic bootstrap so it cannot start the graph before the final runtime is ready.
    .replace(importExportPattern, '');

  const hasGraphResilience = html.includes('data-family-graph-resilience');
  const hasRevisionLayoutGuard = html.includes('data-family-revision-layout-guard');
  const hasPersonIdentity = html.includes('data-family-person-identity');
  const hasPersonPickerLabels = html.includes('data-family-person-picker-labels');
  const hasMediaResilience = html.includes('data-family-media-resilience');

  const build = typeof env.BUILD_SHA === 'string' && env.BUILD_SHA
    ? env.BUILD_SHA.slice(0, 8)
    : 'dev';
  const scripts = [
    !hasGraphResilience
      ? `<script src="/graph-cache.js?v=${encodeURIComponent(build)}" data-family-graph-cache></script>`
      : '',
    !hasPersonIdentity
      ? `<script src="/person-identity.js?v=${encodeURIComponent(build)}" data-family-person-identity></script>`
      : '',
    !hasPersonPickerLabels
      ? `<script src="/person-picker-labels.js?v=${encodeURIComponent(build)}" data-family-person-picker-labels></script>`
      : '',
    !hasGraphResilience
      ? `<script src="/graph-status.js?v=${encodeURIComponent(build)}" data-family-graph-status></script>`
      : '',
    !hasGraphResilience
      ? `<script src="/graph-resilience.js?v=${encodeURIComponent(build)}" data-family-graph-resilience></script>`
      : '',
    !hasRevisionLayoutGuard
      ? `<script src="/revision-layout-guard.js?v=${encodeURIComponent(build)}" data-family-revision-layout-guard></script>`
      : '',
    !hasMediaResilience
      ? `<script src="/media-resilience.js?v=${encodeURIComponent(build)}" data-family-media-resilience></script>`
      : ''
  ].filter(Boolean).join('\n');

  const graphViewPattern = /<script src="\/graph-view\.js(?:\?[^\"]*)?"[^>]*><\/script>/;
  let refinedHtml = graphViewPattern.test(html)
    ? html.replace(graphViewPattern, match => `${scripts}\n${match}`)
    : html.replace('</body>', `${scripts}\n</body>`);

  if (!refinedHtml.includes('data-family-runtime-bootstrap')) {
    const runtimeBootstrap = `<script src="/runtime-bootstrap.js?v=${encodeURIComponent(build)}" data-family-runtime-bootstrap></script>`;
    refinedHtml = refinedHtml.replace('</body>', `${runtimeBootstrap}\n</body>`);
  }

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

    return injectGraphResilience(response, env);
  }
};