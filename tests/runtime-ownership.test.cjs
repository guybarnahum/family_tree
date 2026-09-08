'use strict';

const assert = require('assert');
const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const bootstrap = read('public/runtime-bootstrap.js');
const controller = read('public/render-controller.js');
const api = read('public/family-api.js');
const store = read('public/graph-store.js');
const sync = read('public/graph-sync.js');
const graphView = read('public/graph-view.js');
const mutations = read('public/family-mutations.js');
const personMedia = read('public/person-media.js');
const faceTagging = read('public/face-tagging.js');
const entry = read('src/entry.js');

const layoutModules = {
  'multi-partner': read('public/multi-partner-refinement.js'),
  'relationship-compaction': read('public/layout-refinement.js'),
  planar: read('public/planar-layout.js'),
  'member-order': read('public/member-order-refinement.js'),
  'bridge-compaction': read('public/bridge-compaction.js'),
  'planar-router': read('public/planar-router.js')
};

// One explicit browser transport.
assert(api.includes('window.FamilyApi = Object.freeze'), 'FamilyApi must expose explicit transport');
assert(api.includes('const nativeFetch = window.fetch.bind(window)'), 'FamilyApi captures native fetch once');
assert(!api.includes('window.fetch ='), 'FamilyApi must not replace global fetch');
assert(store.includes('const Api = window.FamilyApi'), 'GraphStore must consume FamilyApi');
assert(sync.includes('const Api = window.FamilyApi'), 'GraphSync must consume FamilyApi');
assert(!store.includes('window.fetch =') && !sync.includes('window.fetch ='), 'Store/sync must not wrap fetch');
assert(personMedia.includes('const Api = window.FamilyApi'), 'person media must use FamilyApi');
assert(faceTagging.includes('const Api = window.FamilyApi'), 'face tagging must use FamilyApi');
assert(faceTagging.includes('const Store = window.FamilyGraphStore'), 'face tagging people come from GraphStore');
assert(!personMedia.includes('fetch(`/api') && !faceTagging.includes('fetch(`/api'),
  'feature modules must not bypass FamilyApi');

// Canonical graph and mutation ownership.
assert(graphView.includes('const Store = window.FamilyGraphStore'), 'GraphView must consume GraphStore');
assert(!graphView.includes("fetch('/api/graph'"), 'GraphView must not fetch canonical graph');
assert(!graphView.includes('history.replaceState'), 'GraphView must not own history');
assert(mutations.includes('window.FamilyMutations = Object.freeze'), 'FamilyMutations must own mutations');
assert(mutations.includes('Api.request'), 'FamilyMutations must use FamilyApi');
assert(!mutations.includes('Store.noteMutation'), 'mutation bookkeeping belongs to transport event path');

// RenderController executes explicit named stages; no RAF-capture architecture remains.
assert(controller.includes('function registerLayoutStage'), 'RenderController must register layout stages');
assert(controller.includes('function registerPrepareStage'), 'RenderController must register prepare stages');
assert(controller.includes('function registerValidationStage'), 'RenderController must register final validators');
assert(controller.includes('function registerConnectorStage'), 'RenderController must register connector stage');
assert(controller.includes('function runValidation()'), 'RenderController must run final validators');
for (const retired of ['capturedRafs', 'withCapturedAnimationFrames', 'runDeferredDiagnostics']) {
  assert(!controller.includes(retired), `RenderController must not retain ${retired}`);
}
assert(controller.includes('function controlledLayoutAndRender()'),
  'temporary inert legacy layout boundary remains until M4-G callers are deleted');

// Every algorithm module registers directly and reads topology only from GraphStore.
for (const [name, source] of Object.entries(layoutModules)) {
  assert(source.includes('FamilyGraphStore') || name === 'relationship-compaction',
    `${name} must use canonical Store topology when topology is needed`);
  assert(!source.includes("fetch('/api/graph'"), `${name} must not fetch the graph`);
  assert(!/\bloadTree\s*=/.test(source), `${name} must not wrap loadTree`);
  assert(!/\blayoutAndRender\s*=/.test(source), `${name} must not wrap layoutAndRender`);
  assert(!source.includes('setTimeout(resolve, 20)'), `${name} must not poll for predecessor function names`);
}
assert(layoutModules['multi-partner'].includes("registerPrepareStage({ name: 'multi-partner'"),
  'multi-partner must register its topology prepare stage');
