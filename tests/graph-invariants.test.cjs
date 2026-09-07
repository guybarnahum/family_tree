const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'src', 'graph-invariants.js');
let source = fs.readFileSync(sourcePath, 'utf8');
source = source.replace(/\bexport\s+function\s+normalizeParentUnions\b/, 'function normalizeParentUnions');
const loadHelpers = new Function(`${source}\nreturn { normalizeParentUnions };`);
const { normalizeParentUnions } = loadHelpers();

const base = {
  format: 'family-graph',
  version: 2,
  people: ['a', 'b', 'c'].map(id => ({ id, name: id, metadata: {} })),
  relationships: [
    { type: 'parent', person1Id: 'a', person2Id: 'c' },
    { type: 'parent', person1Id: 'b', person2Id: 'c' }
  ]
};

const normalized = normalizeParentUnions(base);
assert.equal(normalized.relationships.filter(r => r.type === 'spouse').length, 1);
assert.ok(normalized.relationships.some(r =>
  r.type === 'spouse' &&
  new Set([r.person1Id, r.person2Id]).has('a') &&
  new Set([r.person1Id, r.person2Id]).has('b')
));
assert.equal(base.relationships.filter(r => r.type === 'spouse').length, 0, 'input must not be mutated');

const alreadyUnion = normalizeParentUnions({
  ...base,
  relationships: [
    ...base.relationships,
    { type: 'spouse', person1Id: 'b', person2Id: 'a' }
  ]
});
assert.equal(alreadyUnion.relationships.filter(r => r.type === 'spouse').length, 1);

const oneParent = normalizeParentUnions({
  ...base,
  relationships: [{ type: 'parent', person1Id: 'a', person2Id: 'c' }]
});
assert.equal(oneParent.relationships.filter(r => r.type === 'spouse').length, 0);

console.log('graph invariant tests passed');
