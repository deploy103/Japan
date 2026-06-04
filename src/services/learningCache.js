const { db, nowIso } = require('../db');

const TRUSTED_TRANSLATION_PROVIDERS = new Set(['openai', 'libretranslate', 'local-exact']);
const TRUSTED_EXAMPLE_PROVIDERS = new Set(['openai', 'local-template']);
const MAX_MEANING_ITEMS = 4;
const MAX_EXAMPLE_ITEMS = 3;
const ANALYSIS_CACHE_VERSION = 'analysis-v2';
const CACHE_LIMITS = {
  analysis_cache: 5000,
  translation_cache: 20000,
  example_cache: 10000,
  meaning_cache: 60000
};

function normalizeText(value) {
  return String(value || '').trim();
}

function cacheUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function cacheKeyText(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function normalizePos(pos) {
  return normalizeText(pos).toLowerCase();
}

function safely(fallback, callback) {
  try {
    return callback();
  } catch (error) {
    return fallback;
  }
}

function cleanMeanings(value, limit = MAX_MEANING_ITEMS) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,;/、\n]/);
  const meanings = raw
    .map((item) => normalizeText(item).replace(/[.。]+$/g, ''))
    .filter((item) => item && item !== '뜻 보강 필요');
  return Array.from(new Set(meanings)).slice(0, limit);
}

function cleanExamples(examples, limit = MAX_EXAMPLE_ITEMS) {
  if (!Array.isArray(examples)) {
    return [];
  }
  const cleaned = [];
  for (const example of examples) {
    const japanese = normalizeText(example?.japanese || example);
    const korean = normalizeText(example?.korean);
    if (!japanese) {
      continue;
    }
    cleaned.push({ japanese: japanese.slice(0, 240), korean: korean.slice(0, 240) });
    if (cleaned.length >= limit) {
      break;
    }
  }
  return cleaned;
}

function translationCacheHit(row) {
  if (!row) {
    return null;
  }
  db.prepare(`
    UPDATE translation_cache
    SET hit_count = hit_count + 1, last_used_at = ?
    WHERE id = ?
  `).run(nowIso(), row.id);
  return {
    text: row.translation_text,
    provider: 'cache',
    note: '저장된 번역을 재사용했습니다.'
  };
}

function getCachedTranslation(direction, sourceText, userId = 0) {
  const ownerId = cacheUserId(userId);
  const source = cacheKeyText(sourceText);
  if (!source) {
    return null;
  }
  return safely(null, () => {
    const row = db.prepare(`
    SELECT id, translation_text, provider
    FROM translation_cache
    WHERE user_id = ? AND direction = ? AND source_text = ?
  `).get(ownerId, direction, source);
    return translationCacheHit(row);
  });
}

function saveTranslationCache(direction, sourceText, translation, userId = 0) {
  const ownerId = cacheUserId(userId);
  const source = cacheKeyText(sourceText);
  const text = normalizeText(translation?.text);
  const provider = normalizeText(translation?.provider);
  if (!source || !text || !TRUSTED_TRANSLATION_PROVIDERS.has(provider)) {
    return;
  }

  safely(undefined, () => {
    const timestamp = nowIso();
    db.prepare(`
    INSERT INTO translation_cache (user_id, direction, source_text, translation_text, provider, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, direction, source_text) DO UPDATE SET
      translation_text = excluded.translation_text,
      provider = excluded.provider,
      updated_at = excluded.updated_at
  `).run(ownerId, direction, source, text, provider, timestamp, timestamp);
  });
}

function exampleCacheHit(row, requestedTerm) {
  if (!row) {
    return null;
  }
  return safely(null, () => {
    db.prepare(`
      UPDATE example_cache
      SET hit_count = hit_count + 1, last_used_at = ?
      WHERE id = ?
    `).run(nowIso(), row.id);
    const examples = cleanExamples(JSON.parse(row.examples_json));
    if (!examples.length) {
      return null;
    }
    return {
      term: normalizeText(requestedTerm) || row.term,
      examples,
      provider: 'cache',
      note: '저장된 예문을 재사용했습니다.'
    };
  });
}

