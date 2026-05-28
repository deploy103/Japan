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
