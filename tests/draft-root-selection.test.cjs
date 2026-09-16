'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/family-mutations.js', 'utf8');
let selected = 'A';
let projectionRefreshes = 0;
const drafts = new Map();
const graph = {
  format: 'family-graph',
  version: 2,
  people: [
    { id: 'A', name: 'A', metadata: {} },
    { id: 'B', name: 'B', metadata: {} }
  ],
  relationships: [
    { type: 'spouse', person1Id: 'A', person2Id: 'B' }
  ]
};

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

const Store = {
  async refresh() { return { graph: viewGraph() }; },
  snapshot() { return { revision: 1, graph }; },
  person(id) { return graph.people.find(person => person.id === id) || drafts.get(id)?.person || null; },
  addDraft(person, relationships) {
    drafts.set(person.id, { person: structuredClone(person), relationships: structuredClone(relationships || []) });
    return true;
  },
  draft(id) { return drafts.get(id) || null; },
  isDraft(id) { return drafts.has(id); },
  removeDraft(id) { const value = drafts.get(id) || null; drafts.delete(id); return value; },
  updateDraftPerson(id, patch) { Object.assign(drafts.get(id).person, patch); return true; },
  finiteRevision(value) { return Number(value) || null; }
};

const context = {
  console,
  URL,
  Response,
  structuredClone,
  confirm: () => true,
  showStatus() {},
  globalNodeMap: new Map(),
  setTimeout: () => 1,
  clearTimeout() {},
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
  document: {
    createElement: null,
    head: null,
    getElementById(id) { return id === 'cards-layer' ? { addEventListener() {} } : null; }
  },
  dispatchEvent() {},
  FamilyGraphStore: Store,
  FamilyGraphView: {
    async refresh(options) {
      assert.strictEqual(options.force, false);
      assert.strictEqual(options.recenter, false);
      projectionRefreshes += 1;
      assert(Store.isDraft(selected), 'selected draft must be committed before projection refresh');
      assert(viewGraph().people.some(person => person.id === selected),
        'selected draft must already be present in Store.viewGraph semantics');
    }
  },
  FamilyApi: {
    async request() { throw new Error('blank draft creation must not write'); },
    revisionFromResponse: () => null
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
  const result = await context.FamilyMutations.addChild('A');
  assert(result?.childId, 'addChild should create a draft child');
  assert.strictEqual(selected, result.childId);
  assert(Store.isDraft(result.childId));
  assert.strictEqual(projectionRefreshes, 1, 'draft creation should require one projection refresh');
  console.log('draft root selection tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
