// server/productService.js
const { getDb, saveToDisk } = require('./db');

function rowsToObjects(result) {
  const cols = Array.isArray(result?.columns) ? result.columns : [];
  const rows = Array.isArray(result?.rows) ? result.rows : [];

  return rows.map((row) => {
    // Handle both array rows ([val1, val2]) and object rows ({ col1: val1 })
    if (Array.isArray(row)) {
      const obj = {};
      cols.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    }
    return row && typeof row === 'object' ? row : {};
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

async function ensureSchemaColumns(db) {
  const productCols = [
    `sub_category TEXT DEFAULT ''`,
    `brand TEXT DEFAULT 'Taparia'`,
    `gst_percent REAL DEFAULT 18`,
    `discount_percent REAL DEFAULT 0`,
  ];

  for (const colDef of productCols) {
    try {
      await db.execute(`ALTER TABLE products ADD COLUMN ${colDef}`);
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
    `price REAL DEFAULT 0`,
    `stock TEXT DEFAULT 'In Stock'`,
    `custom_specs TEXT DEFAULT '{}'`,
  ];

  for (const colDef of variantCols) {
    try {
      await db.execute(`ALTER TABLE product_variants ADD COLUMN ${colDef}`);
    } catch (_) {}
  }
}

async function getAllSortedProducts({ category = 'ALL', search = '' } = {}) {
  const db = await getDb();
  await ensureSchemaColumns(db);

  let sql = `SELECT * FROM products WHERE 1=1`;
  const args = [];

  if (category && category !== 'ALL') {
    sql += ` AND category_name = ?`;
    args.push(category);
  }

  if (search && search.trim()) {
    sql += ` AND (
      LOWER(name) LIKE ? OR
      LOWER(brand) LIKE ? OR
      LOWER(sub_category) LIKE ? OR
      LOWER(series) LIKE ? OR
      LOWER(finish) LIKE ? OR
      LOWER(description) LIKE ?
    )`;
    const term = `%${search.trim().toLowerCase()}%`;
    args.push(term, term, term, term, term, term);
  }

  sql += ` ORDER BY category_name ASC, name ASC, created_at DESC`;

  const prodResult = await db.execute({ sql, args });
  const products = rowsToObjects(prodResult);

  const enriched = [];
  for (const p of products) {
    const varResult = await db.execute({
      sql: `
        SELECT size, opening, finish, packaging, sku, mrp, discount_percent, gst_percent, price_tax_mode, price, stock, custom_specs
        FROM product_variants
        WHERE product_id = ?
        ORDER BY id ASC
      `,
      args: [p.id],
    });

    const variants = rowsToObjects(varResult).map((v) => ({
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
      custom_specs: safeParseJson(v.custom_specs),
    }));

    enriched.push({
      ...p,
      brand: p.brand || 'Taparia',
      sub_category: p.sub_category || '',
      discount_percent: Number(p.discount_percent) || 0,
      gst_percent: Number(p.gst_percent ?? 18) || 0,
      variants,
    });
  }

  return enriched;
}

async function createProduct(tool) {
  const db = await getDb();
  await ensureSchemaColumns(db);

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
      custom_specs: JSON.stringify(safeParseJson(v.custom_specs)),
    };
  });

  await db.execute({
    sql: `INSERT OR IGNORE INTO categories (name) VALUES (?)`,
    args: [categoryName],
  });

  await db.execute({
    sql: `
      INSERT OR REPLACE INTO products (
        id, category_name, sub_category, brand, name, series, finish,
        discount_percent, gst_percent, description, image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      categoryName,
      subCategory,
      brand,
      tool.name,
      tool.series || '',
      defaultFinish,
      discountPct,
      defaultGstPct,
      tool.description || '',
      tool.image || '',
    ],
  });

  await db.execute({
    sql: `DELETE FROM product_variants WHERE product_id = ?`,
    args: [id],
  });

  for (const v of variants) {
    await db.execute({
      sql: `
        INSERT INTO product_variants (
          product_id, size, opening, finish, packaging, sku,
          mrp, discount_percent, gst_percent, price_tax_mode, price, stock, custom_specs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        v.size,
        v.opening,
        v.finish,
        v.packaging,
        v.sku,
        v.mrp,
        v.discount_percent,
        v.gst_percent,
        v.price_tax_mode,
        v.price,
        v.stock,
        v.custom_specs,
      ],
    });
  }

  await saveToDisk();
  const all = await getAllSortedProducts();
  return all.find((p) => p.id === id);
}

async function deleteProduct(id) {
  const db = await getDb();
  await ensureSchemaColumns(db);

  await db.execute({
    sql: `DELETE FROM product_variants WHERE product_id = ?`,
    args: [id],
  });
  await db.execute({
    sql: `DELETE FROM products WHERE id = ?`,
    args: [id],
  });

  await saveToDisk();
}

async function getSortedCategories() {
  const db = await getDb();
  const res = await db.execute(`SELECT name FROM categories ORDER BY name ASC`);
  return rowsToObjects(res)
    .map((r) => r.name)
    .filter(Boolean);
}

module.exports = {
  getAllSortedProducts,
  createProduct,
  deleteProduct,
  getSortedCategories,
};