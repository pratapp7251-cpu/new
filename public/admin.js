// public/admin.js
const DEFAULT_CATEGORIES = [
  'Safety Products',
  'Construction Material',
  'Spanners & Wrenches',
  'Sockets & Ratchets',
  'Torque Wrenches',
  'Pliers & Cutters',
  'Screwdrivers & Testers',
  'VDE 1000V Insulated Tools',
  'Allen & Torx Keys',
  'Hammers & Chisels',
  'Pullers & Vices',
  'Files & Hacksaws',
  'Drill Bits & Abrasives',
  'Measuring Tools',
  'Tool Boxes & Jacks',
  'Non-Sparking Tools'
];

const DEFAULT_SUBCATEGORIES = {
  'Safety Products': ['Safety Shoes', 'Safety Helmets', 'Hand Gloves', 'Reflective Jackets', 'Eye & Ear Protection'],
  'Construction Material': ['Cement & Concrete', 'Fasteners & Anchors', 'Adhesives & Sealants', 'TMT & Structural', 'Waterproofing'],
  'Spanners & Wrenches': ['Adjustable Wrenches', 'Combination Spanners', 'Ring & Open Spanners', 'Torque Wrenches'],
  'Pliers & Cutters': ['Combination Pliers', 'Circlip Pliers', 'Long Nose Pliers', 'Side Cutters']
};

const DEFAULT_BRANDS = ['Taparia', 'Karam', '3M', 'Bosch', 'Hillson', 'Stanley', 'JK Files'];

const DEFAULT_FINISHES = [
  'Cr-V Satin Chrome',
  'Cr-V Mirror Polished',
  'Black Phosphate Gunmetal',
  'Phosphate Finish',
  'Chrome Plated',
  'PVC Coated',
  'VDE 1000V Insulated',
  'Beryllium-Copper (Be-Cu)',
  'Aluminum-Bronze (Al-Br)',
  'Drop Forged Alloy Steel'
];

const ADMIN = {
  isUnlocked: sessionStorage.getItem('toolyard_admin_unlocked') === 'true',
  currentImageData: '',
  categories: [...DEFAULT_CATEGORIES],
  customSpecColumns: [],
  tools: []
};

document.addEventListener('DOMContentLoaded', () => {
  renderFinishOptions();
  populateCategoryDropdowns();
  renderSubCategoryDatalist();
  renderBrandDatalist();
  resetUploadForm();
  setupDragAndDrop();
  updateAdminLockUI();
  if (ADMIN.isUnlocked) {
    fetchProductsFromSQLite();
  }
});

// --- PIN AUTH ---
function verifyAdminPin(e) {
  e.preventDefault();
  const entered = (document.getElementById('adminPinInput').value || '').replace(/\s+/g, '').toLowerCase();
  if (entered === 'admin1234') {
    ADMIN.isUnlocked = true;
    sessionStorage.setItem('toolyard_admin_unlocked', 'true');
    document.getElementById('pinErrorMsg').classList.add('hidden');
    document.getElementById('adminPinInput').value = '';
    updateAdminLockUI();
    fetchProductsFromSQLite();
    showToast('Admin Uploader Unlocked');
  } else {
    document.getElementById('pinErrorMsg').classList.remove('hidden');
  }
}

function lockAdminSession() {
  ADMIN.isUnlocked = false;
  sessionStorage.removeItem('toolyard_admin_unlocked');
  updateAdminLockUI();
}

function updateAdminLockUI() {
  const gate = document.getElementById('pinGateSection');
  const workspace = document.getElementById('adminWorkspace');
  const lockBtn = document.getElementById('lockSessionBtn');

  if (ADMIN.isUnlocked) {
    gate.classList.add('hidden');
    workspace.classList.remove('hidden');
    lockBtn.classList.remove('hidden');
    lockBtn.classList.add('flex');
  } else {
    gate.classList.remove('hidden');
    workspace.classList.add('hidden');
    lockBtn.classList.add('hidden');
    lockBtn.classList.remove('flex');
  }
}

