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

function metadataObject(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
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

export function choosePreferredFace(items, primaryFaceId, personId = null) {
  const assigned = (Array.isArray(items) ? items : [])
    .filter(face => !personId || face.personId === personId);
  if (!assigned.length) return null;
  if (primaryFaceId) {
    const preferred = assigned.find(face => face.id === primaryFaceId);
    if (preferred) return preferred;
  }
  return assigned[0];
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
  const face = {
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

  if (row.media_width !== undefined || row.media_height !== undefined || row.mime_type !== undefined) {
    face.contentUrl = `/api/media/${encodeURIComponent(row.media_id)}/content`;
    face.sourceWidth = row.media_width == null ? null : Number(row.media_width);
    face.sourceHeight = row.media_height == null ? null : Number(row.media_height);
    face.mimeType = row.mime_type || null;
  }
  return face;
}

async function faceRow(env, faceId) {
  return env.DB.prepare(`
    SELECT f.id, f.media_id, f.person_id, f.x, f.y, f.width, f.height,
           f.created_at, f.updated_at,
           m.width AS media_width, m.height AS media_height, m.mime_type
    FROM faces f
    INNER JOIN media m ON m.id = f.media_id
    WHERE f.id = ?
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

async function clearPrimaryFaceReferences(env, faceId) {
  const result = await env.DB.prepare('SELECT id, metadata_json FROM nodes').all();
  const statements = [];
  for (const row of result.results || []) {
    const metadata = metadataObject(row.metadata_json);
    if (metadata.primaryFaceId !== faceId) continue;
    delete metadata.primaryFaceId;
    statements.push(
      env.DB.prepare(`
        UPDATE nodes
        SET metadata_json = ?, last_updated = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(JSON.stringify(metadata), row.id)
    );
  }
  if (statements.length) await env.DB.batch(statements);
}

async function listFaces(env, url) {
  const mediaId = cleanId(url.searchParams.get('media'));
  const personId = cleanId(url.searchParams.get('person'));
  if (!mediaId && !personId) return new Response('media or person is required', { status: 400 });

  const clauses = [];
  const values = [];
  if (mediaId) {
    clauses.push('f.media_id = ?');
    values.push(mediaId);
  }
  if (personId) {
    clauses.push('f.person_id = ?');
    values.push(personId);
  }

  const statement = env.DB.prepare(`
    SELECT f.id, f.media_id, f.person_id, f.x, f.y, f.width, f.height,
           f.created_at, f.updated_at,
           m.width AS media_width, m.height AS media_height, m.mime_type
    FROM faces f
    INNER JOIN media m ON m.id = f.media_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY f.created_at ASC, f.id ASC
  `).bind(...values);
  const result = await statement.all();
  return json({ items: (result.results || []).map(rowToFace) });
}

async function preferredFaces(env) {
  const [peopleResult, facesResult] = await Promise.all([
    env.DB.prepare('SELECT id, metadata_json FROM nodes ORDER BY id ASC').all(),
    env.DB.prepare(`
      SELECT f.id, f.media_id, f.person_id, f.x, f.y, f.width, f.height,
             f.created_at, f.updated_at,
             m.width AS media_width, m.height AS media_height, m.mime_type
      FROM faces f
      INNER JOIN media m ON m.id = f.media_id
      WHERE f.person_id IS NOT NULL AND f.person_id <> ''
      ORDER BY f.person_id ASC, f.created_at ASC, f.id ASC
    `).all()
  ]);

  const byPerson = new Map();
  for (const row of facesResult.results || []) {
    const face = rowToFace(row);
    if (!byPerson.has(face.personId)) byPerson.set(face.personId, []);
    byPerson.get(face.personId).push(face);
  }

  const items = [];
  for (const person of peopleResult.results || []) {
    const metadata = metadataObject(person.metadata_json);
    const candidates = byPerson.get(person.id) || [];
    const face = choosePreferredFace(candidates, metadata.primaryFaceId, person.id);
    if (!face) continue;
    items.push({
      personId: person.id,
      explicit: !!metadata.primaryFaceId && face.id === metadata.primaryFaceId,
      face
    });
  }
  return json({ items });
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

async function setPreferredFace(env, faceId) {
  const existing = await faceRow(env, faceId);
  if (!existing) return new Response('Face not found', { status: 404 });
  if (!existing.person_id) return new Response('Assign the face to a person first', { status: 409 });

  const person = await env.DB.prepare('SELECT id, metadata_json FROM nodes WHERE id = ?')
    .bind(existing.person_id).first();
  if (!person) return new Response('Person not found', { status: 404 });

  const metadata = metadataObject(person.metadata_json);
  metadata.primaryFaceId = faceId;
  await env.DB.prepare(`
    UPDATE nodes
    SET metadata_json = ?, last_updated = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(JSON.stringify(metadata), person.id).run();

  return json({
    success: true,
    personId: person.id,
    primaryFaceId: faceId,
    face: rowToFace(existing)
  });
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

    if (existing.person_id && existing.person_id !== personId) {
      await clearPrimaryFaceReferences(env, faceId);
    }

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
  await clearPrimaryFaceReferences(env, faceId);
  await env.DB.prepare('DELETE FROM faces WHERE id = ?').bind(faceId).run();
  return json({ success: true });
}

export async function handleFacesApi(request, env, url) {
  if (!env.DB) return new Response('DB binding missing', { status: 500 });
  await ensureFacesSchema(env);

  const parts = url.pathname.split('/').filter(Boolean);
  const faceId = parts[2] ? decodeURIComponent(parts[2]) : null;
  const action = parts[3] || null;

  try {
    if (faceId === 'preferred' && !action) {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return preferredFaces(env);
    }

    if (!faceId) {
      if (request.method === 'GET') return listFaces(env, url);
      if (request.method === 'POST') return createFace(request, env);
      return new Response('Method not allowed', { status: 405 });
    }

    if (action === 'preferred') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return setPreferredFace(env, faceId);
    }

    if (request.method === 'PATCH') return patchFace(request, env, faceId);
    if (request.method === 'DELETE') return deleteFace(env, faceId);
    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    return new Response(error.message || 'Invalid face request', { status: 400 });
  }
}

export const FACE_LIMITS = Object.freeze({ minSize: MIN_FACE_SIZE });
