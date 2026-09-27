// Draws build/icon.png (512px): a small node-and-beam truss on a dark rounded tile.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 512;
const px = new Float32Array(S * S * 4);

function blend(x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const da = px[i + 3];
  const oa = a + da * (1 - a);
  for (const [k, c] of [[0, r], [1, g], [2, b]]) px[i + k] = (c * a + px[i + k] * da * (1 - a)) / (oa || 1);
  px[i + 3] = oa;
}

// Supersampled shape fill from a signed-distance function.
function fill(sdf, colour, alpha = 1) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (sdf(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4) <= 0) cover++;
      if (cover) blend(x, y, colour, (cover / 16) * alpha);
    }
}

const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  const qx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const qy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return Math.hypot(qx, qy) - r;
};
const segment = (ax, ay, bx, by, w) => (x, y) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - w / 2;
};
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

fill(roundRect(24, 24, 488, 488, 96), [22, 25, 32]);

// Truss: two rows of nodes with verticals and diagonals.
const top = [[120, 190], [256, 150], [392, 190]];
const bot = [[120, 350], [256, 380], [392, 350]];
const beams = [
  [top[0], top[1]], [top[1], top[2]], [bot[0], bot[1]], [bot[1], bot[2]],
  [top[0], bot[0]], [top[1], bot[1]], [top[2], bot[2]],
  [top[0], bot[1]], [top[1], bot[2]], [top[1], bot[0]], [top[2], bot[1]],
];
for (const [a, b] of beams) fill(segment(a[0], a[1], b[0], b[1], 14), [74, 144, 226]);
for (const [x, y] of [...top, ...bot]) {
  fill(circle(x, y, 30), [22, 25, 32]);
  fill(circle(x, y, 24), [240, 176, 64]);
}

// PNG encode.
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, o = y * (S * 4 + 1) + 1 + x * 4;
    for (let k = 0; k < 3; k++) raw[o + k] = Math.round(Math.min(255, px[i + k]));
    raw[o + 3] = Math.round(px[i + 3] * 255);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(new URL('../build/icon.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log('build/icon.png written');
