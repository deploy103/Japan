const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  hashPassword,
  verifyPassword,
  validatePassword,
  validateUsername,
  validateRecoveryEmail,
  normalizeUsername
} = require('../src/security');

test('password hashing verifies only the original password', async () => {
  const hash = await hashPassword('VeryStrong123!');
  assert.equal(await verifyPassword('VeryStrong123!', hash), true);
  assert.equal(await verifyPassword('WrongPassword123!', hash), false);
});

test('password verification rejects unsafe stored scrypt parameters', async () => {
  const unsafeHash = 'scrypt$1073741824$8$1$64$salt$hash';
  const malformedHash = 'scrypt$32768$8$1$4096$salt$hash';
  assert.equal(await verifyPassword('VeryStrong123!', unsafeHash), false);
  assert.equal(await verifyPassword('VeryStrong123!', malformedHash), false);
});

test('account field validation rejects weak input', () => {
  assert.equal(normalizeUsername('  Test_User  '), 'test_user');
  assert.equal(validateUsername('ab').length > 0, true);
  assert.equal(validateUsername('valid_user-1'), '');
  assert.equal(validateRecoveryEmail('learner@example.com'), '');
  assert.equal(validateRecoveryEmail('not-email').length > 0, true);
  assert.equal(validatePassword('short').length > 0, true);
  assert.equal(validatePassword(`${'a'.repeat(128)}1`).length > 0, true);
  assert.equal(validatePassword('LongEnoughPassphrase123!', 'learner'), '');
  assert.equal(validatePassword('LongEnough123', 'learner'), '');
});

test('production config requires explicit strong session secret', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: '',
      APP_ORIGIN: 'https://example.com'
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SESSION_SECRET/);

  const placeholder = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'replace-with-at-least-32-random-characters',
      APP_ORIGIN: 'https://example.com',
      COOKIE_SECURE: 'true'
    },
    encoding: 'utf8'
  });
  assert.notEqual(placeholder.status, 0);
  assert.match(placeholder.stderr, /SESSION_SECRET/);
});

test('production config requires https origin and secure cookies', () => {
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: 'production-secret-that-is-long-enough'
  };

  const insecureOrigin = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...baseEnv,
      APP_ORIGIN: 'http://example.com'
    },
    encoding: 'utf8'
  });
  assert.notEqual(insecureOrigin.status, 0);
  assert.match(insecureOrigin.stderr, /https/);

  const insecureCookie = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...baseEnv,
      APP_ORIGIN: 'https://example.com',
      COOKIE_SECURE: 'false'
    },
    encoding: 'utf8'
  });
  assert.notEqual(insecureCookie.status, 0);
  assert.match(insecureCookie.stderr, /COOKIE_SECURE/);
});

test('production config disables first-user admin by default', () => {
  const result = spawnSync(process.execPath, ['-e', "console.log(require('./src/config').allowFirstUserAdmin)"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'production-secret-that-is-long-enough',
      APP_ORIGIN: 'https://example.com',
      COOKIE_SECURE: 'true',
      FIRST_USER_ADMIN: ''
    },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'false');
});

test('external translation URL must be plain http or https', () => {
  const invalidScheme = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      LIBRETRANSLATE_URL: 'file:///etc/passwd'
    },
    encoding: 'utf8'
  });
  assert.notEqual(invalidScheme.status, 0);
  assert.match(invalidScheme.stderr, /LIBRETRANSLATE_URL/);

  const withCredentials = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      LIBRETRANSLATE_URL: 'https://user:pass@example.com'
    },
    encoding: 'utf8'
  });
  assert.notEqual(withCredentials.status, 0);
  assert.match(withCredentials.stderr, /credentials/);

  const withQuery = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      LIBRETRANSLATE_URL: 'https://example.com?token=leak'
    },
    encoding: 'utf8'
  });
  assert.notEqual(withQuery.status, 0);
  assert.match(withQuery.stderr, /query string/);
});
