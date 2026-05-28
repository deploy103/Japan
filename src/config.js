const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();

const rootDir = path.resolve(__dirname, '..');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const configuredSessionSecret = process.env.SESSION_SECRET || '';
const sessionSecret = configuredSessionSecret || crypto.randomBytes(48).toString('base64url');
if (process.env.NODE_ENV === 'production' && configuredSessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
}

const appOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
let parsedAppOrigin;
try {
  parsedAppOrigin = new URL(appOrigin);
} catch (error) {
  throw new Error('APP_ORIGIN must be a valid URL.');
}

const secureCookies = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : appOrigin.startsWith('https://');

if (process.env.NODE_ENV === 'production') {
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
  libreTranslateUrl: process.env.LIBRETRANSLATE_URL || '',
  libreTranslateApiKey: process.env.LIBRETRANSLATE_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.2'
};
