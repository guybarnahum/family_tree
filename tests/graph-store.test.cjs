'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/graph-store.js', 'utf8');
const storage = new Map();
const events = [];
let networkReads = 0;
let networkGraph = {
  format: 'family-graph', version: 2,
  people: [{ id: 'A', name: 'Alice', metadata: {} }, { id: 'B', name: 'Bob', metadata: {} }],
  relationships: [{ id: 'spouse:A:B', type: 'spouse', person1Id: 'A', person2Id: 'B' }]
};
let networkRevision = 2;

const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};

async function nativeFetch(input) {
  const url = new URL(String(input), 'https://family.example/');
  if (url.pathname !== '/api/graph') throw new Error(`unexpected fetch ${url.pathname}`);
  networkReads += 1;
  return new Response(JSON.stringify(networkGraph), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Family-Graph-Revision': String(networkRevision)
    }
  });
}

const context = {
  console,
  URL,
  Headers,
  Response,
  Request,
  structuredClone,
  localStorage,
  performance: { now: (() => { let n = 0; return () => ++n; })() },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
  fetch: nativeFetch,
  location: { href: 'https://family.example/', origin: 'https://family.example' },
  dispatchEvent(event) { events.push(event); }
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'graph-store.js' });

(async () => {
  const Store = context.FamilyGraphStore;
  assert(Store, 'FamilyGraphStore should install');
  assert.strictEqual(Store.snapshot().graph, null);

  const initial = {
    format: 'family-graph', version: 2,
    people: [{ id: 'R', name: 'Root', metadata: {} }, { id: 'C', name: 'Child', metadata: {} }],
    relationships: [{ id: 'parent:R:C', type: 'parent', person1Id: 'R', person2Id: 'C' }]
  };
  Store.replace(initial, { revision: 1, source: 'test', reason: 'seed' });
  let snapshot = Store.snapshot();
  assert.strictEqual(snapshot.revision, 1);
  assert.strictEqual(snapshot.indexes.peopleById.get('R').name, 'Root');
  assert(snapshot.indexes.parentsByChild.get('C').has('R'));
  assert(snapshot.indexes.childrenByParent.get('R').has('C'));

  const cachedResponse = await context.fetch('/api/graph', { cache: 'no-store' });
  assert.strictEqual(networkReads, 0, 'clean graph reads must stay in GraphStore');
  assert.strictEqual(cachedResponse.headers.get('X-Family-Graph-Cache'), 'hit');

  Store.markStale(2);
  await Store.read({ reason: 'test-refresh' });
  snapshot = Store.snapshot();
  assert.strictEqual(networkReads, 1, 'stale graph must refresh once from network');
  assert.strictEqual(snapshot.revision, 2);
  assert.strictEqual(snapshot.graph.people.length, 2);
  assert(snapshot.indexes.spousesByPerson.get('A').has('B'));
  assert.strictEqual(snapshot.stale, false);
  assert.strictEqual(snapshot.dirty, false);

  Store.noteMutation({ scope: 'graph', revision: 3 });
  assert.strictEqual(Store.snapshot().dirty, true);
  Store.updatePerson('A', { name: 'Alicia' }, { revision: 3, reason: 'pane-name-saved' });
  snapshot = Store.snapshot();
  assert.strictEqual(snapshot.graph.people.find(person => person.id === 'A').name, 'Alicia');
  assert.strictEqual(snapshot.revision, 3);
  assert.strictEqual(snapshot.dirty, false, 'known local person delta should clean the store');

  const persisted = JSON.parse(storage.get('family-tree.graph-cache.v1'));
  assert.strictEqual(persisted.revision, 3);
  assert.strictEqual(persisted.graph.people.find(person => person.id === 'A').name, 'Alicia');

  const storeChanges = events.filter(event => event.type === 'family-graph-store-changed');
  assert(storeChanges.length >= 3, 'store changes should use explicit events');
  assert(events.some(event => event.type === 'family-graph-store-fetch'), 'store fetch metrics event should fire');

  console.log('graph store tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