assert(layoutModules['relationship-compaction'].includes("name: 'relationship-compaction'"),
  'relationship compaction must register directly');
assert(layoutModules.planar.includes("registerLayoutStage({\n        name: 'planar'"), 'planar stage must register directly');
assert(layoutModules.planar.includes("registerValidationStage({\n        name: 'planar'"),
  'planarity diagnostics must be an explicit final validator');
assert(layoutModules['member-order'].includes('ownsPrefix: true'), 'member-order retains explicit feedback ownership');
assert(layoutModules['member-order'].includes("Controller.runThrough('planar')"),
  'member-order feedback must execute the named planar prefix');
assert(layoutModules['bridge-compaction'].includes("name: 'bridge-compaction'"), 'bridge stage registers directly');
assert(layoutModules['planar-router'].includes("registerConnectorStage({ name: 'planar-router'"),
  'router must be the explicit final connector owner');

// Multi-partner is geometry only now; the duplicate mutation implementation is gone.
const multi = layoutModules['multi-partner'];
for (const token of ['putGraph(', 'addRelationships(', 'relationshipAwareAddSpouse',
  'relationshipAwareAddParent', 'relationshipAwareAddChild']) {
  assert(!multi.includes(token), `multi-partner must not retain duplicate mutation code: ${token}`);
}
assert(multi.includes('FamilySelectionController'), 'multi-partner root preference must use SelectionController');
assert(layoutModules['bridge-compaction'].includes('FamilySelectionController'),
  'bridge root selection must use SelectionController');

// Bootstrap is now dependency ordering + verification, not a capture harness.
for (const retired of [
  'captureLegacyModule', 'setLayout(', 'setLoadTree(', 'expectedLayoutName', 'expectedLoadName',
  'noOpLayoutAndRender', 'crossingSafeLayoutAndRender', 'lineageAwareLayoutAndRender',
  'bootstrap-sentinel', 'capturedStages'
]) assert(!bootstrap.includes(retired), `bootstrap must not retain ${retired}`);
assert(bootstrap.includes('function verifyLayoutPipeline()'), 'bootstrap must verify registered stage ownership');
assert(bootstrap.includes('registeredStages'), 'bootstrap diagnostics must report registered stages');
assert(bootstrap.includes("'/layout-refinement.js'"), 'bootstrap loads relationship stage');
assert(bootstrap.includes("'/planar-layout.js'"), 'bootstrap loads planar stage');
assert(bootstrap.includes("'/member-order-refinement.js'"), 'bootstrap loads member-order stage');
assert(bootstrap.includes("'/bridge-compaction.js'"), 'bootstrap loads bridge stage');
assert(bootstrap.includes("'/planar-router.js'"), 'bootstrap loads router');
assert(bootstrap.includes('await window.startFamilyGraph()'), 'bootstrap starts graph after stage install');

const startBody = bootstrap.slice(bootstrap.indexOf('async function start()'));
const featureInstall = startBody.indexOf('await installFeatureStack()');
const layoutInstall = startBody.indexOf('await installLayoutStack()');
const graphStart = startBody.indexOf('await window.startFamilyGraph()');
const syncInstall = startBody.indexOf('await installSyncStack()');
assert(featureInstall < layoutInstall && layoutInstall < graphStart && graphStart < syncInstall,
  'startup order must be features -> layout -> first graph -> sync');

// M4-F compatibility file is physically gone and not injected.
assert(!fs.existsSync('public/legacy-symbols.js'), 'legacy-symbols.js must be deleted');
assert(!entry.includes('legacy-symbols.js'), 'entry must not inject legacy symbols');
assert(entry.includes("'/family-core.js'"), 'entry must load family core');
assert(entry.includes("'/selection-controller.js'"), 'selection must load before GraphView');
assert(entry.indexOf("'/selection-controller.js'") < entry.indexOf("'/graph-view.js'"),
  'SelectionController must precede GraphView');
assert(entry.indexOf("'/family-api.js'") < entry.indexOf("'/graph-store.js'"),
  'FamilyApi must precede GraphStore');

for (const retired of ['public/media-resilience.js', 'public/graph-cache.js', 'public/graph-resilience.js']) {
  assert(!fs.existsSync(retired), `${retired} must remain deleted`);
}

console.log('runtime ownership tests passed');
