CREATE TABLE IF NOT EXISTS course_covers ( course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE, file_key TEXT NOT NULL, content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')), alt_text TEXT NOT NULL DEFAULT '' CHECK (length(alt_text) <= 200), updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS course_ratings ( user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, course_id) );
CREATE INDEX IF NOT EXISTS ix_course_ratings_course ON course_ratings(course_id);
CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_course_cover_rating.sql');
