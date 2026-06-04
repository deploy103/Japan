const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

const source = config.databasePath;
const backupDir = path.resolve(config.rootDir, 'backups');

if (!fs.existsSync(source)) {
  console.error(`database_not_found=${source}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
try {
  fs.chmodSync(backupDir, 0o700);
} catch (error) {
  // Some mounted filesystems do not support POSIX permissions.
}

const { db } = require('../src/db');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `app-${stamp}.sqlite`);
const escapedTarget = target.replace(/'/g, "''");

try {
  db.exec(`VACUUM INTO '${escapedTarget}'`);
  db.exec('PRAGMA wal_checkpoint(PASSIVE);');
} finally {
  try {
    db.close();
  } catch (error) {
    // Ignore close errors so backup result reporting remains clear.
  }
}
try {
  fs.chmodSync(target, 0o600);
} catch (error) {
  // Some mounted filesystems do not support POSIX permissions.
}
console.log(`backup_created=${target}`);
