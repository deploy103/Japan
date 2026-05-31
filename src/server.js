const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const config = require('./config');
const { db, nowIso, pruneExpiredSessions } = require('./db');
const {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  safeEqual,
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateRecoveryEmail,
  validatePassword
} = require('./security');
const {
  analyzeJapanese,
  getKanjiDetailWithAi,
  translateKoreanToJapanese,
  convertKana,
  generateExamples,
  ocrImage
} = require('./services/japanese');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const GUEST_CSRF_COOKIE = 'guest_csrf';
const SESSION_COOKIE = 'sid';
const DUMMY_PASSWORD_HASH = 'scrypt$32768$8$1$64$jUnvMa_JD5-6XnyA0QhkAg$EjkhWkS5SibRIKXJox01CpZHY7ZI57OsYbif8npK9vS-BGGXjTVRFDNC8VOoNZDN6L6F-rq4KS6k83SCighDew';
const INVALID_LOGIN_MESSAGE = '아이디 또는 비밀번호가 올바르지 않습니다.';

const app = express();

if (config.isProduction) {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(config.rootDir, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'none'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: config.secureCookies
    ? { maxAge: 31536000, includeSubDomains: true }
    : false
}));

// 전체 요청 제한과 인증/AI 비용 제한을 분리해 보안과 사용성을 따로 조절한다.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    if (wantsJson(req)) {
      res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    res.status(429).render('error', {
      title: '요청 제한',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    });
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    const isRegister = req.path === '/register';
    res.status(429).render(isRegister ? 'register' : 'login', {
      title: isRegister ? '회원가입' : '로그인',
      error: '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      values: {
        username: normalizeUsername(req.body.username),
        recovery_email: normalizeEmail(req.body.recovery_email)
      }
    });
  }
});

const aiCostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'AI 기능 요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser(config.sessionSecret));
app.use('/assets', express.static(path.join(config.rootDir, 'public'), {
  maxAge: config.isProduction ? '7d' : 0,
  etag: true
}));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: SESSION_TTL_MS
  };
}

function csrfCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: 1000 * 60 * 60
  };
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/'
  });
}

function createSession(res, req, userId) {
  const token = randomToken(48);
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (id_hash, user_id, csrf_token, user_agent, ip_address, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sha256(token),
    userId,
    randomToken(32),
    String(req.get('user-agent') || '').slice(0, 400),
    req.ip,
    now,
    now,
    now + SESSION_TTL_MS
  );
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

function destroySession(req, res) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  }
  clearSessionCookie(res);
}

// 세션 쿠키에는 원본 토큰만 저장하고 DB에는 해시만 저장해 유출 시 재사용 위험을 낮춘다.
function loadSession(req, res, next) {
  res.locals.currentUser = null;
  res.locals.csrfToken = '';
  res.locals.path = req.path;

  const token = req.cookies[SESSION_COOKIE];
  if (!token) {
    next();
    return;
  }

  const row = db.prepare(`
    SELECT
      sessions.id_hash,
      sessions.csrf_token,
      sessions.expires_at,
      users.id,
      users.username,
      users.recovery_email,
      users.role,
      users.is_active,
      users.created_at,
      users.last_login_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id_hash = ?
  `).get(sha256(token));

  if (!row || row.expires_at <= Date.now() || row.is_active !== 1) {
    destroySession(req, res);
    next();
    return;
  }

  req.session = {
    idHash: row.id_hash,
    csrfToken: row.csrf_token
  };
  req.user = {
    id: row.id,
    username: row.username,
    recoveryEmail: row.recovery_email,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
  res.locals.currentUser = req.user;
  res.locals.csrfToken = row.csrf_token;

  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(Date.now(), row.id_hash);
  next();
}

function ensureGuestCsrf(req, res, next) {
  if (req.user || req.path === '/healthz' || req.path.startsWith('/api/')) {
    next();
    return;
  }
  let token = req.cookies[GUEST_CSRF_COOKIE];
  if (!token || token.length < 32) {
    token = randomToken(32);
    res.cookie(GUEST_CSRF_COOKIE, token, csrfCookieOptions());
  }
  res.locals.csrfToken = token;
  next();
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
}

function isAuthPost(req) {
  return req.method === 'POST' && (req.path === '/login' || req.path === '/register');
}

function securityError(req, res, status, message) {
  console.warn('security_blocked', {
    path: req.path,
    method: req.method,
    message,
    origin: req.get('origin') || '',
    host: req.get('host') || '',
    forwardedProto: req.get('x-forwarded-proto') || '',
    protocol: req.protocol
  });

  if (wantsJson(req)) {
    res.status(status).json({ error: message });
    return;
  }
  res.status(status).render('error', {
    title: '확인 필요',
    message
  });
}

// 로그인/회원가입은 Origin 헤더가 빠지는 브라우저/프록시 사례가 있어 별도 속도제한과 입력검증으로 처리한다.
function originGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  if (isAuthPost(req)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(req, origin)) {
    securityError(req, res, 403, '허용되지 않은 출처의 요청입니다.');
    return;
  }
  next();
}

