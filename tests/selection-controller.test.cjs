'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function harness({ href = 'https://family.example/', stored = null } = {}) {
  const listeners = new Map();
  const storage = new Map(stored ? [['family-tree.anchor-person', stored]] : []);
  let renderedRoot = null;
  const window = {
    location: { href },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); }
  };
  window.window = window;
  const history = {
    state: null,
    replaceState(state, _title, url) { this.state = state; window.location.href = String(url); }
  };
  const context = {
    window,
    history,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    document: {
      getElementById: () => null,
      querySelector: selector => selector.includes('graph-root') && renderedRoot
        ? { dataset: { nodeId: renderedRoot } }
        : null
    },
    URL,
    Date,
    console,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    MouseEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/selection-controller.js', 'utf8'), context);
  return { window, history, storage, setRenderedRoot: id => { renderedRoot = id; } };
}

{
  const h = harness({ stored: 'person-b' });
  const events = [];
  h.window.addEventListener('family-selection-will-change', event => events.push(['will', event.detail.personId]));
  h.window.addEventListener('family-selection-changed', event => events.push(['changed', event.detail.personId]));
  const Selection = h.window.FamilySelectionController;

  assert.strictEqual(Selection.restoreSelection(), 'person-b');
  assert.strictEqual(new URL(h.window.location.href).searchParams.get('person'), 'person-b');

  Selection.replaceUrlPerson('person-c', { source: 'test' });
  assert.strictEqual(Selection.getSelectedPersonId(), 'person-c');
  assert.strictEqual(h.storage.get('family-tree.anchor-person'), 'person-c');
  assert.deepStrictEqual(events.slice(-2), [['will', 'person-c'], ['changed', 'person-c']]);

  h.history.replaceState(null, '', 'https://family.example/?person=person-e');
  h.window.dispatchEvent({ type: 'popstate' });
  assert.strictEqual(Selection.getSelectedPersonId(), 'person-e');
  assert.strictEqual(h.storage.get('family-tree.anchor-person'), 'person-e');

  h.setRenderedRoot('person-d');
  Selection.syncFromRenderedRoot({ source: 'test-render' });
  assert.strictEqual(Selection.getSelectedPersonId(), 'person-d');
  assert.strictEqual(new URL(h.window.location.href).searchParams.get('person'), 'person-d');
}

{
  const h = harness({ href: 'https://family.example/?person=explicit', stored: 'stored' });
  assert.strictEqual(h.window.FamilySelectionController.restoreSelection(), 'explicit');
  assert.strictEqual(h.storage.get('family-tree.anchor-person'), 'explicit');
}

console.log('selection-controller tests passed');
