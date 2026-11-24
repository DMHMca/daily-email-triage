/**
 * Zero-dependency PNG PWA Icon Generator (Pure Node.js zlib)
 * Generates crisp 192x192, 512x512, and maskable 512x512 PNG icons
 * required for clean Chrome Android ("Add to Home screen") PWA installation.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIconRgba(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);

  const bg = [31, 78, 95, 255];      // #1F4E5F deep British slate-teal
  const card = [246, 244, 238, 255]; // #F6F4EE warm alabaster envelope
  const flap = [223, 217, 203, 255]; // #DFD9CB soft fold
  const badge = [31, 107, 72, 255];  // #1F6B48 draft-only emerald check
  const white = [255, 255, 255, 255];

  const pad = maskable ? 0.22 : 0.14;
  const left = size * pad;
  const right = size * (1 - pad);
  const top = size * (maskable ? 0.28 : 0.22);
  const bottom = size * (maskable ? 0.72 : 0.78);
  const midX = size * 0.5;
  const flapY = top + (bottom - top) * 0.48;
  const radius = size * (maskable ? 0 : 0.18);

  const badgeCx = right - size * 0.06;
  const badgeCy = bottom - size * 0.05;
  const badgeR = size * 0.12;

  const setPixel = (x, y, color) => {
    const i = (y * size + x) * 4;
    buf[i] = color[0];
    buf[i + 1] = color[1];
    buf[i + 2] = color[2];
    buf[i + 3] = color[3];
  };

  const inRoundedSquare = (x, y, r) => {
    if (r <= 0) return true;
    const dx = Math.max(r - x, 0, x - (size - 1 - r));
    const dy = Math.max(r - y, 0, y - (size - 1 - r));
    return dx * dx + dy * dy <= r * r;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!inRoundedSquare(x, y, radius)) {
        setPixel(x, y, [0, 0, 0, 0]);
        continue;
      }

      let color = bg;

      // Envelope body
      if (x >= left && x <= right && y >= top && y <= bottom) {
        color = card;
        // Envelope V-flap shading
        const progress = Math.abs(x - midX) / ((right - left) * 0.5);
        const vLineY = flapY - progress * (flapY - top);
        if (Math.abs(y - vLineY) < size * 0.018 && y >= top) {
          color = bg;
        } else if (y < vLineY) {
          color = flap;
        }
      }

      // Draft-only shield dot in bottom right
      const bdx = x - badgeCx;
      const bdy = y - badgeCy;
      const dist = Math.hypot(bdx, bdy);
      if (dist <= badgeR) {
        color = badge;
        // Simple white checkmark inside badge
        const nx = bdx / badgeR;
        const ny = bdy / badgeR;
        const onLeg1 = nx >= -0.45 && nx <= -0.05 && Math.abs(ny - (nx + 0.35)) < 0.14;
        const onLeg2 = nx >= -0.08 && nx <= 0.48 && Math.abs(ny - (-0.85 * nx + 0.22)) < 0.14;
        if (onLeg1 || onLeg2) {
          color = white;
        }
      }

      setPixel(x, y, color);
    }
  }

  return buf;
}

const iconsDir = path.resolve('docs/icons');
fs.mkdirSync(iconsDir, { recursive: true });

const specs = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

for (const spec of specs) {
  const rgba = renderIconRgba(spec.size, { maskable: spec.maskable });
  const png = encodePng(spec.size, spec.size, rgba);
  const outPath = path.join(iconsDir, spec.file);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
}