function getCachedExamples(term, userId = 0) {
  const ownerId = cacheUserId(userId);
  const termKey = cacheKeyText(term);
  if (!termKey) {
    return null;
  }
  return safely(null, () => {
    const row = db.prepare(`
      SELECT id, term, examples_json
      FROM example_cache
      WHERE user_id = ? AND term_key = ?
    `).get(ownerId, termKey);
    return exampleCacheHit(row, term);
  });
}

function saveExampleCache(term, result, userId = 0) {
  const ownerId = cacheUserId(userId);
  const normalizedTerm = normalizeText(term).slice(0, 80);
  const termKey = cacheKeyText(normalizedTerm);
  const examples = cleanExamples(result?.examples);
  const provider = normalizeText(result?.provider);
  if (!normalizedTerm || !termKey || !examples.length || !TRUSTED_EXAMPLE_PROVIDERS.has(provider)) {
    return;
  }

  safely(undefined, () => {
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO example_cache (user_id, term_key, term, examples_json, provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, term_key) DO UPDATE SET
        term = excluded.term,
        examples_json = excluded.examples_json,
        provider = excluded.provider,
        updated_at = excluded.updated_at
    `).run(ownerId, termKey, normalizedTerm, JSON.stringify(examples), provider, timestamp, timestamp);
  });
}

function meaningCacheHit(row) {
  if (!row) {
    return [];
  }
  db.prepare(`
    UPDATE meaning_cache
    SET hit_count = hit_count + 1, last_used_at = ?
    WHERE id = ?
  `).run(nowIso(), row.id);
  try {
    return cleanMeanings(JSON.parse(row.meanings_json));
  } catch (error) {
    return [];
  }
}

function wordCacheKeys(token) {
  const surface = normalizeText(token?.surface);
  const base = normalizeText(token?.base);
  const reading = normalizeText(token?.reading);
  const pos = normalizePos(token?.posKo || token?.pos);
  const terms = Array.from(new Set([surface, base].filter(Boolean)));
  const keys = [];

  for (const term of terms) {
    keys.push(`word:${term}:${reading}:${pos}`);
    keys.push(`word:${term}::${pos}`);
    keys.push(`word:${term}:${reading}:`);
    keys.push(`word:${term}::`);
  }

  return Array.from(new Set(keys));
}

function kanjiCacheKey(char) {
  return `kanji:${normalizeText(char)}`;
}

function getCachedMeaning(itemType, keys, userId = 0) {
  const ownerId = cacheUserId(userId);
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  for (const key of uniqueKeys) {
    const meanings = safely([], () => {
      const row = db.prepare(`
      SELECT id, meanings_json
      FROM meaning_cache
      WHERE user_id = ? AND item_type = ? AND cache_key = ?
    `).get(ownerId, itemType, key);
      return meaningCacheHit(row);
    });
    if (meanings.length) {
      return meanings;
    }
  }
  return [];
}

function saveMeaning(itemType, cacheKey, term, meanings, { reading = '', pos = '', source = 'openai', userId = 0 } = {}) {
  const ownerId = cacheUserId(userId);
  const key = normalizeText(cacheKey);
  const normalizedTerm = normalizeText(term);
  const cleaned = cleanMeanings(meanings);
  if (!key || !normalizedTerm || !cleaned.length) {
    return;
  }

  safely(undefined, () => {
    const timestamp = nowIso();
    db.prepare(`
    INSERT INTO meaning_cache (user_id, item_type, cache_key, term, reading, pos, meanings_json, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, cache_key) DO UPDATE SET
      term = excluded.term,
      reading = excluded.reading,
      pos = excluded.pos,
      meanings_json = excluded.meanings_json,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(
    ownerId,
    itemType,
    key,
    normalizedTerm,
    normalizeText(reading),
    normalizePos(pos),
    JSON.stringify(cleaned),
    normalizeText(source) || 'openai',
    timestamp,
    timestamp
  );
  });
}

function getCachedWordMeanings(token, userId = 0) {
  return getCachedMeaning('word', wordCacheKeys(token), userId);
}

