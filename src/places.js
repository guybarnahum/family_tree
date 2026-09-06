const CACHE_TTL_DAYS = 30;
const MAX_RESULTS = 6;
const MIN_QUERY_LENGTH = 3;

// GeoNames free webservice currently allows 10,000 credits/day and 1,000/hour.
// Keep explicit headroom so this app never intentionally runs against the edge.
const HOURLY_EXTERNAL_LIMIT = 800;
const DAILY_EXTERNAL_LIMIT = 8000;

let placeSchemaPromise = null;

function response(value, { cacheable = false, ...init } = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Cache-Control', cacheable ? 'private, max-age=86400' : 'no-store');
  return Response.json(value, { ...init, headers });
}

function normalizedQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizedLang(value) {
  const lang = String(value || '').trim().toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]+)?$/.test(lang) ? lang.slice(0, 12) : 'en';
}

async function ensurePlaceSchema(env) {
  if (!placeSchemaPromise) {
    placeSchemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS place_search_cache (
          cache_key TEXT PRIMARY KEY,
          response_json TEXT NOT NULL,
          fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS place_api_usage (
          bucket TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)
    ]);
  }

  try {
    await placeSchemaPromise;
  } catch (error) {
    placeSchemaPromise = null;
    throw error;
  }
}

function usageBuckets(now = new Date()) {
  const iso = now.toISOString();
  return {
    day: `day:${iso.slice(0, 10)}`,
    hour: `hour:${iso.slice(0, 13)}`
  };
}

async function usageCount(env, bucket) {
  const row = await env.DB.prepare('SELECT count FROM place_api_usage WHERE bucket = ?')
    .bind(bucket)
    .first();
  return Number(row?.count || 0);
}

async function reserveExternalCredit(env) {
  const buckets = usageBuckets();
  const [hourCount, dayCount] = await Promise.all([
    usageCount(env, buckets.hour),
    usageCount(env, buckets.day)
  ]);

  if (hourCount >= HOURLY_EXTERNAL_LIMIT || dayCount >= DAILY_EXTERNAL_LIMIT) {
    return false;
  }

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO place_api_usage (bucket, count, updated_at)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(bucket) DO UPDATE SET
        count = count + 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(buckets.hour),
    env.DB.prepare(`
      INSERT INTO place_api_usage (bucket, count, updated_at)
      VALUES (?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(bucket) DO UPDATE SET
        count = count + 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(buckets.day),
    env.DB.prepare(`
      DELETE FROM place_api_usage
      WHERE updated_at < datetime('now', '-3 days')
    `)
  ]);

  return true;
}

async function cachedResults(env, cacheKey) {
  const row = await env.DB.prepare(`
    SELECT response_json
    FROM place_search_cache
    WHERE cache_key = ?
      AND fetched_at >= datetime('now', ?)
  `).bind(cacheKey, `-${CACHE_TTL_DAYS} days`).first();

  if (!row?.response_json) return null;
  try {
    const parsed = JSON.parse(row.response_json);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function writeCache(env, cacheKey, results) {
  await env.DB.prepare(`
    INSERT INTO place_search_cache (cache_key, response_json, fetched_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET
      response_json = excluded.response_json,
      fetched_at = CURRENT_TIMESTAMP
  `).bind(cacheKey, JSON.stringify(results)).run();
}

function placeLabel(item) {
  const parts = [];
  for (const value of [item.name, item.adminName1, item.countryName]) {
    const text = String(value || '').trim();
    if (!text) continue;
    if (parts.some(part => part.toLocaleLowerCase() === text.toLocaleLowerCase())) continue;
    parts.push(text);
  }
  return parts.join(', ');
}

function normalizedPlace(item) {
  const name = String(item?.name || item?.toponymName || '').trim();
  const countryCode = String(item?.countryCode || '').trim().toUpperCase();
  const geonameId = Number(item?.geonameId);
  const latitude = Number(item?.lat);
  const longitude = Number(item?.lng);

  return {
    name,
    label: placeLabel({ ...item, name }),
    adminName: String(item?.adminName1 || '').trim(),
    countryName: String(item?.countryName || '').trim(),
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    geonameId: Number.isFinite(geonameId) ? geonameId : null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null
  };
}

async function queryGeoNames(query, lang, username) {
  const url = new URL('https://secure.geonames.org/searchJSON');
  url.searchParams.set('q', query);
  url.searchParams.set('maxRows', String(MAX_RESULTS));
  url.searchParams.set('style', 'MEDIUM');
  url.searchParams.set('orderby', 'relevance');
  url.searchParams.set('isNameRequired', 'true');
  url.searchParams.set('lang', lang);
  url.searchParams.set('username', username);
  url.searchParams.append('featureClass', 'P');
  url.searchParams.append('featureClass', 'A');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const upstream = await fetch(url.toString(), { signal: controller.signal });
    if (!upstream.ok) throw new Error(`GeoNames HTTP ${upstream.status}`);
    const data = await upstream.json();
    if (data?.status) throw new Error(`GeoNames ${data.status.value}: ${data.status.message}`);
    return (Array.isArray(data?.geonames) ? data.geonames : [])
      .map(normalizedPlace)
      .filter(place => place.name && place.countryCode)
      .slice(0, MAX_RESULTS);
  } finally {
    clearTimeout(timeout);
  }
}

export async function handlePlacesApi(request, env, url) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  await ensurePlaceSchema(env);

  const rawQuery = String(url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  const query = normalizedQuery(rawQuery);
  const lang = normalizedLang(url.searchParams.get('lang'));
  if (query.length < MIN_QUERY_LENGTH || query.length > 120) {
    return response({ results: [], source: 'none' });
  }

  const cacheKey = `${lang}:${query}`;
  const cached = await cachedResults(env, cacheKey);
  if (cached) return response({ results: cached, source: 'cache' }, { cacheable: true });

  const username = String(env.GEONAMES_USERNAME || '').trim();
  if (!username) {
    return response({ results: [], source: 'unconfigured', configured: false });
  }

  if (!await reserveExternalCredit(env)) {
    return response({ results: [], source: 'quota', quotaReached: true });
  }

  try {
    const results = await queryGeoNames(rawQuery, lang, username);
    await writeCache(env, cacheKey, results);
    return response({ results, source: 'geonames', configured: true }, { cacheable: true });
  } catch (error) {
    console.warn('GeoNames place lookup failed:', error);
    return response({ results: [], source: 'unavailable', configured: true });
  }
}

export const PLACE_SEARCH_LIMITS = Object.freeze({
  cacheTtlDays: CACHE_TTL_DAYS,
  minQueryLength: MIN_QUERY_LENGTH,
  maxResults: MAX_RESULTS,
  hourlyExternalLimit: HOURLY_EXTERNAL_LIMIT,
  dailyExternalLimit: DAILY_EXTERNAL_LIMIT
});
