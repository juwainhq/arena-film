#!/usr/bin/env node
'use strict';

/*
 * Dependency-free 2D canvas renderer for Film Lab's install icons.
 * Run with: node scripts/generate-icons.cjs
 * The generated PNGs are committed so GitHub Pages needs no build runtime.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT_DIR = path.resolve(__dirname, '../icons');
const SIZES = [192, 512];
const COLORS = {
  background: '#0a0a0a',
  frame: '#f5f5f5',
  accent: '#d62828',
  shadow: '#686868',
};

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

  fillCircle(centerX, centerY, radius, color) {
    const top = Math.max(0, Math.floor(centerY - radius));
    const bottom = Math.min(this.height, Math.ceil(centerY + radius));
    const [red, green, blue, alpha] = rgba(color);
    const radiusSquared = radius * radius;
    for (let y = top; y < bottom; y++) {
      for (let x = Math.max(0, Math.floor(centerX - radius)); x < Math.min(this.width, Math.ceil(centerX + radius)); x++) {
        const dx = x + 0.5 - centerX;
        const dy = y + 0.5 - centerY;
        if (dx * dx + dy * dy > radiusSquared) continue;
        const offset = (y * this.width + x) * 4;
        this.pixels[offset] = red;
        this.pixels[offset + 1] = green;
        this.pixels[offset + 2] = blue;
        this.pixels[offset + 3] = alpha;
      }
    }
  }

  fillTriangle(points, color) {
    const [red, green, blue, alpha] = rgba(color);
    const minY = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))));
    const maxY = Math.min(this.height, Math.ceil(Math.max(...points.map(point => point[1]))));
    for (let y = minY; y < maxY; y++) {
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

function drawFilmFrame(size) {
  const canvas = new Canvas(size);
  const px = value => Math.round(value * size);
  canvas.fillRect(0, 0, size, size, COLORS.background);

  // Broad outer film strip with a centered, inset picture frame so the mark
  // remains legible when a platform applies a maskable-icon crop.
  canvas.fillRect(px(.11), px(.10), px(.78), px(.80), COLORS.frame);
  canvas.fillRect(px(.255), px(.145), px(.49), px(.71), COLORS.accent);
  canvas.fillRect(px(.282), px(.172), px(.436), px(.656), COLORS.background);

  // Film perforations on both rails.
  for (let index = 0; index < 5; index++) {
    const y = px(.17 + index * .14);
    canvas.fillRect(px(.145), y, px(.075), px(.075), COLORS.background);
    canvas.fillRect(px(.78), y, px(.075), px(.075), COLORS.background);
  }

  // A minimal still-life inside the frame: red sun and two clean mountain cuts.
  canvas.fillCircle(px(.59), px(.355), px(.075), COLORS.accent);
  canvas.fillTriangle([[px(.31), px(.735)], [px(.475), px(.49)], [px(.61), px(.735)]], COLORS.frame);
  canvas.fillTriangle([[px(.43), px(.735)], [px(.615), px(.535)], [px(.73), px(.735)]], COLORS.shadow);
  canvas.fillRect(px(.31), px(.735), px(.42), px(.027), COLORS.accent);
  return canvas;
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
    chunk('IDAT', zlib.deflateSync(scanlines, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUTPUT_DIR, {recursive: true});
for (const size of SIZES) {
  const file = path.join(OUTPUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, encodePNG(drawFilmFrame(size)));
  console.log(`Generated ${file}`);
}
