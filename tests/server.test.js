const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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

async function waitForServer(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
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

test('server auth and learning API flow works', { timeout: 30000 }, async () => {
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

    response = await fetch(`http://localhost:${port}/api/dashboard`, {
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

    response = await fetch(`http://localhost:${port}/app`, {
      headers: { cookie: cookieHeader(cookies) }
    });
    assert.equal(response.status, 200);
    const appHtml = await response.text();
    const csrf = extractCsrf(appHtml);
    assert.ok(csrf);

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
        meaning: '도서관'
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
