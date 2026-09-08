'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/graph-store.js', 'utf8');

function createStoreContext(requestImpl, { status = null } = {}) {
  const storage = new Map();
  const events = [];
  const listeners = new Map();
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const finiteRevision = value => {
    const result = Number(value);
    return Number.isInteger(result) && result >= 1 ? result : null;
  };
  const context = {
    console,
    Headers,
    Response,
    structuredClone,
    localStorage,
    performance: { now: (() => { let n = 0; return () => ++n; })() },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    FamilyApi: {
      request: requestImpl,
      finiteRevision,
      revisionFromResponse(response) {
        return finiteRevision(
          response?.headers?.get('X-Family-Graph-Revision') ||
          response?.headers?.get('X-Family-Revision')
        );
      }
    },
    FamilyGraphStatus: status,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const handler of listeners.get(event.type) || []) handler(event);
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'graph-store.js' });
  return { context, Store: context.FamilyGraphStore, storage, events };
}

(async () => {
  let graphReads = 0;
  const networkGraph = {
    format: 'family-graph', version: 2,
    people: [{ id: 'A', name: 'Alice', metadata: {} }, { id: 'B', name: 'Bob', metadata: {} }],
    relationships: [{ id: 'spouse:A:B', type: 'spouse', person1Id: 'A', person2Id: 'B' }]
  };

  async function request(input) {
    assert.strictEqual(input, '/api/graph');
    graphReads += 1;
    return new Response(JSON.stringify(networkGraph), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Family-Graph-Revision': '2'
      }
    });
  }

  const { context, Store, storage, events } = createStoreContext(request);
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

  await Store.read({ reason: 'clean-read' });
  assert.strictEqual(graphReads, 0, 'clean graph reads must stay in GraphStore');

  Store.markStale(2);
  await Store.read({ reason: 'test-refresh' });
  snapshot = Store.snapshot();
  assert.strictEqual(graphReads, 1, 'stale graph must refresh once through FamilyApi');
  assert.strictEqual(snapshot.revision, 2);
  assert(snapshot.indexes.spousesByPerson.get('A').has('B'));
  assert.strictEqual(snapshot.stale, false);
  assert.strictEqual(snapshot.dirty, false);

  context.dispatchEvent(new context.CustomEvent('family-api-mutation', {
    detail: { method: 'PATCH', path: '/api/nodes/A', scope: 'graph', revision: 3, at: Date.now() }
  }));
  snapshot = Store.snapshot();
  assert.strictEqual(snapshot.dirty, true, 'graph mutation event must dirty Store');
  assert.strictEqual(snapshot.serverRevision, 3);

  Store.updatePerson('A', { name: 'Alicia' }, { revision: 3, reason: 'pane-name-saved' });
  snapshot = Store.snapshot();
  assert.strictEqual(snapshot.graph.people.find(person => person.id === 'A').name, 'Alicia');
  assert.strictEqual(snapshot.revision, 3);
  assert.strictEqual(snapshot.dirty, false, 'known local person delta should clean Store');

  const persisted = JSON.parse(storage.get('family-tree.graph-cache.v1'));
  assert.strictEqual(persisted.revision, 3);
  assert.strictEqual(persisted.graph.people.find(person => person.id === 'A').name, 'Alicia');
  assert(events.filter(event => event.type === 'family-graph-store-changed').length >= 3);
  assert(events.some(event => event.type === 'family-graph-store-fetch'));

  const shown = [];
  const failingStatus = {
    classify: error => ({ kind: 'server', transient: true, status: error.status || 500, text: error.message }),
    show: options => shown.push(options),
    clear() {},
    ageLabel() { return ''; }
  };
  const failing = createStoreContext(async () => {
    const error = new Error('backend unavailable');
    error.status = 503;
    throw error;
  }, { status: failingStatus });

  await assert.rejects(() => failing.Store.read({ refresh: true, reason: 'first-load' }));
  assert.strictEqual(shown.length, 1, 'first-load failure must surface through GraphStatus');
  assert.strictEqual(shown[0].mode, 'full');
  assert.strictEqual(shown[0].kind, 'server');
  assert.strictEqual(typeof shown[0].retry, 'function');

  console.log('graph store tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
