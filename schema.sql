-- D1 Database Schema for Family Graph
--
-- `nodes` stores person identity plus flexible biographical metadata. Family structure is
-- canonicalized in `relationships`, so a person can have multiple parents/spouses and any
-- person can be used as the root of a generated view.
--
-- Existing deployed databases may still physically contain old `dates` / `description`
-- columns. Slice B intentionally ignores them; new databases do not create them.

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    spouse_id TEXT,
    name TEXT,
    metadata_json TEXT DEFAULT '{}',
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('parent', 'spouse')),
    person1_id TEXT NOT NULL,
    person2_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_unique
ON relationships(type, person1_id, person2_id);

CREATE INDEX IF NOT EXISTS idx_relationship_person1
ON relationships(person1_id);

CREATE INDEX IF NOT EXISTS idx_relationship_person2
ON relationships(person2_id);

-- Seed a default person only for a new/empty database.
INSERT OR IGNORE INTO nodes (id, parent_id, name, metadata_json)
VALUES (
    'root',
    NULL,
    'משפחתנו',
    '{}'
);

-- Non-destructive topology migration from the original one-parent/one-spouse columns.
-- Person metadata is deliberately not migrated from any old biography fields.
INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
SELECT
    'parent:' || parent_id || ':' || id,
    'parent',
    parent_id,
    id
FROM nodes
WHERE parent_id IS NOT NULL
  AND parent_id <> ''
  AND parent_id IN (SELECT id FROM nodes);

INSERT OR IGNORE INTO relationships (id, type, person1_id, person2_id)
SELECT
    'spouse:' ||
        CASE WHEN id < spouse_id THEN id ELSE spouse_id END || ':' ||
        CASE WHEN id < spouse_id THEN spouse_id ELSE id END,
    'spouse',
    CASE WHEN id < spouse_id THEN id ELSE spouse_id END,
    CASE WHEN id < spouse_id THEN spouse_id ELSE id END
FROM nodes
WHERE spouse_id IS NOT NULL
  AND spouse_id <> ''
  AND spouse_id IN (SELECT id FROM nodes)
  AND id <> spouse_id;
