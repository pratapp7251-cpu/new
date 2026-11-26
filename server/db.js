// server/db.js
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'toolyard.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let dbInstance = null;

function saveToDisk() {
  if (!dbInstance) return;
  const data = dbInstance.export();
  fs.writeFileSync(dbFile, Buffer.from(data));
}

function runMigrations(db) {
  const productCols = [
    `sub_category TEXT DEFAULT ''`,
    `brand TEXT DEFAULT 'Taparia'`,
    `gst_percent REAL DEFAULT 18`,
    `discount_percent REAL DEFAULT 0`
  ];
  productCols.forEach(colDef => {
    try { db.run(`ALTER TABLE products ADD COLUMN ${colDef}`); } catch (_) {}
  });

  const variantCols = [
    `opening TEXT DEFAULT ''`,
    `finish TEXT DEFAULT ''`,
    `packaging TEXT DEFAULT ''`,
    `mrp REAL DEFAULT 0`,
    `discount_percent REAL DEFAULT 0`,
    `gst_percent REAL DEFAULT 18`,
    `custom_specs TEXT DEFAULT '{}'`
  ];
  variantCols.forEach(colDef => {
    try { db.run(`ALTER TABLE product_variants ADD COLUMN ${colDef}`); } catch (_) {}
  });
}

async function getDb() {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  if (fs.existsSync(dbFile)) {
    const fileBuffer = fs.readFileSync(dbFile);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
  }

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
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
    );

    CREATE TABLE IF NOT EXISTS product_variants (
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
    );
  `);

  runMigrations(dbInstance);
  saveToDisk();
  return dbInstance;
}

module.exports = { getDb, saveToDisk };