function isAllowedOrigin(req, origin) {
  try {
    const parsedOrigin = new URL(origin);
    const configuredOrigin = new URL(config.appOrigin);
    if (parsedOrigin.origin === configuredOrigin.origin) {
      return true;
    }
    if (config.isProduction) {
      return false;
    }

    const requestHost = req.get('host');
    if (!requestHost) {
      return false;
    }

    const forwardedProto = String(req.get('x-forwarded-proto') || '')
      .split(',')[0]
      .trim();
    const allowedProtocols = new Set([
      `${req.protocol}:`,
      forwardedProto ? `${forwardedProto}:` : '',
      configuredOrigin.protocol
    ].filter(Boolean));

    return parsedOrigin.host === requestHost && allowedProtocols.has(parsedOrigin.protocol);
  } catch (error) {
    return false;
  }
}

function csrfGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  if (!req.user && req.path.startsWith('/api/')) {
    next();
    return;
  }

  const provided = req.get('x-csrf-token') || req.body._csrf;
  const expected = req.session ? req.session.csrfToken : req.cookies[GUEST_CSRF_COOKIE];
  if (!safeEqual(provided, expected)) {
    securityError(req, res, 403, '로그인 정보가 만료되었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
    return;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    res.redirect('/login');
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    res.redirect('/login');
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).render('error', {
      title: '접근 불가',
      message: '관리자만 접근할 수 있는 페이지입니다.'
    });
    return;
  }
  next();
}

function renderAuth(res, view, params = {}) {
  res.render(view, {
    error: '',
    values: {},
    ...params
  });
}

function summarizeAnalysis(result) {
  return JSON.stringify({
    words: result.words.slice(0, 50),
    kanji: result.kanji.slice(0, 50),
    particles: result.particles,
    katakana: result.katakana,
    difficulty: result.difficulty,
    structure: result.structure
  });
}

// 앱 첫 화면에서 필요한 기록/단어장/오답 데이터를 한 번에 묶어 내려준다.
function getDashboardData(userId) {
  const history = db.prepare(`
    SELECT id, source_text, translation_text, created_at
    FROM search_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 12
  `).all(userId);

  const vocabulary = db.prepare(`
    SELECT id, term, reading, meaning, source_text, created_at
    FROM vocabulary
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(userId);

  const favorites = db.prepare(`
    SELECT id, item_type, item_text, note, created_at
    FROM favorites
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId);

  const wrongNotes = db.prepare(`
    SELECT id, term, correct_answer, submitted_answer, created_at
    FROM wrong_notes
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId);

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM search_history WHERE user_id = ?) AS history_count,
      (SELECT COUNT(*) FROM vocabulary WHERE user_id = ?) AS vocabulary_count,
      (SELECT COUNT(*) FROM favorites WHERE user_id = ?) AS favorite_count,
      (SELECT COUNT(*) FROM wrong_notes WHERE user_id = ?) AS wrong_count,
      (SELECT COUNT(*) FROM quiz_attempts WHERE user_id = ?) AS quiz_total,
      (SELECT COUNT(*) FROM quiz_attempts WHERE user_id = ? AND is_correct = 1) AS quiz_correct,
      (SELECT COUNT(*) FROM search_history WHERE user_id = ? AND date(created_at, 'localtime') = date('now', 'localtime')) AS today_history
  `).get(userId, userId, userId, userId, userId, userId, userId);

  const quizAccuracy = stats.quiz_total ? Math.round((stats.quiz_correct / stats.quiz_total) * 100) : 0;
  return {
    history,
    vocabulary,
    favorites,
    wrongNotes,
    stats: {
      ...stats,
      quiz_accuracy: quizAccuracy
    }
  };
}

