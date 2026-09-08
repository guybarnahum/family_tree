const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Metadata = require('../public/person-metadata.js');

const workerPath = path.join(__dirname, '..', 'src', 'worker.js');
let source = fs.readFileSync(workerPath, 'utf8');
source = source.replace(/\bexport\s+default\s+/, 'const __worker = ');
const loadHelpers = new Function(`${source}\nreturn { metadataObject, normalizePerson, validateGraphPayload };`);
const { metadataObject, normalizePerson, validateGraphPayload } = loadHelpers();

assert.deepEqual(metadataObject(null), {});
assert.deepEqual(metadataObject('{"birthDate":"1945"}'), { birthDate: '1945' });
assert.deepEqual(metadataObject({ birthPlace: { text: 'Tel Aviv', countryCode: 'IL' } }), {
  birthPlace: { text: 'Tel Aviv', countryCode: 'IL' }
});
assert.throws(() => metadataObject('[1,2,3]', { strict: true }), /JSON object/);

assert.deepEqual(
  normalizePerson({ id: 'old', name: 'Old', dates: 'c. 1940', description: 'A bio' }),
  { id: 'old', name: 'Old', metadata: {} }
);
assert.deepEqual(
  normalizePerson({
    id: 'person',
    name: 'Person',
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

const twoParents = {
  format: 'family-graph',
  version: 2,
  people: ['p1', 'p2', 'child'].map(id => ({ id, name: id, metadata: {} })),
  relationships: [
    { type: 'parent', person1Id: 'p1', person2Id: 'child' },
    { type: 'parent', person1Id: 'p2', person2Id: 'child' }
  ]
};
assert.equal(validateGraphPayload(twoParents).relationships.length, 2);
assert.throws(() => validateGraphPayload({
  ...twoParents,
  people: [...twoParents.people, { id: 'p3', name: 'p3', metadata: {} }],
  relationships: [
    ...twoParents.relationships,
    { type: 'parent', person1Id: 'p3', person2Id: 'child' }
  ]
}), /at most 2 parents/);

assert.equal(Metadata.inferCountryCode('Tel Aviv, Israel'), 'IL');
assert.equal(Metadata.inferCountryCode('תל אביב, ישראל'), 'IL');
assert.equal(Metadata.inferCountryCode('Tucson, Arizona'), 'US');
assert.equal(Metadata.inferCountryCode('Warsaw, Poland'), 'PL');
assert.equal(Metadata.inferCountryCode('Georgia'), null);
assert.equal(Metadata.flagEmoji('IL'), '🇮🇱');

const original = { primaryFaceId: 'face_123', custom: { preserved: true }, birthDate: '1945' };
const withBirthPlace = Metadata.withField(original, 'birthPlace', 'Tel Aviv, Israel', 'place');
assert.deepEqual(withBirthPlace.birthPlace, { text: 'Tel Aviv, Israel', countryCode: 'IL' });
assert.equal(withBirthPlace.primaryFaceId, 'face_123');
assert.deepEqual(withBirthPlace.custom, { preserved: true });
assert.equal(Object.hasOwn(Metadata.withField(withBirthPlace, 'birthPlace', '   ', 'place'), 'birthPlace'), false);

console.log('person metadata tests passed');
