// Draws the app icon (a green hex with a castle) as PNGs, with no image libraries.
// Used by vite.config.ts at build time so the repo doesn't need binary files.
import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const BG = rgb(0x0b1a2e);
const GRASS = rgb(0x6bb352);
const GRASS_EDGE = rgb(0x3f7d34);
const BLUE = rgb(0x3b82f6);
const DARK = rgb(0x1b1b1b);
const WHITE = rgb(0xffffff);
const GOLD = rgb(0xfacc15);

// Pointy-top hex of radius r centered at 0,0
function inHex(x, y, r) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  return ax <= (r * Math.sqrt(3)) / 2 && ay <= r - ax / Math.sqrt(3);
}
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const s = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = s(px, py, ax, ay, bx, by);
  const d2 = s(px, py, bx, by, cx, cy);
  const d3 = s(px, py, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// Color at a point in unit space (-1..1), everything kept inside the maskable safe zone
function colorAt(x, y) {
  if (inHex(x, y, 0.8)) {
    if (!inHex(x, y, 0.74)) return GRASS_EDGE;
    // castle, same shape as the in-game city icon
    const cy = 0.08;
    if (inRect(x, y, -0.34, cy - 0.12, 0.34, cy + 0.34)) {
      if (inRect(x, y, -0.27, cy - 0.05, 0.27, cy + 0.27)) {
        if (inRect(x, y, -0.07, cy + 0.08, 0.07, cy + 0.27)) return DARK; // door
        return BLUE;
      }
      return WHITE;
    }
    if (inTri(x, y, -0.4, cy - 0.11, 0, cy - 0.46, 0.4, cy - 0.11)) {
      return inTri(x, y, -0.32, cy - 0.14, 0, cy - 0.4, 0.32, cy - 0.14) ? BLUE : WHITE;
    }
    // crown
    const ky = cy - 0.5;
    if (
      inTri(x, y, -0.22, ky, -0.13, ky - 0.15, -0.04, ky) ||
      inTri(x, y, -0.08, ky, 0, ky - 0.2, 0.08, ky) ||
      inTri(x, y, 0.04, ky, 0.13, ky - 0.15, 0.22, ky) ||
      inRect(x, y, -0.22, ky, 0.22, ky + 0.04)
    ) return GOLD;
    return GRASS;
  }
  return BG;
}

export function iconPng(size) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 3; // supersampling for smooth edges
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((i + (sx + 0.5) / ss) / size) * 2 - 1;
          const y = ((j + (sy + 0.5) / ss) / size) * 2 - 1;
          const c = colorAt(x, y);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      const o = (j * size + i) * 4;
      px[o] = Math.round(r / n);
      px[o + 1] = Math.round(g / n);
      px[o + 2] = Math.round(b / n);
      px[o + 3] = 255;
    }
  }
  return encodePng(size, px);
}

export const ICONS = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };
