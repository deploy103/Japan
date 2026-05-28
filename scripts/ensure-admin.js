const { db, nowIso } = require('../src/db');
const { hashPassword, normalizeEmail, normalizeUsername, validatePassword, validateRecoveryEmail, validateUsername } = require('../src/security');

async function main() {
  const username = normalizeUsername(process.env.ADMIN_USERNAME);
  const recoveryEmail = normalizeEmail(process.env.ADMIN_RECOVERY_EMAIL);
  const password = process.env.ADMIN_PASSWORD || '';
  const error =
    validateUsername(username) ||
    validateRecoveryEmail(recoveryEmail) ||
    validatePassword(password, username);

  if (error) {
    throw new Error(error);
  }

  const passwordHash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, recovery_email = ?, role = 'admin', is_active = 1, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, recoveryEmail, nowIso(), existing.id);
    console.log(`admin_updated=${username}`);
    return;
  }

  db.prepare(`
    INSERT INTO users (username, password_hash, recovery_email, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 1, ?, ?)
  `).run(username, passwordHash, recoveryEmail, nowIso(), nowIso());
  console.log(`admin_created=${username}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
