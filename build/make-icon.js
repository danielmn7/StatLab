// Generates build/icon.png (256×256 RGBA) — a small StatLab logo, no image libs needed.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 256;
const buf = Buffer.alloc(S * S * 4);
function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const na = a / 255, ia = 1 - na;
  buf[i] = Math.round(r * na + buf[i] * ia);
  buf[i + 1] = Math.round(g * na + buf[i + 1] * ia);
  buf[i + 2] = Math.round(b * na + buf[i + 2] * ia);
  buf[i + 3] = Math.min(255, buf[i + 3] + a);
}
function rrect(x0, y0, x1, y1, rad, r, g, b, a) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let dx = 0, dy = 0;
    if (x < x0 + rad && y < y0 + rad) { dx = x0 + rad - x; dy = y0 + rad - y; }
    else if (x >= x1 - rad && y < y0 + rad) { dx = x - (x1 - rad - 1); dy = y0 + rad - y; }
    else if (x < x0 + rad && y >= y1 - rad) { dx = x0 + rad - x; dy = y - (y1 - rad - 1); }
    else if (x >= x1 - rad && y >= y1 - rad) { dx = x - (x1 - rad - 1); dy = y - (y1 - rad - 1); }
    if (dx * dx + dy * dy > rad * rad) continue;
    set(x, y, r, g, b, a);
  }
}

// teal rounded background
rrect(0, 0, S, S, 52, 13, 148, 136, 255);
// subtle darker footer band
rrect(28, 200, S - 28, 210, 5, 8, 90, 82, 120);
// three white bars of increasing height
const bars = [[62, 150], [108, 108], [154, 128]];
const barW = 40;
bars.forEach(([x, top]) => rrect(x, top, x + barW, 205, 6, 255, 255, 255, 235));
// a trend line + dot (blue)
function line(x0, y0, x1, y1, col) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let t = 0; t <= n; t++) {
    const x = Math.round(x0 + (x1 - x0) * t / n), y = Math.round(y0 + (y1 - y0) * t / n);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) set(x + dx, y + dy, col[0], col[1], col[2], 255);
  }
}
line(70, 120, 128, 78, [37, 99, 235]);
line(128, 78, 186, 96, [37, 99, 235]);
for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) if (dx * dx + dy * dy <= 36) set(186 + dx, 96 + dy, 37, 99, 235, 255);

// --- encode PNG ---
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('Wrote build/icon.png (' + png.length + ' bytes)');
