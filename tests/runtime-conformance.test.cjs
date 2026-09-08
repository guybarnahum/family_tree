'use strict';

const assert = require('assert');
const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const index = read('public/index.html');
const core = read('public/family-core.js');
const mutations = read('public/family-mutations.js');
const union = read('public/union-child-actions.js');
const personPaneEditing = read('public/person-pane-editing.js');
const bootstrap = read('public/runtime-bootstrap.js');
const entry = read('src/entry.js');

assert(!index.includes('function loadTree'), 'index shell must not contain graph loading');
assert(!index.includes('function layoutAndRender'), 'index shell must not contain layout runtime');
assert(!index.includes('function saveEdit'), 'index shell must not contain edit persistence');
assert(!index.includes('function addChild'), 'index shell must not contain structural mutations');
assert(!index.includes('setInterval('), 'index shell must not poll');
assert(!index.includes("addEventListener('resize'"), 'index shell must not own render resize behavior');
assert(!index.includes("addEventListener('focusout'"), 'index shell must not own persistence blur behavior');
assert(!index.includes('legacy-symbols.js'), 'index shell must not hardcode runtime compatibility scripts');

assert(core.includes('function buildFamilyUnits()'), 'family-core must retain base geometry primitives');
assert(core.includes('function createCardHTML(node)'), 'family-core must own base card construction');
assert(!core.includes("fetch('/api/"), 'family-core must not perform application data I/O');
assert(!core.includes('setInterval('), 'family-core must not poll');

assert(mutations.includes('window.FamilyMutations = Object.freeze'), 'FamilyMutations must expose canonical mutation API');
assert(mutations.includes("method: 'PUT'"), 'structural mutations must use graph PUT');
assert(mutations.includes("method: 'PATCH'"), 'person updates must use one explicit PATCH path');
assert(mutations.includes("cardsLayer.addEventListener('click'"), 'FamilyMutations must own card action dispatch');

assert(personPaneEditing.includes('Mutations.updatePerson'), 'pane saves must delegate to FamilyMutations');
assert(!personPaneEditing.includes('/api/nodes/'), 'pane UX must not own person network writes');
assert(!personPaneEditing.includes('__familyUnchangedGuard'), 'saveEdit wrapper chain must be removed');
assert(personPaneEditing.includes('__familyPersonPaneEditingInstalled'), 'pane editing must use a semantic install guard');
assert(!union.includes("fetch('/api/graph'"), 'union actions must not own structural writes');
assert(!union.includes("fetch('/api/nodes"), 'union actions must not own node mutations');
assert(union.includes('Mutations.addChildToUnion'), 'union UI must delegate structural intent');

assert(!bootstrap.includes('pane-save-guard.js'), 'obsolete pane save guard must not load');
assert(bootstrap.includes('function installMutationFacade()'), 'bootstrap must reclaim historical mutation globals');
assert(bootstrap.includes('addChild = mutations.addChild'), 'legacy addChild global must resolve to canonical mutations');
assert(bootstrap.includes("'/person-pane-editing.js'"), 'bootstrap must use thematic pane editing name');
assert(bootstrap.includes("'/graph-card-geometry.js'"), 'bootstrap must use thematic graph geometry name');
assert(!bootstrap.includes('slice-a-'), 'bootstrap must not retain slice-derived module names');
assert(!fs.existsSync('public/pane-save-guard.js'), 'pane-save-guard must be physically removed');

assert(entry.includes("'/legacy-symbols.js'"), 'entry must version transitional compatibility symbols');
assert(entry.includes("'/family-core.js'"), 'entry must load extracted family core');
assert(entry.includes("'/family-mutations.js'"), 'entry must load canonical mutations before runtime bootstrap');
assert(!entry.includes('stripLegacyInlineStartup'), 'entry must not edit legacy inline application code');

for (const retiredName of [
  'public/slice-a-polish.js',
  'public/slice-a-geometry.js'
]) {
  assert(!fs.existsSync(retiredName), `${retiredName} must be renamed, not kept as an alias`);
}

console.log('runtime conformance tests passed');
