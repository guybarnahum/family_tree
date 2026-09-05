let graphSchemaPromise = null;

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

function normalizedSpousePair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function relationshipId(type, a, b) {
  if (type === 'spouse') {
    const [left, right] = normalizedSpousePair(a, b);
    return `spouse:${left}:${right}`;
  }
  return `parent:${a}:${b}`;
}

function relationshipRecord(type, a, b) {
  if (type === 'spouse') {
    const [left, right] = normalizedSpousePair(a, b);
    return {
      id: relationshipId(type, left, right),
      type,
      person1_id: left,
      person2_id: right
    };
  }

  return {
    id: relationshipId(type, a, b),
    type,
    person1_id: a,
    person2_id: b
  };
}

async function ensureGraphSchema(env) {
  if (!graphSchemaPromise) {
    graphSchemaPromise = (async () => {
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS relationships (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('parent', 'spouse')),
            person1_id TEXT NOT NULL,
            person2_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `),
        env.DB.prepare(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_unique
          ON relationships(type, person1_id, person2_id)
        `),
        env.DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_relationship_person1
          ON relationships(person1_id)
        `),
        env.DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_relationship_person2
          ON relationships(person2_id)
        `)
      ]);

      // Seed the graph non-destructively from the legacy one-parent/one-spouse columns.
      await env.DB.batch([
        env.DB.prepare(`
          INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
          SELECT
            'parent:' || parent_id || ':' || id,
            'parent',
            parent_id,
            id
          FROM nodes
          WHERE parent_id IS NOT NULL
            AND parent_id <> ''
            AND parent_id IN (SELECT id FROM nodes)
        `),
        env.DB.prepare(`
          INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
          SELECT
            'spouse:' ||
              CASE WHEN id < spouse_id THEN id ELSE spouse_id END || ':' ||
              CASE WHEN id < spouse_id THEN spouse_id ELSE id END,
            'spouse',
            CASE WHEN id < spouse_id THEN id ELSE spouse_id END,
            CASE WHEN id < spouse_id THEN spouse_id ELSE id END
          FROM nodes
          WHERE spouse_id IS NOT NULL
            AND spouse_id <> ''
            AND spouse_id IN (SELECT id FROM nodes)
            AND id <> spouse_id
        `)
      ]);
    })();
  }

  try {
    await graphSchemaPromise;
  } catch (error) {
    graphSchemaPromise = null;
    throw error;
  }
}

function normalizePerson(person) {
  return {
    id: person?.id,
    name: person?.name ?? null,
    dates: person?.dates ?? null,
    description: person?.description ?? null
  };
}

function normalizeGraphPayload(payload) {
  if (payload?.format === 'family-tree' && payload?.version === 1 && Array.isArray(payload.people)) {
    const people = payload.people.map(person => normalizePerson(person));
    const relationships = [];

    for (const person of payload.people) {
      if (person?.parentId) {
        relationships.push({ type: 'parent', person1Id: person.parentId, person2Id: person.id });
      }
      if (person?.spouseId) {
        relationships.push({ type: 'spouse', person1Id: person.id, person2Id: person.spouseId });
      }
    }

    return { people, relationships };
  }

  if (payload?.format !== 'family-graph' || payload?.version !== 2) {
    throw new Error('Unsupported family graph format/version');
  }
  if (!Array.isArray(payload.people) || !Array.isArray(payload.relationships)) {
    throw new Error('people and relationships must both be arrays');
  }

  return {
    people: payload.people.map(person => normalizePerson(person)),
    relationships: payload.relationships.map(relation => ({
      type: relation?.type,
      person1Id: relation?.person1Id,
      person2Id: relation?.person2Id
    }))
  };
}

