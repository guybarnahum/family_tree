'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/render-controller.js', 'utf8');

const frames = new Map();
let nextFrameId = 1;
const events = [];
const trace = [];

const viewport = {
  clientWidth: 800,
  clientHeight: 600,
  scrollLeft: 0,
  scrollTop: 0
};
const canvas = { style: {} };
const cardsLayer = {
  innerHTML: '',
  querySelector() { return null; }
};
const svgLayer = {
  innerHTML: '',
  setAttribute() {}
};

const document = {
  getElementById(id) {
    if (id === 'scroll-viewport') return viewport;
    if (id === 'canvas') return canvas;
    if (id === 'cards-layer') return cardsLayer;
    if (id === 'svg-layer') return svgLayer;
    return null;
  }
};

const context = {
  console,
  document,
  URL,
  performance: { now: (() => { let n = 0; return () => ++n; })() },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
  requestAnimationFrame(callback) {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  },
  cancelAnimationFrame(id) { frames.delete(id); },
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
  drawSVGLines() { trace.push('legacy-connectors'); },
  assertLayout() { trace.push('assert'); },
  captureAnchor() { return { id: 'root', screenX: 10, screenY: 20 }; },
  restoreAnchor() { trace.push('restore-anchor'); },
  location: { href: 'https://example.test/?person=root' },
  FamilySelectionController: { getSelectedPersonId: () => 'root' },
  FamilyVisualRoles: { refreshNow: () => trace.push('roles') },
  FamilyUnionChildActions: { refresh: () => trace.push('union-actions') },
  dispatchEvent(event) { events.push(event); }
};
context.window = context;
context.layoutAndRender = function legacyLayout() {};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'render-controller.js' });

const controller = context.FamilyRenderController;
assert(controller, 'RenderController should install');
assert.strictEqual(context.layoutAndRender.name, 'controlledLayoutAndRender');

controller.registerLayoutStage({
  name: 'relationship-compaction', order: 20,
  run: () => trace.push('relationship')
});
controller.registerLayoutStage({
  name: 'planar', order: 30,
  run: () => trace.push('planar')
});
controller.registerLayoutStage({
  name: 'member-order', order: 40, ownsPrefix: true,
  run: () => {
    trace.push('member-start');
    controller.runThrough('planar');
    trace.push('member-end');
  }
});
controller.registerLayoutStage({
  name: 'bridge-compaction', order: 50,
  run: () => trace.push('bridge')
});
controller.registerConnectorStage({
  name: 'planar-router', run: () => trace.push('router')
});

async function flushFrame() {
  const entry = [...frames.entries()][0];
  assert(entry, 'expected a scheduled animation frame');
  frames.delete(entry[0]);
  entry[1](0);
  await Promise.resolve();
}

(async () => {
  const first = controller.renderProjection({ rootId: 'root', recenter: true, reason: 'first' });
  const second = controller.renderProjection({ rootId: 'root', recenter: true, reason: 'second' });

  const superseded = await first;
  assert.strictEqual(superseded.superseded, true, 'new projection should supersede the pending generation');
  assert.strictEqual(frames.size, 1, 'only newest generation should retain a frame');

  await flushFrame();
  const committed = await second;
  assert.strictEqual(committed.committed, true);

  const stageTrace = trace.filter(value => [
    'measure', 'units', 'generations', 'layout-units', 'vertical', 'members', 'bounds',
    'sync-cards', 'relationship', 'planar', 'member-start', 'member-end', 'bridge'
  ].includes(value));
  assert.deepStrictEqual(stageTrace, [
    'member-start',
    'measure', 'units', 'generations', 'layout-units', 'vertical', 'members', 'bounds', 'sync-cards',
    'relationship', 'planar',
    'member-end', 'bridge'
  ], 'feedback owner should explicitly execute the planar prefix once in this harness');

  assert.strictEqual(trace.filter(value => value === 'router').length, 1, 'one final connector generation');
  assert.strictEqual(trace.filter(value => value === 'assert').length, 1, 'one final layout assertion');
  assert.strictEqual(trace.filter(value => value === 'roles').length, 1, 'roles applied once at commit');
  assert.strictEqual(trace.filter(value => value === 'union-actions').length, 1, 'union actions synced once at commit');
  assert.strictEqual(viewport.scrollLeft, 0);
  assert.strictEqual(viewport.scrollTop, 0);

  const rendered = events.filter(event => event.type === 'family-graph-rendered');
  const stable = events.filter(event => event.type === 'family-graph-render-stable');
  assert.strictEqual(rendered.length, 1);
  assert.strictEqual(stable.length, 1);
  assert.strictEqual(rendered[0].detail.reason, 'second');

  const snapshot = controller.snapshot();
  assert.strictEqual(snapshot.generationsStarted, 2);
  assert.strictEqual(snapshot.generationsSuperseded, 1);
  assert.strictEqual(snapshot.generationsCommitted, 1);
  assert.strictEqual(snapshot.connectorRuns, 1);
  assert.deepStrictEqual(
    Array.from(snapshot.lastStageOrder),
    ['base-geometry', 'relationship-compaction', 'planar', 'member-order', 'bridge-compaction']
  );

  console.log('render controller tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
