-- D1 Database Schema for Family Tree
DROP TABLE IF EXISTS nodes;
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT,
    dates TEXT,
    description TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert a default root node (Hebrew)
INSERT INTO nodes (id, parent_id, name, dates, description) 
VALUES ('root', NULL, 'משפחתנו', '1945 - היום', 'שורשי עץ המשפחה שלנו, מחברים דורות של אהבה.');
