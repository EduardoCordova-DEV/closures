import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const size = 256;
const pixels = Buffer.alloc((size * 4 + 1) * size);
function distance(x, y, ax, ay, bx, by) {
  const fraction = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - fraction * (bx - ax), y - ay - fraction * (by - ay));
}
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const sums = [0, 0, 0, 0];
    for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
      const px = x + dx, py = y + dy;
      const cx = Math.max(62, Math.min(194, px)), cy = Math.max(62, Math.min(194, py));
      if (Math.hypot(px - cx, py - cy) > 50) continue;
      const tick = Math.min(distance(px, py, 72, 132, 110, 170), distance(px, py, 110, 170, 187, 84)) < 10;
      const color = tick ? [22, 61, 43] : [182, 239, 208];
      for (let channel = 0; channel < 3; channel++) sums[channel] += color[channel];
      sums[3] += 255;
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const coverage = sums[3] / 255;
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = coverage ? Math.round(sums[channel] / coverage) : 0;
    pixels[offset + 3] = Math.round(sums[3] / 4);
  }
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const header = Buffer.alloc(4), trailer = Buffer.alloc(4);
  header.writeUInt32BE(data.length); trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, body, trailer]);
}
const info = Buffer.alloc(13);
info.writeUInt32BE(size, 0); info.writeUInt32BE(size, 4); info[8] = 8; info[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", info), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
mkdirSync("assets", { recursive: true });
writeFileSync("assets/icon.png", png);
writeFileSync("assets/icon.ico", Buffer.concat([ico, png]));
