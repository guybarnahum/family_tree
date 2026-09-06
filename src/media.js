const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);

let mediaSchemaPromise = null;

function json(value, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Cache-Control', 'no-store');
  return Response.json(value, { ...init, headers });
}

function cleanText(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanFilename(value) {
  return cleanText(value, 180).replace(/[\u0000-\u001f\u007f]/g, '') || 'photo';
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveIntOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizePlace(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const text = cleanText(value, 500);
    return text ? { text } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const text = cleanText(value.text, 500);
  if (!text) return null;

  const result = { text };
  const countryCode = cleanText(value.countryCode, 2).toUpperCase();
  if (/^[A-Z]{2}$/.test(countryCode)) result.countryCode = countryCode;

  const geonameId = Number(value.geonameId);
  if (Number.isInteger(geonameId) && geonameId > 0) result.geonameId = geonameId;

  const latitude = finiteOrNull(value.latitude);
  const longitude = finiteOrNull(value.longitude);
  if (latitude !== null && latitude >= -90 && latitude <= 90) result.latitude = latitude;
  if (longitude !== null && longitude >= -180 && longitude <= 180) result.longitude = longitude;

  return result;
}

async function ensureMediaSchema(env) {
  if (!mediaSchemaPromise) {
    mediaSchemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY,
          object_key TEXT NOT NULL UNIQUE,
          original_filename TEXT,
          mime_type TEXT NOT NULL,
          byte_size INTEGER NOT NULL,
          width INTEGER,
          height INTEGER,
          caption TEXT,
          taken_date_text TEXT,
          taken_place_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS media_people (
          media_id TEXT NOT NULL,
          person_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (media_id, person_id),
          FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_media_people_person ON media_people(person_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_media_people_media ON media_people(media_id)`)
    ]);
  }

  try {
    await mediaSchemaPromise;
  } catch (error) {
    mediaSchemaPromise = null;
    throw error;
  }
}

function rowToMedia(row) {
  let takenPlace = null;
  if (row?.taken_place_json) {
    try { takenPlace = normalizePlace(JSON.parse(row.taken_place_json)); }
    catch (_) {}
  }

  return {
    id: row.id,
    originalFilename: row.original_filename || null,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    caption: row.caption || '',
    takenDate: row.taken_date_text || '',
    takenPlace,
    createdAt: row.created_at || null,
    contentUrl: `/api/media/${encodeURIComponent(row.id)}/content`
  };
}

async function mediaRow(env, mediaId) {
  return env.DB.prepare(`
    SELECT id, object_key, original_filename, mime_type, byte_size, width, height,
           caption, taken_date_text, taken_place_json, created_at
    FROM media
    WHERE id = ?
  `).bind(mediaId).first();
}

async function listForPerson(env, personId) {
  const result = await env.DB.prepare(`
    SELECT m.id, m.object_key, m.original_filename, m.mime_type, m.byte_size,
           m.width, m.height, m.caption, m.taken_date_text, m.taken_place_json, m.created_at
    FROM media m
    INNER JOIN media_people mp ON mp.media_id = m.id
    WHERE mp.person_id = ?
    ORDER BY m.created_at DESC, m.id DESC
  `).bind(personId).all();

  return (result.results || []).map(rowToMedia);
}

async function uploadMedia(request, env, url) {
  if (!env.MEDIA) return new Response('MEDIA R2 binding missing', { status: 503 });

  const personId = cleanText(url.searchParams.get('person'), 160);
  if (!personId) return new Response('person is required', { status: 400 });

  const person = await env.DB.prepare('SELECT id FROM nodes WHERE id = ?').bind(personId).first();
  if (!person) return new Response('Person not found', { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return new Response('Image file is required', { status: 400 });
  }

  const mimeType = cleanText(file.type, 100).toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return new Response('Unsupported image type', { status: 415 });
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_MEDIA_BYTES) {
    return new Response(`Image must be between 1 byte and ${MAX_MEDIA_BYTES} bytes`, { status: 413 });
  }

  const id = `media_${crypto.randomUUID()}`;
  const objectKey = `media/${id}/original`;
  const originalFilename = cleanFilename(file.name);
  const width = positiveIntOrNull(form.get('width'));
  const height = positiveIntOrNull(form.get('height'));
  const bytes = await file.arrayBuffer();

  await env.MEDIA.put(objectKey, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { originalFilename }
  });

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO media (
          id, object_key, original_filename, mime_type, byte_size, width, height,
          caption, taken_date_text, taken_place_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', NULL)
      `).bind(id, objectKey, originalFilename, mimeType, file.size, width, height),
      env.DB.prepare(`
        INSERT INTO media_people (media_id, person_id)
        VALUES (?, ?)
      `).bind(id, personId)
    ]);
  } catch (error) {
    try { await env.MEDIA.delete(objectKey); } catch (_) {}
    throw error;
  }

  const created = await mediaRow(env, id);
  return json({ success: true, item: rowToMedia(created) }, { status: 201 });
}

async function patchMedia(request, env, mediaId) {
  const existing = await mediaRow(env, mediaId);
  if (!existing) return new Response('Media not found', { status: 404 });

  const data = await request.json();
  const fields = Object.keys(data || {});
  if (fields.length !== 1) {
    return new Response('PATCH expects exactly one field', { status: 400 });
  }

  const field = fields[0];
  if (field === 'caption') {
    await env.DB.prepare('UPDATE media SET caption = ? WHERE id = ?')
      .bind(cleanText(data.caption, 4000), mediaId).run();
  } else if (field === 'takenDate') {
    await env.DB.prepare('UPDATE media SET taken_date_text = ? WHERE id = ?')
      .bind(cleanText(data.takenDate, 300), mediaId).run();
  } else if (field === 'takenPlace') {
    const place = normalizePlace(data.takenPlace);
    await env.DB.prepare('UPDATE media SET taken_place_json = ? WHERE id = ?')
      .bind(place ? JSON.stringify(place) : null, mediaId).run();
  } else {
    return new Response('Unsupported media field', { status: 400 });
  }

  return json({ success: true, item: rowToMedia(await mediaRow(env, mediaId)) });
}

async function deleteMedia(env, mediaId) {
  const existing = await mediaRow(env, mediaId);
  if (!existing) return new Response('Media not found', { status: 404 });

  if (env.MEDIA) await env.MEDIA.delete(existing.object_key);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM media_people WHERE media_id = ?').bind(mediaId),
    env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mediaId)
  ]);
  return json({ success: true });
}

