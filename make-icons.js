// Runs on every Netlify publish: cuts the rounded tile out of icon-source.png and saves real,
// ready-made icon files (iPhones need these to be instant, or they fall back to a screenshot).
const fs = require('fs');
const { PNG } = require('pngjs');
const CROP = { x: 272 / 1254, y: 263 / 1254, size: 710 / 1254 };
const img = PNG.sync.read(fs.readFileSync(__dirname + '/icon-source.png'));
const { width: W, height: H, data } = img;
const cx = Math.round(CROP.x * W), cy = Math.round(CROP.y * H), cs = Math.round(CROP.size * Math.min(W, H));
for (const size of [180, 192, 512]) {
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
  fs.writeFileSync(__dirname + '/appicon-' + size + '.png', PNG.sync.write(out));
  console.log('made appicon-' + size + '.png');
}
fs.copyFileSync(__dirname + '/appicon-180.png', __dirname + '/apple-touch-icon.png');
