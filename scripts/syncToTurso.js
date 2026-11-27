// scripts/syncToTurso.js
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { createClient } = require('@libsql/client/web');

const dbFile = path.join(__dirname, '..', 'data', 'toolyard.db');

function rowsFromStmt(stmt) {
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function syncLocalDbToTurso() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment.');
  }
  if (!fs.existsSync(dbFile)) {
    throw new Error(`Local database not found at: ${dbFile}`);
  }

  // 1. Read local SQLite file via sql.js
  const SQL = await initSqlJs();
  const localDb = new SQL.Database(fs.readFileSync(dbFile));

  const categories = rowsFromStmt(localDb.prepare(`SELECT name FROM categories`));
  const products = rowsFromStmt(localDb.prepare(`SELECT * FROM products`));
  const variants = rowsFromStmt(localDb.prepare(`SELECT * FROM product_variants`));

  // 2. Connect to Turso over HTTP/Web client (no native binary required)
  const turso = createClient({ url, authToken });

  await turso.batch(
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

  // 3. Upsert categories
  for (const c of categories) {
    await turso.execute({
      sql: `INSERT OR IGNORE INTO categories (name) VALUES (?)`,
      args: [c.name],
    });
  }

  // 4. Upsert products and refresh their variants cleanly
  for (const p of products) {
    await turso.execute({
      sql: `
        INSERT OR REPLACE INTO products (
          id, category_name, sub_category, brand, name, series, finish,
          gst_percent, discount_percent, description, image, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        p.id,
        p.category_name,
        p.sub_category || '',
        p.brand || 'Taparia',
        p.name,
        p.series || '',
        p.finish || '',
        Number(p.gst_percent ?? 18),
        Number(p.discount_percent ?? 0),
        p.description || '',
        p.image || '',
        p.created_at || new Date().toISOString(),
      ],
    });

    await turso.execute({
      sql: `DELETE FROM product_variants WHERE product_id = ?`,
      args: [p.id],
    });
  }

  for (const v of variants) {
    await turso.execute({
      sql: `
        INSERT INTO product_variants (
          product_id, size, opening, finish, packaging, sku,
          mrp, discount_percent, gst_percent, price_tax_mode, price, stock, custom_specs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        v.product_id,
        v.size || 'Standard',
        v.opening || '',
        v.finish || '',
        v.packaging || '',
        v.sku || '',
        Number(v.mrp ?? 0),
        Number(v.discount_percent ?? 0),
        Number(v.gst_percent ?? 18),
        v.price_tax_mode === 'inc' ? 'inc' : 'ex',
        Number(v.price ?? 0),
        v.stock || 'In Stock',
        typeof v.custom_specs === 'string' ? v.custom_specs : JSON.stringify(v.custom_specs || {}),
      ],
    });
  }

  console.log(
    `Synced to Turso: ${categories.length} categories, ${products.length} products, ${variants.length} variants.`
  );
}

syncLocalDbToTurso().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});