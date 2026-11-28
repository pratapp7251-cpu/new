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

// Lowest GST-inclusive variant price (same rule the storefront uses)
const MIN_PRICE_SQL = `COALESCE((
  SELECT MIN(
    (CASE WHEN COALESCE(v.price, 0) = 0 AND v.mrp > 0 AND v.discount_percent > 0
      THEN v.mrp * (1 - v.discount_percent / 100.0)
      ELSE COALESCE(v.price, 0) END)
    * (1 + COALESCE(v.gst_percent, products.gst_percent, 18) / 100.0))
  FROM product_variants v WHERE v.product_id = products.id
), 1e18)`;

const ORDER_BY = {
  default: 'category_name ASC, name ASC, created_at DESC, id ASC',
  'name-asc': 'name COLLATE NOCASE ASC, id ASC',
  'price-asc': `${MIN_PRICE_SQL} ASC, name COLLATE NOCASE ASC, id ASC`,
  'price-desc': `${MIN_PRICE_SQL} DESC, name COLLATE NOCASE ASC, id ASC`,
};

const CATEGORY_SQL = `COALESCE(NULLIF(category_name, ''), 'Uncategorized')`;
const BRAND_SQL = `COALESCE(NULLIF(TRIM(brand), ''), 'Taparia')`;

function buildFilter({ id, category = 'ALL', subCategory = 'ALL', brand = 'ALL', search = '' }) {
  let where = 'WHERE 1=1';
  const args = [];
  const add = (condition, value) => {
    where += ` AND ${condition}`;
    args.push(value);
  };

  if (id) add('id = ?', id);
  if (category && category !== 'ALL') add(`${CATEGORY_SQL} = ?`, category);
  if (subCategory && subCategory !== 'ALL') add('sub_category = ?', subCategory);
  if (brand && brand !== 'ALL') add(`${BRAND_SQL} = ?`, brand);

  const term = String(search || '').trim().toLowerCase();
  if (term) {
    const text = (cols) => `LOWER(${cols.map((c) => `COALESCE(${c}, '')`).join(" || ' ' || ")})`;
    where += ` AND (
      INSTR(${text(['name', 'brand', 'category_name', 'sub_category', 'series', 'finish', 'description'])}, ?) > 0
      OR id IN (
        SELECT product_id FROM product_variants
        WHERE INSTR(${text(['size', 'opening', 'finish', 'packaging', 'sku', 'custom_specs'])}, ?) > 0
      )
    )`;
    args.push(term, term);
  }

  return { where, args };
}

// Without "limit" this returns every matching product (used by the admin panel)
async function getAllSortedProducts({ sort, limit, offset = 0, ...filters } = {}) {
  const db = await getDb();
  const { where, args } = buildFilter(filters);
  const order = `ORDER BY ${Object.hasOwn(ORDER_BY, sort) ? ORDER_BY[sort] : ORDER_BY.default}`;
  const page = limit ? 'LIMIT ? OFFSET ?' : '';
  const pageArgs = limit ? [...args, limit, offset] : args;

  const [prodResult, varResult] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM products ${where} ${order} ${page}`,
      args: pageArgs,
    }),
    db.execute({
      sql: `
        SELECT product_id, size, opening, finish, packaging, sku, mrp, discount_percent, gst_percent, price_tax_mode, price, stock, custom_specs
        FROM product_variants
        WHERE product_id IN (SELECT id FROM products ${where} ${limit ? `${order} ${page}` : ''})
        ORDER BY id ASC
      `,
      args: pageArgs,
    }),
  ]);

  const byProduct = new Map();
  for (const v of rowsToObjects(varResult)) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  }

  return rowsToObjects(prodResult).map((p) => {
    const variants = (byProduct.get(p.id) || []).map((v) => ({
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

    return {
      ...p,
      brand: p.brand || 'Taparia',
      sub_category: p.sub_category || '',
      discount_percent: Number(p.discount_percent) || 0,
      gst_percent: Number(p.gst_percent ?? 18) || 0,
      variants,
    };
  });
}

async function countProducts(filters = {}) {
  const db = await getDb();
  const { where, args } = buildFilter(filters);
  const res = await db.execute({ sql: `SELECT COUNT(*) AS total FROM products ${where}`, args });
  return Number(rowsToObjects(res)[0]?.total) || 0;
}

// Product counts used to build the category, subcategory and brand filters
async function getFacets() {
  const db = await getDb();
  const res = await db.execute(`
    SELECT ${CATEGORY_SQL} AS category, COALESCE(sub_category, '') AS sub_category,
           ${BRAND_SQL} AS brand_name, COUNT(*) AS total
    FROM products
    GROUP BY 1, 2, 3
  `);
  return rowsToObjects(res).map((r) => ({
    category: r.category,
    sub_category: r.sub_category,
    brand: r.brand_name,
    total: Number(r.total) || 0,
  }));
}

async function createProduct(tool) {
  const db = await getDb();
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
  countProducts,
  getFacets,
  createProduct,
  deleteProduct,
  getSortedCategories,
};