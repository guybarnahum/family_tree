'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/family-mutations.js', 'utf8');
let graph = {
  format: 'family-graph',
  version: 2,
  people: [
    { id: 'A', name: 'A', metadata: {} },
    { id: 'B', name: 'B', metadata: {} },
    { id: 'C', name: 'C', metadata: {} }
  ],
  relationships: [
    { type: 'spouse', person1Id: 'A', person2Id: 'B' },
    { type: 'parent', person1Id: 'A', person2Id: 'C' }
  ]
};
let revision = 1;
let graphPuts = 0;
let personPatches = 0;
let loads = 0;
let selected = 'A';
const events = [];

const cardsLayer = { addEventListener() {} };
const Store = {
  async refresh() { return { graph: structuredClone(graph) }; },
  finiteRevision(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : null;
  },
  person(id) { return graph.people.find(person => person.id === id) || null; },
  updatePerson(id, patch, { revision: next }) {
    Object.assign(this.person(id), patch);
    if (next) revision = next;
  },
  snapshot() { return { revision, graph }; }
};

async function requestStub(input, init = {}) {
  const url = new URL(String(input), 'https://family.example/');
  const method = String(init.method || 'GET').toUpperCase();
  if (url.pathname === '/api/graph' && method === 'PUT') {
    graphPuts += 1;
    graph = JSON.parse(init.body);
    revision += 1;
    return new Response('{}', {
      status: 200,
      headers: { 'X-Family-Graph-Revision': String(revision) }
    });
  }
  if (url.pathname.startsWith('/api/nodes/') && method === 'PATCH') {
    personPatches += 1;
    revision += 1;
    return new Response('{}', {
      status: 200,
      headers: { 'X-Family-Graph-Revision': String(revision) }
    });
  }
  if (url.pathname === '/api/media' && method === 'GET') return Response.json({ items: [] });
  throw new Error(`unexpected request ${method} ${url.pathname}`);
}

const context = {
  console,
  URL,
  Response,
  structuredClone,
  confirm: () => true,
  showStatus() {},
  globalNodeMap: new Map(),
  requestAnimationFrame(callback) { callback(); return 1; },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
  document: { getElementById(id) { return id === 'cards-layer' ? cardsLayer : null; } },
  dispatchEvent(event) { events.push(event); },
  FamilyGraphStore: Store,
  FamilyApi: {
    request: requestStub,
    revisionFromResponse(response) {
      return Store.finiteRevision(
        response.headers.get('X-Family-Graph-Revision') || response.headers.get('X-Family-Revision')
      );
    }
  },
  FamilySelectionController: {
    getSelectedPersonId: () => selected,
    selectPerson(id) { selected = id; return true; },
    replaceUrlPerson(id) { selected = id; return true; }
  },
  async loadTree() { loads += 1; }
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'family-mutations.js' });

(async () => {
  const Mutations = context.FamilyMutations;
  assert(Mutations, 'FamilyMutations should install');

  const childResult = await Mutations.addChild('A');
  assert(childResult?.childId, 'addChild should create a child');
  const childId = childResult.childId;
  assert(graph.relationships.some(r => r.type === 'parent' && r.person1Id === 'A' && r.person2Id === childId));
  assert(graph.relationships.some(r => r.type === 'parent' && r.person1Id === 'B' && r.person2Id === childId),
    'one-spouse child must receive both explicit parents');
  assert.strictEqual(selected, childId, 'new child should become selected');

  const parentId = await Mutations.addParent('C');
  assert(parentId, 'addParent should create a second parent');
  assert(graph.relationships.some(r => r.type === 'parent' && r.person1Id === parentId && r.person2Id === 'C'));
  assert(graph.relationships.some(r => r.type === 'spouse' &&
    ((r.person1Id === 'A' && r.person2Id === parentId) || (r.person1Id === parentId && r.person2Id === 'A'))),
    'second parent must create/ensure the parent union');

  const beforePatches = personPatches;
  const noop = await Mutations.updatePerson('A', { name: 'A' });
  assert.strictEqual(noop.changed, false);
  assert.strictEqual(personPatches, beforePatches, 'unchanged edit must not hit the network');

  const changed = await Mutations.updatePerson('A', { name: 'Alicia' });
  assert.strictEqual(changed.changed, true);
  assert.strictEqual(personPatches, beforePatches + 1);
  assert.strictEqual(Store.person('A').name, 'Alicia');

  selected = childId;
  const deleted = await Mutations.deletePerson(childId);
  assert.strictEqual(deleted, true);
  assert(!graph.people.some(person => person.id === childId));
  assert.strictEqual(selected, 'A', 'deleting the selected child should move selection to a surviving parent');

  assert(loads >= 3, 'structural writes should refresh through the canonical graph loader');
  assert(graphPuts >= 3, 'structural actions should use transactional graph PUTs');
  assert(events.some(event => event.type === 'family-graph-mutated'));

  console.log('family mutation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
