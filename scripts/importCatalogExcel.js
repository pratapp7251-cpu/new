// scripts/importCatalogExcel.js
const path = require('path');
const XLSX = require('xlsx');
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const EXCEL_FILE_PATH = path.resolve(
  process.cwd(),
  process.argv[2] || 'Taparia_Tools_Catalog_April2026.xlsx'
);

// Adjust defaults as needed before running
const DEFAULT_CATEGORY = 'Hand Tools';
const DEFAULT_BRAND = 'Taparia';
const DEFAULT_GST_PERCENT = 18;
const DEFAULT_DISCOUNT_PERCENT = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    // Strip trailing "Price Each ₹: ..." blobs if present inside specification text
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

function loadWorkbookData(filePath) {
  const wb = XLSX.readFile(filePath);

  const catalogSheet = wb.Sheets['Tools Catalog'];
  const skuSheet = wb.Sheets['All SKU Specifications'] || wb.Sheets[wb.SheetNames[0]];

  const catalogMetaMap = new Map();
  if (catalogSheet) {
    const rawCat = XLSX.utils.sheet_to_json(catalogSheet, { header: 1, defval: '' });
    // Header row is index 2 in Tools Catalog
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
  // Header row is index 2 in All SKU Specifications
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
        variants: []
      });
    }

    const parsedSpec = parseSpecString(specSize);
    const group = groupedProducts.get(groupKey);
    if (!group.description && rowDesc) {
      group.description = rowDesc;
    }

    group.variants.push({
      size: parsedSpec.size || productNo || 'Standard',
      opening: parsedSpec.opening,
      finish: parsedSpec.finish,
      packaging: parsedSpec.packaging || stdPkg,
      sku: productNo || `VAR-${group.variants.length + 1}`,
      mrp: priceEach,
      discount_percent: DEFAULT_DISCOUNT_PERCENT,
      gst_percent: DEFAULT_GST_PERCENT,
      price_tax_mode: 'ex',
      price: priceEach,
      stock: priceEach > 0 ? 'In Stock' : 'On Request',
      custom_specs: parsedSpec.custom_specs
    });
  }

  return Array.from(groupedProducts.values());
}

async function run() {
  console.log(`Reading file: ${EXCEL_FILE_PATH}`);
  const products = loadWorkbookData(EXCEL_FILE_PATH);
  console.log(`Found ${products.length} grouped products to upload.`);

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
      image: '',
      variants: item.variants.length
        ? item.variants
        : [{
            size: 'Standard',
            sku: `SKU-${i + 1}`,
            mrp: 0,
            price: 0,
            discount_percent: DEFAULT_DISCOUNT_PERCENT,
            gst_percent: DEFAULT_GST_PERCENT,
            price_tax_mode: 'ex',
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

run();