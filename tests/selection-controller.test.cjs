'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class CustomEventStub {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

class MouseEventStub {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

function createHarness({ href = 'https://family.example/', stored = null } = {}) {
  const listeners = new Map();
  const storage = new Map();
  if (stored) storage.set('family-tree.anchor-person', stored);
  let renderedRootId = null;

  const window = {
    location: { href },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    }
  };
  window.window = window;

  const history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      window.location.href = String(url);
    },
    pushState(state, _title, url) {
      this.state = state;
      window.location.href = String(url);
    }
  };

  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  };

  const document = {
    querySelector(selector) {
      if (selector.includes('graph-root') && renderedRootId) {
        return { dataset: { nodeId: renderedRootId } };
      }
      return null;
    },
    getElementById() {
      return null;
    }
  };

  const context = {
    window,
    history,
    localStorage,
    document,
    URL,
    CustomEvent: CustomEventStub,
    MouseEvent: MouseEventStub,
    Date,
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/selection-controller.js', 'utf8'), context);

  return {
    window,
    history,
    storage,
    setRenderedRoot(id) { renderedRootId = id; }
  };
}

{
  const harness = createHarness({ stored: 'person-b' });
  const events = [];
  harness.window.addEventListener('family-selection-will-change', event => {
    events.push(['will', event.detail.personId, event.detail.previousPersonId]);
  });
  harness.window.addEventListener('family-selection-changed', event => {
    events.push(['changed', event.detail.personId, event.detail.previousPersonId]);
  });

  assert.strictEqual(harness.window.FamilySelectionController.restoreSelection(), 'person-b');
  assert.strictEqual(
    new URL(harness.window.location.href).searchParams.get('person'),
    'person-b'
  );
  assert.strictEqual(
    harness.window.FamilySelectionController.getSelectedPersonId(),
    'person-b'
  );

  harness.history.replaceState(null, '', 'https://family.example/?person=person-c');
  assert.strictEqual(harness.storage.get('family-tree.anchor-person'), 'person-c');
  assert.strictEqual(
    harness.window.FamilySelectionController.getSelectedPersonId(),
    'person-c'
  );
  assert.deepStrictEqual(events.slice(-2), [
    ['will', 'person-c', 'person-b'],
    ['changed', 'person-c', 'person-b']
  ]);

  harness.setRenderedRoot('person-d');
  harness.window.FamilySelectionController.syncFromRenderedRoot({ source: 'test' });
  assert.strictEqual(
    new URL(harness.window.location.href).searchParams.get('person'),
    'person-d'
  );
  assert.strictEqual(harness.storage.get('family-tree.anchor-person'), 'person-d');
  assert.strictEqual(
    harness.window.FamilySelectionController.getSelectedPersonId(),
    'person-d'
  );
}

{
  const harness = createHarness({
    href: 'https://family.example/?person=explicit-person',
    stored: 'stored-person'
  });
  assert.strictEqual(
    harness.window.FamilySelectionController.restoreSelection(),
    'explicit-person'
  );
  assert.strictEqual(
    harness.storage.get('family-tree.anchor-person'),
    'explicit-person',
    'explicit URL selection must remain authoritative over stored selection'
  );
}

console.log('selection-controller tests passed');
