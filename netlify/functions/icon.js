// Serves the app icons as PNG. The artwork lives in the repo as icon-source.png (the full image Jason
// supplied); this crops the rounded tile out of it, shrinks it to each size, and caches the result.
const { PNG } = require('pngjs');
const { siteUrl } = require('./_lib');
// Crop box for the tile inside the 1254x1254 source, as fractions so a resized source still works.
const CROP = { x: 272 / 1254, y: 263 / 1254, size: 710 / 1254 };
const cache = {};
let source = null;

async function loadSource(event) {
  if (source) return source;
  const r = await fetch(siteUrl(event) + '/icon-source.png');
  if (!r.ok) throw new Error('icon-source.png not found (' + r.status + ')');
  source = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
  return source;
}

function cropResize(img, size) {
  const { width: W, height: H, data } = img;
  const cx = Math.round(CROP.x * W), cy = Math.round(CROP.y * H), cs = Math.round(CROP.size * Math.min(W, H));
  const out = new PNG({ width: size, height: size });
  const step = cs / size;
  for (let y = 0; y < size; y++) {
    const y0 = cy + Math.floor(y * step), y1 = Math.max(y0 + 1, cy + Math.floor((y + 1) * step));
    for (let x = 0; x < size; x++) {
      const x0 = cx + Math.floor(x * step), x1 = Math.max(x0 + 1, cx + Math.floor((x + 1) * step));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < H; yy++) for (let xx = x0; xx < x1 && xx < W; xx++) { const i = (yy * W + xx) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      const o = (y * size + x) * 4; out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(out).toString('base64');
}

exports.handler = async function (event) {
  const s = parseInt((event.queryStringParameters || {}).s, 10);
  const size = [180, 192, 512].includes(s) ? s : 192;
  try {
    if (!cache[size]) cache[size] = cropResize(await loadSource(event), size);
    return { statusCode: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }, body: cache[size], isBase64Encoded: true };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Icon error: ' + e.message };
  }
};
