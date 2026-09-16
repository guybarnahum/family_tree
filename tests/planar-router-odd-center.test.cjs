'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sourcePath = process.env.PLANAR_ROUTER_SOURCE || 'public/planar-router.js';
const source = fs.readFileSync(sourcePath, 'utf8');

function runCase(childXs) {
  let prepareStage = null;
  let connectorStage = null;
  const Controller = {
    registerPrepareStage(value) { prepareStage = value; },
    registerConnectorStage(value) { connectorStage = value; }
  };
  const parentsByChild = new Map();
  const spousesByPerson = new Map([
    ['p1', new Set(['p2'])],
    ['p2', new Set(['p1'])]
  ]);
  const Store = {
    snapshot() {
      return { graph: { people: [] }, indexes: { parentsByChild, spousesByPerson } };
    }
  };
  const globalNodeMap = new Map();
  const unitByNodeId = new Map();
  const globalNodes = [];
  const globalUnits = [];

  function node(id, x, gen, targetY) {
    const value = { id, x, gen, targetY, cardWidth: 100, cardHeight: 20 };
    globalNodeMap.set(id, value);
    globalNodes.push(value);
    return value;
  }

  const p1 = node('p1', 0, 0, 0);
  const p2 = node('p2', 200, 0, 0);
  const parentUnit = { id: 'P', gen: 0, centerX: 100, members: [p1, p2], generationCenterY: 10 };
  globalUnits.push(parentUnit);
  unitByNodeId.set('p1', parentUnit);
  unitByNodeId.set('p2', parentUnit);

  childXs.forEach((x, index) => {
    const id = `c${index + 1}`;
    const child = node(id, x, 1, 100);
    const childUnit = { id: `C${index + 1}`, gen: 1, centerX: x, members: [child], generationCenterY: 110 };
    globalUnits.push(childUnit);
    unitByNodeId.set(id, childUnit);
    parentsByChild.set(id, new Set(['p1', 'p2']));
  });

  const svgLayer = { innerHTML: '' };
  const context = {
    console,
    Date,
    Math,
    Map,
    Set,
    window: null,
    FamilyGraphStore: Store,
    FamilyRenderController: Controller,
    globalNodeMap,
    unitByNodeId,
    globalNodes,
    globalUnits,
    svgLayer,
    CONNECTOR_KNEE_RADIUS: 8,
    roundedOrthogonalPath(points) {
      return 'ORTHO ' + points.map(point => point.join(',')).join(' ');
    },
    svgPath(path) { return `${path}\n`; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'planar-router.js' });
  assert(prepareStage && connectorStage, 'planar router stages must register');
  prepareStage.run();
  connectorStage.run();
  return { svg: svgLayer.innerHTML, diagnostics: context.__familyRouteDiagnostics };
}

for (const childXs of [
  [112],
  [-100, 112, 300],
  [-200, -50, 112, 250, 400]
]) {
  const { svg, diagnostics } = runCase(childXs);
  assert(svg.includes('M 112 10 L 112 100'),
    `${childXs.length} children: middle child must have a direct vertical union connector`);
  assert.strictEqual(diagnostics.snappedOddCenters, 1,
    `${childXs.length} children: odd-center routing should be diagnosed`);
}

console.log('planar-router odd-center tests passed');
