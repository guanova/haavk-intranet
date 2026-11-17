/* ==========================================================================
   server/tools/avatar-seed.js — 为演示账号生成默认头像
   背景：全新的站点如果没有头像，界面会显得残缺。这里用**纯 Node** 生成
         （不依赖任何图像库）一批扁平风格 PNG 头像，走与真实上传完全相同的
         落盘与登记路径（uploads 表 + data/uploads/avatars/），
         因此可以验证"头像链路"本身，而不是绕过它伪造 URL。
   用法：node server/tools/avatar-seed.js
   ========================================================================== */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.HAAVK_DB = process.env.HAAVK_DB || path.resolve(__dirname, "../../data/haavk.db");

const { get, run, withTx, getDb } = await import("../lib/db.js");
const { uploadDir } = await import("../api/media.js");

/* ------------------------------ 极简 PNG 编码器 ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 由 RGB 像素数组编码为 PNG（真彩色，无 alpha） */
function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const o = rowStart + 1 + x * 3;
      raw[o] = pixels[i];
      raw[o + 1] = pixels[i + 1];
      raw[o + 2] = pixels[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ------------------------------ 头像绘制 ------------------------------ */

const SIZE = 192;
const W = SIZE;
const H = SIZE;

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function mix(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/**
 * 生成一位员工的头像：
 *  · 背景为品牌色系渐变
 *  · 右下角斜切高光（与站点视觉语言一致）
 *  · 中间为人物剪影（头 + 肩），保证同一观感下可区分
 */
function drawAvatar({ bg, accent, skin, silhouette }) {
  const background = hexToRgb(bg);
  const ac = hexToRgb(accent);
  const sk = hexToRgb(skin);
  const sil = hexToRgb(silhouette);
  const px = new Uint8Array(W * H * 3);

  const headCy = Math.round(H * 0.4);
  const headR = Math.round(W * 0.19);
  const shoulderTop = Math.round(H * 0.62);
  const shoulderR = Math.round(W * 0.46);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 1) 渐变底
      let c = mix(background, ac, y / H * 0.5);

      // 2) 右下角斜切高光
      if (x * 0.6 + (H - y) > W * 0.82) c = mix(c, [255, 255, 255], 0.12);

      // 3) 肩部（椭圆下半部）
      const dxS = (x - W / 2) / shoulderR;
      const dyS = (y - shoulderTop) / (H * 0.42);
      if (y >= shoulderTop && dxS * dxS + dyS * dyS <= 1) c = sil;

      // 4) 头部
      const dxH = x - W / 2;
      const dyH = y - headCy;
      if (dxH * dxH + dyH * dyH <= headR * headR) c = sk;

      const i = (y * W + x) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
  }
  return Buffer.from(px);
}

/* ------------------------------ 落盘与登记 ------------------------------ */

/* 12 组色板：高管人数已超过 6 位，若只用 6 组会有两张头像完全相同、
   在同一条帖子流里看起来像同一个人。色相仍锁定在哈夫克的蓝灰区间。 */
const PALETTES = [
  { bg: "#1687e8", accent: "#3fb0ff", skin: "#f0d6c2", silhouette: "#1b1d20" },
  { bg: "#1e9bf0", accent: "#7fd0ff", skin: "#e8c9a8", silhouette: "#22252a" },
  { bg: "#2b2929", accent: "#4a5158", skin: "#e6c9ae", silhouette: "#101214" },
  { bg: "#0e7cd4", accent: "#39a9f5", skin: "#f2dcc8", silhouette: "#191b1e" },
  { bg: "#39404a", accent: "#6d757c", skin: "#e9cdb0", silhouette: "#14161a" },
  { bg: "#1a7fd5", accent: "#63c0ff", skin: "#efd3ba", silhouette: "#1d2024" },
  { bg: "#134f7a", accent: "#4d8fb8", skin: "#edcfb4", silhouette: "#12161a" },
  { bg: "#25617f", accent: "#6ba6c4", skin: "#f1d8c0", silhouette: "#161a1e" },
  { bg: "#3a4a5c", accent: "#7e93a8", skin: "#e7c8ac", silhouette: "#12151a" },
  { bg: "#0f6a8c", accent: "#43b3d4", skin: "#f0d5bd", silhouette: "#14181c" },
  { bg: "#4a3f52", accent: "#8b7f96", skin: "#ecd0b6", silhouette: "#181619" },
  { bg: "#20505f", accent: "#5e97a8", skin: "#eacdb2", silhouette: "#13171a" }
];

