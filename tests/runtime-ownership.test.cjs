'use strict';

const assert = require('assert');
const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const nodeHover = read('public/node-hover.js');
const importExport = read('public/import-export.js');
const interaction = read('public/interaction-refinement.js');
const presentation = read('public/presentation-refinement.js');
const selection = read('public/selection-controller.js');
const graphCardGeometry = read('public/graph-card-geometry.js');
const personPaneEditing = read('public/person-pane-editing.js');
const faceFootprint = read('public/node-face-footprint.js');
const bootstrap = read('public/runtime-bootstrap.js');
const graphView = read('public/graph-view.js');
const controller = read('public/render-controller.js');
const api = read('public/family-api.js');
const store = read('public/graph-store.js');
const sync = read('public/graph-sync.js');
const visualRoles = read('public/visual-roles.js');
const parentLimit = read('public/parent-limit.js');
const identity = read('public/person-identity.js');
const pickerRefresh = read('public/person-picker-refresh.js');
const unionActions = read('public/union-child-actions.js');
const multiPartner = read('public/multi-partner-refinement.js');
const entry = read('src/entry.js');

assert(!nodeHover.includes('appendScript('), 'node-hover must not bootstrap runtime scripts');
assert(!nodeHover.includes('family-tree.anchor-person'), 'node-hover must not own root persistence');
assert(!nodeHover.includes('history.replaceState'), 'node-hover must not own selection history');

assert(!importExport.includes('history.replaceState'), 'import/export must not own selection persistence');
assert(!importExport.includes('startFamilyGraph?.()'), 'import/export must not start the runtime');
assert(importExport.includes('FamilyGraphStore') && importExport.includes('FamilyMutations'),
  'import/export must use canonical graph owners');
assert(!importExport.includes("fetch('/api/graph'"), 'import/export must not bypass graph owners');

assert(!interaction.includes("fetch('/api/graph'"), 'interaction must not fetch canonical graph for styling');
assert(!interaction.includes('history.replaceState'), 'interaction must not wrap selection history');
assert(!/\blayoutAndRender\s*\(\s*\)/.test(interaction), 'interaction must not request corrective layouts');

assert(selection.includes('function installHistoryOwner()'), 'selection controller must expose history ownership install');
assert(selection.includes("window.addEventListener('family-runtime-ready', installHistoryOwner)"),
  'selection controller must reclaim history after legacy feature bootstrap');
assert(!/history\.replaceState\s*=/.test(presentation), 'presentation must not wrap replaceState');
assert(!/history\.pushState\s*=/.test(presentation), 'presentation must not wrap pushState');
assert(!/new\s+MutationObserver/.test(presentation), 'presentation must use render lifecycle, not card DOM observation');

