// server/routes.js
const express = require('express');
const router = express.Router();
const cheerio = require('cheerio');
const {
  getAllSortedProducts,
  countProducts,
  getFacets,
  createProduct,
  deleteProduct,
  getSortedCategories
} = require('./productService');
const { saveImageLocallyByProductName } = require('./imageHelper');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractProductFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);

  // Check JSON-LD Product schema first (commonly used on e-commerce product pages)
  let ldProduct = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html());
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];
      const found = items.find(
        item => item && (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product')))
      );
      if (found) ldProduct = found;
    } catch (_) {}
  });

  // 1. Extract Product Name
  const name =
    (ldProduct && ldProduct.name) ||
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('title').text().trim() ||
    '';

  // 2. Extract Description
  const description =
    (ldProduct && ldProduct.description) ||
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    '';

  // 3. Extract Product Image & resolve relative paths
  let image =
    (ldProduct && (Array.isArray(ldProduct.image) ? ldProduct.image[0] : (ldProduct.image && ldProduct.image.url) || ldProduct.image)) ||
    $('meta[property="og:image"]').attr('content') ||
    $('img[src*="product"], .product-image img, img').first().attr('src') ||
    '';
  if (image && !image.startsWith('http')) {
    try {
      image = new URL(image, pageUrl).href;
    } catch (_) {}
  }

  // 4. Extract Price (checks JSON-LD offers, meta tags, itemprop, or common price elements)
  const offer = ldProduct && ldProduct.offers
    ? (Array.isArray(ldProduct.offers) ? ldProduct.offers[0] : ldProduct.offers)
    : null;

  // Add inside extractProductFromHtml(html, pageUrl) in server/routes.js
const brand =
  (ldProduct && (typeof ldProduct.brand === 'string' ? ldProduct.brand : ldProduct.brand?.name)) ||
  $('[itemprop="brand"]').text().trim() ||
  '';

const specs = {};
$('table tr, .spec-row, [class*="specification"] tr, [class*="spec"] li').each((_, el) => {
  const cells = $(el).find('th, td');
  if (cells.length >= 2) {
    const key = $(cells[0]).text().replace(/[:\s]+$/g, '').trim();
    const val = $(cells[1]).text().trim();
    if (key && val && key.length < 45 && val.length < 150) {
      specs[key] = val;
    }
  }
});

// Return brand & specs alongside name, description, image, price, sku:
// { name, brand: brand || specs['Brand'] || '', description, image, price, sku, specs }
  const rawPrice =
    (offer && (offer.price || offer.lowPrice)) ||
    $('meta[property="product:price:amount"]').attr('content') ||
    $('[itemprop="price"]').attr('content') ||
    $('[class*="price"], [id*="price"]').first().text() ||
    '';

  const price = parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) || 0;

  // 5. Extract SKU if present
  const sku =
    (ldProduct && (ldProduct.sku || ldProduct.mpn)) ||
    $('[itemprop="sku"]').text().trim() ||
    $('[class*="sku"]').first().text().replace(/sku[:\s]*/i, '').trim() ||
    '';

  return {
    name: String(name).trim(),
    description: String(description).trim(),
    image: String(image || '').trim(),
    price,
    sku: String(sku).trim()
  };
  
}

async function scrapeSingleProduct(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load page (Status ${response.status})`);
  }

  const html = await response.text();
  return extractProductFromHtml(html, url);
}

// Single URL scraper endpoint
router.post('/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Please provide a valid http/https URL.' });
    }

    const scraped = await scrapeSingleProduct(url);
    res.json(scraped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk URL scraper endpoint (optionally saves directly into SQLite)
router.post('/scrape-bulk', async (req, res) => {
  try {
    const { urls, category = 'Spanners & Wrenches', finish = 'Cr-V Satin Chrome', autoSave = true } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of URLs.' });
    }

    const cleanUrls = urls
      .map(u => String(u || '').trim())
      .filter(u => u.startsWith('http'));

    const results = [];

    for (let i = 0; i < cleanUrls.length; i++) {
      const url = cleanUrls[i];
      try {
        const scraped = await scrapeSingleProduct(url);
        const productName = scraped.name || 'Untitled Tool';
        let imagePath = scraped.image;

        if (imagePath) {
          imagePath = await saveImageLocallyByProductName(imagePath, productName);
        }

        const productPayload = {
          id: `tool-${Date.now()}-${i}`,
          category,
          name: productName,
          series: '',
          finish,
          description: scraped.description,
          image: imagePath,
          variants: [
            {
              size: 'Standard',
              sku: scraped.sku || `SKU-${Date.now().toString().slice(-4)}-${i + 1}`,
              price: scraped.price || 0,
              stock: 'In Stock'
            }
          ]
        };

        let saved = productPayload;
        if (autoSave) {
          saved = await createProduct(productPayload);
        }

        results.push({ url, ok: true, product: saved });
      } catch (err) {
        results.push({ url, ok: false, error: err.message });
      }

      if (i < cleanUrls.length - 1) {
        await sleep(700);
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One-time migration endpoint to download existing external product images locally
router.post('/migrate-images', async (req, res) => {
  try {
    const products = await getAllSortedProducts({ category: 'ALL', search: '' });
    const updated = [];

    for (const p of products) {
      if (p.image && !p.image.startsWith('/images/')) {
        const localPath = await saveImageLocallyByProductName(p.image, p.name);
        if (localPath !== p.image) {
          await createProduct({
            ...p,
            category: p.category_name,
            image: localPath
          });
          updated.push({ id: p.id, name: p.name, image: localPath });
        }
      }
    }

    res.json({ updatedCount: updated.length, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const categories = await getSortedCategories();
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products', async (req, res) => {
  try {
    const { id, category, subCategory, brand, search, sort } = req.query;
    const filters = { id, category, subCategory, brand, search };

    // no limit: return everything, as before
    if (!req.query.limit) {
      const products = await getAllSortedProducts({ ...filters, sort });
      return res.json({ products, total: products.length });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const [products, total] = await Promise.all([
      getAllSortedProducts({ ...filters, sort, limit, offset }),
      countProducts(filters)
    ]);
    res.json({ products, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/facets', async (req, res) => {
  try {
    res.json({ facets: await getFacets() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/products', async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.image) {
      payload.image = await saveImageLocallyByProductName(payload.image, payload.name);
    }
    const saved = await createProduct(payload);
    res.status(201).json({ product: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    await deleteProduct(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;