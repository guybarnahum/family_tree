-- D1 Database Schema for Family Tree
--
-- This schema matches src/worker.js. It is intentionally non-destructive so
-- re-running setup does not delete an existing family tree.

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    spouse_id TEXT,
    name TEXT,
    dates TEXT,
    description TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed a default root only for a new/empty database. spouse_id defaults to NULL.
-- Omitting spouse_id here also keeps this seed compatible with a pre-migration
-- database while the one-time ALTER TABLE migration is being applied.
INSERT OR IGNORE INTO nodes (id, parent_id, name, dates, description)
VALUES (
    'root',
    NULL,
    'משפחתנו',
    '1945 - היום',
    'שורשי עץ המשפחה שלנו, מחברים דורות של אהבה.'
);
