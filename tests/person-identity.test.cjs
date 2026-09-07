const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'person-identity.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'person-identity.js' });

const Identity = context.window.FamilyPersonIdentity;
assert(Identity, 'FamilyPersonIdentity should be installed');

assert.strictEqual(Identity.normalizePersonName('  שלום   נחום  '), 'שלום נחום');
assert.strictEqual(Identity.normalizePersonName('שלום\t\nנחום'), 'שלום נחום');
assert.strictEqual(Identity.normalizePersonName('Cafe\u0301'), 'Café');

const graph = {
  people: [
    { id: 'shalom_a', name: ' שלום  נחום ' },
    { id: 'shalom_b', name: 'שלום נחום' },
    { id: 'yehiel', name: 'יהיאל' },
    { id: 'avraham', name: 'אברהם' },
    { id: 'unique', name: 'מרים נחום', metadata: { birthDate: '1942' } }
  ],
  relationships: [
    { id: 'p1', type: 'parent', person1Id: 'yehiel', person2Id: 'shalom_a' },
    { id: 'p2', type: 'parent', person1Id: 'avraham', person2Id: 'shalom_b' }
  ]
};

assert.strictEqual(Identity.setGraph(graph), true);
assert.strictEqual(Identity.setGraph(graph), false, 'same graph should not rebuild the index');
assert.strictEqual(Identity.needsDisambiguation('shalom_a'), true);
assert.strictEqual(Identity.needsDisambiguation('shalom_b'), true);
assert.strictEqual(Identity.needsDisambiguation('unique'), false);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(Identity.describe('shalom_a'))),
  {
    id: 'shalom_a',
    name: 'שלום נחום',
    qualifier: 'הורה: יהיאל',
    ambiguous: true,
    display: 'שלום נחום — הורה: יהיאל'
  }
);
assert.strictEqual(Identity.describe('shalom_b').qualifier, 'הורה: אברהם');
assert.strictEqual(Identity.describe('unique').qualifier, '');
assert(Identity.searchText('shalom_a').includes('יהיאל'));

console.log('person identity tests passed');