assert(controller.includes('legacyLayoutRequestsIgnored'), 'controller must track ignored legacy layouts');
assert(controller.includes('legacyViewportRequestsIgnored'), 'controller must track ignored legacy anchor restores');
assert(controller.includes('function controlledLayoutAndRender()'), 'controller must own legacy layout facade');
assert(controller.includes('function controlledRestoreAnchor()'), 'controller must own legacy anchor facade');
assert(controller.includes('function commitRootIdentity(rootId)'), 'controller must commit one authoritative DOM root');
assert(controller.includes('requestLayout({'), 'controller must expose explicit layout requests');
assert(!/\blayoutAndRender\s*\(\s*\)/.test(presentation), 'presentation must not invoke legacy layout');
assert(!/viewport\.(?:scrollLeft|scrollTop)\s*=|viewport\.scrollTo\s*\(/.test(presentation),
  'presentation must not own viewport positioning');
for (const [name, source] of [
  ['graph-card-geometry', graphCardGeometry],
  ['person-pane-editing', personPaneEditing],
  ['node-face-footprint', faceFootprint]
]) {
  assert(!/\blayoutAndRender\s*\(\s*\)/.test(source), `${name} must not invoke legacy layout`);
  assert(source.includes('FamilyRenderController'), `${name} must express geometry intent through RenderController`);
}

assert(bootstrap.includes("'/selection-controller.js'"), 'bootstrap must install selection controller');
assert(bootstrap.includes("'/render-controller.js'"), 'bootstrap must install RenderController');
assert(bootstrap.includes("'/node-hover.js'"), 'bootstrap must explicitly own node-hover startup');
assert(bootstrap.includes("'/visual-roles.js'"), 'bootstrap must install visual roles');
assert(bootstrap.includes("'/graph-sync.js'"), 'bootstrap must own sync startup');
assert(bootstrap.includes('await window.startFamilyGraph()'), 'bootstrap must explicitly start the graph');
assert(bootstrap.includes("'/person-pane-editing.js'"), 'bootstrap must load semantic person-pane editing module');
assert(bootstrap.includes("'/graph-card-geometry.js'"), 'bootstrap must load semantic graph-card geometry module');
assert(!bootstrap.includes('slice-a-'), 'bootstrap must not retain slice-derived feature names');
for (const retired of [
  'revision-layout-guard.js', 'graph-render-stability.js',
  'root-context-refinement.js', 'root-selection-coherence.js'
]) {
  assert(!bootstrap.includes(retired), `${retired} must not load`);
  assert(!fs.existsSync(`public/${retired}`), `${retired} must be physically removed`);
}

for (const stage of [
  "name: 'relationship-compaction'", "name: 'planar'",
  "name: 'member-order'", "name: 'bridge-compaction'"
]) assert(bootstrap.includes(stage), `bootstrap must register ${stage}`);
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
assert(graphView.includes('await controller?.prepare?.({'), 'structural graph loads must prepare named stages first');
assert(graphView.includes('FamilyGraphStore'), 'graph-view must consume GraphStore');
assert(!graphView.includes("fetch('/api/graph'"), 'graph-view must not bypass GraphStore');
assert(!graphView.includes('history.replaceState'), 'graph-view must not own selection history');
assert(!graphView.includes('baseSaveEdit'), 'graph-view must not retain saveEdit wrappers');
assert(!graphView.includes('requestAnimationFrame(() => {\n                layoutAndRender'),
  'graph-view must not retain legacy render fallback');

assert(controller.includes('function baseGeometry()'), 'RenderController must own base geometry');
assert(controller.includes('function runThrough('), 'RenderController must own named-stage execution');
assert(controller.includes('function completeVisualCommit('), 'RenderController must own final visual commit');
assert(controller.includes("window.dispatchEvent(new CustomEvent('family-graph-rendered'"),
  'RenderController must publish committed render generations');

assert(api.includes('window.FamilyApi = Object.freeze'), 'FamilyApi must own explicit browser transport');
assert(api.includes('const nativeFetch = window.fetch.bind(window)'), 'FamilyApi must capture native fetch once');
assert(!api.includes('window.fetch ='), 'FamilyApi must not monkey-patch window.fetch');
assert(api.includes("new CustomEvent('family-api-mutation'"), 'FamilyApi must publish explicit mutation events');
assert(!fs.existsSync('public/media-resilience.js'), 'old global media fetch wrapper must be removed');

assert(store.includes('window.FamilyGraphStore = Object.freeze'), 'GraphStore must own canonical client graph state');
assert(store.includes('const Api = window.FamilyApi'), 'GraphStore must use FamilyApi transport');
assert(!store.includes('window.fetch ='), 'GraphStore must not monkey-patch fetch');
assert(!store.includes('nativeFetch'), 'GraphStore must not own native transport');
assert(store.includes('peopleById') && store.includes('parentsByChild') && store.includes('spousesByPerson'),
  'GraphStore must own shared topology indexes');
assert(!store.includes('FamilyGraphCache'), 'GraphStore must not expose a cache compatibility API');
assert(!fs.existsSync('public/graph-cache.js'), 'old graph-cache file must be removed');
assert(!fs.existsSync('public/graph-resilience.js'), 'old graph-resilience file must be removed');

assert(sync.includes('const Store = window.FamilyGraphStore'), 'sync must consume GraphStore');
assert(sync.includes('const Api = window.FamilyApi'), 'sync must consume FamilyApi');
assert(!sync.includes('window.fetch ='), 'sync must not monkey-patch fetch');
assert(sync.includes("window.addEventListener('family-api-mutation'"),
  'sync must observe explicit mutation events');
for (const retiredToken of [
  '__familyRevisionReconcileToken', '__familyGraphMutationLayoutToken',
  'settleRenderWindow', 'family-revision-layout-suppressed',
  'family-noop-resize-layout-suppressed'
]) assert(!sync.includes(retiredToken), `sync must not retain ${retiredToken}`);

assert(!visualRoles.includes('new MutationObserver'), 'visual roles must use explicit lifecycle events');
assert(visualRoles.includes('FamilyGraphStore'), 'visual roles must use shared Store indexes');
assert(!parentLimit.includes('new MutationObserver'), 'parent limit must use explicit lifecycle events');
assert(parentLimit.includes('FamilyGraphStore'), 'parent limit must use shared Store indexes');
assert(identity.includes('FamilyGraphStore'), 'identity must use GraphStore');
assert(pickerRefresh.includes('FamilyGraphStore'), 'picker refresh must use GraphStore');
assert(unionActions.includes('FamilyGraphStore'), 'union actions must use GraphStore');
assert(!unionActions.includes('new MutationObserver'), 'union actions must use explicit render/store lifecycle');
assert(!unionActions.includes('unionChildAwareLayout'), 'union actions must not wrap layout ownership');
assert(!multiPartner.includes('loadGraphDocument(true).then'),
  'multi-partner must not autonomously render after loading relationship data');
assert(!multiPartner.includes('renderCards();'),
  'multi-partner must not recreate cards outside graph-view projection ownership');
assert(!multiPartner.includes('requestAnimationFrame(() => layoutAndRender())'),
  'multi-partner must not schedule its own layout generation');
for (const active of [sync, visualRoles, parentLimit, identity, pickerRefresh, unionActions]) {
  assert(!active.includes('FamilyGraphCache'), 'active runtime modules must not reference FamilyGraphCache');
}

assert(entry.includes("'/family-api.js'"), 'entry must install FamilyApi before GraphStore');
assert(entry.indexOf("'/family-api.js'") < entry.indexOf("'/graph-store.js'"),
  'FamilyApi must load before GraphStore');
assert(entry.includes("'/graph-store.js'"), 'entry must install GraphStore foundation');
assert(!entry.includes("'/media-resilience.js'"), 'entry must not install retired media wrapper');
assert(!entry.includes("'/graph-cache.js'"), 'entry must not install retired graph cache');
assert(!entry.includes("'/graph-resilience.js'"), 'entry must not install retired graph resilience');
assert(entry.includes("if (!url.pathname.startsWith('/api/'))"), 'entry must own frontend asset handling directly');
assert(entry.includes('return handleFrontendAsset(request, env);'), 'frontend must bypass worker script injection');
assert(entry.includes("'/runtime-bootstrap.js'"), 'entry must install runtime bootstrap');
assert(!entry.includes("'/graph-sync.js'"), 'entry must not inject sync before bootstrap');
assert(!entry.includes("'/graph-debug.js'"), 'entry must not inject graph debug before sync');

console.log('runtime ownership tests passed');
