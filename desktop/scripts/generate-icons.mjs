// Tauri 图标生成器（纯 Node.js，无外部依赖）
// 设计：蓝色圆角方形背景(#3B82F6) + 白色 C 字母居中
// 产出：32x32.png / 128x128.png / icon.ico / icon.icns
//
// 实现要点：
// - PNG：手写编码（签名 + IHDR + IDAT(zlib deflate) + IEND + CRC32）
// - ICO：ICONDIR + ICONDIRENTRY[] + 嵌入 PNG 数据（Vista+ 支持 PNG 编码）
// - ICNS：魔数 "icns" + 总大小 + 图标条目（icp5=32px / ic07=128px，PNG 载荷）
// - 像素：4x4 子采样抗锯齿，圆角矩形 + C 字母（环形开口在右侧）
//
// 经验参考：固定尺寸图标无需响应式转换（cf. 2026-09-12-svg-canvas-fixed-size-to-responsive）；
// 本实现直接像素渲染，不使用 SVG <defs>，故不涉及 gradient id 唯一性问题
// （cf. 2026-09-11-svg-defs-gradient-id-useid-unique）。

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'src-tauri', 'icons');

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- PNG chunk ----------
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ---------- PNG 编码（RGBA8） ----------
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 扫描线：每行前加 filter byte (0 = None)
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      raw[p++] = rgba[idx];
      raw[p++] = rgba[idx + 1];
      raw[p++] = rgba[idx + 2];
      raw[p++] = rgba[idx + 3];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 几何：圆角方形判定 ----------
function inRoundedRect(px, py, N, r) {
  if (px < 0 || px > N || py < 0 || py > N) return false;
  const left = r, right = N - r, top = r, bottom = N - r;
  let cx = px;
  if (px < left) cx = left;
  else if (px > right) cx = right;
  let cy = py;
  if (py < top) cy = top;
  else if (py > bottom) cy = bottom;
  if (cx === px && cy === py) return true;
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

// ---------- 几何：C 字母判定（环形，开口在右侧） ----------
function inLetterC(px, py, cx, cy, outerR, innerR, opening) {
  const dx = px - cx, dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > outerR * outerR) return false;
  if (d2 < innerR * innerR) return false;
  const ang = Math.atan2(dy, dx); // -PI..PI，0 朝右
  if (Math.abs(ang) < opening) return false; // 右侧开口
  return true;
}

// ---------- 渲染图标像素（4x4 子采样抗锯齿） ----------
function renderIcon(N) {
  const rgba = new Uint8Array(N * N * 4);
  const cx = N / 2, cy = N / 2;
  const cornerR = N * 0.18;
  const outerR = N * 0.34;
  const innerR = N * 0.20;
  const opening = 42 * Math.PI / 180; // 开口半角
  const bg = [59, 130, 246];   // #3B82F6
  const fg = [255, 255, 255];  // white
  const SS = 4;
  const total = SS * SS;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (inRoundedRect(px, py, N, cornerR)) {
            if (inLetterC(px, py, cx, cy, outerR, innerR, opening)) {
              r += fg[0]; g += fg[1]; b += fg[2]; a += 255;
            } else {
              r += bg[0]; g += bg[1]; b += bg[2]; a += 255;
            }
          }
        }
      }
      const idx = (y * N + x) * 4;
      rgba[idx]     = Math.round(r / total);
      rgba[idx + 1] = Math.round(g / total);
      rgba[idx + 2] = Math.round(b / total);
      rgba[idx + 3] = Math.round(a / total);
    }
  }
  return rgba;
}

// ---------- ICO 编码（嵌入多个 PNG） ----------
function encodeICO(entries) {
  // entries: [{ width, height, png: Buffer }]
  const count = entries.length;
  const headerSize = 6 + 16 * count;
  // 计算偏移
  let offset = headerSize;
  const dirEntries = [];
  for (const e of entries) {
    dirEntries.push({ ...e, offset });
    offset += e.png.length;
  }
  // ICONDIR
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);      // reserved
  dir.writeUInt16LE(1, 2);      // type = icon
  dir.writeUInt16LE(count, 4);  // count
  // ICONDIRENTRY[]
  const entryBufs = dirEntries.map(e => {
    const b = Buffer.alloc(16);
    b[0] = e.width >= 256 ? 0 : e.width;   // width (0 => 256)
    b[1] = e.height >= 256 ? 0 : e.height; // height
    b[2] = 0;   // colorCount
    b[3] = 0;   // reserved
    b.writeUInt16LE(1, 4);    // planes
    b.writeUInt16LE(32, 6);   // bitCount
    b.writeUInt32LE(e.png.length, 8);  // bytesInRes
    b.writeUInt32LE(e.offset, 12);     // imageOffset
    return b;
  });
  const data = Buffer.concat(entries.map(e => e.png));
  return Buffer.concat([dir, ...entryBufs, data]);
}

// ---------- ICNS 编码（嵌入多个 PNG） ----------
function encodeICNS(entries) {
  // entries: [{ type: string(4), png: Buffer }]
  const bodyParts = entries.map(e => {
    const typeBuf = Buffer.from(e.type, 'ascii');
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32BE(8 + e.png.length, 0);
    return Buffer.concat([typeBuf, sizeBuf, e.png]);
  });
  const body = Buffer.concat(bodyParts);
  const magic = Buffer.from('icns', 'ascii');
  const totalSize = Buffer.alloc(4);
  totalSize.writeUInt32BE(8 + body.length, 0);
  return Buffer.concat([magic, totalSize, body]);
}

// ---------- 主流程 ----------
function main() {
  mkdirSync(ICONS_DIR, { recursive: true });

  console.log('渲染 32x32 ...');
  const rgba32 = renderIcon(32);
  const png32 = encodePNG(32, 32, rgba32);

  console.log('渲染 128x128 ...');
  const rgba128 = renderIcon(128);
  const png128 = encodePNG(128, 128, rgba128);

  // PNG 文件
  writeFileSync(join(ICONS_DIR, '32x32.png'), png32);
  writeFileSync(join(ICONS_DIR, '128x128.png'), png128);

  // ICO（嵌入 32 与 128 两个 PNG 载荷）
  const ico = encodeICO([
    { width: 32, height: 32, png: png32 },
    { width: 128, height: 128, png: png128 },
  ]);
  writeFileSync(join(ICONS_DIR, 'icon.ico'), ico);

  // ICNS（icp5=32px, ic07=128px，PNG 载荷）
  const icns = encodeICNS([
    { type: 'icp5', png: png32 },
    { type: 'ic07', png: png128 },
  ]);
  writeFileSync(join(ICONS_DIR, 'icon.icns'), icns);

  console.log('\n生成完成：');
  console.log(`  32x32.png   ${png32.length} bytes`);
  console.log(`  128x128.png ${png128.length} bytes`);
  console.log(`  icon.ico    ${ico.length} bytes`);
  console.log(`  icon.icns   ${icns.length} bytes`);
  console.log(`\n输出目录：${ICONS_DIR}`);
}

main();