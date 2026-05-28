const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};
const KEY_LENGTH = 64;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(`${config.sessionSecret}:${value}`).digest('hex');
}

async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new Error('Password must be a string.');
  }
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${KEY_LENGTH}$${salt}$${derived.toString('base64url')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, n, r, p, keyLength, salt, expectedHash] = parts;
  const derived = await scrypt(password, salt, Number(keyLength), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024
  });

  const expected = Buffer.from(expectedHash, 'base64url');
  if (expected.length !== derived.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, derived);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateUsername(username) {
  const value = normalizeUsername(username);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(value)) {
    return '아이디는 영문 소문자, 숫자, 점, 밑줄, 하이픈으로 3~32자여야 합니다.';
  }
  if (/[._-]{2,}/.test(value)) {
    return '아이디에는 특수문자를 연속해서 사용할 수 없습니다.';
  }
  return '';
}

function validateRecoveryEmail(email) {
  const value = normalizeEmail(email);
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return '복구용 이메일 형식이 올바르지 않습니다.';
  }
  return '';
}

function validatePassword(password, username = '') {
  if (typeof password !== 'string' || password.length < 10) {
    return '비밀번호는 최소 10자 이상이어야 합니다.';
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `비밀번호는 ${PASSWORD_MAX_LENGTH}자를 넘을 수 없습니다.`;
  }
  if (username && password.toLowerCase().includes(normalizeUsername(username))) {
    return '비밀번호에 아이디를 포함할 수 없습니다.';
  }
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;
  if (classes < 2) {
    return '비밀번호에는 서로 다른 문자 종류를 2가지 이상 섞어 주세요.';
  }
  return '';
}

module.exports = {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  safeEqual,
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateRecoveryEmail,
  validatePassword,
  PASSWORD_MAX_LENGTH
};
