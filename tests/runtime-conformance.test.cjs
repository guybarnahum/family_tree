'use strict';

const assert = require('assert');
const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const index = read('public/index.html');
const core = read('public/family-core.js');
const api = read('public/family-api.js');
const store = read('public/graph-store.js');
const mutations = read('public/family-mutations.js');
const union = read('public/union-child-actions.js');
const personPaneEditing = read('public/person-pane-editing.js');
const graphView = read('public/graph-view.js');
const visualRoles = read('public/visual-roles.js');
const bootstrap = read('public/runtime-bootstrap.js');
const entry = read('src/entry.js');

assert(!index.includes('function loadTree'), 'index shell must not contain graph loading');
assert(!index.includes('function layoutAndRender'), 'index shell must not contain layout runtime');
assert(!index.includes('function saveEdit'), 'index shell must not contain edit persistence');
assert(!index.includes('function addChild'), 'index shell must not contain structural mutations');
assert(!index.includes('setInterval('), 'index shell must not poll');
assert(!index.includes("addEventListener('resize'"), 'index shell must not own render resize behavior');
assert(!index.includes("addEventListener('focusout'"), 'index shell must not own persistence blur behavior');
assert(!index.includes('legacy-symbols.js'), 'index shell must not hardcode compatibility scripts');

assert(core.includes('function buildFamilyUnits()'), 'family-core must retain base geometry primitives');
assert(core.includes('function createCardHTML(node)'), 'family-core must own base card construction');
assert(!core.includes("fetch('/api/"), 'family-core must not perform application data I/O');
assert(!core.includes('setInterval('), 'family-core must not poll');

assert(api.includes('window.FamilyApi = Object.freeze'), 'FamilyApi must expose explicit transport');
assert(api.includes('const nativeFetch = window.fetch.bind(window)'), 'FamilyApi alone may capture native fetch');
assert(!api.includes('window.fetch ='), 'FamilyApi must not replace global fetch');
assert(api.includes("new CustomEvent('family-api-mutation'"), 'FamilyApi must publish mutation revisions explicitly');
assert(!fs.existsSync('public/media-resilience.js'), 'media fetch wrapper must be physically removed');

assert(store.includes('const Api = window.FamilyApi'), 'GraphStore must use FamilyApi');
assert(!store.includes('window.fetch ='), 'GraphStore must not wrap fetch');
assert(!store.includes('nativeFetch'), 'GraphStore must not own native transport');

assert(mutations.includes('window.FamilyMutations = Object.freeze'), 'FamilyMutations must expose canonical mutation API');
assert(mutations.includes('Api.request'), 'mutations must use FamilyApi transport');
assert(mutations.includes("method: 'PUT'"), 'structural mutations must use graph PUT');
assert(mutations.includes("method: 'PATCH'"), 'person updates must use one explicit PATCH path');
assert(mutations.includes("cardsLayer.addEventListener('click'"), 'FamilyMutations must own card action dispatch');
assert(!mutations.includes('Store.noteMutation'), 'transport mutation bookkeeping must not be duplicated');

assert(personPaneEditing.includes('Mutations.updatePerson'), 'pane saves must delegate to FamilyMutations');
assert(!personPaneEditing.includes('/api/nodes/'), 'pane UX must not own person network writes');
assert(!personPaneEditing.includes('__familyUnchangedGuard'), 'saveEdit wrapper chain must be removed');
assert(personPaneEditing.includes('__familyPersonPaneEditingInstalled'), 'pane editing must use semantic install guard');
assert(!union.includes("fetch('/api/graph'"), 'union actions must not own structural writes');
assert(!union.includes("fetch('/api/nodes"), 'union actions must not own node mutations');
assert(union.includes('Mutations.addChildToUnion'), 'union UI must delegate structural intent');

assert(graphView.includes('const Store = window.FamilyGraphStore'), 'graph-view must consume GraphStore');
assert(graphView.includes('let rootSiblingIds = new Set()'), 'graph-view must track selected-root siblings explicitly');
assert(graphView.includes('rootSiblingIds = siblingsOf(graphRootId)'), 'graph-view must classify siblings during projection');
assert(graphView.includes("? 'sibling'"), 'graph-view must emit a sibling viewRole');
assert(graphView.includes("card.classList.toggle('graph-context', node.viewRole === 'context')"),
  'graph-view must not dim every lateral node');
assert(!graphView.includes("fetch('/api/graph'"), 'graph-view must not bypass GraphStore');
assert(!graphView.includes('history.replaceState'), 'graph-view must not own history');
assert(!graphView.includes('baseSaveEdit'), 'graph-view must not retain save wrapper debt');
assert(visualRoles.includes("node?.viewRole === 'sibling'"), 'visual roles must consume projection sibling semantics');
assert(!visualRoles.includes('projectionSiblings('), 'visual roles must not reconstruct projection siblinghood');
assert(!visualRoles.includes('parent_id'), 'visual roles must not infer siblinghood from layout fields');

// Bootstrap may wait for semantic dependency guards, but must not capture algorithm globals.
assert(!bootstrap.includes('captureLegacyModule'), 'bootstrap capture harness must be removed');
assert(!bootstrap.includes('setLayout('), 'bootstrap must not swap layout globals');
assert(!bootstrap.includes('setLoadTree('), 'bootstrap must not swap graph loaders');
assert(!bootstrap.includes('expectedLayoutName'), 'bootstrap must not inspect layout function names');
assert(!bootstrap.includes('expectedLoadName'), 'bootstrap must not inspect load function names');
assert(!bootstrap.includes('bootstrap-sentinel'), 'bootstrap must not inject fake dependency sentinels');
assert(bootstrap.includes('verifyLayoutPipeline()'), 'bootstrap must verify registered stage ownership');
assert(bootstrap.includes("'/person-pane-editing.js'"), 'bootstrap must use thematic pane editing module');
assert(bootstrap.includes("'/graph-card-geometry.js'"), 'bootstrap must use thematic graph geometry module');
assert(!bootstrap.includes('slice-a-'), 'bootstrap must not retain slice-derived module names');
assert(!fs.existsSync('public/pane-save-guard.js'), 'pane-save-guard must stay deleted');
assert(!fs.existsSync('public/legacy-symbols.js'), 'legacy-symbols must be physically removed');

assert(entry.includes("'/family-core.js'"), 'entry must load extracted family core');
assert(entry.includes("'/selection-controller.js'"), 'entry must load canonical selection owner');
assert(entry.includes("'/family-api.js'"), 'entry must load explicit transport');
assert(entry.indexOf("'/selection-controller.js'") < entry.indexOf("'/graph-view.js'"),
  'selection owner must load before graph projection');
assert(entry.indexOf("'/family-api.js'") < entry.indexOf("'/graph-store.js'"), 'transport must load before Store');
assert(entry.includes("'/family-mutations.js'"), 'entry must load canonical mutations before runtime bootstrap');
assert(!entry.includes("'/legacy-symbols.js'"), 'entry must not load retired legacy symbols');
assert(!entry.includes("'/media-resilience.js'"), 'entry must not load retired media wrapper');
assert(!entry.includes('stripLegacyInlineStartup'), 'entry must not edit legacy inline application code');

for (const retiredName of [
  'public/slice-a-polish.js',
  'public/slice-a-geometry.js',
  'public/legacy-symbols.js'
]) assert(!fs.existsSync(retiredName), `${retiredName} must not survive as an alias`);

console.log('runtime conformance tests passed');