async function mediaContent(env, mediaId) {
  if (!env.MEDIA) return new Response('MEDIA R2 binding missing', { status: 503 });
  const existing = await mediaRow(env, mediaId);
  if (!existing) return new Response('Media not found', { status: 404 });

  const object = await env.MEDIA.get(existing.object_key);
  if (!object) return new Response('Media object not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag || object.etag);
  headers.set('Cache-Control', 'private, max-age=86400');
  headers.set('Content-Disposition', `inline; filename="${cleanFilename(existing.original_filename).replaceAll('"', '')}"`);
  return new Response(object.body, { headers });
}

export async function handleMediaApi(request, env, url) {
  if (!env.DB) return new Response('DB binding missing', { status: 500 });
  await ensureMediaSchema(env);

  const parts = url.pathname.split('/').filter(Boolean);
  const mediaId = parts[2] ? decodeURIComponent(parts[2]) : null;
  const action = parts[3] || null;

  if (!mediaId) {
    if (request.method === 'GET') {
      const personId = cleanText(url.searchParams.get('person'), 160);
      if (!personId) return new Response('person is required', { status: 400 });
      return json({
        items: await listForPerson(env, personId),
        storageConfigured: !!env.MEDIA,
        maxUploadBytes: MAX_MEDIA_BYTES
      });
    }
    if (request.method === 'POST') return uploadMedia(request, env, url);
    return new Response('Method not allowed', { status: 405 });
  }

  if (action === 'content') {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    return mediaContent(env, mediaId);
  }

  if (request.method === 'PATCH') return patchMedia(request, env, mediaId);
  if (request.method === 'DELETE') return deleteMedia(env, mediaId);
  return new Response('Method not allowed', { status: 405 });
}

export const MEDIA_LIMITS = Object.freeze({
  maxUploadBytes: MAX_MEDIA_BYTES,
  allowedImageTypes: [...ALLOWED_IMAGE_TYPES]
});
