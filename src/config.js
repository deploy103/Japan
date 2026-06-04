const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();

const rootDir = path.resolve(__dirname, '..');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const configuredSessionSecret = String(process.env.SESSION_SECRET || '').trim();
const sessionSecret = configuredSessionSecret || crypto.randomBytes(48).toString('base64url');
const knownWeakSessionSecrets = new Set([
  'replace-with-at-least-32-random-characters',
  'change-me',
  'changeme',
  'development-secret',
  'production-secret'
]);

const appOrigin = String(process.env.APP_ORIGIN || '').trim() || `http://localhost:${port}`;
let parsedAppOrigin;
try {
  parsedAppOrigin = new URL(appOrigin);
} catch (error) {
  throw new Error('APP_ORIGIN must be a valid URL.');
}

const secureCookies = process.env.COOKIE_SECURE
  ? String(process.env.COOKIE_SECURE).trim() === 'true'
  : appOrigin.startsWith('https://');
const allowFirstUserAdmin = process.env.FIRST_USER_ADMIN
  ? String(process.env.FIRST_USER_ADMIN).trim() === 'true'
  : process.env.NODE_ENV !== 'production';

function optionalHttpUrl(envName) {
  const value = String(process.env[envName] || '').trim();
  if (!value) {
    return '';
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${envName} must be a valid URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${envName} must use http:// or https://.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${envName} must not include credentials.`);
  }
  if (parsed.search) {
    throw new Error(`${envName} must not include a query string.`);
  }
  parsed.hash = '';
  return parsed.href.replace(/\/$/, '');
}

if (process.env.NODE_ENV === 'production') {
  if (configuredSessionSecret.length < 32 || knownWeakSessionSecrets.has(configuredSessionSecret.toLowerCase())) {
    throw new Error('SESSION_SECRET must be set to a unique random value of at least 32 characters in production.');
  }
  if (parsedAppOrigin.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use https:// in production.');
  }
  if (!secureCookies) {
    throw new Error('COOKIE_SECURE must be true in production.');
  }
}

module.exports = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port,
  appOrigin,
  databasePath: path.resolve(rootDir, process.env.DATABASE_PATH || './data/app.sqlite'),
  sessionSecret,
  secureCookies,
  allowFirstUserAdmin,
  libreTranslateUrl: optionalHttpUrl('LIBRETRANSLATE_URL'),
  libreTranslateApiKey: process.env.LIBRETRANSLATE_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.2'
};
