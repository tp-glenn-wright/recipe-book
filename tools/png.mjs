// Minimal PNG writer, so app icons can be generated at build time without an image
// library. Colour type 6 (RGBA), 8 bits per channel, one filter byte per row.

import zlib from 'node:zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/**
 * Render a square PNG.
 * `shade(x, y)` takes normalised coordinates in 0..1 and returns [r, g, b, a].
 * Each pixel is supersampled 3x3, which is enough to keep curves smooth at 180px.
 */
export function renderPng(size, shade) {
  const SAMPLES = 3;
  const rows = [];
  for (let py = 0; py < size; py += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          const [pr, pg, pb, pa] = shade(x, y);
          const alpha = pa / 255;
          r += pr * alpha;
          g += pg * alpha;
          b += pb * alpha;
          a += pa;
        }
      }
      // Colour was accumulated premultiplied by alpha, so divide it back out to get a
      // straight-alpha pixel. Guard the fully transparent case.
      const n = SAMPLES * SAMPLES;
      const offset = 1 + px * 4;
      const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
      row[offset] = a > 0 ? clamp((r * 255) / a) : 0;
      row[offset + 1] = a > 0 ? clamp((g * 255) / a) : 0;
      row[offset + 2] = a > 0 ? clamp((b * 255) / a) : 0;
      row[offset + 3] = clamp(a / n);
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
