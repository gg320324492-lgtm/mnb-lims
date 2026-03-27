const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Load .env from backend directory so migrations work when called via npm run
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function splitSqlStatements(sqlText) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < sqlText.length; i += 1) {
    const ch = sqlText[i];
    const prev = sqlText[i - 1];

    if (ch === "'" && !inDouble && !inBacktick && prev !== '\\') {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && !inBacktick && prev !== '\\') {
      inDouble = !inDouble;
    } else if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    }

    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum VARCHAR(64) NOT NULL,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function buildChecksum(content) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function run() {
  const useMySql = String(process.env.USE_MYSQL || '').toLowerCase() === 'true';
  if (!useMySql) {
    console.log('[migrate] USE_MYSQL is false, skip migrations');
    return;
  }

  const migrationsDir = path.resolve(__dirname, '../migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[migrate] migrations directory not found, skip');
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.log('[migrate] no migration files found');
    return;
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: false,
    charset: 'utf8mb4'
  });

  try {
    const dbName = process.env.DB_NAME || 'lab_miniapp';
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    await conn.query(`USE \`${dbName}\``);

    await ensureMigrationsTable(conn);

    const [rows] = await conn.query('SELECT filename, checksum FROM schema_migrations ORDER BY filename ASC');
    const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

    for (const filename of files) {
      const fullPath = path.join(migrationsDir, filename);
      const raw = fs.readFileSync(fullPath, 'utf8');
      const checksum = buildChecksum(raw);

      if (applied.has(filename)) {
        const previousChecksum = applied.get(filename);
        if (previousChecksum !== checksum) {
          throw new Error(`migration checksum mismatch: ${filename}`);
        }
        console.log(`[migrate] skip ${filename} (already applied)`);
        continue;
      }

      const statements = splitSqlStatements(raw);
      if (statements.length === 0) {
        console.log(`[migrate] skip ${filename} (empty)`);
        continue;
      }

      console.log(`[migrate] apply ${filename}`);
      await conn.beginTransaction();
      try {
        for (const stmt of statements) {
          await conn.query(stmt);
        }
        await conn.query(
          'INSERT INTO schema_migrations (filename, checksum, executed_at) VALUES (?, ?, NOW())',
          [filename, checksum]
        );
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }

    console.log('[migrate] done');
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(`[migrate] failed: ${err.message}`);
  process.exit(1);
});
