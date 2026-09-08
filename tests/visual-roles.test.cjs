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

const relationships = [];
let relationIndex = 0;
const relationship = (type, person1Id, person2Id) =>
  relationships.push({ id: `${type}-${++relationIndex}`, type, person1Id, person2Id });
const parent = (a, b) => relationship('parent', a, b);
const spouse = (a, b) => relationship('spouse', a, b);

parent('X', 'R');
spouse('R', 'S');
spouse('S', 'O');
parent('S', 'C');
parent('O', 'C');
parent('P', 'S');
spouse('P', 'Q');
spouse('P', 'B');
parent('D', 'P');

const cards = ['R', 'S', 'B', 'O', 'C', 'P', 'Q', 'D'].map(id =>
  new CardStub(id, id === 'R'
    ? ['graph-root', 'graph-context', 'graph-spouse-parent']
    : (id === 'B' ? ['graph-context'] : []))
);
const cardsLayer = { querySelectorAll: () => cards };

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
  } else {
    addSet(spousesByPerson, relation.person1Id, relation.person2Id);
    addSet(spousesByPerson, relation.person2Id, relation.person1Id);
  }
}

const graph = { people: [], relationships };
const globalNodeMap = new Map(cards.map(card => [
  card.dataset.nodeId,
  {
    id: card.dataset.nodeId,
    viewRole: card.dataset.nodeId === 'B'
      ? 'sibling'
      : (card.dataset.nodeId === 'O' ? 'context' : 'primary')
  }
]));

const window = {
  FamilyGraphStore: {
    snapshot: () => ({
      graph,
      indexes: { parentsByChild, childrenByParent, spousesByPerson }
    })
  }
};
window.window = window;

const document = {
  head: { appendChild() {} },
  createElement: () => ({ textContent: '' }),
  getElementById: id => id === 'cards-layer' ? cardsLayer : null
};

const context = {
  window,
  document,
  globalNodeMap,
  Number,
  Map,
  Set,
  console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/visual-roles.js', 'utf8'), context);

const card = id => cards.find(candidate => candidate.dataset.nodeId === id);
assert.strictEqual(window.FamilyVisualRoles.refreshNow('R'), true);

assert.strictEqual(card('R').classList.contains('graph-context'), false);
assert.strictEqual(card('R').classList.contains('graph-spouse-parent'), false);
assert.strictEqual(card('R').dataset.familyVisualRole, 'root');

assert(window.__familyVisualRoleDiagnostics.siblings.includes('B'));
assert.strictEqual(card('B').classList.contains('graph-context'), false);
assert.strictEqual(card('B').classList.contains('graph-spouse-parent'), false);
assert.strictEqual(card('B').classList.contains('graph-spouse-ancestor-deep'), false);
assert.strictEqual(card('B').dataset.familyVisualRole, 'sibling');

assert.strictEqual(card('O').classList.contains('graph-context'), true);
assert.strictEqual(card('O').dataset.familyVisualRole, 'other-union-context');
assert.strictEqual(card('C').classList.contains('graph-context'), true);
assert.strictEqual(card('C').dataset.familyVisualRole, 'other-union-context');
assert.strictEqual(card('P').classList.contains('graph-spouse-parent'), true);
assert.strictEqual(card('Q').classList.contains('graph-spouse-parent'), true);
assert.strictEqual(card('D').classList.contains('graph-spouse-ancestor-deep'), true);

// RenderController commits the DOM root before applying roles for the same generation.
card('R').classList.remove('graph-root');
card('O').classList.add('graph-root');
assert.strictEqual(window.FamilyVisualRoles.refreshNow('O'), true);
assert.strictEqual(window.__familyVisualRoleDiagnostics.rootId, 'O');
assert.strictEqual(card('O').dataset.familyVisualRole, 'root');
assert.strictEqual(card('O').classList.contains('graph-context'), false);
assert.notStrictEqual(card('R').dataset.familyVisualRole, 'root');

assert.strictEqual(window.FamilyVisualRoles.refreshNow(), false,
  'visual roles require an authoritative committed root');

console.log('visual-roles tests passed');