function normalizeShortText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function buildVocabularyCsv(userId) {
  const rows = db.prepare(`
    SELECT term, reading, meaning, source_text, created_at
    FROM vocabulary
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId);
  const header = ['term', 'reading', 'meaning', 'source_text', 'created_at'];
  const lines = [
    header.map(csvCell).join(','),
    ...rows.map((row) => header.map((field) => csvCell(row[field])).join(','))
  ];
  return `${lines.join('\r\n')}\r\n`;
}

app.use(loadSession);
app.use(ensureGuestCsrf);
app.use(originGuard);
app.use(csrfGuard);

setInterval(pruneExpiredSessions, 1000 * 60 * 30).unref();
pruneExpiredSessions();

app.get('/', (req, res) => {
  res.redirect(req.user ? '/app' : '/login');
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    time: nowIso()
  });
});

app.get('/login', (req, res) => {
  if (req.user) {
    res.redirect('/app');
    return;
  }
  renderAuth(res, 'login', { title: '로그인' });
});

app.post('/login', authLimiter, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');
    const usernameError = validateUsername(username);
    const passwordError = password ? '' : '비밀번호를 입력해 주세요.';
    if (usernameError || passwordError) {
      renderAuth(res.status(400), 'login', {
        title: '로그인',
        error: usernameError || passwordError,
        values: { username }
      });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const passwordMatches = await verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);

    if (!user || !passwordMatches) {
      renderAuth(res.status(401), 'login', {
        title: '로그인',
        error: INVALID_LOGIN_MESSAGE,
        values: { username }
      });
      return;
    }

    if (user.is_active !== 1) {
      renderAuth(res.status(403), 'login', {
        title: '로그인',
        error: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
        values: { username }
      });
      return;
    }

    destroySession(req, res);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').run(user.id, Date.now());
    createSession(res, req, user.id);
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
    res.redirect('/app');
  } catch (error) {
    next(error);
  }
});

app.get('/register', (req, res) => {
  if (req.user) {
    res.redirect('/app');
    return;
  }
  renderAuth(res, 'register', { title: '회원가입' });
});

app.post('/register', authLimiter, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const recoveryEmail = normalizeEmail(req.body.recovery_email);
    const password = String(req.body.password || '');
    const passwordConfirm = String(req.body.password_confirm || '');
    const error =
      validateUsername(username) ||
      validateRecoveryEmail(recoveryEmail) ||
      validatePassword(password, username) ||
      (password !== passwordConfirm ? '비밀번호 확인이 일치하지 않습니다.' : '');

    if (error) {
      renderAuth(res.status(400), 'register', {
        title: '회원가입',
        error,
        values: { username, recovery_email: recoveryEmail }
      });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      renderAuth(res.status(409), 'register', {
        title: '회원가입',
        error: '이미 사용 중인 아이디입니다.',
        values: { username, recovery_email: recoveryEmail }
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    let result;
    db.exec('BEGIN IMMEDIATE');
    try {
      const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      const role = count === 0 ? 'admin' : 'user';
      result = db.prepare(`
        INSERT INTO users (username, password_hash, recovery_email, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(username, passwordHash, recoveryEmail, role, nowIso(), nowIso());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    destroySession(req, res);
    createSession(res, req, Number(result.lastInsertRowid));
    res.redirect('/app');
  } catch (error) {
    next(error);
  }
});

app.post('/logout', requireAuth, (req, res) => {
  destroySession(req, res);
  res.redirect('/login');
});

