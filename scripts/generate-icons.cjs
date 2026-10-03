#!/usr/bin/env node
'use strict';

/*
 * Dependency-free 2D canvas renderer for Film Lab's install icons.
 * Rasterizes the Juwain Haque (JH) mark from favicon.svg into square PNG icons.
 * Run with: node scripts/generate-icons.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'icons');
const SIZES = [192, 512];
const ANDROID_MIPMAPS = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

function rgba(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16)).concat(255);
}

class Canvas {
  constructor(size) {
    this.width = size;
    this.height = size;
    this.pixels = Buffer.alloc(size * size * 4);
  }

  fillRect(x, y, width, height, color) {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(this.width, Math.ceil(x + width));
    const bottom = Math.min(this.height, Math.ceil(y + height));
    const [red, green, blue, alpha] = rgba(color);
    for (let row = top; row < bottom; row++) {
      let offset = (row * this.width + left) * 4;
      for (let col = left; col < right; col++, offset += 4) {
        this.pixels[offset] = red;
        this.pixels[offset + 1] = green;
        this.pixels[offset + 2] = blue;
        this.pixels[offset + 3] = alpha;
      }
    }
  }

  fillPolygon(points, color) {
    const [red, green, blue, alpha] = rgba(color);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const y = points[i][1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const top = Math.max(0, Math.floor(minY));
    const bottom = Math.min(this.height, Math.ceil(maxY));
    for (let y = top; y < bottom; y++) {
      const scanY = y + 0.5;
      const intersections = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
          intersections.push(x1 + (scanY - y1) * (x2 - x1) / (y2 - y1));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const left = Math.max(0, Math.ceil(intersections[i] - 0.5));
        const right = Math.min(this.width, Math.ceil(intersections[i + 1] - 0.5));
        for (let x = left; x < right; x++) {
          const offset = (y * this.width + x) * 4;
          this.pixels[offset] = red;
          this.pixels[offset + 1] = green;
          this.pixels[offset + 2] = blue;
          this.pixels[offset + 3] = alpha;
        }
      }
    }
  }
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

function parseSvgPaths(svgSource) {
  const paths = [];
  const pathRegex = /<path\s+d="([^"]+)"\s+fill="([^"]+)"(?:\s+transform="translate\(([^,]+),([^)]+)\)")?/g;
  let match;
  while ((match = pathRegex.exec(svgSource)) !== null) {
    const [, d, fill, tx = '0', ty = '0'] = match;
    const offsetX = Number.parseFloat(tx);
    const offsetY = Number.parseFloat(ty);
    const tokens = d.match(/[MCZ]|-?\d+(?:\.\d+)?/g) || [];
    const points = [];
    let cx = 0;
    let cy = 0;
    let i = 0;
    while (i < tokens.length) {
      const cmd = tokens[i++];
      if (cmd === 'M') {
        cx = Number.parseFloat(tokens[i++]) + offsetX;
        cy = Number.parseFloat(tokens[i++]) + offsetY;
        points.push([cx, cy]);
      } else if (cmd === 'C') {
        const x1 = Number.parseFloat(tokens[i++]) + offsetX;
        const y1 = Number.parseFloat(tokens[i++]) + offsetY;
        const x2 = Number.parseFloat(tokens[i++]) + offsetX;
        const y2 = Number.parseFloat(tokens[i++]) + offsetY;
        const x3 = Number.parseFloat(tokens[i++]) + offsetX;
        const y3 = Number.parseFloat(tokens[i++]) + offsetY;
        const steps = 8;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          points.push([
            cubicPoint(cx, x1, x2, x3, t),
            cubicPoint(cy, y1, y2, y3, t),
          ]);
        }
        cx = x3;
        cy = y3;
      } else if (cmd === 'Z') {
        break;
      }
    }
    paths.push({ fill, points });
  }
  return paths;
}

const SVG_SOURCE = fs.readFileSync(path.join(ROOT_DIR, 'favicon.svg'), 'utf8');
const SVG_PATHS = parseSvgPaths(SVG_SOURCE);
const SVG_WIDTH = 3000;
const SVG_HEIGHT = 2400;

function drawBrandMark(size) {
  const supersample = 2;
  const hiSize = size * supersample;
  const hiCanvas = new Canvas(hiSize);
  hiCanvas.fillRect(0, 0, hiSize, hiSize, '#000000');

  // Center the 3000x2400 JH mark inside the square icon (matching favicon.png).
  const scale = hiSize / SVG_WIDTH;
  const drawHeight = SVG_HEIGHT * scale;
  const padY = (hiSize - drawHeight) / 2;

  for (const { fill, points } of SVG_PATHS) {
    const scaled = points.map(([x, y]) => [x * scale, padY + y * scale]);
    hiCanvas.fillPolygon(scaled, fill);
  }

  const out = new Canvas(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const idx = ((y * supersample + sy) * hiSize + (x * supersample + sx)) * 4;
          r += hiCanvas.pixels[idx];
          g += hiCanvas.pixels[idx + 1];
          b += hiCanvas.pixels[idx + 2];
        }
      }
      const count = supersample * supersample;
      const outIdx = (y * size + x) * 4;
      out.pixels[outIdx] = Math.round(r / count);
      out.pixels[outIdx + 1] = Math.round(g / count);
      out.pixels[outIdx + 2] = Math.round(b / count);
      out.pixels[outIdx + 3] = 255;
    }
  }
  return out;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function encodePNG(canvas) {
  const rowLength = canvas.width * 4;
  const scanlines = Buffer.alloc((rowLength + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const row = y * (rowLength + 1);
    scanlines[row] = 0; // PNG filter: None.
    canvas.pixels.copy(scanlines, row + 1, y * rowLength, (y + 1) * rowLength);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUTPUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, encodePNG(drawBrandMark(size)));
  console.log(`Generated ${file}`);
}

const androidResDir = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(androidResDir)) {
  for (const { dir, size } of ANDROID_MIPMAPS) {
    const targetDir = path.join(androidResDir, dir);
    if (!fs.existsSync(targetDir)) continue;
    const png = encodePNG(drawBrandMark(size));
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      fs.writeFileSync(path.join(targetDir, name), png);
    }
  }
}
