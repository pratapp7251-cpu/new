// server/db.js
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'toolyard.db');

let dbInstance = null;
let initialized = false;

function createClientInstance() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const localUrl = process.env.LOCAL_DB_URL || `file:${dbFile}`;
  return createClient({ url: localUrl });
}

async function runMigrations(db) {
  const productCols = [
    `sub_category TEXT DEFAULT ''`,
    `brand TEXT DEFAULT 'Taparia'`,
    `gst_percent REAL DEFAULT 18`,
    `discount_percent REAL DEFAULT 0`,
  ];

  for (const colDef of productCols) {
    try {
      await db.execute(`ALTER TABLE products ADD COLUMN ${colDef}`);
    } catch (_) {
      // Column already exists
    }
  }

  const variantCols = [
    `opening TEXT DEFAULT ''`,
    `finish TEXT DEFAULT ''`,
    `packaging TEXT DEFAULT ''`,
    `mrp REAL DEFAULT 0`,
    `discount_percent REAL DEFAULT 0`,
    `gst_percent REAL DEFAULT 18`,
    `custom_specs TEXT DEFAULT '{}'`,
  ];

  for (const colDef of variantCols) {
    try {
      await db.execute(`ALTER TABLE product_variants ADD COLUMN ${colDef}`);
    } catch (_) {
      // Column already exists
    }
  }
}

async function initSchema(db) {
  if (initialized) return;

  try {
    await db.execute('PRAGMA foreign_keys = ON');
  } catch (_) {}

  await db.batch(
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
        price REAL NOT NULL DEFAULT 0,
        stock TEXT DEFAULT 'In Stock',
        custom_specs TEXT DEFAULT '{}',
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )`,
    ],
    'write'
  );

  await runMigrations(db);
  initialized = true;
}

async function getDb() {
  if (!dbInstance) {
    dbInstance = createClientInstance();
  }
  await initSchema(dbInstance);
  return dbInstance;
}

// Kept as a safe no-op so existing callers don't break if still invoked
async function saveToDisk() {
  return;
}

module.exports = { getDb, saveToDisk };