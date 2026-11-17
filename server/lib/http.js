/* ==========================================================================
   server/lib/http.js — HTTP 原语：请求体解析、响应、Cookie、静态文件、上传解析
   仅使用 node:http / node:fs / node:path，无第三方依赖。
   ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AppError } from "./errors.js";
import { UPLOAD } from "../constants.js";

/* ------------------------------ 响应 ------------------------------ */

export function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

export function sendOk(res, data = {}, status = 200) {
  sendJson(res, status, { ok: true, data });
}

export function sendError(res, err) {
  const isApp = err instanceof AppError;
  const code = isApp ? err.code : "INTERNAL";
  const status = isApp ? err.httpStatus : 500;
  const traceId = crypto.randomBytes(6).toString("hex");
  if (!isApp) {
    console.error(`[error] traceId=${traceId}`, err);
  }
  sendJson(res, status, {
    ok: false,
    error: {
      code,
      message: isApp ? err.message : "服务器内部错误，请稍后重试",
      details: isApp ? err.details : {},
      traceId
    }
  });
}

/* ------------------------------ 请求体 ------------------------------ */

export function readRawBody(req, maxBytes = UPLOAD.MAX_BYTES * 4) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (c) => {
      if (settled) return;
      size += c.length;
      if (size > maxBytes) {
        settled = true;
        // 注意：这里**不能** destroy 连接，否则客户端会收到 "fetch failed" 而不是 413。
        // 停止读取即可，由上层写出明确的错误响应。
        try {
          req.pause();
        } catch {
          /* ignore */
        }
        reject(new AppError("PAYLOAD_TOO_LARGE", `请求体超过上限（${Math.round(maxBytes / 1024 / 1024)}MB）`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

export async function readJsonBody(req, maxBytes = 256 * 1024) {
  const raw = await readRawBody(req, maxBytes);
  if (!raw.length) return {};
  const text = raw.toString("utf8");
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw AppError.badRequest("请求体必须是 JSON 对象");
    }
    return parsed;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.badRequest("请求体不是合法 JSON");
  }
}

/* ------------------------------ Cookie ------------------------------ */

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function buildSetCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  if (opts.secure || process.env.HAAVK_COOKIE_SECURE === "1") parts.push("Secure");
  if (opts.expires) parts.push("Expires=" + new Date(opts.expires).toUTCString());
  return parts.join("; ");
}

export function setCookieHeader(res, cookie) {
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(cookie);
  res.setHeader("Set-Cookie", list);
}

/* ------------------------------ 同源校验 ------------------------------ */

export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return; // 同源非 CORS 请求（如 curl/表单）不带 Origin，放行
  const host = req.headers.host || "";
  try {
    const o = new URL(origin);
    if (o.host !== host) throw AppError.forbidden("请求来源与本站不一致");
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.forbidden("请求来源不合法");
  }
}

/* ------------------------------ 静态文件 ------------------------------ */

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

