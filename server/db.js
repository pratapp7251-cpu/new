// server/db.js
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client/web');
const initSqlJs = require('sql.js');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'toolyard.db');

let remoteClient = null;
let localSqlJsDb = null;
let initialized = false;

function isTursoConfigured() {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

function createAdapter(db, mode) {
  if (mode === 'turso') {
    return {
      mode: 'turso',
      execute: (stmt) =>
        typeof stmt === 'string' ? db.execute(stmt) : db.execute(stmt),
      batch: (stmts, txnMode = 'write') => db.batch(stmts, txnMode),
    };
  }

  // Local sql.js fallback adapter with an execute({ sql, args }) interface
  return {
    mode: 'sqljs',
    execute: async (stmt) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      const args = typeof stmt === 'string' ? [] : (stmt.args || []);
      const trimmed = sql.trim().toUpperCase();

      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
        const stmtObj = db.prepare(sql);
        stmtObj.bind(args);
        const rows = [];
        const columns = stmtObj.getColumnNames();
        while (stmtObj.step()) {
          const obj = stmtObj.getAsObject();
          rows.push(columns.map((col) => obj[col]));
        }
        stmtObj.free();
        return { rows, columns };
      }

      const stmtObj = db.prepare(sql);
      stmtObj.bind(args);
      stmtObj.step();
      stmtObj.free();
      saveLocalDb(db);
      return { rows: [], columns: [] };
    },
    batch: async (stmts) => {
      for (const s of stmts) {
        await createAdapter(db, 'sqljs').execute(s);
      }
    },
  };
}

function saveLocalDb(db) {
  if (!db) return;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(dbFile, Buffer.from(db.export()));
}

async function runMigrations(adapter) {
  const productCols = [
    `sub_category TEXT DEFAULT ''`,
    `brand TEXT DEFAULT 'Taparia'`,
    `gst_percent REAL DEFAULT 18`,
    `discount_percent REAL DEFAULT 0`,
  ];

  for (const colDef of productCols) {
    try {
      await adapter.execute(`ALTER TABLE products ADD COLUMN ${colDef}`);
    } catch (_) {}
  }

  const variantCols = [
    `opening TEXT DEFAULT ''`,
    `finish TEXT DEFAULT ''`,
    `packaging TEXT DEFAULT ''`,
    `mrp REAL DEFAULT 0`,
    `discount_percent REAL DEFAULT 0`,
    `gst_percent REAL DEFAULT 18`,
    `price_tax_mode TEXT DEFAULT 'ex'`,
    `custom_specs TEXT DEFAULT '{}'`,
  ];

  for (const colDef of variantCols) {
    try {
      await adapter.execute(`ALTER TABLE product_variants ADD COLUMN ${colDef}`);
    } catch (_) {}
  }
}

async function initSchema(adapter) {
  if (initialized) return;

  await adapter.batch(
    [
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        category_name TEXT NOT NULL,
        sub_category TEXT DEFAULT '',
        brand TEXT DEFAULT 'Taparia',
        name TEXT NOT NULL,
        series TEXT,
        finish TEXT,
        gst_percent REAL DEFAULT 18,
        discount_percent REAL DEFAULT 0,
        description TEXT,
        image TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        size TEXT NOT NULL,
        opening TEXT DEFAULT '',
        finish TEXT DEFAULT '',
        packaging TEXT DEFAULT '',
        sku TEXT NOT NULL,
        mrp REAL DEFAULT 0,
        discount_percent REAL DEFAULT 0,
        gst_percent REAL DEFAULT 18,
        price_tax_mode TEXT DEFAULT 'ex',
        price REAL NOT NULL DEFAULT 0,
        stock TEXT DEFAULT 'In Stock',
        custom_specs TEXT DEFAULT '{}',
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )`,
    ],
    'write'
  );

  await runMigrations(adapter);
  initialized = true;
}

async function getDb() {
  if (isTursoConfigured()) {
    if (!remoteClient) {
      remoteClient = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
    }
    const adapter = createAdapter(remoteClient, 'turso');
    await initSchema(adapter);
    return adapter;
  }

  if (!localSqlJsDb) {
    const SQL = await initSqlJs();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    localSqlJsDb = fs.existsSync(dbFile)
      ? new SQL.Database(fs.readFileSync(dbFile))
      : new SQL.Database();
  }

  const adapter = createAdapter(localSqlJsDb, 'sqljs');
  await initSchema(adapter);
  return adapter;
}

async function saveToDisk() {
  if (localSqlJsDb) {
    saveLocalDb(localSqlJsDb);
  }
}

module.exports = { getDb, saveToDisk };