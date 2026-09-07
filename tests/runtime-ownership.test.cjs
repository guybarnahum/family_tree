'use strict';

const assert = require('assert');
const fs = require('fs');

const read = path => fs.readFileSync(path, 'utf8');

const nodeHover = read('public/node-hover.js');
const importExport = read('public/import-export.js');
const interaction = read('public/interaction-refinement.js');
const bootstrap = read('public/runtime-bootstrap.js');
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
assert(bootstrap.includes("'/visual-roles.js'"), 'bootstrap must install visual roles');
assert(bootstrap.includes("'/graph-sync.js'"), 'bootstrap must own sync startup');
assert(bootstrap.includes('await window.startFamilyGraph()'), 'bootstrap must explicitly start the graph');
assert(
  bootstrap.indexOf("'/visual-roles.js'") < bootstrap.indexOf('await window.startFamilyGraph()'),
  'visual roles must be installed before the first graph render'
);
assert(
  bootstrap.indexOf('await window.startFamilyGraph()') < bootstrap.indexOf("'/graph-sync.js'"),
  'sync must start only after the first committed graph render'
);
assert(!bootstrap.includes("'/root-context-refinement.js'"), 'legacy root-context layer must not load');
assert(!bootstrap.includes("'/root-selection-coherence.js'"), 'legacy selection repair layer must not load');

assert(entry.includes("const legacyGraphStart = '        loadTree(null, true);\\n';"));
assert(entry.includes('runtime-bootstrap.js'));
assert(!entry.includes('<script src="/graph-sync.js'), 'entry must not inject sync before bootstrap');
assert(!entry.includes('<script src="/graph-debug.js'), 'entry must not inject graph debug before sync');

console.log('runtime ownership tests passed');