// --- CATEGORIES, SUBCATEGORIES, BRANDS & FINISHES ---
function populateCategoryDropdowns(selected = '') {
  const formSel = document.getElementById('toolCategorySelect');
  const filterSel = document.getElementById('adminCatFilter');

  formSel.innerHTML = ADMIN.categories.map(c =>
    `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');

  filterSel.innerHTML = `<option value="ALL">All Categories (${ADMIN.categories.length})</option>` +
    ADMIN.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  renderSubCategoryDatalist();
}

function renderSubCategoryDatalist() {
  const cat = document.getElementById('toolCategorySelect')?.value || '';
  const dl = document.getElementById('subCategorySuggestions');
  if (!dl) return;

  const subs = new Set(DEFAULT_SUBCATEGORIES[cat] || []);
  ADMIN.tools.forEach(t => {
    if ((t.category_name || t.category) === cat && t.sub_category) {
      subs.add(t.sub_category);
    }
  });

  dl.innerHTML = Array.from(subs).map(s => `<option value="${escapeAttr(s)}"></option>`).join('');
}

function renderBrandDatalist() {
  const dl = document.getElementById('brandSuggestions');
  if (!dl) return;
  const brands = new Set(DEFAULT_BRANDS);
  ADMIN.tools.forEach(t => {
    if (t.brand) brands.add(t.brand);
  });
  dl.innerHTML = Array.from(brands).sort().map(b => `<option value="${escapeAttr(b)}"></option>`).join('');
}

function toggleCustomCategoryBox() {
  const box = document.getElementById('customCategoryBox');
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) document.getElementById('newCategoryNameInput').focus();
}

function addCustomCategory() {
  const input = document.getElementById('newCategoryNameInput');
  const name = input.value.trim();
  if (!name) return;
  if (!ADMIN.categories.includes(name)) {
    ADMIN.categories.push(name);
    ADMIN.categories.sort();
  }
  populateCategoryDropdowns(name);
  input.value = '';
  document.getElementById('customCategoryBox').classList.add('hidden');
  showToast(`Category "${name}" added`);
}

function getAllFinishes() {
  const custom = JSON.parse(localStorage.getItem('ty_custom_finishes') || '[]');
  return [...DEFAULT_FINISHES, ...custom];
}

function renderFinishOptions(selectedValue = 'Cr-V Satin Chrome') {
  const select = document.getElementById('toolFinishInput');
  const finishes = getAllFinishes();
  select.innerHTML = `<option value="">None / Not Applicable</option>` +
    finishes.map(f => `<option value="${escapeHtml(f)}" ${f === selectedValue ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('');
}

function toggleNewFinishBox() {
  const box = document.getElementById('newFinishBox');
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) document.getElementById('newFinishInput').focus();
}

function savePersonalFinish() {
  const input = document.getElementById('newFinishInput');
  const val = input.value.trim();
  if (!val) return;
  const custom = JSON.parse(localStorage.getItem('ty_custom_finishes') || '[]');
  if (!getAllFinishes().some(f => f.toLowerCase() === val.toLowerCase())) {
    custom.push(val);
    localStorage.setItem('ty_custom_finishes', JSON.stringify(custom));
  }
  renderFinishOptions(val);
  input.value = '';
  document.getElementById('newFinishBox').classList.add('hidden');
  showToast(`Added personal finish "${val}"`);
}

// --- IMAGE UPLOAD & COMPRESSION ---
function setupDragAndDrop() {
  const dz = document.getElementById('dropZone');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(evt => {
    dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add('border-amber-500'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove('border-amber-500'); });
  });
  dz.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) compressAndPreviewImage(file);
  });
}

function handleImageFileSelect(e) {
  const file = e.target.files[0];
  if (file) compressAndPreviewImage(file);
}

function handleImageUrlInput(url) {
  const trimmed = url.trim();
  if (trimmed) {
    ADMIN.currentImageData = trimmed;
    showImagePreview(trimmed);
  } else {
    clearUploadedImage();
  }
}