export function mimeOf(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * 安全解析静态路径：拒绝穿越（..），返回绝对路径或 null
 */
export function resolveStatic(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const rel = decoded.replace(/^\/+/, "");
  const abs = path.resolve(rootDir, rel);
  const rootWithSep = path.resolve(rootDir) + path.sep;
  if (abs !== path.resolve(rootDir) && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

export function sendFile(req, res, filePath, { cacheSeconds = 0, contentType } = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const headers = {
    "Content-Type": contentType || mimeOf(filePath),
    "Content-Length": stat.size,
    ETag: etag,
    "X-Content-Type-Options": "nosniff"
  };
  if (cacheSeconds > 0) {
    headers["Cache-Control"] = `public, max-age=${cacheSeconds}, immutable`;
  } else {
    headers["Cache-Control"] = "no-cache";
  }

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": headers["Cache-Control"] });
    res.end();
    return true;
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/* ------------------------------ multipart 上传 ------------------------------ */

/**
 * 极简 multipart/form-data 解析器：只取第一个文件的字节与文件名。
 * 返回 { file?: {buffer, filename, declaredMime, fieldName}, fields: {} }
 */
export async function parseMultipart(req, maxBytes = UPLOAD.MAX_BYTES) {
  const ctype = req.headers["content-type"] || "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
  if (!m) throw AppError.badRequest("上传请求缺少 multipart boundary");
  const boundary = (m[1] || m[2]).trim();
  const body = await readRawBody(req, maxBytes + 4096);
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = 0;

  while (pos < body.length) {
    const start = body.indexOf(delim, pos);
    if (start < 0) break;
    const afterDelim = start + delim.length;
    // 结束标记 --
    if (body.slice(afterDelim, afterDelim + 2).toString() === "--") break;
    const headerEnd = body.indexOf("\r\n\r\n", afterDelim);
    if (headerEnd < 0) break;
    const headerText = body.slice(afterDelim, headerEnd).toString("utf8");
    const nextDelim = body.indexOf(delim, headerEnd + 4);
    if (nextDelim < 0) break;
    const contentEnd = nextDelim - 2; // 去掉 CRLF
    const content = body.slice(headerEnd + 4, contentEnd);
    parts.push({ headerText, content });
    pos = nextDelim;
  }

  const fields = {};
  let file = null;
  for (const p of parts) {
    const nameMatch = /name="([^"]*)"/i.exec(p.headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(p.headerText);
    const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(p.headerText);
    const fieldName = nameMatch ? nameMatch[1] : "";
    if (fileMatch) {
      if (!file) {
        file = {
          fieldName,
          filename: fileMatch[1],
          declaredMime: (mimeMatch ? mimeMatch[1] : "").trim(),
          buffer: p.content
        };
      }
    } else if (fieldName) {
      fields[fieldName] = p.content.toString("utf8");
    }
  }
  return { file, fields };
}

/**
 * 多文件 multipart 解析器（资料征集投稿用）：
 * 返回 { files: [{buffer, filename, declaredMime, fieldName}], fields: {} }
 * 与 parseMultipart 的区别是保留全部文件（files[] 命名字段均可）。
 */
export async function parseMultipartAll(req, maxBytes, maxFiles = 5) {
  const ctype = req.headers["content-type"] || "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
  if (!m) throw AppError.badRequest("上传请求缺少 multipart boundary");
  const boundary = (m[1] || m[2]).trim();
  const body = await readRawBody(req, maxBytes + 4096);
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = 0;
  while (pos < body.length) {
    const start = body.indexOf(delim, pos);
    if (start < 0) break;
    const afterDelim = start + delim.length;
    if (body.slice(afterDelim, afterDelim + 2).toString() === "--") break;
    const headerEnd = body.indexOf("\r\n\r\n", afterDelim);
    if (headerEnd < 0) break;
    const headerText = body.slice(afterDelim, headerEnd).toString("utf8");
    const nextDelim = body.indexOf(delim, headerEnd + 4);
    if (nextDelim < 0) break;
    const content = body.slice(headerEnd + 4, nextDelim - 2);
    parts.push({ headerText, content });
    pos = nextDelim;
  }
  const fields = {};
  const files = [];
  for (const p of parts) {
    const nameMatch = /name="([^"]*)"/i.exec(p.headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(p.headerText);
    const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(p.headerText);
    const fieldName = nameMatch ? nameMatch[1] : "";
    if (fileMatch) {
      if (p.content.length > 0) {
        files.push({
          fieldName,
          filename: fileMatch[1],
          declaredMime: (mimeMatch ? mimeMatch[1] : "").trim(),
          buffer: p.content
        });
      }
    } else if (fieldName) {
      fields[fieldName] = p.content.toString("utf8");
    }
  }
  if (files.length > maxFiles) {
    throw AppError.badRequest(`一次最多上传 ${maxFiles} 张图片`);
  }
  return { files, fields };
}

/** 由魔数判定图片类型（不信任客户端声明的 MIME） */
export function sniffImageMime(buf) {  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** 读取 PNG / JPEG / WebP 的宽高 */
export function imageSize(buf, mime) {
  try {
    if (mime === "image/png") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let off = 2;
      while (off < buf.length - 9) {
        if (buf[off] !== 0xff) {
          off++;
          continue;
        }
        const marker = buf[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        off += 2 + buf.readUInt16BE(off + 2);
      }
    }
    if (mime === "image/webp") {
      const fourcc = buf.slice(12, 16).toString("ascii");
      if (fourcc === "VP8X") {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { width: w, height: h };
      }
      if (fourcc === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
    }
  } catch {
    /* 解析失败不影响主流程 */
  }
  return { width: null, height: null };
}

/** 客户端 IP（支持反向代理头，需显式开启信任） */
export function clientIp(req) {
  if (process.env.HAAVK_TRUST_PROXY === "1") {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "";
}
