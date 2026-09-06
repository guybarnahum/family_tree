const MIN_FACE_SIZE = 0.01;
let facesSchemaPromise = null;

function json(value, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Cache-Control', 'no-store');
  return Response.json(value, { ...init, headers });
}

function cleanId(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeFaceRect(value, { strict = false } = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const x = finite(input.x);
  const y = finite(input.y);
  const width = finite(input.width);
  const height = finite(input.height);
  const valid = x !== null && y !== null && width !== null && height !== null &&
    x >= 0 && y >= 0 && width >= MIN_FACE_SIZE && height >= MIN_FACE_SIZE &&
    x <= 1 && y <= 1 && x + width <= 1.000001 && y + height <= 1.000001;

  if (!valid) {
    if (strict) throw new Error('Face rectangle must be normalized to 0..1 and remain inside the image');
    return null;
  }

  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(MIN_FACE_SIZE, Math.min(1 - x, width)),
    height: Math.max(MIN_FACE_SIZE, Math.min(1 - y, height))
  };
}

async function ensureFacesSchema(env) {
  if (!facesSchemaPromise) {
    facesSchemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS faces (
          id TEXT PRIMARY KEY,
          media_id TEXT NOT NULL,
          person_id TEXT,
          x REAL NOT NULL,
          y REAL NOT NULL,
          width REAL NOT NULL,
          height REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
          CHECK (x >= 0 AND x <= 1),
          CHECK (y >= 0 AND y <= 1),
          CHECK (width > 0 AND width <= 1),
          CHECK (height > 0 AND height <= 1),
          CHECK (x + width <= 1.000001),
          CHECK (y + height <= 1.000001)
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_faces_media ON faces(media_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id)`)
    ]);
  }

  try {
    await facesSchemaPromise;
  } catch (error) {
    facesSchemaPromise = null;
    throw error;
  }
}

function rowToFace(row) {
  return {
    id: row.id,
    mediaId: row.media_id,
    personId: row.person_id || null,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function faceRow(env, faceId) {
  return env.DB.prepare(`
    SELECT id, media_id, person_id, x, y, width, height, created_at, updated_at
    FROM faces
    WHERE id = ?
  `).bind(faceId).first();
}

async function requireMedia(env, mediaId) {
  const row = await env.DB.prepare('SELECT id FROM media WHERE id = ?').bind(mediaId).first();
  if (!row) throw new Error('Media not found');
}

async function requirePerson(env, personId) {
  if (!personId) return;
  const row = await env.DB.prepare('SELECT id FROM nodes WHERE id = ?').bind(personId).first();
  if (!row) throw new Error('Person not found');
}

async function listFaces(env, url) {
  const mediaId = cleanId(url.searchParams.get('media'));
  const personId = cleanId(url.searchParams.get('person'));
  if (!mediaId && !personId) return new Response('media or person is required', { status: 400 });

  const clauses = [];
  const values = [];
  if (mediaId) {
    clauses.push('media_id = ?');
    values.push(mediaId);
  }
  if (personId) {
    clauses.push('person_id = ?');
    values.push(personId);
  }

  const statement = env.DB.prepare(`
    SELECT id, media_id, person_id, x, y, width, height, created_at, updated_at
    FROM faces
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at ASC, id ASC
  `).bind(...values);
  const result = await statement.all();
  return json({ items: (result.results || []).map(rowToFace) });
}

async function createFace(request, env) {
  const data = await request.json();
  const mediaId = cleanId(data?.mediaId);
  const personId = cleanId(data?.personId) || null;
  if (!mediaId) return new Response('mediaId is required', { status: 400 });

  const rect = normalizeFaceRect(data, { strict: true });
  try {
    await requireMedia(env, mediaId);
    await requirePerson(env, personId);
  } catch (error) {
    return new Response(error.message, { status: 404 });
  }

  const id = `face_${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO faces (id, media_id, person_id, x, y, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, mediaId, personId, rect.x, rect.y, rect.width, rect.height)
  ];

  // A tagged face also makes the photo discoverable in that person's gallery. We keep
  // media_people as an association rather than ownership, so unassigning a face does not
  // destructively remove an association that may have existed independently.
  if (personId) {
    statements.push(
      env.DB.prepare(`
        INSERT OR IGNORE INTO media_people (media_id, person_id)
        VALUES (?, ?)
      `).bind(mediaId, personId)
    );
  }

  await env.DB.batch(statements);
  return json({ success: true, item: rowToFace(await faceRow(env, id)) }, { status: 201 });
}

async function patchFace(request, env, faceId) {
  const existing = await faceRow(env, faceId);
  if (!existing) return new Response('Face not found', { status: 404 });

  const data = await request.json();
  const fields = Object.keys(data || {});
  if (fields.length !== 1) return new Response('PATCH expects exactly one field', { status: 400 });

  if (fields[0] === 'personId') {
    const personId = cleanId(data.personId) || null;
    try { await requirePerson(env, personId); }
    catch (error) { return new Response(error.message, { status: 404 }); }

    const statements = [
      env.DB.prepare(`
        UPDATE faces
        SET person_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(personId, faceId)
    ];
    if (personId) {
      statements.push(
        env.DB.prepare(`
          INSERT OR IGNORE INTO media_people (media_id, person_id)
          VALUES (?, ?)
        `).bind(existing.media_id, personId)
      );
    }
    await env.DB.batch(statements);
  } else if (fields[0] === 'rect') {
    const rect = normalizeFaceRect(data.rect, { strict: true });
    await env.DB.prepare(`
      UPDATE faces
      SET x = ?, y = ?, width = ?, height = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(rect.x, rect.y, rect.width, rect.height, faceId).run();
  } else {
    return new Response('Unsupported face field', { status: 400 });
  }

  return json({ success: true, item: rowToFace(await faceRow(env, faceId)) });
}

async function deleteFace(env, faceId) {
  const existing = await faceRow(env, faceId);
  if (!existing) return new Response('Face not found', { status: 404 });
  await env.DB.prepare('DELETE FROM faces WHERE id = ?').bind(faceId).run();
  return json({ success: true });
}

export async function handleFacesApi(request, env, url) {
  if (!env.DB) return new Response('DB binding missing', { status: 500 });
  await ensureFacesSchema(env);

  const parts = url.pathname.split('/').filter(Boolean);
  const faceId = parts[2] ? decodeURIComponent(parts[2]) : null;

  try {
    if (!faceId) {
      if (request.method === 'GET') return listFaces(env, url);
      if (request.method === 'POST') return createFace(request, env);
      return new Response('Method not allowed', { status: 405 });
    }

    if (request.method === 'PATCH') return patchFace(request, env, faceId);
    if (request.method === 'DELETE') return deleteFace(env, faceId);
    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    return new Response(error.message || 'Invalid face request', { status: 400 });
  }
}

export const FACE_LIMITS = Object.freeze({ minSize: MIN_FACE_SIZE });
