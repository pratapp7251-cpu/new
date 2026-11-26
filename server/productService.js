// server/productService.js
const { getDb, saveToDisk } = require('./db');

function rowsFromStmt(stmt) {
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function ensureSchemaColumns(db) {
  [
    `sub_category TEXT DEFAULT ''`,
    `brand TEXT DEFAULT 'Taparia'`,
    `gst_percent REAL DEFAULT 18`,
    `discount_percent REAL DEFAULT 0`
  ].forEach(colDef => {
    try { db.run(`ALTER TABLE products ADD COLUMN ${colDef}`); } catch (_) {}
  });

  [
    `opening TEXT DEFAULT ''`,
    `finish TEXT DEFAULT ''`,
    `packaging TEXT DEFAULT ''`,
    `mrp REAL DEFAULT 0`,
    `discount_percent REAL DEFAULT 0`,
    `gst_percent REAL DEFAULT 18`,
    `price_tax_mode TEXT DEFAULT 'ex'`,
    `price REAL DEFAULT 0`,
    `stock TEXT DEFAULT 'In Stock'`,
    `custom_specs TEXT DEFAULT '{}'`
  ].forEach(colDef => {
    try { db.run(`ALTER TABLE product_variants ADD COLUMN ${colDef}`); } catch (_) {}
  });
}

function safeParseJson(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  try {
    const parsed = JSON.parse(val);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function getAllSortedProducts({ category = 'ALL', search = '' } = {}) {
  const db = await getDb();
  ensureSchemaColumns(db);

  let sql = `SELECT * FROM products WHERE 1=1`;
  const params = [];

  if (category && category !== 'ALL') {
    sql += ` AND category_name = ?`;
    params.push(category);
  }

  if (search.trim()) {
    sql += ` AND (LOWER(name) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(sub_category) LIKE ? OR LOWER(series) LIKE ? OR LOWER(finish) LIKE ? OR LOWER(description) LIKE ?)`;
    const term = `%${search.trim().toLowerCase()}%`;
    params.push(term, term, term, term, term, term);
  }

  sql += ` ORDER BY category_name ASC, name ASC, created_at DESC`;

  const prodStmt = db.prepare(sql);
  prodStmt.bind(params);
  const products = rowsFromStmt(prodStmt);

  return products.map(p => {
    const varStmt = db.prepare(`
      SELECT size, opening, finish, packaging, sku, mrp, discount_percent, gst_percent, price_tax_mode, price, stock, custom_specs
      FROM product_variants
      WHERE product_id = ?
      ORDER BY id ASC
    `);
    varStmt.bind([p.id]);
    const variants = rowsFromStmt(varStmt).map(v => ({
      size: v.size || 'Standard',
      opening: v.opening || '',
      finish: v.finish || '',
      packaging: v.packaging || '',
      sku: v.sku || '',
      mrp: Number(v.mrp) || 0,
      discount_percent: Number(v.discount_percent ?? p.discount_percent ?? 0) || 0,
      gst_percent: Number(v.gst_percent ?? p.gst_percent ?? 18) || 0,
      price_tax_mode: v.price_tax_mode === 'inc' ? 'inc' : 'ex',
      price: Number(v.price) || 0,
      stock: v.stock || 'In Stock',
      custom_specs: safeParseJson(v.custom_specs)
    }));
    return {
      ...p,
      brand: p.brand || 'Taparia',
      sub_category: p.sub_category || '',
      discount_percent: Number(p.discount_percent) || 0,
      gst_percent: Number(p.gst_percent ?? 18) || 0,
      variants
    };
  });
}

async function createProduct(tool) {
  const db = await getDb();
  ensureSchemaColumns(db);

  const id = tool.id || `tool-${Date.now()}`;
  const categoryName = tool.category || tool.category_name || 'Uncategorized';
  const subCategory = tool.sub_category || '';
  const brand = tool.brand || 'Taparia';
  const defaultFinish = tool.finish || '';
  const discountPct = Number(tool.discount_percent) || 0;
  const defaultGstPct = Number(tool.gst_percent ?? 18) || 0;

  const variants = (Array.isArray(tool.variants) ? tool.variants : []).map((v, idx) => {
    const exGst = Number(v.price) || 0;
    const vDisc = Number(v.discount_percent ?? discountPct) || 0;
    const vGst = Number(v.gst_percent ?? defaultGstPct) || 0;
    const taxMode = v.price_tax_mode === 'inc' ? 'inc' : 'ex';
    let mrp = Number(v.mrp) || 0;
    if (!mrp && exGst > 0 && vDisc > 0 && vDisc < 100) {
      mrp = Number((exGst / (1 - vDisc / 100)).toFixed(2));
    } else if (!mrp) {
      mrp = exGst;
    }

    return {
      size: String(v.size || 'Standard').trim(),
      opening: String(v.opening || '').trim(),
      finish: String(v.finish || defaultFinish).trim(),
      packaging: String(v.packaging || '').trim(),
      sku: String(v.sku || `SKU-${idx + 1}`).trim(),
      mrp,
      discount_percent: vDisc,
      gst_percent: vGst,
      price_tax_mode: taxMode,
      price: exGst,
      stock: String(v.stock || 'In Stock').trim(),
      custom_specs: JSON.stringify(safeParseJson(v.custom_specs))
    };
  });

  db.run(`INSERT OR IGNORE INTO categories (name) VALUES (?)`, [categoryName]);
  db.run(
    `INSERT OR REPLACE INTO products (id, category_name, sub_category, brand, name, series, finish, discount_percent, gst_percent, description, image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, categoryName, subCategory, brand, tool.name, tool.series || '', defaultFinish, discountPct, defaultGstPct, tool.description || '', tool.image || '']
  );

  db.run(`DELETE FROM product_variants WHERE product_id = ?`, [id]);
  for (const v of variants) {
    db.run(
      `INSERT INTO product_variants (product_id, size, opening, finish, packaging, sku, mrp, discount_percent, gst_percent, price_tax_mode, price, stock, custom_specs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, v.size, v.opening, v.finish, v.packaging, v.sku, v.mrp, v.discount_percent, v.gst_percent, v.price_tax_mode, v.price, v.stock, v.custom_specs]
    );
  }

  saveToDisk();
  const all = await getAllSortedProducts();
  return all.find(p => p.id === id);
}

async function deleteProduct(id) {
  const db = await getDb();
  ensureSchemaColumns(db);
  db.run(`DELETE FROM product_variants WHERE product_id = ?`, [id]);
  db.run(`DELETE FROM products WHERE id = ?`, [id]);
  saveToDisk();
}

async function getSortedCategories() {
  const db = await getDb();
  const stmt = db.prepare(`SELECT name FROM categories ORDER BY name ASC`);
  return rowsFromStmt(stmt).map(r => r.name);
}

module.exports = { getAllSortedProducts, createProduct, deleteProduct, getSortedCategories };