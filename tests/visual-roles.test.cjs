'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class ClassListStub {
  constructor(values = []) {
    this.values = new Set(values);
  }
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

class MutationObserverStub {
  observe() {}
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

// R has sibling B and spouse S. S also has spouse O, and S+O have child C.
// P/Q are S's parents/couple; D is one generation farther up S's ancestry.
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
  querySelectorAll() {
    return cards;
  }
};

const listeners = new Map();
const graph = { people: [], relationships };
const globalNodeMap = new Map(cards.map(card => [
  card.dataset.nodeId,
  {
    id: card.dataset.nodeId,
    // Graph projection historically marks root siblings as context; unified roles must
    // promote B back to sibling/primary for the selected root.
    viewRole: card.dataset.nodeId === 'B' ? 'context' : 'primary'
  }
]));

const window = {
  location: { href: 'https://family.example/?person=R' },
  FamilyGraphCache: { load: () => ({ graph }) },
  FamilySelectionController: { getSelectedPersonId: () => 'R' },
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
  MutationObserver: MutationObserverStub,
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

console.log('visual-roles tests passed');
