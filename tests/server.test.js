const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function mergeCookies(existing, response) {
  const headers = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (!headers.length && response.headers.get('set-cookie')) {
    headers.push(response.headers.get('set-cookie'));
  }
  const next = new Map(existing);
  for (const header of headers) {
    const [pair] = header.split(';');
    const [name, value] = pair.split('=');
    next.set(name, value);
  }
  return next;
}

function cookieHeader(cookies) {
  return Array.from(cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

function extractCsrf(html) {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1] ||
    html.match(/meta name="csrf-token" content="([^"]+)"/)?.[1] ||
    '';
}

async function registerUser(port, { username, recoveryEmail, password }) {
  let cookies = new Map();
  let response = await fetch(`http://localhost:${port}/register`);
  cookies = mergeCookies(cookies, response);
  const csrf = extractCsrf(await response.text());

  response = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(cookies),
      origin: `http://localhost:${port}`
    },
    body: new URLSearchParams({
      _csrf: csrf,
      username,
      recovery_email: recoveryEmail,
      password,
      password_confirm: password
    }),
    redirect: 'manual'
  });

  assert.equal(response.status, 302);
  return mergeCookies(cookies, response);
}

async function attemptLogin(port, { username, password }) {
  let cookies = new Map();
  let response = await fetch(`http://localhost:${port}/login`);
  cookies = mergeCookies(cookies, response);
  const csrf = extractCsrf(await response.text());

  response = await fetch(`http://localhost:${port}/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(cookies),
      origin: `http://localhost:${port}`
    },
    body: new URLSearchParams({
      _csrf: csrf,
      username,
      password
    }),
    redirect: 'manual'
  });

  return {
    response,
    cookies: mergeCookies(cookies, response)
  };
}

async function loginUser(port, { username, password }) {
  const { response, cookies } = await attemptLogin(port, { username, password });
  assert.equal(response.status, 302);
  return cookies;
}

async function waitForServer(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error('server did not start in time');
}