app.get('/app', requireAuth, (req, res) => {
  res.render('app', {
    title: '문장 분석',
    sampleText: '私は昨日、図書館で日本語の本を読みました。',
    dashboard: getDashboardData(req.user.id)
  });
});

app.post('/api/analyze', requireAuth, aiCostLimiter, async (req, res, next) => {
  try {
    const result = await analyzeJapanese(req.body.text);
    if (req.body.saveHistory !== false) {
      db.prepare(`
        INSERT INTO search_history (user_id, source_text, translation_text, summary_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.user.id, result.source, result.translation.text, summarizeAnalysis(result), nowIso());
    }
    res.json(result);
  } catch (error) {
    if (error.message && (error.message.includes('입력') || error.message.includes('이하'))) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.post('/api/translate-ko-ja', requireAuth, aiCostLimiter, async (req, res, next) => {
  try {
    const result = await translateKoreanToJapanese(req.body.text);
    if (req.body.saveHistory === true) {
      db.prepare(`
        INSERT INTO search_history (user_id, source_text, translation_text, summary_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.user.id, result.source, result.translation.text, JSON.stringify({ direction: 'ko-ja' }), nowIso());
    }
    res.json(result);
  } catch (error) {
    if (error.message && (error.message.includes('입력') || error.message.includes('이하'))) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.get('/api/kanji/:char', requireAuth, async (req, res, next) => {
  const char = String(req.params.char || '').charAt(0);
  try {
    res.json(await getKanjiDetailWithAi(char));
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', requireAuth, (req, res) => {
  res.json(getDashboardData(req.user.id));
});

app.get('/api/vocabulary.csv', requireAuth, (req, res) => {
  res
    .type('text/csv; charset=utf-8')
    .attachment('japanese-vocabulary.csv')
    .send(`\uFEFF${buildVocabularyCsv(req.user.id)}`);
});

app.delete('/api/history/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM search_history WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

app.post('/api/vocabulary', requireAuth, (req, res) => {
  const term = normalizeShortText(req.body.term, 120);
  const reading = normalizeShortText(req.body.reading, 120);
  const meaning = normalizeShortText(req.body.meaning, 240);
  const sourceText = normalizeShortText(req.body.sourceText, 500);
  if (!term) {
    res.status(400).json({ error: '저장할 단어를 입력해 주세요.' });
    return;
  }

  db.prepare(`
    INSERT INTO vocabulary (user_id, term, reading, meaning, source_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, term) DO UPDATE SET
      reading = excluded.reading,
      meaning = excluded.meaning,
      source_text = excluded.source_text,
      updated_at = excluded.updated_at
  `).run(req.user.id, term, reading, meaning, sourceText, nowIso(), nowIso());
  res.json({ ok: true });
});

app.delete('/api/vocabulary/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM vocabulary WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

app.post('/api/favorites', requireAuth, (req, res) => {
  const itemType = normalizeShortText(req.body.itemType, 20);
  const itemText = normalizeShortText(req.body.itemText, 500);
  const note = normalizeShortText(req.body.note, 500);
  if (!['word', 'kanji', 'sentence'].includes(itemType) || !itemText) {
    res.status(400).json({ error: '즐겨찾기 종류와 내용을 확인해 주세요.' });
    return;
  }

  db.prepare(`
    INSERT INTO favorites (user_id, item_type, item_text, note, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, item_type, item_text) DO UPDATE SET note = excluded.note
  `).run(req.user.id, itemType, itemText, note, nowIso());
  res.json({ ok: true });
});

app.delete('/api/favorites/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

app.post('/api/examples', requireAuth, aiCostLimiter, async (req, res, next) => {
  try {
    res.json({ examples: await generateExamples(req.body.term) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ocr', requireAuth, aiCostLimiter, async (req, res, next) => {
  try {
    res.json(await ocrImage(req.body.image));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/convert-kana', requireAuth, (req, res) => {
  const text = normalizeShortText(req.body.text, 3000);
  if (!text) {
    res.status(400).json({ error: '변환할 문자를 입력해 주세요.' });
    return;
  }
  res.json(convertKana(text));
});

app.get('/api/quiz', requireAuth, (req, res) => {
  const item = db.prepare(`
    SELECT id, term, reading, meaning
    FROM vocabulary
    WHERE user_id = ?
    ORDER BY RANDOM()
    LIMIT 1
  `).get(req.user.id);

  if (!item) {
    res.status(404).json({ error: '퀴즈를 만들 단어장이 비어 있습니다.' });
    return;
  }

  res.json({
    vocabularyId: item.id,
    prompt: item.meaning ? `뜻이 "${item.meaning}"인 일본어 단어는?` : `읽기가 "${item.reading || '-'}"인 단어는?`
  });
});

app.post('/api/quiz', requireAuth, (req, res) => {
  const vocabularyId = Number(req.body.vocabularyId);
  const submittedAnswer = normalizeShortText(req.body.answer, 120);
  const item = db.prepare('SELECT id, term, meaning FROM vocabulary WHERE id = ? AND user_id = ?').get(vocabularyId, req.user.id);
  if (!item || !submittedAnswer) {
    res.status(400).json({ error: '퀴즈 답안을 확인해 주세요.' });
    return;
  }

  const normalizeAnswer = (value) => String(value || '').trim().toLowerCase();
  const isCorrect = normalizeAnswer(submittedAnswer) === normalizeAnswer(item.term);
  const prompt = item.meaning ? `뜻이 "${item.meaning}"인 일본어 단어는?` : '단어장 복습';
  db.prepare(`
    INSERT INTO quiz_attempts (user_id, vocabulary_id, prompt, expected_answer, submitted_answer, is_correct, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, item.id, prompt, item.term, submittedAnswer, isCorrect ? 1 : 0, nowIso());

  if (!isCorrect) {
    db.prepare(`
      INSERT INTO wrong_notes (user_id, term, correct_answer, submitted_answer, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.id, item.term, item.term, submittedAnswer, nowIso());
  }

  res.json({
    ok: true,
    isCorrect,
    correctAnswer: item.term
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT
      users.id,
      users.username,
      users.recovery_email,
      users.role,
      users.is_active,
      users.created_at,
      users.updated_at,
      users.last_login_at,
      COUNT(sessions.id_hash) AS active_sessions
    FROM users
    LEFT JOIN sessions ON sessions.user_id = users.id AND sessions.expires_at > ?
    GROUP BY users.id
    ORDER BY users.created_at DESC
  `).all(Date.now());

  res.render('admin', {
    title: '관리자',
    users
  });
});

app.post('/admin/users/:id/status', requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    res.status(400).render('error', {
      title: '처리 불가',
      message: '본인 계정은 비활성화할 수 없습니다.'
    });
    return;
  }

  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(targetId);
  if (user) {
    const nextStatus = user.is_active === 1 ? 0 : 1;
    db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(nextStatus, nowIso(), targetId);
    if (nextStatus === 0) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
    }
  }
  res.redirect('/admin');
});

app.post('/admin/users/:id/role', requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    res.status(400).render('error', {
      title: '처리 불가',
      message: '본인 관리자 권한은 직접 변경할 수 없습니다.'
    });
    return;
  }

  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
  if (user) {
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(nextRole, nowIso(), targetId);
  }
  res.redirect('/admin');
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' });
    return;
  }
  res.status(404).render('error', {
    title: '페이지 없음',
    message: '요청한 페이지를 찾을 수 없습니다.'
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = error.type === 'entity.too.large' ? 413 : 500;
  const message = status === 413
    ? '요청 본문이 너무 큽니다.'
    : (config.isProduction ? '요청을 처리하지 못했습니다.' : error.message);
  if (req.path.startsWith('/api/')) {
    res.status(status).json({ error: message });
    return;
  }
  res.status(status).render('error', {
    title: status === 413 ? '요청 크기 초과' : '서버 오류',
    message
  });
});

app.listen(config.port, () => {
  console.log(`Japanese learning assistant listening on http://localhost:${config.port}`);
});