function validateGraphPayload(payload) {
  const normalized = normalizeGraphPayload(payload);
  if (normalized.people.length > 1000) {
    throw new Error('Import is limited to 1000 people');
  }
  if (normalized.relationships.length > 5000) {
    throw new Error('Import is limited to 5000 relationships');
  }

  const ids = new Set();
  for (const person of normalized.people) {
    if (typeof person.id !== 'string' || !person.id.trim()) {
      throw new Error('Every person must have a non-empty string id');
    }
    if (ids.has(person.id)) {
      throw new Error(`Duplicate person id: ${person.id}`);
    }
    ids.add(person.id);
  }

  const relationKeys = new Set();
  const relationships = [];

  for (const relation of normalized.relationships) {
    if (relation.type !== 'parent' && relation.type !== 'spouse') {
      throw new Error(`Unsupported relationship type: ${relation.type}`);
    }
    if (!ids.has(relation.person1Id) || !ids.has(relation.person2Id)) {
      throw new Error(`Relationship references a missing person: ${relation.person1Id} -> ${relation.person2Id}`);
    }
    if (relation.person1Id === relation.person2Id) {
      throw new Error(`A person cannot be related to themselves: ${relation.person1Id}`);
    }

    const record = relationshipRecord(relation.type, relation.person1Id, relation.person2Id);
    const key = `${record.type}|${record.person1_id}|${record.person2_id}`;
    if (relationKeys.has(key)) continue;
    relationKeys.add(key);
    relationships.push(record);
  }

  // Detect ancestry cycles across any number of parent relationships.
  const parentsByChild = new Map();
  for (const relation of relationships) {
    if (relation.type !== 'parent') continue;
    if (!parentsByChild.has(relation.person2_id)) parentsByChild.set(relation.person2_id, []);
    parentsByChild.get(relation.person2_id).push(relation.person1_id);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Parent cycle detected at ${id}`);

    visiting.add(id);
    for (const parentId of parentsByChild.get(id) || []) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  }

  for (const person of normalized.people) visit(person.id);
  return { people: normalized.people, relationships };
}

function legacyLinksFor(people, relationships) {
  const parentByChild = new Map();
  const spouseByPerson = new Map();

  for (const relation of relationships) {
    if (relation.type === 'parent' && !parentByChild.has(relation.person2_id)) {
      parentByChild.set(relation.person2_id, relation.person1_id);
    }
    if (relation.type === 'spouse') {
      if (!spouseByPerson.has(relation.person1_id)) spouseByPerson.set(relation.person1_id, relation.person2_id);
      if (!spouseByPerson.has(relation.person2_id)) spouseByPerson.set(relation.person2_id, relation.person1_id);
    }
  }

  return new Map(people.map(person => [person.id, {
    parent_id: parentByChild.get(person.id) || null,
    spouse_id: spouseByPerson.get(person.id) || null
  }]));
}

async function replaceGraph(env, payload) {
  const { people, relationships } = validateGraphPayload(payload);
  const legacy = legacyLinksFor(people, relationships);

  const statements = [
    env.DB.prepare('DELETE FROM relationships'),
    env.DB.prepare('DELETE FROM nodes')
  ];

  for (const person of people) {
    const links = legacy.get(person.id);
    statements.push(
      env.DB.prepare(`
        INSERT INTO nodes (id, parent_id, spouse_id, name, dates, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        person.id,
        links?.parent_id || null,
        links?.spouse_id || null,
        person.name,
        person.dates,
        person.description
      )
    );
  }

  for (const relation of relationships) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO relationships (id, type, person1_id, person2_id)
        VALUES (?, ?, ?, ?)
      `).bind(relation.id, relation.type, relation.person1_id, relation.person2_id)
    );
  }

  await env.DB.batch(statements);
  return { people: people.length, relationships: relationships.length };
}

async function graphDocument(env) {
  await ensureGraphSchema(env);
  const [peopleResult, relationshipsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT id, name, dates, description, last_updated
      FROM nodes
      ORDER BY id ASC
    `).all(),
    env.DB.prepare(`
      SELECT id, type, person1_id, person2_id, created_at
      FROM relationships
      ORDER BY type ASC, person1_id ASC, person2_id ASC
    `).all()
  ]);

  return {
    format: 'family-graph',
    version: 2,
    people: peopleResult.results.map(person => ({
      id: person.id,
      name: person.name ?? null,
      dates: person.dates ?? null,
      description: person.description ?? null,
      lastUpdated: person.last_updated ?? null
    })),
    relationships: relationshipsResult.results.map(relation => ({
      id: relation.id,
      type: relation.type,
      person1Id: relation.person1_id,
      person2Id: relation.person2_id,
      createdAt: relation.created_at ?? null
    }))
  };
}

async function handleGraphApi(request, env) {
  if (request.method === 'GET') {
    return jsonResponse(await graphDocument(env));
  }

  if (request.method === 'PUT') {
    const payload = await request.json();
    const counts = await replaceGraph(env, payload);
    return jsonResponse({ success: true, ...counts });
  }

  return new Response('Method not allowed', { status: 405 });
}

