'use strict';

const assert = require('assert');
const fs = require('fs');

const read = path => fs.readFileSync(path, 'utf8');

const nodeHover = read('public/node-hover.js');
const importExport = read('public/import-export.js');
const interaction = read('public/interaction-refinement.js');
const bootstrap = read('public/runtime-bootstrap.js');
const graphView = read('public/graph-view.js');
const controller = read('public/render-controller.js');
const entry = read('src/entry.js');

assert(!nodeHover.includes('appendScript('), 'node-hover must not bootstrap runtime scripts');
assert(!nodeHover.includes('family-tree.anchor-person'), 'node-hover must not own root persistence');
assert(!nodeHover.includes('history.replaceState'), 'node-hover must not own selection history');

assert(!importExport.includes('history.replaceState'), 'import/export must not own selection persistence');
assert(!importExport.includes('startFamilyGraph?.()'), 'import/export must not start the runtime');
assert(!importExport.includes('interaction-refinement.js'), 'import/export must not dynamically load interaction');

assert(!interaction.includes("fetch('/api/graph'"), 'interaction must not fetch canonical graph for styling');
assert(!interaction.includes('history.replaceState'), 'interaction must not wrap selection history');
assert(!interaction.includes('layoutAndRender()'), 'interaction must not request corrective layouts');

assert(bootstrap.includes("'/selection-controller.js'"), 'bootstrap must install selection controller');
assert(bootstrap.includes("'/render-controller.js'"), 'bootstrap must install RenderController');
assert(bootstrap.includes("'/visual-roles.js'"), 'bootstrap must install visual roles');
assert(bootstrap.includes("'/graph-sync.js'"), 'bootstrap must own sync startup');
assert(bootstrap.includes('await window.startFamilyGraph()'), 'bootstrap must explicitly start the graph');
assert(!bootstrap.includes("'/revision-layout-guard.js'"), 'M1 revision layout guard must not load');
assert(!bootstrap.includes("'/graph-render-stability.js'"), 'M1 render stability repair layer must not load');
assert(!bootstrap.includes("'/root-context-refinement.js'"), 'legacy root-context layer must not load');
assert(!bootstrap.includes("'/root-selection-coherence.js'"), 'legacy selection repair layer must not load');

for (const stage of [
  "name: 'relationship-compaction'",
  "name: 'planar'",
  "name: 'member-order'",
  "name: 'bridge-compaction'"
]) {
  assert(bootstrap.includes(stage), `bootstrap must register ${stage}`);
}
assert(bootstrap.includes("name: 'planar-router'"), 'bootstrap must register final connector stage');
assert(bootstrap.includes('ownsPrefix: true'), 'member-order must explicitly own its feedback prefix');

const startBody = bootstrap.slice(bootstrap.indexOf('async function start()'));
const featureInstall = startBody.indexOf('await installFeatureStack()');
const layoutInstall = startBody.indexOf('await installLayoutStack()');
const graphStart = startBody.indexOf('await window.startFamilyGraph()');
const syncInstall = startBody.indexOf('await installSyncStack()');
assert(featureInstall >= 0 && layoutInstall >= 0 && graphStart >= 0 && syncInstall >= 0,
  'bootstrap start sequence must be explicit');
assert(featureInstall < layoutInstall, 'feature ownership must settle before layout stage capture');
assert(layoutInstall < graphStart, 'final named layout pipeline must install before first graph render');
assert(graphStart < syncInstall, 'sync must start only after the first committed graph render');

assert(graphView.includes('controller.renderProjection({'), 'graph-view must commit projection through RenderController');
assert(graphView.includes('await controller.prepare({'), 'structural graph loads must prepare named stages first');
const renderBody = graphView.slice(
  graphView.indexOf('function renderGraphView'),
  graphView.indexOf('function chooseInitialRoot')
);
assert(!renderBody.includes('requestAnimationFrame(() => {\n            layoutAndRender();'),
  'production graph render must not own the historical double-RAF layout path');

assert(controller.includes('function baseGeometry()'), 'RenderController must own base geometry');
assert(controller.includes('function runThrough('), 'RenderController must own named-stage execution');
assert(controller.includes('function completeVisualCommit('), 'RenderController must own final visual commit');
assert(controller.includes("window.dispatchEvent(new CustomEvent('family-graph-rendered'"),
  'RenderController must publish committed render generations');

assert(entry.includes("const legacyGraphStart = '        loadTree(null, true);\\n';"));
assert(entry.includes('layoutRefinementPattern'), 'entry must remove historical eager layout-refinement');
assert(entry.includes('revisionGuardPattern'), 'entry must remove any stale revision guard tag');
assert(!entry.includes('<script src="/revision-layout-guard.js'), 'entry must not inject revision guard');
assert(entry.includes('runtime-bootstrap.js'));
assert(!entry.includes('<script src="/graph-sync.js'), 'entry must not inject sync before bootstrap');
assert(!entry.includes('<script src="/graph-debug.js'), 'entry must not inject graph debug before sync');

console.log('runtime ownership tests passed');
