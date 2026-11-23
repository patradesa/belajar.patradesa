ALTER TABLE questions ADD COLUMN explanation TEXT CHECK (explanation IS NULL OR length(explanation) <= 2000);
ALTER TABLE assessments ADD COLUMN review_policy TEXT NOT NULL DEFAULT 'none' CHECK (review_policy IN ('none', 'after_done'));
CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0006_explanation_review.sql');