function saveWordMeaning(token, meanings, source = 'openai', userId = 0) {
  const cleaned = cleanMeanings(meanings, 3);
  if (!cleaned.length) {
    return;
  }

  const surface = normalizeText(token?.surface);
  const base = normalizeText(token?.base);
  const reading = normalizeText(token?.reading);
  const pos = normalizeText(token?.posKo || token?.pos);
  const terms = Array.from(new Set([surface, base].filter(Boolean)));

  for (const term of terms) {
    saveMeaning('word', `word:${term}:${reading}:${normalizePos(pos)}`, term, cleaned, { reading, pos, source, userId });
    saveMeaning('word', `word:${term}::${normalizePos(pos)}`, term, cleaned, { pos, source, userId });
    saveMeaning('word', `word:${term}::`, term, cleaned, { source, userId });
  }
}

function getCachedKanjiMeanings(char, userId = 0) {
  const value = normalizeText(char);
  if (!value) {
    return [];
  }
  return getCachedMeaning('kanji', [kanjiCacheKey(value)], userId);
}

function saveKanjiMeaning(char, meanings, source = 'openai', userId = 0) {
  const value = normalizeText(char);
  if (!value) {
    return;
  }
  saveMeaning('kanji', kanjiCacheKey(value), value, cleanMeanings(meanings), { source, userId });
}

function analysisCacheHit(row, requestedSource) {
  if (!row) {
    return null;
  }
  return safely(null, () => {
    db.prepare(`
      UPDATE analysis_cache
      SET hit_count = hit_count + 1, last_used_at = ?
      WHERE id = ?
    `).run(nowIso(), row.id);
    const result = JSON.parse(row.result_json);
    return {
      ...result,
      source: normalizeText(requestedSource) || result.source,
      translation: {
        ...result.translation,
        provider: 'cache',
        note: '저장된 분석 결과를 재사용했습니다.'
      }
    };
  });
}

function getCachedAnalysis(sourceText, userId = 0) {
  const ownerId = cacheUserId(userId);
  const sourceKey = cacheKeyText(sourceText);
  if (!sourceKey) {
    return null;
  }
  return safely(null, () => {
    const row = db.prepare(`
      SELECT id, result_json
      FROM analysis_cache
      WHERE user_id = ? AND source_key = ? AND version = ?
    `).get(ownerId, sourceKey, ANALYSIS_CACHE_VERSION);
    return analysisCacheHit(row, sourceText);
  });
}

function saveAnalysisCache(sourceText, result, userId = 0) {
  const ownerId = cacheUserId(userId);
  const source = normalizeText(sourceText);
  const sourceKey = cacheKeyText(sourceText);
  const translationText = normalizeText(result?.translation?.text);
  if (!source || !sourceKey || !translationText || !result?.words || !result?.kanji) {
    return;
  }

  safely(undefined, () => {
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO analysis_cache (user_id, source_key, source_text, result_json, version, provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, source_key, version) DO UPDATE SET
        source_text = excluded.source_text,
        result_json = excluded.result_json,
        version = excluded.version,
        provider = excluded.provider,
        updated_at = excluded.updated_at
    `).run(
      ownerId,
      sourceKey,
      source,
      JSON.stringify(result),
      ANALYSIS_CACHE_VERSION,
      normalizeText(result.translation?.provider) || 'unknown',
      timestamp,
      timestamp
    );
  });
}

function pruneTable(tableName, limit) {
  safely(undefined, () => {
    db.prepare(`
      DELETE FROM ${tableName}
      WHERE id NOT IN (
        SELECT id
        FROM ${tableName}
        ORDER BY COALESCE(last_used_at, updated_at, created_at) DESC, id DESC
        LIMIT ?
      )
    `).run(limit);
  });
}

function pruneLearningCaches() {
  for (const [tableName, limit] of Object.entries(CACHE_LIMITS)) {
    pruneTable(tableName, limit);
  }
}

module.exports = {
  cleanMeanings,
  getCachedAnalysis,
  saveAnalysisCache,
  getCachedTranslation,
  saveTranslationCache,
  getCachedExamples,
  saveExampleCache,
  getCachedWordMeanings,
  saveWordMeaning,
  getCachedKanjiMeanings,
  saveKanjiMeaning,
  pruneLearningCaches
};
