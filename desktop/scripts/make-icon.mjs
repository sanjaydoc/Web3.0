// Generate the app icons (assets/icon.ico for Windows, assets/icon.png for Linux) from one SVG.
//
// Why this exists: a naive "pack a PNG per size" ICO can embed near-empty small images (Windows then
// shows a blank/generic shortcut icon, because the desktop + taskbar use the 16/32/48 sizes). This
// renders the W3 mark ONCE at high resolution with headless Chromium, downsamples it with proper
// alpha-weighted area averaging, and writes each ICO entry as an uncompressed 32-bit BMP DIB — the
// most universally compatible icon format.
//
// Run:  node scripts/make-icon.mjs   (needs the pre-installed Chromium; see CHROME below)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'assets');

// The W3 mark — white rounded tile, black outline, black serif "W3". Matches the dashboard theme.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <rect x="34" y="34" width="444" height="444" rx="96" ry="96" fill="#ffffff" stroke="#0d0d0f" stroke-width="24"/>
  <text x="256" y="298" text-anchor="middle" font-family="Newsreader, Georgia, 'Times New Roman', serif" font-size="230" font-weight="700" fill="#0d0d0f">W3</text>
</svg>`;

const CHROME =
  process.env.CHROME ||
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(
    (p) => existsSync(p),
  );
if (!CHROME) throw new Error('Chromium not found — set CHROME=/path/to/chrome');

// --- render the SVG to a PNG at `size` px via headless Chromium ------------------------------------
function renderPng(size) {
  const dir = mkdtempSync(join(tmpdir(), 'w3icon-'));
  const html = `<!doctype html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${size}px;height:${size}px;overflow:hidden;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${SVG.replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`)}</body></html>`;
  writeFileSync(join(dir, 'i.html'), html);
  const out = join(dir, 'i.png');
  execFileSync(
    CHROME,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--screenshot=${out}`,
      `--window-size=${size},${size}`,
      `file://${join(dir, 'i.html')}`,
    ],
    { stdio: 'ignore' },
  );
  return readFileSync(out);
}

// --- minimal PNG decoder (8-bit, non-interlaced, RGBA/RGB) → {w,h,rgba} ----------------------------
function decodePng(buf) {
  let p = 8; // skip signature
  let w = 0;
  let h = 0;
  let colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`bit depth ${data[8]} unsupported`);
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!ch) throw new Error(`color type ${colorType} unsupported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const rgba = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const x = raw[rp++];
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let recon = x;
      if (filter === 1) recon = x + a;
      else if (filter === 2) recon = x + b;
      else if (filter === 3) recon = x + ((a + b) >> 1);
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        recon = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = recon & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch;
      const d = (y * w + x) * 4;
      rgba[d] = cur[s];
      rgba[d + 1] = cur[s + 1];
      rgba[d + 2] = cur[s + 2];
      rgba[d + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { w, h, rgba };
}

// --- alpha-weighted area downsample from a source RGBA image to `size`×`size` ----------------------
function downsample(src, size) {
  const { w: sw, h: sh, rgba: s } = src;
  const out = Buffer.alloc(size * size * 4);
  const sxStep = sw / size;
  const syStep = sh / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sxStep);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sxStep));
      const y0 = Math.floor(y * syStep);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * syStep));
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          const al = s[i + 3] / 255;
          ar += s[i] * al;
          ag += s[i + 1] * al;
          ab += s[i + 2] * al;
          aa += s[i + 3];
          n++;
        }
      }
      const d = (y * size + x) * 4;
      const wsum = ar + ag + ab === 0 ? 0 : aa / 255; // total alpha weight
      out[d] = wsum ? Math.round(ar / wsum) : 0;
      out[d + 1] = wsum ? Math.round(ag / wsum) : 0;
      out[d + 2] = wsum ? Math.round(ab / wsum) : 0;
      out[d + 3] = Math.round(aa / n);
    }
  }
  return { w: size, h: size, rgba: out };
}

// --- encode one ICO entry as a 32-bit BMP DIB (BITMAPINFOHEADER + BGRA + AND mask) -----------------
function bmpDib(img) {
  const { w, h, rgba } = img;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(w, 4); // biWidth
  header.writeInt32LE(h * 2, 8); // biHeight = image + AND mask
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  const xor = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4; // BMP rows are bottom-up
      const d = (y * w + x) * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }
  const maskRow = (((w + 31) >> 5) * 4) | 0; // 1bpp, padded to 32-bit
  const and = Buffer.alloc(maskRow * h, 0); // fully opaque; alpha channel handles transparency
  return Buffer.concat([header, xor, and]);
}

// --- assemble the .ico ----------------------------------------------------------------------------
const SIZES = [256, 128, 64, 48, 32, 24, 16];
const base = decodePng(renderPng(1024));
const dibs = SIZES.map((sz) => bmpDib(sz === base.w ? base : downsample(base, sz)));

const dir = Buffer.alloc(6 + SIZES.length * 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // type = icon
dir.writeUInt16LE(SIZES.length, 4);
let offset = dir.length;
SIZES.forEach((sz, i) => {
  const o = 6 + i * 16;
  dir[o] = sz >= 256 ? 0 : sz; // 0 means 256
  dir[o + 1] = sz >= 256 ? 0 : sz;
  dir[o + 2] = 0; // palette
  dir[o + 3] = 0; // reserved
  dir.writeUInt16LE(1, o + 4); // planes
  dir.writeUInt16LE(32, o + 6); // bpp
  dir.writeUInt32LE(dibs[i].length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += dibs[i].length;
});
writeFileSync(resolve(assets, 'icon.ico'), Buffer.concat([dir, ...dibs]));

// Linux + macOS app icon — a clean 1024 PNG (electron-builder derives .icns / Linux sizes from it;
// macOS retina wants 1024).
writeFileSync(resolve(assets, 'icon.png'), renderPng(1024));

console.log(`✓ wrote assets/icon.ico (${SIZES.join(', ')}) and assets/icon.png (1024)`);
