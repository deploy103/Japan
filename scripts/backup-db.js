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

const { db } = require('../src/db');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `app-${stamp}.sqlite`);
const escapedTarget = target.replace(/'/g, "''");

db.exec(`VACUUM INTO '${escapedTarget}'`);
db.exec('PRAGMA wal_checkpoint(PASSIVE);');
console.log(`backup_created=${target}`);
