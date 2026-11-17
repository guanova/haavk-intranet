/* ==========================================================================
   server/api/media.js — 头像上传 / 删除 / 媒体文件服务
   头像链路（从机制上根除"头像全丢"）：
     1) 上传经魔数校验 + 尺寸解析，落盘到 data/uploads/avatars/{sha256前16位}.{ext}
     2) 用户表只存 uploads.id，接口统一返回 avatarUrl
     3) 未设置头像 → 返回 /media/default-avatar.svg（由服务端提供，永不 404）
     4) /media/* 走长缓存 + ETag；前端 <img> 还有 onerror 兜底
   ========================================================================== */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { get, run, withTx } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import {
  assertSameOrigin,
  imageSize,
  mimeOf,
  parseMultipart,
  sendFile,
  sendOk,
  sniffImageMime
} from "../lib/http.js";
import { findUserById, publicUser, requireAuth } from "../lib/auth.js";
import { UPLOAD } from "../constants.js";
import { hit } from "../lib/ratelimit.js";

export function uploadDir() {
  const dir = process.env.HAAVK_UPLOAD_DIR || path.resolve(process.cwd(), "data/uploads/avatars");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** POST /api/me/avatar */
export async function uploadAvatar(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);

  const limit = hit(`avatar:user:${user.id}`, UPLOAD.MAX_PER_HOUR, 3600_000);
  if (!limit.allowed) throw AppError.rateLimited("头像上传过于频繁，请稍后再试", limit.retryAfter);

  // 先自行读取并校验体积，避免超限时读到一半就断开连接导致客户端拿到 "fetch failed"
  const { file } = await parseMultipart(ctx.req, UPLOAD.MAX_BYTES + 1024 * 1024);
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw AppError.badRequest("未接收到图片文件", { fields: { file: "请选择图片" } });
  }
  if (file.buffer.length > UPLOAD.MAX_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", `图片不能超过 ${Math.round(UPLOAD.MAX_BYTES / 1024 / 1024)}MB`);
  }

  // 以魔数为准，不信任客户端 Content-Type
  const mime = sniffImageMime(file.buffer);
  if (!mime || !UPLOAD.ALLOWED_MIME.includes(mime)) {
    throw new AppError("UNSUPPORTED_MEDIA", "仅支持 PNG / JPG / WEBP 格式的图片");
  }

  const { width, height } = imageSize(file.buffer, mime);
  if (width && height) {
    if (width < 32 || height < 32) throw AppError.badRequest("图片尺寸过小，最小 32×32");
    if (width > 4096 || height > 4096) throw AppError.badRequest("图片尺寸过大，最大 4096×4096");
  }

  const digest = crypto.createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
  const ext = EXT_BY_MIME[mime];
  const storedName = `${digest}.${ext}`;
  const dir = uploadDir();
  const abs = path.join(dir, storedName);

  if (!fs.existsSync(abs)) {
    const tmp = `${abs}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, file.buffer);
    fs.renameSync(tmp, abs); // 原子落盘，避免读到半个文件
  }

  const uploadId = withTx(() => {
    let row = get("SELECT id FROM uploads WHERE stored_name = ?", storedName);
    if (row) {
      run("UPDATE uploads SET deleted_at = NULL WHERE id = ?", row.id);
    } else {
      const info = run(
        `INSERT INTO uploads (user_id, kind, stored_name, mime, byte_size, width, height, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        user.id,
        "avatar",
        storedName,
        mime,
        file.buffer.length,
        width,
        height,
        Date.now()
      );
      row = { id: Number(info.lastInsertRowid) };
    }
    const previous = get("SELECT avatar_upload_id FROM users WHERE id = ?", user.id).avatar_upload_id;
    run("UPDATE users SET avatar_upload_id = ?, updated_at = ? WHERE id = ?", row.id, Date.now(), user.id);
    // 旧头像若无人引用则归档（软删除，磁盘文件保留以便回滚）
    if (previous && previous !== row.id) {
      const refs = get("SELECT COUNT(*) AS c FROM users WHERE avatar_upload_id = ?", previous).c;
      if (!refs) run("UPDATE uploads SET deleted_at = ? WHERE id = ?", Date.now(), previous);
    }
    return row.id;
  });

  run(
    "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
    user.id,
    "avatar.upload",
    "upload",
    String(uploadId),
    JSON.stringify({ storedName, byteSize: file.buffer.length, mime }),
    ctx.ip,
    Date.now()
  );

  return sendOk(ctx.res, { user: publicUser(findUserById(user.id)) }, 201);
}

/** DELETE /api/me/avatar */
export async function deleteAvatar(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const previous = get("SELECT avatar_upload_id FROM users WHERE id = ?", user.id).avatar_upload_id;
  withTx(() => {
    run("UPDATE users SET avatar_upload_id = NULL, updated_at = ? WHERE id = ?", Date.now(), user.id);
    if (previous) run("UPDATE uploads SET deleted_at = ? WHERE id = ?", Date.now(), previous);
  });
  return sendOk(ctx.res, { user: publicUser(findUserById(user.id)) });
}

/** GET /media/avatars/:name —— 长缓存 + ETag */
export function serveAvatar(ctx) {
  const name = path.basename(String(ctx.params.name || ""));
  if (!/^[a-f0-9]{16}\.(png|jpg|webp)$/i.test(name)) {
    // 非法名称一律回退到默认头像，绝不返回 404 破图
    return serveDefaultAvatar(ctx);
  }
  const abs = path.join(uploadDir(), name);
  const sent = sendFile(ctx.req, ctx.res, abs, { cacheSeconds: 31536000, contentType: mimeOf(abs) });
  if (!sent) return serveDefaultAvatar(ctx);
  return true;
}

/** GET /media/default-avatar.svg —— 服务端内置默认头像，永不 404 */
export function serveDefaultAvatar(ctx) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="默认头像">
  <rect width="96" height="96" fill="#e4e6e9"/>
  <circle cx="48" cy="38" r="16" fill="#b6bcc2"/>
  <path d="M16 96c0-18 14-30 32-30s32 12 32 30z" fill="#b6bcc2"/>
  <path d="M0 72h96M0 24h96" stroke="#ffffff" stroke-opacity=".5" stroke-width="1" fill="none"/>
</svg>`;
  const buf = Buffer.from(svg, "utf8");
  ctx.res.writeHead(200, {
    "Content-Type": "image/svg+xml",
    "Content-Length": buf.length,
    "Cache-Control": "public, max-age=86400"
  });
  ctx.res.end(buf);
  return true;
}
