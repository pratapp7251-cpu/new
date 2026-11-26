// server/imageHelper.js
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');

function ensureImagesDir() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function slugifyProductName(name) {
  return (
    String(name || 'product-image')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'product-image'
  );
}

function extensionFromMimeOrUrl(mimeOrUrl) {
  const s = String(mimeOrUrl || '').toLowerCase();
  if (s.includes('png')) return '.png';
  if (s.includes('webp')) return '.webp';
  if (s.includes('gif')) return '.gif';
  const match = s.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i);
  if (match) return match[1].toLowerCase() === 'jpeg' ? '.jpg' : `.${match[1].toLowerCase()}`;
  return '.jpg';
}

function getUniqueFilename(baseSlug, ext) {
  ensureImagesDir();
  let candidate = `${baseSlug}${ext}`;
  let counter = 2;
  while (fs.existsSync(path.join(IMAGES_DIR, candidate))) {
    candidate = `${baseSlug}-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

/**
 * Downloads an http(s) image URL or decodes a data:image/...;base64,... string
 * and saves it to public/images/<product-name>.<ext>.
 * Returns the local public path (e.g. "/images/taparia-25mm-beveled-edge-chisel.jpg").
 */
async function saveImageLocallyByProductName(imageInput, productName) {
  if (!imageInput) return '';

  const trimmed = String(imageInput).trim();

  // Already saved locally under /images/
  if (trimmed.startsWith('/images/')) {
    return trimmed;
  }

  const baseSlug = slugifyProductName(productName);

  // Handle Base64 data URLs from browser compression
  if (trimmed.startsWith('data:image/')) {
    const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return trimmed;
    const ext = extensionFromMimeOrUrl(match[1]);
    const filename = getUniqueFilename(baseSlug, ext);
    const buffer = Buffer.from(match[2], 'base64');
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
    return `/images/${filename}`;
  }

  // Handle external http(s) URLs
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const res = await fetch(trimmed, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!res.ok) return trimmed;

      const contentType = res.headers.get('content-type') || '';
      const ext = extensionFromMimeOrUrl(contentType || trimmed);
      const filename = getUniqueFilename(baseSlug, ext);
      const arrayBuffer = await res.arrayBuffer();
      fs.writeFileSync(path.join(IMAGES_DIR, filename), Buffer.from(arrayBuffer));
      return `/images/${filename}`;
    } catch (_) {
      return trimmed;
    }
  }

  return trimmed;
}

module.exports = {
  saveImageLocallyByProductName,
  slugifyProductName,
  IMAGES_DIR
};