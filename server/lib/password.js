/* ==========================================================================
   server/lib/password.js — 密码哈希（scrypt）
   存储格式：password_hash = hex(derivedKey)，password_salt = hex(salt)
   algo 字段记录算法版本，便于将来平滑升级。
   ========================================================================== */
import crypto from "node:crypto";

const KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const ALGO = "scrypt$1";

export function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

/** 同步派生（注册/登录路径调用；N=16384 时约 40–70ms，可接受） */
export function hashPassword(password, salt, algo = ALGO) {
  if (algo !== ALGO) throw new Error(`不支持的密码算法：${algo}`);
  return crypto.scryptSync(String(password), Buffer.from(salt, "hex"), KEYLEN, SCRYPT_OPTS).toString("hex");
}

/** 恒定时间比较，避免时序侧信道 */
export function verifyPassword(password, salt, expectedHash, algo = ALGO) {
  const actual = hashPassword(password, salt, algo);
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(String(expectedHash || ""), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 密码强度校验：≥8 位，且至少包含两类字符 */
export function validatePasswordStrength(password) {
  const p = String(password || "");
  if (p.length < 8) return "密码至少 8 位";
  if (p.length > 64) return "密码不超过 64 位";
  let classes = 0;
  if (/[a-z]/.test(p)) classes++;
  if (/[A-Z]/.test(p)) classes++;
  if (/\d/.test(p)) classes++;
  if (/[^A-Za-z0-9]/.test(p)) classes++;
  if (classes < 2) return "密码需包含至少两类字符（小写、大写、数字、符号）";
  return "";
}

export function passwordStrengthScore(password) {
  const p = String(password || "");
  let classes = 0;
  if (/[a-z]/.test(p)) classes++;
  if (/[A-Z]/.test(p)) classes++;
  if (/\d/.test(p)) classes++;
  if (/[^A-Za-z0-9]/.test(p)) classes++;
  let level = 0;
  if (p.length >= 8) level++;
  if (p.length >= 12) level++;
  if (classes >= 3) level++;
  if (classes >= 2 && p.length >= 8) level++;
  if (level <= 1) return { score: 1, text: "弱" };
  if (level === 2) return { score: 2, text: "中" };
  if (level === 3) return { score: 3, text: "强" };
  return { score: 4, text: "很强" };
}
