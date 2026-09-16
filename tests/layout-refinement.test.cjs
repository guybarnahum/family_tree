'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function makeHarness({ multiPartner = false } = {}) {
  let stage = null;
  const Controller = {
    registerLayoutStage(value) { stage = value; }
  };

  const parentsByChild = new Map();
  const spousesByPerson = new Map();
  const addSpouse = (a, b) => {
    if (!spousesByPerson.has(a)) spousesByPerson.set(a, new Set());
    if (!spousesByPerson.has(b)) spousesByPerson.set(b, new Set());
    spousesByPerson.get(a).add(b);
    spousesByPerson.get(b).add(a);
  };
  const Store = {
    snapshot() { return { indexes: { parentsByChild, spousesByPerson } }; }
  };

  const unitByNodeId = new Map();
  const globalNodeMap = new Map();
  const globalUnits = [];
  const globalNodes = [];

  function node(id, x, parentId = null, width = 100) {
    const value = { id, name: id, x, parent_id: parentId, cardWidth: width };
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

  const context = {
    console,
    Date,
    Math,
    Map,
    Set,
    window: null,
    FamilyRenderController: Controller,
    FamilyGraphStore: Store,
    globalUnits,
    globalNodes,
    globalNodeMap,
    unitByNodeId,
    geometryMobileQuery: { matches: false },
    MOBILE_UNIT_GAP: 48,
    UNIT_GAP: 40,
    CANVAS_PAD_X: 0,
    unitSeparation(left, right) { return left.width / 2 + 40 + right.width / 2; },
    updateCanvasBounds() {},
    syncCardPositions() {}
  };
  context.window = context;

  if (!multiPartner) {
    const p1 = node('p1', 830);
    const p2 = node('p2', 970);
    addSpouse('p1', 'p2');
    const parent = unit('P', 0, 900, 240, [p1, p2]);

    const c1n = node('c1', 0, 'p1');
    const c2n = node('c2', 1000, 'p1');
    const c1 = unit('C1', 1, 0, 100, [c1n]);
    const c2 = unit('C2', 1, 1000, 100, [c2n]);
    parent.children.add(c1); parent.children.add(c2);
    c1.parents.add(parent); c2.parents.add(parent);

    const g1n = node('g1', -100, 'c1');
    const g2n = node('g2', 1100, 'c2');
    const g1 = unit('G1', 2, -100, 100, [g1n]);
    const g2 = unit('G2', 2, 1100, 100, [g2n]);
    c1.children.add(g1); c2.children.add(g2);
    g1.parents.add(c1); g2.parents.add(c2);

    parentsByChild.set('c1', new Set(['p1', 'p2']));
    parentsByChild.set('c2', new Set(['p1', 'p2']));
    parentsByChild.set('g1', new Set(['c1']));
    parentsByChild.set('g2', new Set(['c2']));

    context.fixture = { parent, c1, c2, g1, g2 };
  } else {
    const a = node('a', 0);
    const b = node('b', 140);
    const c = node('c', 280);
    addSpouse('a', 'b');
    addSpouse('b', 'c');
    const parent = unit('P', 0, 140, 380, [a, b, c]);

    const c1n = node('c1', -200, 'a');
    const c2n = node('c2', 600, 'b');
    const c1 = unit('C1', 1, -200, 100, [c1n]);
    const c2 = unit('C2', 1, 600, 100, [c2n]);
    parent.children.add(c1); parent.children.add(c2);
    c1.parents.add(parent); c2.parents.add(parent);
    parentsByChild.set('c1', new Set(['a', 'b']));
    parentsByChild.set('c2', new Set(['b', 'c']));
    context.fixture = { parent, c1, c2 };
  }

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/layout-refinement.js', 'utf8'), context);
  assert(stage, 'relationship-compaction stage should register');
  return { context, run: () => stage.run() };
}

{
  const h = makeHarness();
  h.run();
  const diagnostics = h.context.__familySubtreeLayoutDiagnostics;
  assert(diagnostics, 'subtree diagnostics should be published');
  const rootGroup = diagnostics.groups.find(group => group.parents === 'p1 + p2');
  assert(rootGroup, 'root union diagnostics should exist');
  assert(Math.abs(rootGroup.offset) <= 1, 'union attachment should center over descendant span');
  assert(rootGroup.subtreeWidth < 500, 'widely separated sibling subtrees should compact substantially');
  assert(rootGroup.avoidableGap <= 1, 'safe sibling compaction should remove avoidable subtree gap');
  assert(rootGroup.connectorWidth < 250, 'direct child connector arms should shorten with subtree compaction');
  const lowerGroups = diagnostics.groups.filter(group => group.parents === 'c1' || group.parents === 'c2');
  assert.strictEqual(lowerGroups.length, 2, 'both lower parent/child groups should be diagnosed');
  assert(lowerGroups.every(group => Math.abs(group.offset) <= 1),
    'compacting an ancestor subtree must preserve lower-level parent/child centering');
  assert(diagnostics.compactionMoves.some(move => move.parentUnit === 'P' && move.appliedReduction > 700),
    'diagnostics should record the large safe compaction');
}

{
  const h = makeHarness({ multiPartner: true });
  h.run();
  const groups = h.context.__familySubtreeLayoutDiagnostics.groups.filter(group => group.parents === 'a + b + c');
  assert.strictEqual(groups.length, 2, 'multi-partner children should retain distinct outgoing union groups');
  assert(groups.every(group => group.sourceKey.startsWith('union:')),
    'each multi-partner child group should be tied to its actual router union source');
  assert.notStrictEqual(groups[0].unionAnchor, groups[1].unionAnchor,
    'diagnostics must report distinct union anchors instead of collapsing to unit center');
}

console.log('layout-refinement tests passed');
