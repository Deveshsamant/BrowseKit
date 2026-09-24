#!/usr/bin/env node
/**
 * Generates assets/icons/icon{16,32,48,128}.png with no dependencies:
 * shapes are rasterised from signed-distance functions with 4×4 supersampling
 * and encoded as PNG using node:zlib.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling per axis

/** Signed distance to a rounded rectangle centred at (cx, cy). Units: 0..1. */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const lerp = (a, b, t) => a + (b - a) * t;
const TOP = [99, 102, 241]; // #6366f1
const BOTTOM = [67, 56, 202]; // #4338ca

/** Colour at normalised point, or null when outside the icon. */
function shade(x, y) {
  if (sdRoundRect(x, y, 0.5, 0.5, 0.47, 0.47, 0.2) > 0) return null;
  // Glyph: three stacked "saved tab" bars, the last one shorter.
  const bars = [
    sdRoundRect(x, y, 0.5, 0.32, 0.27, 0.075, 0.05),
    sdRoundRect(x, y, 0.5, 0.5, 0.27, 0.075, 0.05),
    sdRoundRect(x, y, 0.41, 0.68, 0.18, 0.075, 0.05),
  ];
  if (Math.min(...bars) <= 0) return [255, 255, 255];
  const t = (x + y) / 2;
  return TOP.map((c, i) => lerp(c, BOTTOM[i], t));
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let pxX = 0; pxX < size; pxX += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const c = shade((pxX + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = (py * size + pxX) * 4;
      if (a > 0) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
      }
      px[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
