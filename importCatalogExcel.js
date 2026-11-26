<<<<<<< HEAD
// scripts/importCatalogExcel.js
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const EXCEL_FILE_PATH = path.resolve(
  process.cwd(),
  process.argv[2] || 'Taparia_Tools_Catalog_April2026.xlsx'
);
const IMAGE_MAP_PATH = path.resolve(process.cwd(), 'scripts/taparia_images.json');

const DEFAULT_CATEGORY = 'Hand Tools';
const DEFAULT_BRAND = 'Taparia';
const DEFAULT_GST_PERCENT = 18;
const DEFAULT_DISCOUNT_PERCENT = 0;
const DEFAULT_PRICE_TAX_MODE = 'inc';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadImageMap() {
  if (!fs.existsSync(IMAGE_MAP_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(IMAGE_MAP_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function cleanText(val) {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  return s === '-' || s.toLowerCase() === 'nan' ? '' : s;
}

function parsePrice(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const cleaned = String(val ?? '').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseSpecString(specText = '') {
  const specs = {};
  let size = '';
  let opening = '';
  let finish = '';
  let packaging = '';

  const parts = String(specText)
    .split(';')
    .map(p => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const cleanPart = part.replace(/Price Each\s*₹.*$/i, '').trim();
    if (!cleanPart) continue;

    const colonIdx = cleanPart.indexOf(':');
    if (colonIdx > -1) {
      const key = cleanPart.slice(0, colonIdx).trim();
      const val = cleanPart.slice(colonIdx + 1).trim();
      if (!key || !val) continue;

      specs[key] = val;

      const lk = key.toLowerCase();
      if (!size && (lk.includes('length') || lk === 'size')) {
        size = val;
      } else if (!opening && (lk.includes('opening') || lk.includes('capacity'))) {
        opening = val;
      } else if (!packaging && lk.includes('pkg')) {
        packaging = val;
      }
    } else if (!finish && /finish|plated|insulated|coated|phosphat/i.test(cleanPart)) {
      finish = cleanPart;
    }
  }

  return {
    size: size || 'Standard',
    opening,
    finish,
    packaging,
    custom_specs: specs
  };
}

function buildDiscountedExGstPrice(rawPrice, taxMode, discPct, gstPct) {
  const baseNum = Number(rawPrice) || 0;
  if (baseNum <= 0) return { mrp: 0, price: 0 };

  const exGstBase =
    taxMode === 'inc' && gstPct > 0
      ? baseNum / (1 + gstPct / 100)
      : baseNum;

  const discountedExGst =
    discPct > 0 ? exGstBase * (1 - discPct / 100) : exGstBase;

  return {
    mrp: Number(exGstBase.toFixed(2)),
    price: Number(discountedExGst.toFixed(2))
  };
}

function loadWorkbookData(filePath) {
  const wb = XLSX.readFile(filePath);
  const imageMap = loadImageMap();

  const catalogSheet = wb.Sheets['Tools Catalog'];
  const skuSheet = wb.Sheets['All SKU Specifications'] || wb.Sheets[wb.SheetNames[0]];

  const catalogMetaMap = new Map();
  if (catalogSheet) {
    const rawCat = XLSX.utils.sheet_to_json(catalogSheet, { header: 1, defval: '' });
    for (let r = 3; r < rawCat.length; r++) {
      const row = rawCat[r];
      const section = cleanText(row[1]);
      const toolName = cleanText(row[2]);
      const toolSpec = cleanText(row[4]);
      const description = cleanText(row[5]);
      if (section || toolName) {
        catalogMetaMap.set(`${section}__${toolName}`, { toolSpec, description });
      }
    }
  }

  const rawSku = XLSX.utils.sheet_to_json(skuSheet, { header: 1, defval: '' });
  let lastSection = '';
  let lastToolName = '';
  const groupedProducts = new Map();

  for (let r = 3; r < rawSku.length; r++) {
    const row = rawSku[r];
    const section = cleanText(row[0]) || lastSection;
    const toolName = cleanText(row[1]) || lastToolName;
    if (section) lastSection = section;
    if (toolName) lastToolName = toolName;

    const productNo = cleanText(row[2]);
    const specSize = cleanText(row[3]);
    const rowDesc = cleanText(row[4]);
    const stdPkg = cleanText(row[5]);
    const priceEach = parsePrice(row[6]);

    if (!toolName && !productNo) continue;

    const groupKey = `${section}__${toolName}`;
    if (!groupedProducts.has(groupKey)) {
      const meta = catalogMetaMap.get(groupKey) || {};
      groupedProducts.set(groupKey, {
        section,
        name: toolName || productNo,
        description: meta.description || rowDesc || meta.toolSpec || '',
        image: imageMap[groupKey] || '',
        variants: []
      });
    }

    const parsedSpec = parseSpecString(specSize);
    const group = groupedProducts.get(groupKey);
    if (!group.description && rowDesc) {
      group.description = rowDesc;
    }

    const priced = buildDiscountedExGstPrice(
      priceEach,
      DEFAULT_PRICE_TAX_MODE,
      DEFAULT_DISCOUNT_PERCENT,
      DEFAULT_GST_PERCENT
    );

    group.variants.push({
      size: parsedSpec.size || productNo || 'Standard',
      opening: parsedSpec.opening,
      finish: parsedSpec.finish,
      packaging: parsedSpec.packaging || stdPkg,
      sku: productNo || `VAR-${group.variants.length + 1}`,
      mrp: priced.mrp,
      discount_percent: DEFAULT_DISCOUNT_PERCENT,
      gst_percent: DEFAULT_GST_PERCENT,
      price_tax_mode: DEFAULT_PRICE_TAX_MODE,
      price: priced.price,
      stock: priceEach > 0 ? 'In Stock' : 'On Request',
      custom_specs: parsedSpec.custom_specs
    });
  }

  return Array.from(groupedProducts.values());
}

async function run() {
  console.log(`Reading file: ${EXCEL_FILE_PATH}`);
  const products = loadWorkbookData(EXCEL_FILE_PATH);
  const withImages = products.filter(p => p.image).length;
  console.log(`Found ${products.length} grouped products (${withImages} with images).`);

  let successCount = 0;
  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    const slug = `${item.section || 'sec'}-${item.name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);

    const payload = {
      id: `taparia-${slug}-${i + 1}`,
      category: DEFAULT_CATEGORY,
      sub_category: item.section || '',
      brand: DEFAULT_BRAND,
      name: item.name,
      series: item.section || '',
      finish: item.variants[0]?.finish || '',
      discount_percent: DEFAULT_DISCOUNT_PERCENT,
      gst_percent: DEFAULT_GST_PERCENT,
      description: item.description,
      image: item.image || '',
      variants: item.variants.length
        ? item.variants
        : [{
            size: 'Standard',
            sku: `SKU-${i + 1}`,
            mrp: 0,
            price: 0,
            discount_percent: DEFAULT_DISCOUNT_PERCENT,
            gst_percent: DEFAULT_GST_PERCENT,
            price_tax_mode: DEFAULT_PRICE_TAX_MODE,
            stock: 'In Stock',
            custom_specs: {}
          }]
    };

    try {
      await axios.post(`${API_BASE}/api/products`, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      successCount += 1;
      if (successCount % 25 === 0 || i === products.length - 1) {
        console.log(`Uploaded ${successCount}/${products.length}: "${payload.name}" (${payload.variants.length} variants)`);
      }
    } catch (err) {
      console.error(`Failed "${payload.name}": ${err.message}`);
    }

    await sleep(40);
  }

  console.log(`Done! Uploaded ${successCount} of ${products.length} products into SQLite.`);
}

=======
// scripts/importCatalogExcel.js
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const EXCEL_FILE_PATH = path.resolve(
  process.cwd(),
  process.argv[2] || 'Taparia_Tools_Catalog_April2026.xlsx'
);
const IMAGE_MAP_PATH = path.resolve(process.cwd(), 'scripts/taparia_images.json');

const DEFAULT_CATEGORY = 'Hand Tools';
const DEFAULT_BRAND = 'Taparia';
const DEFAULT_GST_PERCENT = 18;
const DEFAULT_DISCOUNT_PERCENT = 0;
const DEFAULT_PRICE_TAX_MODE = 'inc';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadImageMap() {
  if (!fs.existsSync(IMAGE_MAP_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(IMAGE_MAP_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function cleanText(val) {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  return s === '-' || s.toLowerCase() === 'nan' ? '' : s;
}

function parsePrice(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const cleaned = String(val ?? '').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseSpecString(specText = '') {
  const specs = {};
  let size = '';
  let opening = '';
  let finish = '';
  let packaging = '';

  const parts = String(specText)
    .split(';')
    .map(p => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const cleanPart = part.replace(/Price Each\s*₹.*$/i, '').trim();
    if (!cleanPart) continue;

    const colonIdx = cleanPart.indexOf(':');
    if (colonIdx > -1) {
      const key = cleanPart.slice(0, colonIdx).trim();
      const val = cleanPart.slice(colonIdx + 1).trim();
      if (!key || !val) continue;

      specs[key] = val;

      const lk = key.toLowerCase();
      if (!size && (lk.includes('length') || lk === 'size')) {
        size = val;
      } else if (!opening && (lk.includes('opening') || lk.includes('capacity'))) {
        opening = val;
      } else if (!packaging && lk.includes('pkg')) {
        packaging = val;
      }
    } else if (!finish && /finish|plated|insulated|coated|phosphat/i.test(cleanPart)) {
      finish = cleanPart;
    }
  }

  return {
    size: size || 'Standard',
    opening,
    finish,
    packaging,
    custom_specs: specs
  };
}

function buildDiscountedExGstPrice(rawPrice, taxMode, discPct, gstPct) {
  const baseNum = Number(rawPrice) || 0;
  if (baseNum <= 0) return { mrp: 0, price: 0 };

  const exGstBase =
    taxMode === 'inc' && gstPct > 0
      ? baseNum / (1 + gstPct / 100)
      : baseNum;

  const discountedExGst =
    discPct > 0 ? exGstBase * (1 - discPct / 100) : exGstBase;

  return {
    mrp: Number(exGstBase.toFixed(2)),
    price: Number(discountedExGst.toFixed(2))
  };
}

function loadWorkbookData(filePath) {
  const wb = XLSX.readFile(filePath);
  const imageMap = loadImageMap();

  const catalogSheet = wb.Sheets['Tools Catalog'];
  const skuSheet = wb.Sheets['All SKU Specifications'] || wb.Sheets[wb.SheetNames[0]];

  const catalogMetaMap = new Map();
  if (catalogSheet) {
    const rawCat = XLSX.utils.sheet_to_json(catalogSheet, { header: 1, defval: '' });
    for (let r = 3; r < rawCat.length; r++) {
      const row = rawCat[r];
      const section = cleanText(row[1]);
      const toolName = cleanText(row[2]);
      const toolSpec = cleanText(row[4]);
      const description = cleanText(row[5]);
      if (section || toolName) {
        catalogMetaMap.set(`${section}__${toolName}`, { toolSpec, description });
      }
    }
  }

  const rawSku = XLSX.utils.sheet_to_json(skuSheet, { header: 1, defval: '' });
  let lastSection = '';
  let lastToolName = '';
  const groupedProducts = new Map();

  for (let r = 3; r < rawSku.length; r++) {
    const row = rawSku[r];
    const section = cleanText(row[0]) || lastSection;
    const toolName = cleanText(row[1]) || lastToolName;
    if (section) lastSection = section;
    if (toolName) lastToolName = toolName;

    const productNo = cleanText(row[2]);
    const specSize = cleanText(row[3]);
    const rowDesc = cleanText(row[4]);
    const stdPkg = cleanText(row[5]);
    const priceEach = parsePrice(row[6]);

    if (!toolName && !productNo) continue;

    const groupKey = `${section}__${toolName}`;
    if (!groupedProducts.has(groupKey)) {
      const meta = catalogMetaMap.get(groupKey) || {};
      groupedProducts.set(groupKey, {
        section,
        name: toolName || productNo,
        description: meta.description || rowDesc || meta.toolSpec || '',
        image: imageMap[groupKey] || '',
        variants: []
      });
    }

    const parsedSpec = parseSpecString(specSize);
    const group = groupedProducts.get(groupKey);
    if (!group.description && rowDesc) {
      group.description = rowDesc;
    }

    const priced = buildDiscountedExGstPrice(
      priceEach,
      DEFAULT_PRICE_TAX_MODE,
      DEFAULT_DISCOUNT_PERCENT,
      DEFAULT_GST_PERCENT
    );

    group.variants.push({
      size: parsedSpec.size || productNo || 'Standard',
      opening: parsedSpec.opening,
      finish: parsedSpec.finish,
      packaging: parsedSpec.packaging || stdPkg,
      sku: productNo || `VAR-${group.variants.length + 1}`,
      mrp: priced.mrp,
      discount_percent: DEFAULT_DISCOUNT_PERCENT,
      gst_percent: DEFAULT_GST_PERCENT,
      price_tax_mode: DEFAULT_PRICE_TAX_MODE,
      price: priced.price,
      stock: priceEach > 0 ? 'In Stock' : 'On Request',
      custom_specs: parsedSpec.custom_specs
    });
  }

  return Array.from(groupedProducts.values());
}

async function run() {
  console.log(`Reading file: ${EXCEL_FILE_PATH}`);
  const products = loadWorkbookData(EXCEL_FILE_PATH);
  const withImages = products.filter(p => p.image).length;
  console.log(`Found ${products.length} grouped products (${withImages} with images).`);

  let successCount = 0;
  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    const slug = `${item.section || 'sec'}-${item.name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);

    const payload = {
      id: `taparia-${slug}-${i + 1}`,
      category: DEFAULT_CATEGORY,
      sub_category: item.section || '',
      brand: DEFAULT_BRAND,
      name: item.name,
      series: item.section || '',
      finish: item.variants[0]?.finish || '',
      discount_percent: DEFAULT_DISCOUNT_PERCENT,
      gst_percent: DEFAULT_GST_PERCENT,
      description: item.description,
      image: item.image || '',
      variants: item.variants.length
        ? item.variants
        : [{
            size: 'Standard',
            sku: `SKU-${i + 1}`,
            mrp: 0,
            price: 0,
            discount_percent: DEFAULT_DISCOUNT_PERCENT,
            gst_percent: DEFAULT_GST_PERCENT,
            price_tax_mode: DEFAULT_PRICE_TAX_MODE,
            stock: 'In Stock',
            custom_specs: {}
          }]
    };

    try {
      await axios.post(`${API_BASE}/api/products`, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      successCount += 1;
      if (successCount % 25 === 0 || i === products.length - 1) {
        console.log(`Uploaded ${successCount}/${products.length}: "${payload.name}" (${payload.variants.length} variants)`);
      }
    } catch (err) {
      console.error(`Failed "${payload.name}": ${err.message}`);
    }

    await sleep(40);
  }

  console.log(`Done! Uploaded ${successCount} of ${products.length} products into SQLite.`);
}

>>>>>>> 0285a09 (Update project files)
run();