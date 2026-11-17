/* ==========================================================================
   server/lib/webdav.js — 极简 WebDAV 转存客户端（零依赖，基于全局 fetch）
   职责：把投稿附件 PUT 到管理员配置的 WebDAV 目录；失败可重试。
   配置来源：site_settings 的 webdav.* 组（仅管理面板可编辑，publicSettings 不下发）。
   ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import { all, get, run } from "./db.js";
import { getSetting } from "./settings.js";

const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 8;

/** 当前 WebDAV 配置；未启用或地址为空返回 null */
export function davConfig() {
  const enabled = getSetting("webdav.enabled", "0") === "1";
  const url = String(getSetting("webdav.url", "") || "").trim();
  if (!enabled || !url) return null;
  const base = url.endsWith("/") ? url : url + "/";
  const user = String(getSetting("webdav.user", "") || "");
  const pass = String(getSetting("webdav.pass", "") || "");
  return {
    base,
    auth: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")
  };
}

async function davRequest(method, url, cfg, body, contentType) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { Authorization: cfg.auth };
    if (body) headers["Content-Type"] = contentType || "application/octet-stream";
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

/** 逐级创建目录（MKCOL 已存在会返回 405，属正常） */
async function ensureDirs(cfg, relDir) {
  const segs = relDir.split("/").filter(Boolean);
  let cur = cfg.base;
  for (const seg of segs) {
    cur = cur + encodeURIComponent(seg) + "/";
    try {
      await davRequest("MKCOL", cur, cfg);
    } catch {
      /* 目录创建失败不致命，PUT 时再报错 */
    }
  }
}

/**
 * 转存单个文件：本地路径 → WebDAV {base}{YYYY-MM}/{submissionId}/{storedName}
 * 返回 { ok, remotePath, status }
 */
export async function forwardOne(cfg, fileRow, absPath) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const relDir = `${month}/${fileRow.submission_id}`;
  const remotePath = `${relDir}/${fileRow.stored_name}`;
  await ensureDirs(cfg, relDir);
  const buf = fs.readFileSync(absPath);
  const status = await davRequest(
    "PUT",
    cfg.base + remotePath.split("/").map(encodeURIComponent).join("/"),
    cfg,
    buf,
    fileRow.mime || "application/octet-stream"
  );
  const ok = status === 200 || status === 201 || status === 204;
  return { ok, remotePath, status };
}

/**
 * 推进所有待转存文件（pending/failed 且 attempts < MAX_ATTEMPTS）。
 * 未配置 WebDAV 时不动（保持 pending，配置好后自动补传）。
 * 返回 { done, failed, skipped }
 */
export async function pumpWebdav(uploadDirOf) {
  const cfg = davConfig();
  if (!cfg) return { done: 0, failed: 0, skipped: 1 };
  const rows = all(
    `SELECT id, submission_id, stored_name, mime, webdav_attempts
     FROM submission_files
     WHERE webdav_status IN ('pending','failed') AND webdav_attempts < ?
     ORDER BY id LIMIT 20`,
    MAX_ATTEMPTS
  );
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    const abs = path.join(uploadDirOf(), row.stored_name);
    try {
      if (!fs.existsSync(abs)) throw new Error("本地文件缺失");
      const r = await forwardOne(cfg, row, abs);
      if (r.ok) {
        run(
          "UPDATE submission_files SET webdav_status='ok', webdav_path=?, webdav_attempts=? WHERE id=?",
          r.remotePath,
          row.webdav_attempts + 1,
          row.id
        );
        done++;
      } else {
        throw new Error("HTTP " + r.status);
      }
    } catch (err) {
      run(
        "UPDATE submission_files SET webdav_status='failed', webdav_attempts=? WHERE id=?",
        row.webdav_attempts + 1,
        row.id
      );
      failed++;
      console.error(`[webdav] 转存失败 file#${row.id}:`, err && err.message ? err.message : err);
    }
  }
  return { done, failed, skipped: 0 };
}

/** 管理面板「测试连接」：尝试 MKCOL 根目录 + PUT 一个探针文件再 DELETE */
export async function testConnection() {
  const cfg = davConfig();
  if (!cfg) return { ok: false, error: "未启用或未填写 WebDAV 地址" };
  try {
    await ensureDirs(cfg, ".haavk-probe");
    const probeUrl = cfg.base + ".haavk-probe/probe.txt";
    const status = await davRequest("PUT", probeUrl, cfg, Buffer.from("haavk probe\n"), "text/plain");
    const ok = status === 200 || status === 201 || status === 204;
    if (ok) {
      try {
        await davRequest("DELETE", probeUrl, cfg);
      } catch {
        /* 探针残留无妨 */
      }
    }
    return ok ? { ok: true } : { ok: false, error: "HTTP " + status };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/** 供管理面板展示：各状态文件计数 */
export function davStats() {
  const rows = all(
    "SELECT webdav_status AS s, COUNT(*) AS c FROM submission_files GROUP BY webdav_status"
  );
  const out = { pending: 0, ok: 0, failed: 0, skipped: 0 };
  for (const r of rows) out[r.s] = r.c;
  out.configured = davConfig() ? 1 : 0;
  return out;
}
