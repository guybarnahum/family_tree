const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workerPath = path.join(__dirname, '..', 'src', 'worker.js');
let source = fs.readFileSync(workerPath, 'utf8');
source = source.replace(/\bexport\s+default\s+/, 'const __worker = ');

const loadHelpers = new Function(`${source}\nreturn { metadataObject, metadataFromLegacy, normalizePerson };`);
const { metadataObject, metadataFromLegacy, normalizePerson } = loadHelpers();

assert.deepEqual(metadataObject(null), {});
assert.deepEqual(metadataObject('{"birthDate":"1945"}'), { birthDate: '1945' });
assert.deepEqual(
  metadataFromLegacy({}, '1945 - היום', 'legacy bio'),
  { lifeDates: '1945 - היום', bio: 'legacy bio' }
);
assert.deepEqual(
  metadataFromLegacy({}, 'תאריכים', 'תיאור'),
  {}
);

// Old graph/person records without metadata are upgraded from legacy fields.
assert.deepEqual(
  normalizePerson({ id: 'old', name: 'Old', dates: 'c. 1940', description: 'A bio' }),
  {
    id: 'old',
    name: 'Old',
    dates: 'c. 1940',
    description: 'A bio',
    metadata: { lifeDates: 'c. 1940', bio: 'A bio' }
  }
);

// Once metadata is explicitly present, it is authoritative. Empty metadata must not
// resurrect legacy values on the next import or request.
assert.deepEqual(
  normalizePerson({
    id: 'new',
    name: 'New',
    dates: 'legacy dates',
    description: 'legacy bio',
    metadata: {}
  }),
  {
    id: 'new',
    name: 'New',
    dates: 'legacy dates',
    description: 'legacy bio',
    metadata: {}
  }
);

// Metadata values win for the legacy compatibility projection as well.
assert.deepEqual(
  normalizePerson({
    id: 'mixed',
    name: 'Mixed',
    dates: 'old dates',
    description: 'old bio',
    metadata: { lifeDates: 'Spring 1945', bio: 'New bio', custom: 'kept' }
  }),
  {
    id: 'mixed',
    name: 'Mixed',
    dates: 'Spring 1945',
    description: 'New bio',
    metadata: { lifeDates: 'Spring 1945', bio: 'New bio', custom: 'kept' }
  }
);

console.log('person metadata migration tests passed');
