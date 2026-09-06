const assert = require('node:assert/strict');
const Metadata = require('../public/person-metadata.js');

assert.equal(Metadata.inferCountryCode('Tel Aviv, Israel'), 'IL');
assert.equal(Metadata.inferCountryCode('תל אביב, ישראל'), 'IL');
assert.equal(Metadata.inferCountryCode('Tucson, Arizona'), 'US');
assert.equal(Metadata.inferCountryCode('San Francisco, CA'), 'US');
assert.equal(Metadata.inferCountryCode('Warsaw, Poland'), 'PL');
assert.equal(Metadata.inferCountryCode('Spring 1945'), null);

// Ambiguous place names are intentionally not guessed.
assert.equal(Metadata.inferCountryCode('Georgia'), null);

assert.equal(Metadata.flagEmoji('IL'), '🇮🇱');
assert.equal(Metadata.flagEmoji('US'), '🇺🇸');
assert.equal(Metadata.placeText({ text: 'Tucson, Arizona', countryCode: 'US' }), 'Tucson, Arizona');
assert.equal(Metadata.placeCountryCode({ text: 'Tucson, Arizona', countryCode: 'US' }), 'US');

const original = {
  primaryFaceId: 'face_123',
  custom: { preserved: true },
  birthDate: '1945'
};

const withBirthPlace = Metadata.withField(original, 'birthPlace', 'Tel Aviv, Israel', 'place');
assert.deepEqual(withBirthPlace.birthPlace, { text: 'Tel Aviv, Israel', countryCode: 'IL' });
assert.equal(withBirthPlace.primaryFaceId, 'face_123');
assert.deepEqual(withBirthPlace.custom, { preserved: true });
assert.equal(withBirthPlace.birthDate, '1945');

const changedDate = Metadata.withField(withBirthPlace, 'birthDate', 'Spring 1945', 'text');
assert.equal(changedDate.birthDate, 'Spring 1945');
assert.deepEqual(changedDate.birthPlace, { text: 'Tel Aviv, Israel', countryCode: 'IL' });

const cleared = Metadata.withField(changedDate, 'birthPlace', '   ', 'place');
assert.equal(Object.hasOwn(cleared, 'birthPlace'), false);
assert.equal(cleared.primaryFaceId, 'face_123');

console.log('Slice C person metadata UI tests passed');
