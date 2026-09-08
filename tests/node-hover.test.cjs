'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class ClassListStub {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

const listeners = new Map();
const field = {
  dataset: { field: 'name' },
  textContent: 'Sophia Bar-Nahum',
  innerText: '', // reproduce the old hidden-layout failure mode
  classList: new ClassListStub(),
  closest(selector) {
    return selector.includes('[data-field]') ? this : null;
  }
};

const cardsLayer = {
  querySelectorAll(selector) {
    return selector.includes('.absolute-card [data-field]') ? [field] : [];
  },
  addEventListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  },
  contains(element) { return element === field; }
};

const document = {
  head: { appendChild() {} },
  createElement() { return { textContent: '' }; },
  getElementById(id) { return id === 'cards-layer' ? cardsLayer : null; }
};

const context = {
  console,
  document,
  Date,
  window: null,
  addEventListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  },
  dispatchEvent(event) {
    for (const handler of listeners.get(event.type) || []) handler(event);
  }
};
context.window = context;

vm.createContext(context);
vm.runInContext(fs.readFileSync('public/node-hover.js', 'utf8'), context, { filename: 'node-hover.js' });

assert.strictEqual(
  field.classList.contains('default-node-text'),
  false,
  'real textContent must not be classified as placeholder when innerText is temporarily empty'
);

field.textContent = 'שם';
context.dispatchEvent({ type: 'family-graph-rendered' });
assert.strictEqual(field.classList.contains('default-node-text'), true, 'literal placeholder should be marked on read-only cards');

field.textContent = 'Itai Nahum';
context.dispatchEvent({ type: 'family-graph-rendered' });
assert.strictEqual(field.classList.contains('default-node-text'), false, 'committed real name should clear placeholder styling');

assert.strictEqual(context.__familyNodeTextDiagnostics.defaults, 0);
assert.strictEqual(context.__familyNodeTextDiagnostics.realValues, 1);

console.log('node hover placeholder tests passed');
