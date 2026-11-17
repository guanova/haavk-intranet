/* ==========================================================================
   server/lib/ratelimit.js — 通用限流（SQLite 计数桶）
   用途：登录尝试、头像上传、点数领取 IP 维度等。
   ========================================================================== */
import { get, run } from "./db.js";

/**
 * 固定窗口计数器。返回 { allowed, remaining, retryAfter }
 * @param {string} key      形如 `login:ip:1.2.3.4`
 * @param {number} limit    窗口内允许次数
 * @param {number} windowMs 窗口长度
 */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  const row = get("SELECT window_start, count FROM rate_limits WHERE key = ?", key);
  if (!row || now - row.window_start >= windowMs) {
    run(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1)
       ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
      key,
      now
    );
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  const count = row.count + 1;
  run("UPDATE rate_limits SET count = ? WHERE key = ?", count, key);
  if (count > limit) {
    const retryAfter = Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: limit - count, retryAfter: 0 };
}

/** 只读查询，不计数（用于预览剩余次数） */
export function peek(key, limit, windowMs) {
  const now = Date.now();
  const row = get("SELECT window_start, count FROM rate_limits WHERE key = ?", key);
  if (!row || now - row.window_start >= windowMs) return { used: 0, remaining: limit, retryAfter: 0 };
  const retryAfter = Math.max(0, Math.ceil((row.window_start + windowMs - now) / 1000));
  return { used: row.count, remaining: Math.max(0, limit - row.count), retryAfter };
}

/** 清理过期桶（启动与定时任务调用） */
export function prune(maxWindowMs = 24 * 3600_000) {
  const cutoff = Date.now() - maxWindowMs;
  run("DELETE FROM rate_limits WHERE window_start < ?", cutoff);
}
