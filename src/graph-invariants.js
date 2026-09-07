// Canonical family-graph invariants applied at the API boundary before persistence.
// A child may have at most two explicit parents, and when two are present they form one
// explicit union. This keeps parenthood structurally unambiguous in multi-partner families.
export function normalizeParentUnions(payload) {
  if (
    payload?.format !== 'family-graph' ||
    payload?.version !== 2 ||
    !Array.isArray(payload.people) ||
    !Array.isArray(payload.relationships)
  ) {
    return payload;
  }

  const relationships = payload.relationships.map(relation => ({ ...relation }));
  const parentsByChild = new Map();

  for (const relation of relationships) {
    if (relation?.type !== 'parent') continue;
    if (!parentsByChild.has(relation.person2Id)) parentsByChild.set(relation.person2Id, new Set());
    parentsByChild.get(relation.person2Id).add(relation.person1Id);
  }

  function hasSpouse(a, b) {
    return relationships.some(relation =>
      relation?.type === 'spouse' &&
      ((relation.person1Id === a && relation.person2Id === b) ||
       (relation.person1Id === b && relation.person2Id === a))
    );
  }

  for (const parents of parentsByChild.values()) {
    if (parents.size !== 2) continue;
    const [a, b] = [...parents];
    if (!a || !b || a === b || hasSpouse(a, b)) continue;
    relationships.push({ type: 'spouse', person1Id: a, person2Id: b });
  }

  return { ...payload, relationships };
}