function assignAvatar(userId, palette) {
  const pixels = drawAvatar(palette);
  const png = encodePng(W, H, pixels);
  const digest = crypto.createHash("sha256").update(png).digest("hex").slice(0, 16);
  const storedName = `${digest}.png`;
  const dir = uploadDir();
  const abs = path.join(dir, storedName);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, png);

  return withTx(() => {
    let row = get("SELECT id FROM uploads WHERE stored_name = ?", storedName);
    if (row) {
      run("UPDATE uploads SET deleted_at = NULL WHERE id = ?", row.id);
    } else {
      const info = run(
        `INSERT INTO uploads (user_id, kind, stored_name, mime, byte_size, width, height, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        userId,
        "avatar",
        storedName,
        "image/png",
        png.length,
        W,
        H,
        Date.now()
      );
      row = { id: Number(info.lastInsertRowid) };
    }
    run("UPDATE users SET avatar_upload_id = ?, updated_at = ? WHERE id = ?", row.id, Date.now(), userId);
    return { uploadId: row.id, storedName, byteSize: png.length };
  });
}

/* ------------------------------ 执行 ------------------------------ */

const db = getDb();

/**
 * 先修复"悬空头像引用"：users.avatar_upload_id 指向不存在的 uploads 行
 * （例如 reset 清库后遗留），必须置空，否则下面的补齐逻辑会误判为"已有头像"。
 */
const dangling = db
  .prepare(
    `UPDATE users SET avatar_upload_id = NULL
      WHERE avatar_upload_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM uploads up
           WHERE up.id = users.avatar_upload_id AND up.deleted_at IS NULL
        )`
  )
  .run();
if (dangling.changes) {
  console.log(`[avatar-seed] 已修复 ${dangling.changes} 个悬空头像引用（指向已清理的上传记录）。`);
}

function listTargets(extraWhere = "1=1", params = []) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name
         FROM users u
         LEFT JOIN ai_officers o ON o.user_id = u.id
        WHERE u.avatar_upload_id IS NULL AND (${extraWhere})
        ORDER BY u.id`
    )
    .all(...params);
}

function assignTo(list, offset) {
  list.forEach((u, i) => {
    const palette = { ...PALETTES[(i + offset) % PALETTES.length] };
    const info = assignAvatar(u.id, palette);
    console.log(`  · ${u.display_name}（${u.username}）→ /media/avatars/${info.storedName}（${Math.round(info.byteSize / 1024)}KB）`);
  });
  return list.length;
}

// 1) 在职员工
const nEmp = assignTo(listTargets("u.role = 'employee' AND u.status = 'active'"), 0);

// 2) AI 高管（与"集团高管"身份匹配的深色板）
const nOff = assignTo(listTargets("o.id IS NOT NULL"), 3);

// 3) 网站管理员 / 秘书办（避免帖子与页脚出现灰头像）
const nStaff = assignTo(listTargets("u.role IN ('site_admin','chief_secretary')"), 1);

if (!nEmp && !nOff && !nStaff) {
  console.log("[avatar-seed] 所有账号均已有头像，无需处理。");
} else {
  console.log(`[avatar-seed] 完成：员工 ${nEmp} 位 · AI 高管 ${nOff} 位 · 管理账号 ${nStaff} 位。`);
}

getDb().close();
