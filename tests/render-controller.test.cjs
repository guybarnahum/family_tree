'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class ClassList {
  constructor(values = []) { this.values = new Set(values); }
  contains(value) { return this.values.has(value); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) {
    if (force) this.values.add(value); else this.values.delete(value);
    return force;
  }
}

const frames = new Map();
const timers = new Map();
const events = [];
const trace = [];
let frameId = 0;
let timerId = 0;
const viewport = {
  clientWidth: 800,
  clientHeight: 600,
  scrollLeft: 0,
  scrollTop: 0,
  style: {},
  addEventListener() {}
};
const cards = [
  { dataset: { nodeId: 'root' }, classList: new ClassList(['graph-context', 'graph-spouse-parent']) },
  { dataset: { nodeId: 'old' }, classList: new ClassList(['graph-root']) }
];

const context = {
  console,
  performance: { now: (() => { let n = 0; return () => ++n; })() },
  CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  document: {
    hidden: false,
    activeElement: null,
    addEventListener() {},
    querySelector() { return null; },
    getElementById(id) {
      return {
        'scroll-viewport': viewport,
        canvas: { style: {} },
        'cards-layer': { innerHTML: '', querySelectorAll: () => cards },
        'svg-layer': { innerHTML: '' }
      }[id] || null;
    }
  },
  requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { frames.delete(id); },
  setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
  addEventListener() {},
  dispatchEvent(event) { events.push(event); },
  globalNodes: [{ id: 'root', x: 400, targetY: 250, cardWidth: 100, cardHeight: 80 }],
  globalNodeMap: new Map([['root', { id: 'root', x: 400, targetY: 250, cardWidth: 100, cardHeight: 80 }]]),
  measureCards() { trace.push('measure'); },
  buildFamilyUnits() { trace.push('units'); },
  assignGenerations() { trace.push('generations'); },
  layoutUnits() { trace.push('layout-units'); return new Map(); },
  assignVerticalPositions() { trace.push('vertical'); },
  positionMembers() { trace.push('members'); },
  updateCanvasBounds() { trace.push('bounds'); },
  syncCardPositions() { trace.push('sync-cards'); },
  assertLayout() { trace.push('assert'); },
  captureAnchor() { return null; },
  restoreAnchor() {},
  FamilySelectionController: { getSelectedPersonId: () => 'root' },
  FamilyVisualRoles: { refreshNow: () => trace.push('roles') },
  FamilyUnionChildActions: { refresh: () => trace.push('union-actions') }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('public/render-controller.js', 'utf8'), context);

const controller = context.FamilyRenderController;
controller.registerLayoutStage({ name: 'relationship-compaction', order: 20, run: () => trace.push('relationship') });
controller.registerLayoutStage({ name: 'planar', order: 30, run: () => trace.push('planar') });
controller.registerLayoutStage({
  name: 'member-order', order: 40, ownsPrefix: true,
  run: () => { trace.push('member-start'); controller.runThrough('planar'); trace.push('member-end'); }
});
controller.registerLayoutStage({ name: 'bridge-compaction', order: 50, run: () => trace.push('bridge') });
controller.registerConnectorStage({ name: 'planar-router', run: () => trace.push('router') });
controller.registerValidationStage({ name: 'planar', order: 30, run: () => trace.push('validate') });

(async () => {
  assert.strictEqual(viewport.style.paddingLeft, '400px');
  assert.strictEqual(viewport.style.paddingRight, '400px');
  assert.strictEqual(viewport.style.paddingTop, '300px');
  assert.strictEqual(viewport.style.paddingBottom, '300px');
  assert.strictEqual(timers.size, 1);

  const first = controller.renderProjection({ rootId: 'root', recenter: true, reason: 'first' });
  const second = controller.renderProjection({ rootId: 'root', recenter: true, reason: 'second' });
  assert.strictEqual((await first).superseded, true);
  assert.strictEqual(frames.size, 1);

  const [id, callback] = [...frames.entries()][0];
  frames.delete(id);
  callback(0);
  assert.strictEqual((await second).committed, true);

  assert.deepStrictEqual(trace.slice(0, 12), [
    'member-start', 'measure', 'units', 'generations', 'layout-units', 'vertical',
    'members', 'bounds', 'sync-cards', 'relationship', 'planar', 'member-end'
  ]);
  assert(trace.indexOf('router') < trace.indexOf('validate'));
  assert.strictEqual(trace.filter(value => value === 'router').length, 1);
  assert.strictEqual(trace.filter(value => value === 'validate').length, 1);

  assert(cards[0].classList.contains('graph-root'));
  assert(!cards[0].classList.contains('graph-context'));
  assert(!cards[0].classList.contains('graph-spouse-parent'));
  assert(!cards[1].classList.contains('graph-root'));

  assert.strictEqual(viewport.scrollLeft, 400);
  assert.strictEqual(viewport.scrollTop, 290);

  const rendered = events.filter(event => event.type === 'family-graph-rendered');
  assert.strictEqual(rendered.length, 1);
  assert.strictEqual(rendered[0].detail.reason, 'second');

  let snapshot = controller.snapshot();
  assert.strictEqual(snapshot.generationsStarted, 2);
  assert.strictEqual(snapshot.generationsSuperseded, 1);
  assert.strictEqual(snapshot.generationsCommitted, 1);
  assert.strictEqual(snapshot.connectorRuns, 1);
  assert.strictEqual(snapshot.validationRuns, 1);
  assert.strictEqual(snapshot.viewportCommits, 1);
  assert.strictEqual(snapshot.idleRecenterMs, 30000);

  context.FamilySelectionController.getSelectedPersonId = () => null;
  const rootNode = context.globalNodeMap.get('root');
  rootNode.x = 700;
  rootNode.targetY = 500;
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  assert.strictEqual(controller.centerRoot('missing', { reason: 'fallback-test' }), true);
  assert.strictEqual(viewport.scrollLeft, 700);
  assert.strictEqual(viewport.scrollTop, 540);
  snapshot = controller.snapshot();
  assert.strictEqual(snapshot.fallbackRecenters, 1);

  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
  const [idleId, idleCallback] = [...timers.entries()][0];
  timers.delete(idleId);
  idleCallback();
  assert.strictEqual(viewport.scrollLeft, 700);
  assert.strictEqual(viewport.scrollTop, 540);
  snapshot = controller.snapshot();
  assert.strictEqual(snapshot.idleRecenters, 1);
  assert.strictEqual(snapshot.fallbackRecenters, 2);
  assert.strictEqual(timers.size, 1);

  console.log('render controller tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
