// public/storefront.js
let allProducts = [];
let allCategories = [];
let selectedCategory = 'ALL';
let cart = JSON.parse(localStorage.getItem('toolyard_cart') || '[]');

document.addEventListener('DOMContentLoaded', () => {
  loadStorefrontData();
  renderCart();

  document.getElementById('storeSearchInput')?.addEventListener('input', () => {
    renderProducts();
  });
});

async function loadStorefrontData() {
  const grid = document.getElementById('storeProductsGrid');
  if (grid) {
    grid.innerHTML = `<div class="col-span-full text-center py-10 text-sm text-slate-400">Loading catalogue from database...</div>`;
  }

  try {
    const [prodRes, catRes] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/categories')
    ]);

    const prodData = await prodRes.json();
    const catData = await catRes.json();

    allProducts = Array.isArray(prodData.products) ? prodData.products : [];
    allCategories = Array.isArray(catData.categories) ? catData.categories : [];

    renderCategoryPills();
    renderProducts();
  } catch (err) {
    console.error('Failed to load products:', err);
    if (grid) {
      grid.innerHTML = `<div class="col-span-full text-center py-10 text-sm text-red-400">Could not connect to server. Make sure the backend is running.</div>`;
    }
  }
}

function renderCategoryPills() {
  const container = document.getElementById('storeCategoryPills');
  if (!container) return;

  const categories = ['ALL', ...allCategories];
  container.innerHTML = categories.map(cat => {
    const active = selectedCategory === cat;
    const label = cat === 'ALL' ? 'All Uploaded Tools' : cat;
    return `
      <button type="button" onclick="selectCategory('${escapeHtml(cat)}')"
        class="px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
          active ? 'bg-amber-500 text-slate-950' : 'surface-card border hover:border-amber-500'
        }">
        ${escapeHtml(label)}
      </button>
    `;
  }).join('');
}

function selectCategory(cat) {
  selectedCategory = cat;
  renderCategoryPills();
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById('storeProductsGrid');
  if (!grid) return;

  const query = (document.getElementById('storeSearchInput')?.value || '').trim().toLowerCase();

  const filtered = allProducts.filter(item => {
    if (selectedCategory !== 'ALL' && item.category_name !== selectedCategory) return false;
    if (!query) return true;

    const variantMatch = (item.variants || []).some(v =>
      String(v.size).toLowerCase().includes(query) || String(v.sku).toLowerCase().includes(query)
    );
    const textBlob = `${item.name} ${item.category_name} ${item.series || ''} ${item.finish || ''} ${item.description || ''}`.toLowerCase();
    return textBlob.includes(query) || variantMatch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full surface-card border rounded-2xl p-10 text-center space-y-2">
        <div class="text-sm font-bold">No tools uploaded yet</div>
        <p class="text-xs text-slate-400">Go to the Admin Panel (<a href="/admin.html" class="text-amber-500 underline">admin.html</a>) to upload tools and images.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const variants = item.variants && item.variants.length ? item.variants : [{ size: 'Standard', sku: 'N/A', price: 0, stock: 'In Stock' }];
    const first = variants[0];

    const optionsHtml = variants.map((v, idx) =>
      `<option value="${idx}">${escapeHtml(v.size)} — ₹${Number(v.price).toLocaleString('en-IN')}</option>`
    ).join('');

    const imgHtml = item.image
      ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="max-h-full max-w-full object-contain" />`
      : `<span class="text-xs text-slate-400">No Image</span>`;

    return `
      <article class="product-card surface-card border rounded-2xl p-4 flex flex-col justify-between gap-3">
        <div class="space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">${escapeHtml(item.category_name)}</span>
            <span id="sku-${item.id}" class="font-mono text-[11px] text-slate-400">${escapeHtml(first.sku)}</span>
          </div>

          <div class="w-full h-36 rounded-xl border border-slate-800 blueprint-bg p-3 flex items-center justify-center">
            ${imgHtml}
          </div>

          <div>
            <div class="text-[11px] font-mono text-slate-400">${escapeHtml([item.series, item.finish].filter(Boolean).join(' • '))}</div>
            <h3 class="font-bold text-sm sm:text-base mt-0.5">${escapeHtml(item.name)}</h3>
            ${item.description ? `<p class="text-xs text-slate-400 mt-1">${escapeHtml(item.description)}</p>` : ''}
          </div>
        </div>

        <div class="pt-3 border-t border-slate-800 space-y-3">
          <select id="variant-${item.id}" onchange="onVariantChange('${item.id}', this.value)"
            class="w-full px-3 py-2 text-xs rounded-xl border surface-subtle font-semibold">
            ${optionsHtml}
          </select>

          <div class="flex items-center justify-between">
            <span id="price-${item.id}" class="font-mono font-extrabold text-lg text-amber-500">
              ₹${Number(first.price).toLocaleString('en-IN')}
            </span>
            <button type="button" onclick="addToCart('${item.id}')"
              class="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold">
              Add to Cart
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function onVariantChange(productId, idx) {
  const product = allProducts.find(p => p.id === productId);
  const variant = product?.variants?.[Number(idx)];
  if (!variant) return;

  document.getElementById(`sku-${productId}`).textContent = variant.sku;
  document.getElementById(`price-${productId}`).textContent = `₹${Number(variant.price).toLocaleString('en-IN')}`;
}

function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const selectEl = document.getElementById(`variant-${productId}`);
  const idx = selectEl ? Number(selectEl.value) : 0;
  const variant = product.variants[idx] || product.variants[0];
  const key = `${product.id}__${variant.sku}`;

  const existing = cart.find(c => c.key === key);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      key,
      name: product.name,
      size: variant.size,
      sku: variant.sku,
      price: Number(variant.price) || 0,
      image: product.image || '',
      qty: 1
    });
  }

  localStorage.setItem('toolyard_cart', JSON.stringify(cart));
  renderCart();
}

function renderCart() {
  const badge = document.getElementById('cartBadge');
  const container = document.getElementById('cartItemsContainer');
  const totalEl = document.getElementById('cartTotalDisplay');

  const totalCount = cart.reduce((sum, i) => sum + i.qty, 0);
  if (badge) badge.textContent = totalCount;
  if (!container || !totalEl) return;

  if (cart.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-xs text-slate-400">Your cart is empty.</div>`;
    totalEl.textContent = '₹ 0.00';
    return;
  }

  let total = 0;
  container.innerHTML = cart.map((item, idx) => {
    total += item.price * item.qty;
    return `
      <div class="p-3 rounded-xl surface-subtle border flex items-center justify-between gap-2 text-xs">
        <div>
          <div class="font-bold">${escapeHtml(item.name)}</div>
          <div class="font-mono text-amber-500">${escapeHtml(item.size)} (${escapeHtml(item.sku)})</div>
          <div class="font-mono text-slate-400">₹${item.price.toLocaleString('en-IN')} × ${item.qty}</div>
        </div>
        <button type="button" onclick="removeCartItem(${idx})" class="text-red-400 font-bold px-2">✕</button>
      </div>
    `;
  }).join('');

  totalEl.textContent = `₹ ${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function removeCartItem(idx) {
  cart.splice(idx, 1);
  localStorage.setItem('toolyard_cart', JSON.stringify(cart));
  renderCart();
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}