function jsonResponse(value, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Cache-Control', 'no-store');
  return Response.json(value, { ...init, headers });
}

function buildInfo(env) {
  const sha = typeof env.BUILD_SHA === 'string' && env.BUILD_SHA
    ? env.BUILD_SHA
    : 'unknown';
  const deployedAt = typeof env.BUILD_TIME === 'string' && env.BUILD_TIME
    ? env.BUILD_TIME
    : null;

  return {
    sha,
    short: sha.slice(0, 8),
    deployedAt
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeImportedPerson(person) {
  return {
    id: person?.id,
    name: person?.name ?? null,
    dates: person?.dates ?? null,
    description: person?.description ?? null,
    parent_id: person?.parentId ?? null,
    spouse_id: person?.spouseId ?? null
  };
}

function validateImportedTree(payload) {
  if (!payload || payload.format !== 'family-tree' || payload.version !== 1) {
    throw new Error('Unsupported family-tree format/version');
  }
  if (!Array.isArray(payload.people)) {
    throw new Error('people must be an array');
  }
  if (payload.people.length > 1000) {
    throw new Error('Import is limited to 1000 people');
  }

  const people = payload.people.map(normalizeImportedPerson);
  const ids = new Set();

  for (const person of people) {
    if (typeof person.id !== 'string' || !person.id.trim()) {
      throw new Error('Every person must have a non-empty string id');
    }
    if (ids.has(person.id)) {
      throw new Error(`Duplicate person id: ${person.id}`);
    }
    ids.add(person.id);
  }

  for (const person of people) {
    if (person.parent_id === person.id) {
      throw new Error(`Person cannot be their own parent: ${person.id}`);
    }
    if (person.spouse_id === person.id) {
      throw new Error(`Person cannot be their own spouse: ${person.id}`);
    }
    if (person.parent_id && !ids.has(person.parent_id)) {
      throw new Error(`Missing parent ${person.parent_id} referenced by ${person.id}`);
    }
    if (person.spouse_id && !ids.has(person.spouse_id)) {
      throw new Error(`Missing spouse ${person.spouse_id} referenced by ${person.id}`);
    }
  }

  const byId = new Map(people.map(person => [person.id, person]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Parent cycle detected at ${id}`);
    }

    visiting.add(id);
    const parentId = byId.get(id)?.parent_id;
    if (parentId) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  }

  for (const person of people) visit(person.id);
  return people;
}

async function handleTreeApi(request, env) {
  if (request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM nodes ORDER BY id ASC')
      .all();

    return jsonResponse({
      format: 'family-tree',
      version: 1,
      exportedAt: new Date().toISOString(),
      people: results.map(node => ({
        id: node.id,
        name: node.name ?? null,
        dates: node.dates ?? null,
        description: node.description ?? null,
        parentId: node.parent_id ?? null,
        spouseId: node.spouse_id ?? null
      }))
    });
  }

  if (request.method === 'PUT') {
    const payload = await request.json();
    const people = validateImportedTree(payload);

    const statements = [env.DB.prepare('DELETE FROM nodes')];
    for (const person of people) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO nodes (id, parent_id, spouse_id, name, dates, description) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
          person.id,
          person.parent_id,
          person.spouse_id,
          person.name,
          person.dates,
          person.description
        )
      );
    }

    await env.DB.batch(statements);
    return jsonResponse({ success: true, imported: people.length });
  }

  return new Response('Method not allowed', { status: 405 });
}

async function handleNodesApi(request, env, url) {
  const pathParts = url.pathname.split('/').filter(Boolean);
  const nodeId = pathParts[2];

  if (request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM nodes ORDER BY id ASC')
      .all();

    return jsonResponse(results);
  }

  if (request.method === 'POST') {
    const data = await request.json();
    if (!data.id) {
      return new Response('Node id is required', { status: 400 });
    }

    await env.DB.prepare(
      'INSERT INTO nodes (id, parent_id, spouse_id, name, dates, description) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      data.id,
      data.parent_id || null,
      data.spouse_id || null,
      data.name || 'שם',
      data.dates || 'תאריכים',
      data.description || 'תיאור'
    ).run();

    return jsonResponse({ success: true });
  }

  if (request.method === 'PATCH' && nodeId) {
    const data = await request.json();
    const fields = Object.keys(data);
    if (fields.length !== 1) {
      return new Response('PATCH expects exactly one field', { status: 400 });
    }

    const field = fields[0];
    const allowedFields = ['name', 'dates', 'description', 'parent_id', 'spouse_id'];
    if (!allowedFields.includes(field)) {
      return new Response('Unsupported field', { status: 400 });
    }

    await env.DB.prepare(
      `UPDATE nodes SET ${field} = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(data[field], nodeId).run();

    return jsonResponse({ success: true });
  }

  if (request.method === 'DELETE' && nodeId) {
    await env.DB.batch([
      env.DB.prepare('UPDATE nodes SET parent_id = NULL WHERE parent_id = ?').bind(nodeId),
      env.DB.prepare('UPDATE nodes SET spouse_id = NULL WHERE spouse_id = ?').bind(nodeId),
      env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(nodeId)
    ]);

    return jsonResponse({ success: true });
  }

  return new Response('Method not allowed', { status: 405 });
}

async function handleAsset(request, env) {
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

  const html = await assetResponse.text();
  const refinementScriptPaths = [
    '/layout-refinement.js',
    '/node-hover.js',
    '/import-export.js'
  ];

  // Version the injected frontend URLs with the deployed Git SHA. This makes a browser
  // request a new script URL after every deploy while still resolving the same asset.
  const missingScripts = refinementScriptPaths
    .filter(path => !html.includes(`src="${path}`))
    .map(path => `<script src="${path}?v=${encodeURIComponent(build.short)}"></script>`)
    .join('\n');

  const buildMeta = `<meta name="family-tree-build" content="${escapeHtml(build.short)}">`;
  const buildTitle = build.deployedAt
    ? `Build ${build.sha} · deployed ${build.deployedAt}`
    : `Build ${build.sha}`;
  const buildBadge = `<div id="family-tree-build" title="${escapeHtml(buildTitle)}" style="position:fixed;right:10px;bottom:8px;z-index:9999;font:10px/1.2 Inter,sans-serif;color:#8b8b84;opacity:.72;pointer-events:none;direction:ltr">v ${escapeHtml(build.short)}</div>`;

  let refinedHtml = html;
  if (!refinedHtml.includes('name="family-tree-build"')) {
    refinedHtml = refinedHtml.replace('</head>', `${buildMeta}\n</head>`);
  }
  if (missingScripts) {
    refinedHtml = refinedHtml.replace('</body>', `${missingScripts}\n</body>`);
  }
  if (!refinedHtml.includes('id="family-tree-build"')) {
    refinedHtml = refinedHtml.replace('</body>', `${buildBadge}\n</body>`);
  }

  const headers = new Headers(assetResponse.headers);
  headers.set('Content-Type', 'text/html; charset=UTF-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Family-Tree-Build', build.short);
  headers.delete('Content-Length');

  return new Response(refinedHtml, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/version') {
        return jsonResponse(buildInfo(env), {
          headers: { 'X-Family-Tree-Build': buildInfo(env).short }
        });
      }

      if (url.pathname.startsWith('/api/')) {
        if (!env.DB) {
          return new Response('DB binding missing', { status: 500 });
        }

        if (url.pathname === '/api/tree') {
          return await handleTreeApi(request, env);
        }

        if (url.pathname.startsWith('/api/nodes')) {
          return await handleNodesApi(request, env, url);
        }

        return new Response('Not found', { status: 404 });
      }

      return await handleAsset(request, env);
    } catch (err) {
      return new Response(`API Error: ${err.message}`, { status: 500 });
    }
  }
};
