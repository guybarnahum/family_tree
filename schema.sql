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

-- Seed a default root only for a new/empty database.
INSERT OR IGNORE INTO nodes (id, parent_id, spouse_id, name, dates, description)
VALUES (
    'root',
    NULL,
    NULL,
    'משפחתנו',
    '1945 - היום',
    'שורשי עץ המשפחה שלנו, מחברים דורות של אהבה.'
);
