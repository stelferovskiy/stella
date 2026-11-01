// Рисует графику установщика (24-bit BMP) в стиле Stella: тёмный фон, «звёздное ядро» с оранжевым свечением.
// Запуск: node build/gen-installer-art.js
const fs = require('fs');
const path = require('path');

function bmp(w, h, px) {
  const row = Math.ceil((w * 3) / 4) * 4, size = row * h, buf = Buffer.alloc(54 + size);
  buf.write('BM'); buf.writeUInt32LE(54 + size, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(size, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = px(x, y), o = 54 + (h - 1 - y) * row + x * 3;
    buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
  }
  return buf;
}
const BG = [8, 8, 13], ACC = [224, 135, 95], WARM = [255, 214, 170];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
const hash = (x, y) => { let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };

function art(w, h, cx, cy, R) {
  return (x, y) => {
    let c = BG;
    const d = Math.hypot(x - cx, y - cy);
    c = mix(c, [42, 22, 32], 1 - d / (R * 2.6));            // тёмно-вишнёвое гало (--glow)
    c = mix(c, ACC, Math.pow(Math.max(0, 1 - d / (R * 1.5)), 2.2) * 0.55);
    c = mix(c, WARM, Math.pow(Math.max(0, 1 - d / (R * 0.45)), 1.6));  // ядро
    if (y % 4 === 0) c = c.map((v) => Math.min(255, v + 3));          // линии как в интерфейсе
    if (hash(x, y) > 0.994) c = mix(c, [236, 234, 228], 0.7);         // редкие звёзды
    const ring = Math.abs(d - R * 1.05);                              // тонкое кольцо HUD
    if (ring < 0.7) c = mix(c, ACC, 0.45);
    return c;
  };
}
fs.writeFileSync(path.join(__dirname, 'installerSidebar.bmp'), bmp(164, 314, art(164, 314, 82, 130, 40)));
fs.writeFileSync(path.join(__dirname, 'installerHeader.bmp'), bmp(150, 57, art(150, 57, 118, 28, 16)));
console.log('ok');