function compressAndPreviewImage(file) {
  const reader = new FileReader();
  reader.onload = event => {
    const img = new Image();
    img.onload = () => {
      const MAX = 500;
      let w = img.width;
      let h = img.height;
      if (w > h && w > MAX) { h = Math.round((h * MAX) / w); w = MAX; }
      else if (h > MAX) { w = Math.round((w * MAX) / h); h = MAX; }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      ADMIN.currentImageData = canvas.toDataURL('image/jpeg', 0.82);
      document.getElementById('toolImageUrlInput').value = '';
      showImagePreview(ADMIN.currentImageData);
      showToast('Image compressed & ready');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function showImagePreview(src) {
  document.getElementById('imagePreviewEl').src = src;
  document.getElementById('imagePreviewEl').classList.remove('hidden');
  document.getElementById('imagePlaceholderPrompt').classList.add('hidden');
  document.getElementById('removeImgBtn').classList.remove('hidden');
}

function clearUploadedImage() {
  ADMIN.currentImageData = '';
  document.getElementById('toolImageFile').value = '';
  document.getElementById('toolImageUrlInput').value = '';
  document.getElementById('imagePreviewEl').src = '';
  document.getElementById('imagePreviewEl').classList.add('hidden');
  document.getElementById('imagePlaceholderPrompt').classList.remove('hidden');
  document.getElementById('removeImgBtn').classList.add('hidden');
}

// --- CUSTOM SPEC COLUMNS ---
function addCustomSpecColumn(colNameArg = '') {
  const input = document.getElementById('newCustomColInput');
  const colName = (colNameArg || input.value || '').trim();
  if (!colName) return;

  if (!ADMIN.customSpecColumns.some(c => c.toLowerCase() === colName.toLowerCase())) {
    ADMIN.customSpecColumns.push(colName);
    renderCustomSpecColumnsChips();
    rebuildVariantRowsPreservingValues();
  }
  if (!colNameArg) input.value = '';
}

function removeCustomSpecColumn(colName) {
  ADMIN.customSpecColumns = ADMIN.customSpecColumns.filter(c => c !== colName);
  renderCustomSpecColumnsChips();
  rebuildVariantRowsPreservingValues();
}

function renderCustomSpecColumnsChips() {
  const list = document.getElementById('customSpecColumnsList');
  if (!list) return;
  if (!ADMIN.customSpecColumns.length) {
    list.innerHTML = `<span class="text-[11px] text-slate-500">No custom specification columns added yet.</span>`;
    return;
  }
  list.innerHTML = ADMIN.customSpecColumns.map(col => `
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-amber-500/40 text-xs text-amber-300 font-semibold">
      ${escapeHtml(col)}
      <button type="button" onclick="removeCustomSpecColumn('${escapeAttr(col)}')" class="text-slate-400 hover:text-red-400 font-bold">✕</button>
    </span>
  `).join('');
}

function parseCustomSpecs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : {};
  } catch (_) {
    return {};
  }
}

function formatINR(num) {
  return `₹${Number(num || 0).toLocaleString('en-IN', {
    minimumFractionDigits: Number(num) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

/**
 * Pricing rules:
 * - Discount is always applied on Ex-GST MRP.
 * - If taxMode === 'ex':
 *     exGstRate = exGstMrp * (1 - discPct/100)
 *     finalDisplayRate = exGstRate * (1 + gstPct/100)   <-- GST added on storefront
 * - If taxMode === 'inc':
 *     exGstMrp = rawMrp / (1 + gstPct/100)
 *     exGstRate = exGstMrp * (1 - discPct/100)
 *     finalDisplayRate = exGstRate * (1 + gstPct/100)   <-- matches entered Incl. GST after discount on Ex-GST
 */
function computeRowAmounts(row, fallbackDiscPct = 0, fallbackGstPct = 18) {
  const discInput = parseFloat(document.getElementById('toolDiscountInput')?.value);
  const discPct = !isNaN(discInput) ? Math.min(Math.max(discInput, 0), 99.99) : (Number(fallbackDiscPct) || 0);

  const rowGstRaw = row.querySelector('[data-field="gst_percent"]')?.value;
  const parsedRowGst = parseFloat(rowGstRaw);
  const gstPct = !isNaN(parsedRowGst) ? Math.max(parsedRowGst, 0) : (Number(fallbackGstPct) || 18);

  const taxMode = row.querySelector('[data-field="price_tax_mode"]')?.value === 'inc' ? 'inc' : 'ex';
  const mrpInput = parseFloat(row.querySelector('[data-field="mrp"]')?.value) || 0;
  const rateInput = parseFloat(row.querySelector('[data-field="price"]')?.value) || 0;

  let mrpExGst = 0;
  let rateExGst = 0;

  if (mrpInput > 0) {
    mrpExGst = taxMode === 'inc' && gstPct > 0
      ? mrpInput / (1 + gstPct / 100)
      : mrpInput;
    rateExGst = discPct > 0
      ? mrpExGst * (1 - discPct / 100)
      : mrpExGst;
  } else if (rateInput > 0) {
    if (taxMode === 'inc') {
      const rateInclInput = rateInput;
      const baseEx = gstPct > 0 ? rateInclInput / (1 + gstPct / 100) : rateInclInput;
      rateExGst = baseEx;
      mrpExGst = discPct > 0 ? baseEx / (1 - discPct / 100) : baseEx;
    } else {
      rateExGst = rateInput;
      mrpExGst = discPct > 0 ? rateInput / (1 - discPct / 100) : rateInput;
    }
  }

  mrpExGst = Number((mrpExGst || 0).toFixed(2));
  rateExGst = Number((rateExGst || 0).toFixed(2));
  const gstAmount = Number((rateExGst * (gstPct / 100)).toFixed(2));
  const rateInclGst = Number((rateExGst + gstAmount).toFixed(2));
  const mrpInclGst = Number((mrpExGst * (1 + gstPct / 100)).toFixed(2));

  return {
    discPct,
    gstPct,
    taxMode,
    mrpExGst,
    rateExGst,
    gstAmount,
    rateInclGst,
    mrpInclGst
  };
}

function recalculateAllVariantPrices() {
  const defaultDisc = parseFloat(document.getElementById('toolDiscountInput')?.value) || 0;
  const defaultGst = parseFloat(document.getElementById('toolGstInput')?.value) || 18;

  document.querySelectorAll('#variantsContainer .variant-row').forEach(row => {
    const mrpVal = parseFloat(row.querySelector('[data-field="mrp"]')?.value) || 0;
    const rateEl = row.querySelector('[data-field="price"]');
    const previewEl = row.querySelector('.var-gst-preview');
    const calc = computeRowAmounts(row, defaultDisc, defaultGst);

    if (mrpVal > 0 && rateEl) {
      rateEl.value = calc.rateExGst;
    }

    if (previewEl) {
      const modeText = calc.taxMode === 'inc'
        ? `Entered Incl. GST → Ex-GST: ${formatINR(calc.rateExGst)} | Final (Incl. ${calc.gstPct}% GST): ${formatINR(calc.rateInclGst)}`
        : `Entered Ex-GST: ${formatINR(calc.rateExGst)} + ${calc.gstPct}% GST (${formatINR(calc.gstAmount)}) = Storefront Total: ${formatINR(calc.rateInclGst)}`;
      previewEl.textContent = modeText;
    }
  });
}

function extractVariantsFromDom() {
  const defaultDisc = parseFloat(document.getElementById('toolDiscountInput')?.value) || 0;
  const defaultGst = parseFloat(document.getElementById('toolGstInput')?.value) || 18;

  return Array.from(document.querySelectorAll('#variantsContainer .variant-row')).map(row => {
    const getVal = f => (row.querySelector(`[data-field="${f}"]`)?.value || '').trim();
    const custom_specs = {};
    row.querySelectorAll('[data-custom-spec]').forEach(inp => {
      const key = inp.getAttribute('data-custom-spec');
      if (key) custom_specs[key] = inp.value.trim();
    });

    const calc = computeRowAmounts(row, defaultDisc, defaultGst);

    return {
      size: getVal('size'),
      opening: getVal('opening'),
      finish: getVal('finish'),
      packaging: getVal('packaging'),
      sku: getVal('sku'),
      mrpRaw: getVal('mrp'),
      enteredRateRaw: getVal('price'),
      price_tax_mode: calc.taxMode,
      gst_percent: calc.gstPct,
      discount_percent: calc.discPct,
      mrp: calc.mrpExGst,
      price: calc.rateExGst,
      rate_ex_gst: calc.rateExGst,
      rate_incl_gst: calc.rateInclGst,
      stock: getVal('stock') || 'In Stock',
      custom_specs
    };
  });
}

function rebuildVariantRowsPreservingValues() {
  const existing = extractVariantsFromDom().map(v => ({
    ...v,
    mrp: v.mrpRaw !== '' ? v.mrpRaw : '',
    price: v.enteredRateRaw !== '' ? v.enteredRateRaw : ''
  }));
  const container = document.getElementById('variantsContainer');
  container.innerHTML = '';
  if (existing.length) {
    existing.forEach(v => addVariantRow(v));
  } else {
    addVariantRow();
  }
}

// --- VARIANT ROWS & BULK GENERATOR ---
function addVariantRow(vOrSize = {}, skuArg = '', priceArg = '', stockArg = 'In Stock') {
  const v = typeof vOrSize === 'object' && vOrSize !== null
    ? vOrSize
    : { size: vOrSize, sku: skuArg, price: priceArg, stock: stockArg };

  const customMap = parseCustomSpecs(v.custom_specs);
  const defaultGst = parseFloat(document.getElementById('toolGstInput')?.value) || 18;
  const rowGst = v.gst_percent !== undefined && v.gst_percent !== '' ? v.gst_percent : defaultGst;
  const taxMode = v.price_tax_mode === 'inc' ? 'inc' : 'ex';

  const customInputsHtml = ADMIN.customSpecColumns.map(col => `
    <input type="text" data-custom-spec="${escapeAttr(col)}" value="${escapeAttr(customMap[col] || '')}"
      placeholder="${escapeAttr(col)}"
      class="px-2 py-1.5 rounded border border-amber-500/40 bg-slate-900 text-amber-200 placeholder-slate-500" />
  `).join('');

  const displayRate = v.price !== undefined && v.price !== '' ? v.price : '';
  const displayMrp = v.mrp !== undefined && v.mrp !== '' ? v.mrp : '';

  const container = document.getElementById('variantsContainer');
  const row = document.createElement('div');
  row.className = 'variant-row p-3 rounded-xl border border-slate-700 surface-subtle text-xs space-y-2';
  row.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <input type="text" data-field="size" value="${escapeAttr(v.size || '')}" placeholder="Size / Length (e.g. 150mm)"
        class="var-size px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-white" />
      <input type="text" data-field="opening" value="${escapeAttr(v.opening || '')}" placeholder="Opening / Cap. (e.g. 19mm)"
        class="var-opening px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-white" />
      <input type="text" data-field="finish" value="${escapeAttr(v.finish || '')}" placeholder="Finish (Phosphate/Chrome)"
        class="var-finish px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-white" />
      <input type="text" data-field="packaging" value="${escapeAttr(v.packaging || '')}" placeholder="Pkg (Blister/Bag/Std 10)"
        class="var-packaging px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-white" />
    </div>

    ${customInputsHtml ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${customInputsHtml}</div>` : ''}

    <div class="grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
      <input type="text" data-field="sku" value="${escapeAttr(v.sku || '')}" placeholder="Product No. / SKU"
        class="var-sku px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-white font-mono" />
      <input type="number" step="0.01" data-field="mrp" value="${escapeAttr(displayMrp)}" placeholder="MRP ₹"
        oninput="recalculateAllVariantPrices()"
        class="px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-white font-mono" />
      <input type="number" step="0.01" data-field="price" value="${escapeAttr(displayRate)}" placeholder="Rate ₹"
        oninput="recalculateAllVariantPrices()"
        class="var-price px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-amber-300 font-mono" />
      <select data-field="price_tax_mode" onchange="recalculateAllVariantPrices()"
        class="px-1.5 py-1.5 rounded border border-slate-700 bg-slate-900 text-amber-200 font-semibold">
        <option value="ex" ${taxMode === 'ex' ? 'selected' : ''}>Ex-GST (+GST)</option>
        <option value="inc" ${taxMode === 'inc' ? 'selected' : ''}>Incl. GST (No +GST)</option>
      </select>
      <div class="flex items-center gap-1">
        <input type="number" step="0.01" min="0" max="100" data-field="gst_percent" value="${escapeAttr(rowGst)}" placeholder="GST %"
          oninput="recalculateAllVariantPrices()" title="GST %"
          class="w-full px-2 py-1.5 rounded border border-slate-700 bg-slate-900 text-emerald-300 font-mono" />
        <span class="text-slate-400 font-bold">%</span>
      </div>
      <div class="flex items-center gap-1">
        <select data-field="stock" class="var-stock flex-1 px-1.5 py-1.5 rounded border border-slate-700 bg-slate-900 text-white">
          <option value="In Stock" ${v.stock !== 'Out of Stock' ? 'selected' : ''}>In Stock</option>
          <option value="Out of Stock" ${v.stock === 'Out of Stock' ? 'selected' : ''}>Out of Stock</option>
        </select>
        <button type="button" onclick="removeVariantRow(this)" title="Remove"
          class="px-2 py-1.5 rounded bg-red-950/60 text-red-300 hover:bg-red-900 font-bold">✕</button>
      </div>
    </div>

    <div class="var-gst-preview text-[11px] font-mono text-slate-400"></div>
  `;
  container.appendChild(row);
  recalculateAllVariantPrices();
}

function removeVariantRow(btn) {
  const container = document.getElementById('variantsContainer');
  if (container.children.length <= 1) {
    showToast('At least one variant row is required', true);
    return;
  }
  btn.closest('.variant-row').remove();
}

function extractFirstRowTemplate() {
  const firstRow = document.querySelector('#variantsContainer .variant-row');
  const defaultFinish = document.getElementById('toolFinishInput')?.value || '';
  const defaultGst = parseFloat(document.getElementById('toolGstInput')?.value) || 18;

  if (!firstRow) {
    return {
      firstSize: '',
      sku: '',
      mrp: '',
      price: '',
      price_tax_mode: 'ex',
      gst_percent: defaultGst,
      opening: '',
      finish: defaultFinish,
      packaging: '',
      stock: 'In Stock',
      custom_specs: {}
    };
  }

  const getVal = f => (firstRow.querySelector(`[data-field="${f}"]`)?.value ?? '').trim();
  const custom_specs = {};
  firstRow.querySelectorAll('[data-custom-spec]').forEach(inp => {
    const key = inp.getAttribute('data-custom-spec');
    if (key) custom_specs[key] = inp.value.trim();
  });

  return {
    firstSize: getVal('size'),
    sku: getVal('sku'),
    mrp: getVal('mrp'),
    price: getVal('price'),
    price_tax_mode: getVal('price_tax_mode') === 'inc' ? 'inc' : 'ex',
    gst_percent: getVal('gst_percent') !== '' ? getVal('gst_percent') : defaultGst,
    opening: getVal('opening'),
    finish: getVal('finish') || defaultFinish,
    packaging: getVal('packaging'),
    stock: getVal('stock') || 'In Stock',
    custom_specs
  };
}

function syncBulkGstToggleButton() {
  const btn = document.getElementById('bulkToggleGstModeBtn');
  if (!btn) return;

  const selects = Array.from(document.querySelectorAll('#variantsContainer [data-field="price_tax_mode"]'));
  if (!selects.length) {
    btn.textContent = 'Set All Sizes: Incl. GST';
    return;
  }

  // If every variant is already Incl. GST, offer switching all to Ex-GST; otherwise switch all to Incl. GST
  const allInc = selects.every(sel => sel.value === 'inc');
  btn.textContent = allInc ? 'Set All Sizes: Ex-GST' : 'Set All Sizes: Incl. GST';
}

function toggleAllVariantsTaxMode() {
  const selects = Array.from(document.querySelectorAll('#variantsContainer [data-field="price_tax_mode"]'));
  if (!selects.length) return;

  const allInc = selects.every(sel => sel.value === 'inc');
  const nextMode = allInc ? 'ex' : 'inc';

  selects.forEach(sel => {
    sel.value = nextMode;
  });

  recalculateAllVariantPrices();
  syncBulkGstToggleButton();
  showToast(
    nextMode === 'inc'
      ? `All ${selects.length} size variants set to Incl. GST`
      : `All ${selects.length} size variants set to Ex-GST`
  );
}

function buildPatternSku(templateSku, firstSize, newSize, brandPrefix) {
  const cleanFirstSize = String(firstSize || '').trim();
  const cleanNewSize = String(newSize || '').trim();

  if (templateSku) {
    // 1. If the first row's SKU contains the first row's size (e.g. "DEP 6*7" or "DEP 6 * 7"), replace it
    if (cleanFirstSize) {
      const escapedSize = cleanFirstSize.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      const sizeRegex = new RegExp(escapedSize, 'i');
      if (sizeRegex.test(templateSku)) {
        return templateSku.replace(sizeRegex, cleanNewSize);
      }
    }

    // 2. If the first row's SKU ends with a size/number pattern (e.g. "DEP 6*7" or "AK-2"), replace trailing size token
    const trailingTokenMatch = templateSku.match(/^(.*?)([a-zA-Z0-9]+(?:\s*[*xX]\s*[a-zA-Z0-9.]+)?)\s*$/);
    if (trailingTokenMatch) {
      const prefix = trailingTokenMatch[1];
      return `${prefix}${cleanNewSize}`;
    }

    // 3. Otherwise append the new size to the template SKU
    return `${templateSku} ${cleanNewSize}`.trim();
  }

  // Fallback if first row SKU was blank
  return `${brandPrefix}-${cleanNewSize.replace(/[^a-zA-Z0-9*xX]/g, '')}`;
}

function bulkGenerateSizeRows() {
  const input = document.getElementById('bulkSizesInput');
  const raw = (input?.value || '').trim();
  if (!raw) return;

  const sizes = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!sizes.length) return;

  const template = extractFirstRowTemplate();
  const brandPrefix = (document.getElementById('toolBrandInput')?.value || 'TY')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4) || 'TY';

  const container = document.getElementById('variantsContainer');
  container.innerHTML = '';

  sizes.forEach((sz, idx) => {
    const generatedSku =
      idx === 0 && template.sku
        ? template.sku
        : buildPatternSku(template.sku, template.firstSize, sz, brandPrefix);

    addVariantRow({
      size: sz,
      opening: template.opening,
      finish: template.finish,
      packaging: template.packaging,
      sku: generatedSku,
      mrp: template.mrp,
      price: template.price,
      price_tax_mode: template.price_tax_mode,
      gst_percent: template.gst_percent,
      stock: template.stock,
      custom_specs: { ...template.custom_specs }
    });
  });

  input.value = '';
  recalculateAllVariantPrices();
  showToast(`Generated ${sizes.length} variants using row 1 pattern`);
}

// --- SQLITE API OPERATIONS ---
async function fetchProductsFromSQLite() {
  try {
    const [prodRes, catRes] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/categories')
    ]);
    const prodData = await prodRes.json();
    const catData = await catRes.json();

    ADMIN.tools = Array.isArray(prodData.products) ? prodData.products : [];
    (catData.categories || []).forEach(c => {
      if (!ADMIN.categories.includes(c)) ADMIN.categories.push(c);
    });
    ADMIN.categories.sort();

    document.getElementById('storeCountBadge').textContent = ADMIN.tools.length;
    populateCategoryDropdowns();
    renderBrandDatalist();
    renderAdminInventory();
  } catch (err) {
    showToast('Could not fetch from SQLite server', true);
  }
}

async function saveToolEntry(e) {
  e.preventDefault();
  const editId = document.getElementById('editingToolId').value;
  const defaultFinish = document.getElementById('toolFinishInput').value;
  const discountPct = parseFloat(document.getElementById('toolDiscountInput').value) || 0;
  const defaultGstPct = parseFloat(document.getElementById('toolGstInput').value) || 0;

  const variants = extractVariantsFromDom()
    .map((v, idx) => {
      const hasAnyInput = v.size || v.opening || v.sku || v.mrpRaw !== '' || v.enteredRateRaw !== '';
      if (!hasAnyInput) return null;

      return {
        size: v.size || 'Standard',
        opening: v.opening || '',
        finish: v.finish || defaultFinish,
        packaging: v.packaging || '',
        sku: v.sku || `SKU-${Date.now().toString().slice(-4)}-${idx + 1}`,
        mrp: v.mrp,
        discount_percent: discountPct,
        gst_percent: v.gst_percent,
        price_tax_mode: v.price_tax_mode,
        price: v.price,
        rate_ex_gst: v.rate_ex_gst,
        rate_incl_gst: v.rate_incl_gst,
        stock: v.stock || 'In Stock',
        custom_specs: v.custom_specs || {}
      };
    })
    .filter(Boolean);

  if (variants.length === 0) {
    showToast('Add at least one variant with size, SKU, or price.', true);
    return;
  }

  const payload = {
    id: editId || `tool-${Date.now()}`,
    category: document.getElementById('toolCategorySelect').value,
    sub_category: document.getElementById('toolSubCategoryInput').value.trim(),
    brand: document.getElementById('toolBrandInput').value.trim(),
    name: document.getElementById('toolNameInput').value.trim(),
    series: document.getElementById('toolSeriesInput').value.trim(),
    finish: defaultFinish,
    discount_percent: discountPct,
    gst_percent: defaultGstPct,
    description: document.getElementById('toolDescInput').value.trim(),
    image: ADMIN.currentImageData,
    variants
  };

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to save product');

    resetUploadForm();
    await fetchProductsFromSQLite();
    showToast(editId ? `Updated "${payload.name}" in SQLite` : `Saved "${payload.name}" to SQLite & Storefront!`);
  } catch (err) {
    showToast(err.message, true);
  }
}

function editToolEntry(toolId) {
  const tool = ADMIN.tools.find(t => t.id === toolId);
  if (!tool) return;

  document.getElementById('editingToolId').value = tool.id;
  document.getElementById('formModeBadge').textContent = 'Editing Existing Tool';
  document.getElementById('formHeading').textContent = 'Edit Tool & Variants';
  document.getElementById('submitBtnText').textContent = 'Update Tool in SQLite';
  document.getElementById('cancelEditBtn').classList.remove('hidden');

  if (!ADMIN.categories.includes(tool.category_name)) ADMIN.categories.push(tool.category_name);
  populateCategoryDropdowns(tool.category_name);
  document.getElementById('toolSubCategoryInput').value = tool.sub_category || '';
  document.getElementById('toolBrandInput').value = tool.brand || '';
  renderFinishOptions(tool.finish || '');
  document.getElementById('toolDiscountInput').value = tool.discount_percent ?? 0;
  document.getElementById('toolGstInput').value = tool.gst_percent ?? 18;

  document.getElementById('toolNameInput').value = tool.name;
  document.getElementById('toolSeriesInput').value = tool.series || '';
  document.getElementById('toolDescInput').value = tool.description || '';

  if (tool.image) {
    ADMIN.currentImageData = tool.image;
    showImagePreview(tool.image);
  } else {
    clearUploadedImage();
  }

  const discoveredCols = new Set();
  (tool.variants || []).forEach(v => {
    const map = parseCustomSpecs(v.custom_specs);
    Object.keys(map).forEach(k => discoveredCols.add(k));
  });
  ADMIN.customSpecColumns = Array.from(discoveredCols);
  renderCustomSpecColumnsChips();

  const container = document.getElementById('variantsContainer');
  container.innerHTML = '';
  if (Array.isArray(tool.variants) && tool.variants.length) {
    tool.variants.forEach(v => addVariantRow({
      ...v,
      price_tax_mode: v.price_tax_mode === 'inc' ? 'inc' : 'ex'
    }));
  } else {
    addVariantRow();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteToolEntry(toolId) {
  await fetch(`/api/products/${encodeURIComponent(toolId)}`, { method: 'DELETE' });
  await fetchProductsFromSQLite();
  showToast('Deleted from SQLite');
}

function resetUploadForm() {
  document.getElementById('toolUploadForm').reset();
  document.getElementById('editingToolId').value = '';
  document.getElementById('formModeBadge').textContent = 'New Product Entry';
  document.getElementById('formHeading').textContent = 'Upload Tool to Catalogue';
  document.getElementById('submitBtnText').textContent = 'Save Tool & Publish to Storefront';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  document.getElementById('toolBrandInput').value = 'Taparia';
  document.getElementById('toolDiscountInput').value = '0';
  document.getElementById('toolGstInput').value = '18';
  ADMIN.customSpecColumns = [];
  renderCustomSpecColumnsChips();
  clearUploadedImage();
  renderFinishOptions();

  const container = document.getElementById('variantsContainer');
  container.innerHTML = '';
  addVariantRow();
}

async function importFromWebsiteUrl() {
  const urlInput = document.getElementById('scrapeUrlInput');
  const btn = document.getElementById('scrapeBtn');
  const url = urlInput.value.trim();
  if (!url) {
    showToast('Paste a product URL first', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Fetching...';

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not extract data');

    if (data.name) document.getElementById('toolNameInput').value = data.name;
    if (data.brand) document.getElementById('toolBrandInput').value = data.brand;
    if (data.description) document.getElementById('toolDescInput').value = data.description;
    if (data.image) {
      ADMIN.currentImageData = data.image;
      document.getElementById('toolImageUrlInput').value = data.image;
      showImagePreview(data.image);
    }

    const container = document.getElementById('variantsContainer');
    container.innerHTML = '';
    addVariantRow({
      size: 'Standard',
      opening: '',
      finish: document.getElementById('toolFinishInput').value || '',
      packaging: '',
      sku: data.sku || '',
      mrp: data.price || '',
      price: data.price || '',
      price_tax_mode: 'ex',
      gst_percent: parseFloat(document.getElementById('toolGstInput')?.value) || 18,
      stock: 'In Stock',
      custom_specs: data.specs || {}
    });

    urlInput.value = '';
    showToast('Product details extracted! Review and click Save.');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch Details';
  }
}

function renderAdminInventory() {
  const tbody = document.getElementById('adminInventoryBody');
  const search = (document.getElementById('adminSearchInput').value || '').trim().toLowerCase();
  const catFilter = document.getElementById('adminCatFilter').value;

  const filtered = ADMIN.tools.filter(t => {
    if (catFilter !== 'ALL' && t.category_name !== catFilter) return false;
    if (search) {
      const blob = `${t.name} ${t.brand || ''} ${t.category_name} ${t.sub_category || ''} ${t.series || ''} ${(t.variants || []).map(v => `${v.size} ${v.opening || ''} ${v.finish || ''} ${v.packaging || ''} ${v.sku} ${JSON.stringify(v.custom_specs || '')}`).join(' ')}`.toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-10 text-center text-slate-400">No tools saved in SQLite yet. Upload your first tool on the left!</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(tool => {
    const variants = tool.variants || [];
    const discPct = Number(tool.discount_percent ?? 0) || 0;

    const shownRates = variants.map(v => {
      const ex = Number(v.price) || 0;
      const g = Number(v.gst_percent ?? tool.gst_percent ?? 18) || 0;
      const mode = v.price_tax_mode === 'inc' ? 'inc' : 'ex';
      return mode === 'inc' ? ex : ex * (1 + g / 100);
    });

    const minR = shownRates.length ? Math.min(...shownRates) : 0;
    const maxR = shownRates.length ? Math.max(...shownRates) : 0;
    const rangeText = minR === maxR ? formatINR(minR) : `${formatINR(minR)} – ${formatINR(maxR)}`;

    const imgHtml = tool.image
      ? `<img src="${escapeAttr(tool.image)}" alt="" class="w-14 h-11 rounded-lg object-contain border border-slate-700/50 blueprint-bg p-1 shrink-0" />`
      : `<div class="w-14 h-11 rounded-lg border border-slate-800 blueprint-bg flex items-center justify-center text-[10px] text-slate-500 shrink-0">No Img</div>`;

    return `
      <tr class="hover:bg-slate-500/5 transition">
        <td class="py-3 px-3">
          <div class="flex items-center gap-3">
            ${imgHtml}
            <div class="min-w-0">
              <div class="font-bold text-xs sm:text-sm truncate max-w-[210px]">${escapeHtml(tool.name)}</div>
              <div class="text-[11px] font-mono text-amber-400">${escapeHtml([tool.brand, tool.series].filter(Boolean).join(' • '))}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-3">
          <div class="px-2 py-1 rounded-md text-[11px] font-semibold surface-subtle border inline-block">${escapeHtml(tool.category_name)}</div>
          ${tool.sub_category ? `<div class="text-[11px] text-slate-400 mt-1">${escapeHtml(tool.sub_category)}</div>` : ''}
        </td>
        <td class="py-3 px-3">
          <div class="font-mono font-bold text-amber-400">${rangeText}</div>
          <div class="text-[11px] text-slate-400 mt-0.5">${variants.length} var${discPct > 0 ? ` • ${discPct}% off Ex-GST` : ''}</div>
        </td>
        <td class="py-3 px-3 text-right">
          <div class="inline-flex items-center gap-1.5">
            <button type="button" onclick="editToolEntry('${escapeAttr(tool.id)}')" class="px-2.5 py-1.5 rounded-lg border surface-subtle hover:border-amber-500 text-xs font-semibold transition">Edit</button>
            <button type="button" onclick="deleteToolEntry('${escapeAttr(tool.id)}')" class="px-2.5 py-1.5 rounded-lg border surface-subtle hover:border-red-500 text-red-400 text-xs font-semibold transition">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function showToast(msg, isError = false) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg border flex items-center gap-2 transition-opacity ${
    isError ? 'bg-red-950 text-red-200 border-red-700' : 'bg-slate-900 text-white border-slate-700'
  }`;
  el.innerHTML = `<span class="w-2 h-2 rounded-full ${isError ? 'bg-red-500' : 'bg-amber-500'}"></span><span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 220); }, 2500);
}