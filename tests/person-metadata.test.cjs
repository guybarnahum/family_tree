const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workerPath = path.join(__dirname, '..', 'src', 'worker.js');
let source = fs.readFileSync(workerPath, 'utf8');
source = source.replace(/\bexport\s+default\s+/, 'const __worker = ');

const loadHelpers = new Function(`${source}\nreturn { metadataObject, normalizePerson };`);
const { metadataObject, normalizePerson } = loadHelpers();

assert.deepEqual(metadataObject(null), {});
assert.deepEqual(metadataObject('{"birthDate":"1945"}'), { birthDate: '1945' });
assert.deepEqual(metadataObject({ birthPlace: { text: 'Tel Aviv', countryCode: 'IL' } }), {
  birthPlace: { text: 'Tel Aviv', countryCode: 'IL' }
});

// Old dates/description are deliberately ignored. Slice B starts existing people with
// empty metadata rather than attempting to infer or preserve biography fields.
assert.deepEqual(
  normalizePerson({ id: 'old', name: 'Old', dates: 'c. 1940', description: 'A bio' }),
  { id: 'old', name: 'Old', metadata: {} }
);

assert.deepEqual(
  normalizePerson({
    id: 'person',
    name: 'Person',
    dates: 'ignored',
    description: 'ignored',
    metadata: {
      birthDate: 'Spring 1945',
      birthPlace: { text: 'Tel Aviv', countryCode: 'IL' },
      bio: 'New bio'
    }
  }),
  {
    id: 'person',
    name: 'Person',
    metadata: {
      birthDate: 'Spring 1945',
      birthPlace: { text: 'Tel Aviv', countryCode: 'IL' },
      bio: 'New bio'
    }
  }
);

assert.throws(
  () => metadataObject('[1,2,3]', { strict: true }),
  /JSON object/
);

console.log('person metadata tests passed');