test('server auth and learning API flow works', { timeout: 60000 }, async () => {
  const port = 3317;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'japan-server-test-'));
  const databasePath = path.join(tempDir, 'app.sqlite');
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      APP_ORIGIN: `http://localhost:${port}`,
      SESSION_SECRET: 'server-test-secret-that-is-long-enough',
      DATABASE_PATH: databasePath,
      OPENAI_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(`http://localhost:${port}/healthz`, child);
    let response = await fetch(`http://localhost:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('strict-transport-security'), null);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.match(response.headers.get('permissions-policy') || '', /geolocation=\(\)/);

    response = await fetch(`http://localhost:${port}/api/dashboard`, {
      redirect: 'manual'
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, '로그인이 필요합니다.');

    response = await fetch(`http://localhost:${port}/api/vocabulary.csv`, {
      redirect: 'manual'
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, '로그인이 필요합니다.');

    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '私は学生です。' })
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, '로그인이 필요합니다.');

    let cookies = new Map();
    response = await fetch(`http://localhost:${port}/register`);
    cookies = mergeCookies(cookies, response);
    const registerHtml = await response.text();
    const registerCsrf = extractCsrf(registerHtml);

    response = await fetch(`http://localhost:${port}/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: new URLSearchParams({
        _csrf: registerCsrf,
        username: 'flowuser',
        recovery_email: 'flow@example.com',
        password: 'Flowpass123!',
        password_confirm: 'Flowpass123!'
      }),
      redirect: 'manual'
    });
    cookies = mergeCookies(cookies, response);
    assert.equal(response.status, 302);

    let crossOriginCookies = new Map();
    response = await fetch(`http://localhost:${port}/login`);
    crossOriginCookies = mergeCookies(crossOriginCookies, response);
    const crossOriginCsrf = extractCsrf(await response.text());
    response = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(crossOriginCookies),
        origin: 'http://evil.example'
      },
      body: new URLSearchParams({
        _csrf: crossOriginCsrf,
        username: 'flowuser',
        password: 'Flowpass123!'
      }),
      redirect: 'manual'
    });
    assert.equal(response.status, 403);

    let longPasswordCookies = new Map();
    response = await fetch(`http://localhost:${port}/login`);
    longPasswordCookies = mergeCookies(longPasswordCookies, response);
    const longPasswordCsrf = extractCsrf(await response.text());
    response = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(longPasswordCookies),
        origin: `http://localhost:${port}`
      },
      body: new URLSearchParams({
        _csrf: longPasswordCsrf,
        username: 'flowuser',
        password: `${'A'.repeat(129)}1!`
      }),
      redirect: 'manual'
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /128자를 넘을 수 없습니다/);

    for (let index = 0; index < 6; index += 1) {
      cookies = await loginUser(port, {
        username: 'flowuser',
        password: 'Flowpass123!'
      });
    }
    let testDb = new DatabaseSync(databasePath);
    const activeSessionCount = testDb.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE users.username = ?
    `).get('flowuser').count;
    testDb.close();
    assert.equal(activeSessionCount, 5);

    let badLoginCookies = new Map();
    response = await fetch(`http://localhost:${port}/login`);
    badLoginCookies = mergeCookies(badLoginCookies, response);
    const badLoginHtml = await response.text();
    const badLoginCsrf = extractCsrf(badLoginHtml);
    response = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(badLoginCookies),
        origin: `http://localhost:${port}`
      },
      body: new URLSearchParams({
        _csrf: badLoginCsrf,
        username: 'flowuser',
        password: 'Wrongpass123!'
      }),
      redirect: 'manual'
    });
    assert.equal(response.status, 401);
    assert.match(await response.text(), /아이디 또는 비밀번호가 올바르지 않습니다/);

    let lockoutResponse;
    for (let index = 0; index < 9; index += 1) {
      lockoutResponse = (await attemptLogin(port, {
        username: 'lockuser',
        password: 'Wrongpass123!'
      })).response;
    }
    assert.equal(lockoutResponse.status, 429);
    assert.match(await lockoutResponse.text(), /로그인 실패가 반복/);

    response = await fetch(`http://localhost:${port}/app`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 200);
    const appHtml = await response.text();
    const csrf = extractCsrf(appHtml);
    assert.ok(csrf);
    assert.match(appHtml, /Japan Lab/);
    assert.match(appHtml, /theme\.js\?v=/);
    assert.equal((appHtml.match(/id="dark-mode-button"/g) || []).length, 1);
    assert.match(appHtml, /학습 관리/);
    assert.match(appHtml, /단어 테스트/);

    response = await fetch(`http://localhost:${port}/api/kanji/${encodeURIComponent('学')}`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 403);

    response = await fetch(`http://localhost:${port}/api/kanji/${encodeURIComponent('学')}`, {
      headers: {
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies)
      }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).char, '学');

    response = await fetch(`http://localhost:${port}/api/kanji/${encodeURIComponent('A')}`, {
      headers: {
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies)
      }
    });
    assert.equal(response.status, 400);

    response = await fetch(`http://localhost:${port}/api/dashboard?constructor=blocked`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, '요청에 허용되지 않는 키가 포함되어 있습니다.');

    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: '{"text":'
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, '요청 본문 형식이 올바르지 않습니다.');

    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: '{"__proto__":{"polluted":true},"text":"私は学生です。"}'
    });
    assert.equal(response.status, 400);

    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        text: '私は学生です。',
        meta: { constructor: { prototype: { polluted: true } } }
      })
    });
    assert.equal(response.status, 400);

    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({ text: 'あ'.repeat(300000) })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, '요청 본문이 너무 큽니다.');

    response = await fetch(`http://localhost:${port}/api/history/not-number`, {
      method: 'DELETE',
      headers: {
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      }
    });
    assert.equal(response.status, 400);

    testDb = new DatabaseSync(databasePath);
    const sessionRows = testDb.prepare('SELECT ip_address FROM sessions').all();
    testDb.close();
    assert.equal(sessionRows.every((row) => /^[a-f0-9]{64}$/i.test(row.ip_address)), true);

    response = await fetch(`http://localhost:${port}/admin`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 200);
    const adminHtml = await response.text();
    assert.match(adminHtml, /보안 이벤트/);
    assert.match(adminHtml, /AI 사용량/);
    assert.match(adminHtml, /로그인 실패/);
    assert.match(adminHtml, /계정 생성/);
    assert.doesNotMatch(adminHtml, /flow@example\.com/);
    assert.match(adminHtml, /fw\*\*@example\.com/);

    response = await fetch(`http://localhost:${port}/study`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 200);
    const studyHtml = await response.text();
    assert.match(studyHtml, /단어장 · 기록 · 오답/);
    assert.match(studyHtml, /1 \/ 1/);
    assert.equal((studyHtml.match(/id="dark-mode-button"/g) || []).length, 1);

    response = await fetch(`http://localhost:${port}/word-test`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 200);
    const wordTestHtml = await response.text();
    assert.match(wordTestHtml, /저장 단어 복습/);
    assert.equal((wordTestHtml.match(/id="dark-mode-button"/g) || []).length, 1);

    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        text: '私は図書館で日本語を勉強します。',
        saveHistory: false
      })
    });
    assert.equal(response.status, 200);
    const analysis = await response.json();
    assert.equal(analysis.words.some((word) => word.meaning === '도서관'), true);

    const privateSentence = '私はりんごを食べます。';
    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        text: privateSentence,
        saveHistory: true
      })
    });
    assert.equal(response.status, 200);

    let otherCookies = await registerUser(port, {
      username: 'otheruser',
      recoveryEmail: 'other@example.com',
      password: 'Otherpass123!'
    });
    response = await fetch(`http://localhost:${port}/app`, {
      headers: { cookie: cookieHeader(otherCookies) }
    });
    otherCookies = mergeCookies(otherCookies, response);
    const otherCsrf = extractCsrf(await response.text());

    response = await fetch(`http://localhost:${port}/api/dashboard`, {
      headers: { cookie: cookieHeader(otherCookies) }
    });
    assert.equal(response.status, 200);
    const otherDashboardBefore = await response.json();
    assert.equal(otherDashboardBefore.stats.history_count, 0);
    assert.equal(otherDashboardBefore.history.length, 0);

    response = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': otherCsrf,
        cookie: cookieHeader(otherCookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        text: privateSentence,
        saveHistory: true
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-learning-cache'), null);

    response = await fetch(`http://localhost:${port}/api/dashboard`, {
      headers: { cookie: cookieHeader(otherCookies) }
    });
    const otherDashboardAfter = await response.json();
    assert.equal(otherDashboardAfter.stats.history_count, 1);
    assert.equal(otherDashboardAfter.history[0].source_text, privateSentence);

    response = await fetch(`http://localhost:${port}/api/dashboard`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    const ownerDashboard = await response.json();
    assert.equal(ownerDashboard.stats.history_count, 1);
    assert.equal(ownerDashboard.history[0].source_text, privateSentence);

    response = await fetch(`http://localhost:${port}/api/translate-ko-ja`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        text: '나는 일본어를 공부하고 있습니다.',
        saveHistory: false
      })
    });
    assert.equal(response.status, 200);
    const koJa = await response.json();
    assert.equal(koJa.translation.text, '私は日本語を勉強しています。');

    response = await fetch(`http://localhost:${port}/api/translate-ko-ja`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        text: '나는 일본어를 공부하고 있습니다.',
        saveHistory: false
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-learning-cache'), 'translation-hit');
    const cachedKoJa = await response.json();
    assert.equal(cachedKoJa.translation.provider, 'cache');

    response = await fetch(`http://localhost:${port}/api/examples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({ term: '' })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /입력/);

    response = await fetch(`http://localhost:${port}/api/examples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({ term: '図書館' })
    });
    assert.equal(response.status, 200);
    const examples = await response.json();
    assert.equal(examples.provider, 'local-template');
    assert.equal(examples.examples.length, 3);

    response = await fetch(`http://localhost:${port}/api/examples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({ term: '図書館' })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-learning-cache'), 'examples-hit');
    const cachedExamples = await response.json();
    assert.equal(cachedExamples.provider, 'cache');

    response = await fetch(`http://localhost:${port}/api/examples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': otherCsrf,
        cookie: cookieHeader(otherCookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({ term: '図書館' })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-learning-cache'), null);
    const otherExamples = await response.json();
    assert.equal(otherExamples.provider, 'local-template');

    response = await fetch(`http://localhost:${port}/api/vocabulary`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        term: '図書館',
        reading: 'としょかん',
        meaning: '도서관',
        sourceText: '昨日 "図書館", で'
      })
    });
    assert.equal(response.status, 200);

    response = await fetch(`http://localhost:${port}/api/dashboard`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 200);
    const dashboard = await response.json();
    assert.equal(dashboard.stats.vocabulary_count, 1);

    const savedVocabularyId = dashboard.vocabulary.find((item) => item.term === '図書館').id;
    response = await fetch(`http://localhost:${port}/api/word-test/attempt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      },
      body: JSON.stringify({
        vocabularyId: savedVocabularyId,
        mode: 'term',
        answer: '図書館'
      })
    });
    assert.equal(response.status, 200);
    const wordTestAttempt = await response.json();
    assert.equal(wordTestAttempt.isCorrect, true);

    response = await fetch(`http://localhost:${port}/api/vocabulary.csv`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/csv/);
    assert.match(response.headers.get('content-disposition'), /attachment; filename="japanese-vocabulary\.csv"/);
    const csv = await response.text();
    assert.match(csv, /^"term","reading","meaning","source_text","created_at"\r\n/);
    assert.match(csv, /"図書館","としょかん","도서관","昨日 ""図書館"", で","[^"]+"\r\n/);

    response = await fetch(`http://localhost:${port}/api/vocabulary/${savedVocabularyId}`, {
      method: 'DELETE',
      headers: {
        'x-csrf-token': csrf,
        cookie: cookieHeader(cookies),
        origin: `http://localhost:${port}`
      }
    });
    assert.equal(response.status, 200);

    response = await fetch(`http://localhost:${port}/api/dashboard`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    const dashboardAfterDelete = await response.json();
    assert.equal(dashboardAfterDelete.stats.vocabulary_count, 0);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
