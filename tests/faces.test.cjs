const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'src', 'faces.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\bexport\s+/g, '');
const loadHelpers = new Function(`${source}\nreturn { normalizeFaceRect, choosePreferredFace };`);
const { normalizeFaceRect, choosePreferredFace } = loadHelpers();

assert.deepEqual(
  normalizeFaceRect({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { strict: true }),
  { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
);

assert.equal(normalizeFaceRect({ x: -0.1, y: 0, width: 0.2, height: 0.2 }), null);
assert.equal(normalizeFaceRect({ x: 0.95, y: 0, width: 0.1, height: 0.2 }), null);
assert.equal(normalizeFaceRect({ x: 0.1, y: 0.1, width: 0.005, height: 0.2 }), null);

assert.throws(
  () => normalizeFaceRect({ x: 0.8, y: 0.8, width: 0.3, height: 0.3 }, { strict: true }),
  /normalized to 0\.\.1/
);

const faces = [
  { id: 'face_a', personId: 'person_1' },
  { id: 'face_b', personId: 'person_1' },
  { id: 'face_c', personId: 'person_2' }
];
assert.equal(choosePreferredFace(faces, null, 'person_1').id, 'face_a');
assert.equal(choosePreferredFace(faces, 'face_b', 'person_1').id, 'face_b');
assert.equal(choosePreferredFace(faces, 'face_c', 'person_1').id, 'face_a');
assert.equal(choosePreferredFace(faces, null, 'missing'), null);

console.log('face rectangle and preferred-face tests passed');