async function handleTreeApi(request, env) {
  if (request.method === 'GET') {
    const graph = await graphDocument(env);
    const people = graph.people.map(person => ({
      id: person.id,
      name: person.name,
      dates: person.dates,
      description: person.description,
      parentId: null,
      spouseId: null
    }));
    const byId = new Map(people.map(person => [person.id, person]));

    for (const relation of graph.relationships) {
      if (relation.type === 'parent' && byId.has(relation.person2Id) && !byId.get(relation.person2Id).parentId) {
        byId.get(relation.person2Id).parentId = relation.person1Id;
      }
      if (relation.type === 'spouse') {
        if (byId.has(relation.person1Id) && !byId.get(relation.person1Id).spouseId) {
          byId.get(relation.person1Id).spouseId = relation.person2Id;
        }
        if (byId.has(relation.person2Id) && !byId.get(relation.person2Id).spouseId) {
          byId.get(relation.person2Id).spouseId = relation.person1Id;
        }
      }
    }

    return jsonResponse({
      format: 'family-tree',
      version: 1,
      exportedAt: new Date().toISOString(),
      people
    });
  }

  if (request.method === 'PUT') {
    const payload = await request.json();
    const counts = await replaceGraph(env, payload);
    return jsonResponse({ success: true, imported: counts.people });
  }

  return new Response('Method not allowed', { status: 405 });
}

async function handleNodesApi(request, env, url) {
  await ensureGraphSchema(env);
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
    if (!data.id) return new Response('Node id is required', { status: 400 });

    const statements = [
      env.DB.prepare(`
        INSERT INTO nodes (id, parent_id, spouse_id, name, dates, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        data.id,
        data.parent_id || null,
        data.spouse_id || null,
        data.name || 'שם',
        data.dates || 'תאריכים',
        data.description || 'תיאור'
      )
    ];

    if (data.parent_id) {
      const relation = relationshipRecord('parent', data.parent_id, data.id);
      statements.push(
        env.DB.prepare(`
          INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
          VALUES (?, ?, ?, ?)
        `).bind(relation.id, relation.type, relation.person1_id, relation.person2_id)
      );
    }

    if (data.spouse_id) {
      const relation = relationshipRecord('spouse', data.id, data.spouse_id);
      statements.push(
        env.DB.prepare(`
          INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
          VALUES (?, ?, ?, ?)
        `).bind(relation.id, relation.type, relation.person1_id, relation.person2_id)
      );
    }

    await env.DB.batch(statements);
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

    if (field === 'parent_id') {
      const parentId = data.parent_id || null;
      const statements = [
        env.DB.prepare(`DELETE FROM relationships WHERE type = 'parent' AND person2_id = ?`).bind(nodeId),
        env.DB.prepare('UPDATE nodes SET parent_id = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?').bind(parentId, nodeId)
      ];

      if (parentId) {
        const relation = relationshipRecord('parent', parentId, nodeId);
        statements.push(
          env.DB.prepare(`
            INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
            VALUES (?, ?, ?, ?)
          `).bind(relation.id, relation.type, relation.person1_id, relation.person2_id)
        );
      }

      await env.DB.batch(statements);
      return jsonResponse({ success: true });
    }

    if (field === 'spouse_id') {
      const spouseId = data.spouse_id || null;
      const statements = [
        env.DB.prepare(`DELETE FROM relationships WHERE type = 'spouse' AND (person1_id = ? OR person2_id = ?)`).bind(nodeId, nodeId),
        env.DB.prepare('UPDATE nodes SET spouse_id = NULL WHERE id = ? OR spouse_id = ?').bind(nodeId, nodeId),
        env.DB.prepare('UPDATE nodes SET spouse_id = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?').bind(spouseId, nodeId)
      ];

      if (spouseId) {
        const relation = relationshipRecord('spouse', nodeId, spouseId);
        statements.push(
          env.DB.prepare('UPDATE nodes SET spouse_id = ? WHERE id = ?').bind(nodeId, spouseId),
          env.DB.prepare(`
            INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
            VALUES (?, ?, ?, ?)
          `).bind(relation.id, relation.type, relation.person1_id, relation.person2_id)
        );
      }

      await env.DB.batch(statements);
      return jsonResponse({ success: true });
    }

    await env.DB.prepare(
      `UPDATE nodes SET ${field} = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(data[field], nodeId).run();

    return jsonResponse({ success: true });
  }

  if (request.method === 'DELETE' && nodeId) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM relationships WHERE person1_id = ? OR person2_id = ?').bind(nodeId, nodeId),
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
    '/graph-view.js',
    '/import-export.js'
  ];

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
        if (!env.DB) return new Response('DB binding missing', { status: 500 });

        if (url.pathname === '/api/graph') {
          return await handleGraphApi(request, env);
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
