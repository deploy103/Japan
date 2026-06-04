const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
try {
  fs.chmodSync(path.dirname(config.databasePath), 0o700);
} catch (error) {
  // Some mounted filesystems do not support POSIX permissions.
}

const db = new DatabaseSync(config.databasePath);

function lockDownDatabaseFiles() {
  for (const filePath of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      fs.chmodSync(filePath, 0o600);
    } catch (error) {
      // Some mounted filesystems do not support POSIX permissions.
    }
  }
}

// SQLite 단일 파일로 사용자, 세션, 학습 기록을 관리한다. 모든 사용자 데이터는 user_id로 묶어 삭제/조회 범위를 제한한다.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA trusted_schema = OFF;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    recovery_email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    username TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ip_hash TEXT,
    user_agent TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC);

  CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_text TEXT NOT NULL,
    translation_text TEXT,
    summary_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_history_user_created ON search_history(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS analysis_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    source_key TEXT NOT NULL,
    source_text TEXT NOT NULL,
    result_json TEXT NOT NULL,
    version TEXT NOT NULL,
    provider TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    UNIQUE(user_id, source_key, version)
  );

  CREATE INDEX IF NOT EXISTS idx_analysis_cache_updated ON analysis_cache(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    direction TEXT NOT NULL CHECK (direction IN ('ja-ko', 'ko-ja')),
    source_text TEXT NOT NULL,
    translation_text TEXT NOT NULL,
    provider TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    UNIQUE(user_id, direction, source_text)
  );

  CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS example_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    term_key TEXT NOT NULL,
    term TEXT NOT NULL,
    examples_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    UNIQUE(user_id, term_key)
  );

  CREATE INDEX IF NOT EXISTS idx_example_cache_updated ON example_cache(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ai_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created ON ai_usage_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_events_operation ON ai_usage_events(operation, created_at DESC);

  CREATE TABLE IF NOT EXISTS meaning_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    item_type TEXT NOT NULL CHECK (item_type IN ('word', 'kanji')),
    cache_key TEXT NOT NULL,
    term TEXT NOT NULL,
    reading TEXT,
    pos TEXT,
    meanings_json TEXT NOT NULL,
    source TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    UNIQUE(user_id, cache_key)
  );

  CREATE INDEX IF NOT EXISTS idx_meaning_cache_type_term ON meaning_cache(user_id, item_type, term);

  CREATE TABLE IF NOT EXISTS vocabulary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    reading TEXT,
    meaning TEXT,
    source_text TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, term)
  );

  CREATE INDEX IF NOT EXISTS idx_vocabulary_user_created ON vocabulary(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('word', 'kanji', 'sentence')),
    item_text TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, item_type, item_text)
  );

  CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE SET NULL,
    prompt TEXT NOT NULL,
    expected_answer TEXT NOT NULL,
    submitted_answer TEXT NOT NULL,
    is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_quiz_user_created ON quiz_attempts(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS wrong_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    submitted_answer TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_wrong_notes_user_created ON wrong_notes(user_id, created_at DESC);
`);

function tableDefinition(tableName) {
  return db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName)?.sql || '';
}

function ensureUserScopedLearningCaches() {
  const analysisSql = tableDefinition('analysis_cache');
  const translationSql = tableDefinition('translation_cache');
  const exampleSql = tableDefinition('example_cache');
  const meaningSql = tableDefinition('meaning_cache');

  if (!analysisSql.includes('UNIQUE(user_id, source_key, version)')) {
    db.exec(`
      DROP TABLE IF EXISTS analysis_cache;
      CREATE TABLE analysis_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 0,
        source_key TEXT NOT NULL,
        source_text TEXT NOT NULL,
        result_json TEXT NOT NULL,
        version TEXT NOT NULL,
        provider TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        UNIQUE(user_id, source_key, version)
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_cache_updated ON analysis_cache(user_id, updated_at DESC);
    `);
  }

  if (!translationSql.includes('UNIQUE(user_id, direction, source_text)')) {
    db.exec(`
      DROP TABLE IF EXISTS translation_cache;
      CREATE TABLE translation_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 0,
        direction TEXT NOT NULL CHECK (direction IN ('ja-ko', 'ko-ja')),
        source_text TEXT NOT NULL,
        translation_text TEXT NOT NULL,
        provider TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        UNIQUE(user_id, direction, source_text)
      );
      CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(user_id, updated_at DESC);
    `);
  }

  if (!exampleSql.includes('UNIQUE(user_id, term_key)')) {
    db.exec(`
      DROP TABLE IF EXISTS example_cache;
      CREATE TABLE example_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 0,
        term_key TEXT NOT NULL,
        term TEXT NOT NULL,
        examples_json TEXT NOT NULL,
        provider TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        UNIQUE(user_id, term_key)
      );
      CREATE INDEX IF NOT EXISTS idx_example_cache_updated ON example_cache(user_id, updated_at DESC);
    `);
  }

  if (!meaningSql.includes('UNIQUE(user_id, cache_key)')) {
    db.exec(`
      DROP TABLE IF EXISTS meaning_cache;
      CREATE TABLE meaning_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 0,
        item_type TEXT NOT NULL CHECK (item_type IN ('word', 'kanji')),
        cache_key TEXT NOT NULL,
        term TEXT NOT NULL,
        reading TEXT,
        pos TEXT,
        meanings_json TEXT NOT NULL,
        source TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        UNIQUE(user_id, cache_key)
      );
      CREATE INDEX IF NOT EXISTS idx_meaning_cache_type_term ON meaning_cache(user_id, item_type, term);
    `);
  }
}

ensureUserScopedLearningCaches();
lockDownDatabaseFiles();

function nowIso() {
  return new Date().toISOString();
}

function pruneExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

module.exports = {
  db,
  nowIso,
  pruneExpiredSessions
};
