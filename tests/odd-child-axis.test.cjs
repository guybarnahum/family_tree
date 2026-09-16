'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sourcePath = process.env.LAYOUT_REFINEMENT_SOURCE || 'public/layout-refinement.js';
let stage = null;
const Controller = { registerLayoutStage(value) { stage = value; } };
const parentsByChild = new Map();
const spousesByPerson = new Map();
const addSpouse = (a, b) => {
  if (!spousesByPerson.has(a)) spousesByPerson.set(a, new Set());
  if (!spousesByPerson.has(b)) spousesByPerson.set(b, new Set());
  spousesByPerson.get(a).add(b);
  spousesByPerson.get(b).add(a);
};
const Store = { snapshot: () => ({ indexes: { parentsByChild, spousesByPerson } }) };
const unitByNodeId = new Map();
const globalNodeMap = new Map();
const globalUnits = [];
const globalNodes = [];

function node(id, x, parentId = null) {
  const value = { id, name: id, x, parent_id: parentId, cardWidth: 100 };
  globalNodeMap.set(id, value);
  globalNodes.push(value);
  return value;
}
function unit(id, gen, centerX, width, members) {
  const value = { id, gen, centerX, width, members, parents: new Set(), children: new Set() };
  globalUnits.push(value);
  for (const member of members) unitByNodeId.set(member.id, value);
  return value;
}

const p1 = node('p1', 830);
const p2 = node('p2', 970);
addSpouse('p1', 'p2');
const parent = unit('P', 0, 900, 240, [p1, p2]);

const c1 = unit('C1', 1, 0, 100, [node('c1', 0, 'p1')]);
const c2 = unit('C2', 1, 1000, 100, [node('c2', 1000, 'p1')]);
const c3 = unit('C3', 1, 2100, 100, [node('c3', 2100, 'p1')]);
for (const child of [c1, c2, c3]) {
  parent.children.add(child);
  child.parents.add(parent);
  parentsByChild.set(child.members[0].id, new Set(['p1', 'p2']));
}

const g31 = unit('G31', 2, 1900, 100, [node('g31', 1900, 'c3')]);
const g32 = unit('G32', 2, 2300, 100, [node('g32', 2300, 'c3')]);
c3.children.add(g31); c3.children.add(g32);
g31.parents.add(c3); g32.parents.add(c3);
parentsByChild.set('g31', new Set(['c3']));
parentsByChild.set('g32', new Set(['c3']));

const context = {
  console, Date, Math, Map, Set,
  window: null,
  FamilyRenderController: Controller,
  FamilyGraphStore: Store,
  globalUnits, globalNodes, globalNodeMap, unitByNodeId,
  geometryMobileQuery: { matches: false },
  MOBILE_UNIT_GAP: 48,
  UNIT_GAP: 40,
  CANVAS_PAD_X: 0,
  unitSeparation(left, right) { return left.width / 2 + 40 + right.width / 2; },
  updateCanvasBounds() {},
  syncCardPositions() {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
assert(stage, 'relationship-compaction stage should register');
stage.run();

const diagnostics = context.__familySubtreeLayoutDiagnostics;
const rootGroup = diagnostics.groups.find(group => group.parents === 'p1 + p2');
const centerChildX = globalNodeMap.get('c2').x;
assert(rootGroup, 'odd-child union diagnostics should exist');
assert.strictEqual(rootGroup.targetCount, 3);
assert(Math.abs(rootGroup.unionAnchor - centerChildX) <= 1,
  'odd child group must put the union directly above the center child');
assert(Math.abs(rootGroup.axisOffset) <= 1,
  'center child should receive a straight vertical connector');
assert(Math.abs(rootGroup.offset) > 10,
  'direct-child axis should win over an asymmetric descendant bounding box');

console.log('odd-child-axis tests passed');
