-- 0005: Blok Skenario Bercabang v1.0 (docs/scenario-block/README.md §5, ADR-0008).
-- scenario_blocks: satu baris per versi blok. Versi published tidak diubah; perubahan = versi baru.
CREATE TABLE scenario_blocks (
  id TEXT PRIMARY KEY,
  block_key TEXT NOT NULL CHECK (length(block_key) BETWEEN 3 AND 64 AND block_key NOT GLOB '*[^a-z0-9-]*'),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'in_review', 'published', 'archived')),
  mode TEXT NOT NULL CHECK (mode IN ('formative', 'graded')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  pass_percent INTEGER NOT NULL CHECK (pass_percent BETWEEN 0 AND 100),
  max_score INTEGER NOT NULL CHECK (max_score >= 0),
  definition_json TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  next_review_due TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  published_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (block_key, version)
);
-- Paling banyak satu versi yang masih bisa disunting (draft/in_review) per blok.
CREATE UNIQUE INDEX ux_scenario_blocks_one_editable ON scenario_blocks(block_key) WHERE status IN ('draft', 'in_review');

-- Dipin saat versi kelas diterbitkan; enrollment sudah dipin ke course_version (ADR-0002).
CREATE TABLE lesson_scenarios (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  scenario_block_id TEXT NOT NULL REFERENCES scenario_blocks(id),
  block_key TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  PRIMARY KEY (lesson_id, scenario_block_id),
  UNIQUE (lesson_id, block_key)
);
CREATE INDEX ix_lesson_scenarios_block ON lesson_scenarios(scenario_block_id);

CREATE TABLE scenario_attempts (
  id TEXT PRIMARY KEY,
  scenario_block_id TEXT NOT NULL REFERENCES scenario_blocks(id),
  block_version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  current_node_id TEXT,
  option_order_json TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL,
  percent INTEGER,
  band_key TEXT,
  passed INTEGER CHECK (passed IS NULL OR passed IN (0, 1)),
  role_snapshot TEXT,
  village_snapshot TEXT,
  district_snapshot TEXT,
  regency_snapshot TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (user_id, scenario_block_id, attempt_no)
);
CREATE UNIQUE INDEX ux_scenario_attempt_active ON scenario_attempts(user_id, scenario_block_id) WHERE status = 'in_progress';
CREATE INDEX ix_scenario_attempts_block ON scenario_attempts(scenario_block_id, status);

CREATE TABLE scenario_choices (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES scenario_attempts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  node_id TEXT NOT NULL,
  option_id TEXT,
  verdict TEXT CHECK (verdict IS NULL OR verdict IN ('best', 'acceptable', 'risky', 'wrong')),
  score INTEGER NOT NULL DEFAULT 0,
  chosen_at INTEGER NOT NULL,
  UNIQUE (attempt_id, node_id),
  UNIQUE (attempt_id, seq)
);
CREATE INDEX ix_scenario_choices_stats ON scenario_choices(node_id, option_id);
