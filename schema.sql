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

-- Place autocomplete caches GeoNames results aggressively so ordinary family editing stays
-- well below the free service limits. Usage buckets count only cache misses sent upstream.
CREATE TABLE IF NOT EXISTS place_search_cache (
    cache_key TEXT PRIMARY KEY,
    response_json TEXT NOT NULL,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS place_api_usage (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Slice D media metadata lives in D1 while original image bytes live in R2. `media_people`
-- is an association table, not ownership: one photo can be associated with multiple people.
-- person_id deliberately has no FK because topology edits currently replace/reinsert `nodes`;
-- associations must survive that graph rewrite unchanged.
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    original_filename TEXT,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    caption TEXT,
    taken_date_text TEXT,
    taken_place_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_people (
    media_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (media_id, person_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_people_person
ON media_people(person_id);

CREATE INDEX IF NOT EXISTS idx_media_people_media
ON media_people(media_id);

-- Slice E face rectangles are normalized to the original image (0..1), so the same record
-- works at any rendered size. person_id is nullable: a face can be marked before it is named.
-- As with media_people, person_id intentionally has no FK to nodes so graph rewrites do not
-- destroy face identity assignments.
CREATE TABLE IF NOT EXISTS faces (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    person_id TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    CHECK (x >= 0 AND x <= 1),
    CHECK (y >= 0 AND y <= 1),
    CHECK (width > 0 AND width <= 1),
    CHECK (height > 0 AND height <= 1),
    CHECK (x + width <= 1.000001),
    CHECK (y + height <= 1.000001)
);

CREATE INDEX IF NOT EXISTS idx_faces_media
ON faces(media_id);

CREATE INDEX IF NOT EXISTS idx_faces_person
ON faces(person_id);

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
