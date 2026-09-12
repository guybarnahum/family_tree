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
const drafts = new Map();
let revision = 1;
let graphPuts = 0;
let personPatches = 0;
let graphRefreshes = 0;
let projectionRefreshes = 0;
let selected = 'A';
const events = [];
let timerId = 0;
const timers = new Map();

function sameRelationship(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'spouse') {
    return (a.person1Id === b.person1Id && a.person2Id === b.person2Id) ||
      (a.person1Id === b.person2Id && a.person2Id === b.person1Id);
  }
  return a.person1Id === b.person1Id && a.person2Id === b.person2Id;
}

function viewGraph() {
  const value = structuredClone(graph);
  for (const record of drafts.values()) {
    value.people.push(structuredClone(record.person));
    for (const relation of record.relationships) {
      if (!value.relationships.some(existing => sameRelationship(existing, relation))) {
        value.relationships.push(structuredClone(relation));
      }
    }
  }
  return value;
}

const cardsLayer = { addEventListener() {} };
const Store = {
  async refresh() { return { graph: viewGraph() }; },
  finiteRevision(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : null;
  },
  person(id) {
    return graph.people.find(person => person.id === id) || drafts.get(id)?.person || null;
  },
  updatePerson(id, patch, { revision: next }) {
    Object.assign(this.person(id), patch);
    if (next) revision = next;
  },
  snapshot() { return { revision, graph }; },
  addDraft(person, relationships) {
    if (this.person(person.id)) return false;
    drafts.set(person.id, {
      person: structuredClone(person),
      relationships: structuredClone(relationships || [])
    });
    return true;
  },
  draft(id) { return drafts.get(id) || null; },
  isDraft(id) { return drafts.has(id); },
  removeDraft(id) {
    const record = drafts.get(id) || null;
    drafts.delete(id);
    return record;
  },
  updateDraftPerson(id, patch) {
    const record = drafts.get(id);
    if (!record) return false;
    Object.assign(record.person, patch);
    return true;
  }
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
  setTimeout(fn, ms) {
    const id = ++timerId;
    timers.set(id, { fn, ms });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
  document: { getElementById(id) { return id === 'cards-layer' ? cardsLayer : null; } },
  dispatchEvent(event) { events.push(event); },
  FamilyGraphStore: Store,
  FamilyGraphView: {
    async refresh(options) {
      if (options.force) graphRefreshes += 1;
      else projectionRefreshes += 1;
      assert.strictEqual(options.recenter, false);
    }
  },
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
  }
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'family-mutations.js' });

(async () => {
  const Mutations = context.FamilyMutations;
  assert(Mutations, 'FamilyMutations should install');
  assert.strictEqual(Mutations.constants.draftTtlMs, 30 * 60 * 1000);

  const childResult = await Mutations.addChild('A');
  assert(childResult?.childId, 'addChild should create a child draft');
  const childId = childResult.childId;
  assert.strictEqual(graphPuts, 0, 'creating a blank child must not write the graph');
  assert(Store.isDraft(childId));
  const childDraft = Store.draft(childId);
  assert(childDraft.relationships.some(r => r.type === 'parent' && r.person1Id === 'A' && r.person2Id === childId));
  assert(childDraft.relationships.some(r => r.type === 'parent' && r.person1Id === 'B' && r.person2Id === childId),
    'one-spouse child draft must receive both explicit parents');
  assert.strictEqual(selected, childId, 'new child should become selected');
  assert(events.some(event => event.type === 'family-focus-person-name' && event.detail?.id === childId),
    'new child should focus the pane name editor');

  const blankSave = await Mutations.updatePerson(childId, { name: '' });
  assert.strictEqual(blankSave.changed, false, 'blank draft edits must remain ephemeral');
  assert(Store.isDraft(childId));
  assert.strictEqual(graphPuts, 0);

  const initializedChild = await Mutations.updatePerson(childId, { name: 'Kid' });
  assert.strictEqual(initializedChild.changed, true);
  assert(!Store.isDraft(childId), 'first meaningful edit must promote the draft');
  assert.strictEqual(graphPuts, 1, 'draft promotion should be one transactional graph write');
  assert.strictEqual(graph.people.find(person => person.id === childId).name, 'Kid');
  assert(graph.relationships.some(r => r.type === 'parent' && r.person1Id === 'A' && r.person2Id === childId));
  assert(graph.relationships.some(r => r.type === 'parent' && r.person1Id === 'B' && r.person2Id === childId));

  const parentId = await Mutations.addParent('C');
  assert(parentId, 'addParent should create a draft second parent');
  assert(Store.isDraft(parentId));
  assert.strictEqual(graphPuts, 1, 'creating a blank parent must not write the graph');
  const parentDraft = Store.draft(parentId);
  assert(parentDraft.relationships.some(r => r.type === 'parent' && r.person1Id === parentId && r.person2Id === 'C'));
  assert(parentDraft.relationships.some(r => r.type === 'spouse' &&
    ((r.person1Id === 'A' && r.person2Id === parentId) || (r.person1Id === parentId && r.person2Id === 'A'))),
    'second parent draft must project the parent union');
  assert.strictEqual(selected, parentId, 'new parent should become selected');
  assert(events.some(event => event.type === 'family-focus-person-name' && event.detail?.id === parentId));

  await Mutations.updatePerson(parentId, { name: 'Parent' });
  assert.strictEqual(graphPuts, 2, 'initializing the parent should promote once');
  assert(!Store.isDraft(parentId));

  const spouseId = await Mutations.addSpouse('A');
  assert(spouseId && Store.isDraft(spouseId));
  assert.strictEqual(graphPuts, 2, 'creating a blank spouse must not write the graph');
  assert.strictEqual(selected, spouseId, 'new spouse should become selected');
  assert(events.some(event => event.type === 'family-focus-person-name' && event.detail?.id === spouseId));
  const beforeDraftDeletePuts = graphPuts;
  const deletedDraft = await Mutations.deletePerson(spouseId);
  assert.strictEqual(deletedDraft, true);
  assert(!Store.isDraft(spouseId));
  assert.strictEqual(graphPuts, beforeDraftDeletePuts, 'deleting a draft must stay local');
  assert.strictEqual(selected, 'A');

  const expiringId = await Mutations.addSpouse('A');
  assert(Store.isDraft(expiringId));
  const beforeExpiryPuts = graphPuts;
  const expired = await Mutations.expireDraft(expiringId);
  assert.strictEqual(expired, true);
  assert(!Store.isDraft(expiringId));
  assert.strictEqual(graphPuts, beforeExpiryPuts, 'automatic draft expiry must stay local');
  assert(events.some(event => event.type === 'family-draft-expired' && event.detail?.id === expiringId));

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

  assert(graphRefreshes >= 3, 'promotions/deletes should refresh authoritative graph state');
  assert(projectionRefreshes >= 5, 'draft create/remove should refresh only the projection');
  assert(graphPuts >= 3, 'only initialized structural changes should use graph PUTs');
  assert(events.some(event => event.type === 'family-graph-mutated'));

  console.log('family mutation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
