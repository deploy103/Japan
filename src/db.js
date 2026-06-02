const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new DatabaseSync(config.databasePath);

// SQLite 단일 파일로 사용자, 세션, 학습 기록을 관리한다. 모든 사용자 데이터는 user_id로 묶어 삭제/조회 범위를 제한한다.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

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
    source_key TEXT NOT NULL UNIQUE,
    source_text TEXT NOT NULL,
    result_json TEXT NOT NULL,
    version TEXT NOT NULL,
    provider TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_analysis_cache_updated ON analysis_cache(updated_at DESC);

  CREATE TABLE IF NOT EXISTS translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL CHECK (direction IN ('ja-ko', 'ko-ja')),
    source_text TEXT NOT NULL,
    translation_text TEXT NOT NULL,
    provider TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    UNIQUE(direction, source_text)
  );

  CREATE INDEX IF NOT EXISTS idx_translation_cache_updated ON translation_cache(updated_at DESC);

  CREATE TABLE IF NOT EXISTS example_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_key TEXT NOT NULL UNIQUE,
    term TEXT NOT NULL,
    examples_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_example_cache_updated ON example_cache(updated_at DESC);

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
    item_type TEXT NOT NULL CHECK (item_type IN ('word', 'kanji')),
    cache_key TEXT NOT NULL UNIQUE,
    term TEXT NOT NULL,
    reading TEXT,
    pos TEXT,
    meanings_json TEXT NOT NULL,
    source TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_meaning_cache_type_term ON meaning_cache(item_type, term);

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

function normalizeCacheText(value) {
  return String(value || '').trim();
}

function normalizeCachePos(value) {
  return normalizeCacheText(value).toLowerCase();
}

function cleanCachedMeanings(value, limit = 4) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,;/、\n]/);
  const meanings = raw
    .map((item) => normalizeCacheText(item).replace(/[.。]+$/g, ''))
    .filter((item) => item && item !== '뜻 보강 필요');
  return Array.from(new Set(meanings)).slice(0, limit);
}

function insertMeaningCache({ itemType, cacheKey, term, reading = '', pos = '', meanings, source, timestamp }) {
  const cleaned = cleanCachedMeanings(meanings);
  const normalizedTerm = normalizeCacheText(term);
  const normalizedKey = normalizeCacheText(cacheKey);
  if (!normalizedKey || !normalizedTerm || !cleaned.length) {
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO meaning_cache (item_type, cache_key, term, reading, pos, meanings_json, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemType,
    normalizedKey,
    normalizedTerm,
    normalizeCacheText(reading),
    normalizeCachePos(pos),
    JSON.stringify(cleaned),
    source,
    timestamp,
    timestamp
  );
}

function insertWordMeaningCache({ surface, base, reading, pos, meanings, source, timestamp }) {
  const normalizedReading = normalizeCacheText(reading);
  const normalizedPos = normalizeCachePos(pos);
  const terms = Array.from(new Set([
    normalizeCacheText(surface),
    normalizeCacheText(base)
  ].filter(Boolean)));

  for (const term of terms) {
    insertMeaningCache({
      itemType: 'word',
      cacheKey: `word:${term}:${normalizedReading}:${normalizedPos}`,
      term,
      reading: normalizedReading,
      pos: normalizedPos,
      meanings,
      source,
      timestamp
    });
    insertMeaningCache({
      itemType: 'word',
      cacheKey: `word:${term}::${normalizedPos}`,
      term,
      pos: normalizedPos,
      meanings,
      source,
      timestamp
    });
    insertMeaningCache({
      itemType: 'word',
      cacheKey: `word:${term}::`,
      term,
      meanings,
      source,
      timestamp
    });
  }
}

db.exec(`
  INSERT OR IGNORE INTO translation_cache (direction, source_text, translation_text, provider, created_at, updated_at)
  SELECT
    CASE
      WHEN summary_json LIKE '%"direction":"ko-ja"%' THEN 'ko-ja'
      ELSE 'ja-ko'
    END,
    source_text,
    translation_text,
    'history',
    created_at,
    created_at
  FROM search_history
  WHERE TRIM(source_text) <> ''
    AND TRIM(COALESCE(translation_text, '')) <> ''
  ORDER BY created_at DESC;
`);

const vocabularyCacheRows = db.prepare(`
  SELECT term, reading, meaning, created_at, updated_at
  FROM vocabulary
  WHERE TRIM(term) <> ''
    AND TRIM(COALESCE(meaning, '')) <> ''
`).all();

for (const row of vocabularyCacheRows) {
  const term = String(row.term || '').trim();
  const meaning = String(row.meaning || '').trim();
  if (!term || !meaning) {
    continue;
  }
  const timestamp = row.updated_at || row.created_at || new Date().toISOString();
  insertWordMeaningCache({
    surface: term,
    base: term,
    reading: row.reading,
    pos: '',
    meanings: [meaning],
    source: 'vocabulary',
    timestamp
  });
}

const historySummaryRows = db.prepare(`
  SELECT summary_json, created_at
  FROM search_history
  WHERE TRIM(COALESCE(summary_json, '')) <> ''
`).all();

for (const row of historySummaryRows) {
  let summary;
  try {
    summary = JSON.parse(row.summary_json);
  } catch (error) {
    continue;
  }

  const timestamp = row.created_at || new Date().toISOString();
  for (const word of summary.words || []) {
    insertWordMeaningCache({
      surface: word.surface,
      base: word.base,
      reading: word.reading,
      pos: word.posKo || word.pos,
      meanings: word.meaning,
      source: 'history',
      timestamp
    });
  }

  for (const detail of summary.kanji || []) {
    insertMeaningCache({
      itemType: 'kanji',
      cacheKey: `kanji:${normalizeCacheText(detail.char)}`,
      term: detail.char,
      meanings: detail.meaningsKo || detail.meanings,
      source: 'history',
      timestamp
    });

    for (const example of detail.examples || []) {
      insertWordMeaningCache({
        surface: example.written,
        base: example.written,
        reading: example.pronounced,
        pos: '명사',
        meanings: example.meanings,
        source: 'history',
        timestamp
      });
    }
  }
}

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
