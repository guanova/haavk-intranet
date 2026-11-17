/* ==========================================================================
   server/lib/validate.js — 入参校验（字段级错误收集）
   ========================================================================== */
import { AppError } from "./errors.js";
import { textLength, tidy } from "./strings.js";

export function vString(value, { field, label, min = 0, max = 1000, required = true, pattern, patternMessage, trim = true }) {
  let v = value == null ? "" : String(value);
  if (trim) v = tidy(v);
  if (required && !v) return { error: `${label}不能为空`, value: "" };
  if (!v && !required) return { value: "" };
  const len = textLength(v);
  if (len < min) return { error: `${label}至少 ${min} 个字符`, value: v };
  if (len > max) return { error: `${label}不超过 ${max} 个字符`, value: v };
  if (pattern && !pattern.test(v)) return { error: patternMessage || `${label}格式不正确`, value: v };
  return { value: v };
}

export function vInt(value, { field, label, min, max, required = true, default: def = null }) {
  if (value === undefined || value === null || value === "") {
    if (required) return { error: `${label}不能为空`, value: null };
    return { value: def };
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return { error: `${label}必须是整数`, value: null };
  if (min !== undefined && n < min) return { error: `${label}不能小于 ${min}`, value: n };
  if (max !== undefined && n > max) return { error: `${label}不能大于 ${max}`, value: n };
  return { value: n };
}

export const RULES = {
  username: { pattern: /^[A-Za-z0-9_]{3,16}$/, message: "账号需为 3–16 位字母、数字或下划线" },
  tag: { max: 12 },
  title: { min: 4, max: 60 },
  body: { min: 5, max: 4000 },
  replyBody: { min: 1, max: 1000 },
  displayName: { min: 2, max: 16 },
  signature: { max: 40 },
  reason: { max: 200 }
};

/**
 * 收集校验结果，一次性抛出全部字段错误（前端可逐字段标红）
 * @param {Array<{field:string, error?:string, value:any}>} results
 */
export function collect(results) {
  const fields = {};
  const values = {};
  for (const r of results) {
    if (r.error) fields[r.field] = r.error;
    else values[r.field] = r.value;
  }
  if (Object.keys(fields).length) {
    throw AppError.badRequest(Object.values(fields)[0], { fields });
  }
  return values;
}
