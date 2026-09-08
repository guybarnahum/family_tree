'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class ClassListStub {
  constructor(values = []) { this.values = new Set(values); }
  contains(value) { return this.values.has(value); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : !!force;
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class CardStub {
  constructor(id, classes = []) {
    this.dataset = { nodeId: id };
    this.classList = new ClassListStub(classes);
  }
}

function relationship(type, person1Id, person2Id, index) {
  return { id: `${type}-${index}`, type, person1Id, person2Id };
}

const relationships = [];
let relationIndex = 0;
const parent = (parentId, childId) => relationships.push(
  relationship('parent', parentId, childId, ++relationIndex)
);
const spouse = (a, b) => relationships.push(
  relationship('spouse', a, b, ++relationIndex)
);

parent('X', 'R');
parent('X', 'B');
spouse('R', 'S');
spouse('S', 'O');
parent('S', 'C');
parent('O', 'C');
parent('P', 'S');
spouse('P', 'Q');
parent('D', 'P');

const cards = ['R', 'S', 'B', 'O', 'C', 'P', 'Q', 'D'].map(id =>
  new CardStub(
    id,
    id === 'R'
      ? ['graph-root', 'graph-context', 'graph-spouse-parent']
      : (id === 'B' ? ['graph-context'] : [])
  )
);

const cardsLayer = {
  querySelector(selector) {
    if (!selector.includes('graph-root')) return null;
    return cards.find(card => card.classList.contains('graph-root')) || null;
  },
  querySelectorAll() { return cards; }
};

function addSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

const parentsByChild = new Map();
const childrenByParent = new Map();
const spousesByPerson = new Map();
for (const relation of relationships) {
  if (relation.type === 'parent') {
    addSet(parentsByChild, relation.person2Id, relation.person1Id);
    addSet(childrenByParent, relation.person1Id, relation.person2Id);
  } else if (relation.type === 'spouse') {
    addSet(spousesByPerson, relation.person1Id, relation.person2Id);
    addSet(spousesByPerson, relation.person2Id, relation.person1Id);
  }
}

const listeners = new Map();
const graph = { people: [], relationships };
const globalNodeMap = new Map(cards.map(card => [
  card.dataset.nodeId,
  {
    id: card.dataset.nodeId,
    viewRole: card.dataset.nodeId === 'B' || card.dataset.nodeId === 'O' ? 'context' : 'primary'
  }
]));

let selectedId = 'R';
const window = {
  location: { href: 'https://family.example/?person=R' },
  FamilyGraphStore: {
    snapshot: () => ({
      graph,
      indexes: { parentsByChild, childrenByParent, spousesByPerson, peopleById: new Map() }
    })
  },
  FamilySelectionController: { getSelectedPersonId: () => selectedId },
  addEventListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  },
  dispatchEvent(event) {
    for (const handler of listeners.get(event.type) || []) handler(event);
  }
};
window.window = window;

const document = {
  getElementById(id) { return id === 'cards-layer' ? cardsLayer : null; },
  createElement() { return { textContent: '' }; },
  head: { appendChild() {} }
};

const context = {
  window,
  document,
  globalNodeMap,
  URL,
  localStorage: { getItem: () => null },
  queueMicrotask,
  Number,
  Map,
  Set,
  Date,
  console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/visual-roles.js', 'utf8'), context);
window.FamilyVisualRoles.refreshNow();

const card = id => cards.find(candidate => candidate.dataset.nodeId === id);

assert.strictEqual(card('R').classList.contains('graph-context'), false);
assert.strictEqual(card('R').classList.contains('graph-spouse-parent'), false);
assert.strictEqual(card('R').classList.contains('graph-spouse-ancestor-deep'), false);
assert.strictEqual(card('R').dataset.familyVisualRole, 'root');

assert.strictEqual(card('B').classList.contains('graph-context'), false);
assert.strictEqual(card('B').dataset.familyVisualRole, 'sibling');

assert.strictEqual(card('O').classList.contains('graph-context'), true);
assert.strictEqual(card('O').dataset.familyVisualRole, 'other-union-context');
assert.strictEqual(card('C').classList.contains('graph-context'), true);
assert.strictEqual(card('C').dataset.familyVisualRole, 'other-union-context');

assert.strictEqual(card('P').classList.contains('graph-spouse-parent'), true);
assert.strictEqual(card('Q').classList.contains('graph-spouse-parent'), true);
assert.strictEqual(card('D').classList.contains('graph-spouse-ancestor-deep'), true);

// Pending reroot regression: SelectionController changes immediately when a contextual card is
// clicked, but the old projection can remain on screen until RenderController commits the new
// card set. Visual roles must stay bound to the rendered .graph-root during that interval.
selectedId = 'O';
window.dispatchEvent({ type: 'family-selection-changed', detail: { personId: 'O', previousPersonId: 'R' } });
window.FamilyVisualRoles.refreshNow();
assert.strictEqual(window.__familyVisualRoleDiagnostics.rootId, 'R');
assert.strictEqual(window.__familyVisualRoleDiagnostics.selectedPersonId, 'O');
assert.strictEqual(card('R').dataset.familyVisualRole, 'root');
assert.strictEqual(card('R').classList.contains('graph-context'), false);
assert.strictEqual(card('O').classList.contains('graph-context'), true);

// Once the projection commits, the rendered root becomes authoritative. Even if the node carried
// a contextual viewRole in the previous projection, the new root may never remain dimmed.
card('R').classList.remove('graph-root');
card('O').classList.add('graph-root');
window.FamilyVisualRoles.refreshNow();
assert.strictEqual(window.__familyVisualRoleDiagnostics.rootId, 'O');
assert.strictEqual(card('O').dataset.familyVisualRole, 'root');
assert.strictEqual(card('O').classList.contains('graph-context'), false);
assert.strictEqual(card('O').classList.contains('graph-spouse-parent'), false);
assert.strictEqual(card('O').classList.contains('graph-spouse-ancestor-deep'), false);

console.log('visual-roles tests passed');
