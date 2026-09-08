'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/family-api.js', 'utf8');

(async () => {
  const storage = new Map();
  const events = [];
  let failMedia = false;
  let calls = 0;

  async function nativeFetch(input, init = {}) {
    calls += 1;
    const url = new URL(input instanceof Request ? input.url : String(input), 'https://family.example/');
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (url.pathname === '/api/graph' && method === 'GET') {
      return new Response(JSON.stringify({ people: [], relationships: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Family-Graph-Revision': '6' }
      });
    }
    if (url.pathname === '/api/graph' && method === 'PUT') {
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Family-Graph-Revision': '7' }
      });
    }
    if (url.pathname === '/api/media' && method === 'GET') {
      if (failMedia) throw new Error('offline');
      return new Response(JSON.stringify({
        storageConfigured: true,
        items: [{ id: 'm1', contentUrl: '/api/media/m1/content' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected request ${method} ${url.pathname}`);
  }

  const context = {
    console,
    URL,
    Headers,
    Request,
    Response,
    Date,
    fetch: nativeFetch,
    location: { href: 'https://family.example/', origin: 'https://family.example' },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    dispatchEvent(event) { events.push(event); }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'family-api.js' });

  const Api = context.FamilyApi;
  assert(Api, 'FamilyApi should install');
  assert.strictEqual(context.fetch, nativeFetch, 'FamilyApi must not replace window.fetch');

  await Api.request('/api/graph', { cache: 'no-store' });
  assert.strictEqual(events.length, 0, 'GET requests must not emit mutation events');

  await Api.request('/api/graph', { method: 'PUT', body: '{}' });
  assert.strictEqual(events.length, 1, 'successful mutation must emit exactly one event');
  assert.strictEqual(events[0].type, 'family-api-mutation');
  assert.deepStrictEqual(
    { scope: events[0].detail.scope, method: events[0].detail.method, revision: events[0].detail.revision },
    { scope: 'graph', method: 'PUT', revision: 7 }
  );

  const freshMedia = await Api.request('/api/media?person=P', { cache: 'no-store' });
  assert.strictEqual(freshMedia.headers.get('X-Family-Media-Stale'), null);
  assert.strictEqual((await freshMedia.json()).items[0].id, 'm1');

  failMedia = true;
  const staleMedia = await Api.request('/api/media?person=P', { cache: 'no-store' });
  assert.strictEqual(staleMedia.headers.get('X-Family-Media-Stale'), '1');
  assert.strictEqual((await staleMedia.json()).items[0].id, 'm1');
  assert(calls >= 4, 'transport should still attempt the network before resilient fallback');

  console.log('family api tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
