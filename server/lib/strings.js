/* ==========================================================================
   server/lib/strings.js — 名称归一化与文本工具
   ========================================================================== */

/**
 * 名称归一化：用于部门/职业去重。
 * 去首尾空白 → 全角转半角 → 去所有空白 → 转小写。
 */
export function normName(input) {
  if (!input) return "";
  return String(input)
    .replace(/\u3000/g, " ")
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

/** 统计"CJK 字符数"，用于长度校验（中文一字算一个） */
export function textLength(str) {
  return Array.from(String(str || "")).length;
}

/** 去除首尾空白并压缩连续空白 */
export function tidy(str) {
  return String(str == null ? "" : str)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .trim();
}

/** HTML 转义（服务端渲染片段时使用） */
export function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 生成审核编号 M-YYYYMMDD-XXXX */
export function mentionCode(seq) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = String(seq % 10000).padStart(4, "0");
  return `M-${ymd}-${rand}`;
}

/** 服务器本地时区的 YYYY-MM-DD（每日领取按此判定） */
export function localDate(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 提取文本中的 @提及：返回 [{ raw, name }]，按出现顺序去重 */
export function extractMentions(text) {
  const out = [];
  const seen = new Set();
  const re = /@([^\s@，。！？、,.!?;:；：()（）[\]【】"'“”]{1,24})/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const name = m[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ raw: m[0], name });
  }
  return out;
}

/** 是否为灌水文本（连续重复字符 ≥ 8） */
export function looksLikeSpam(text) {
  return /(.)\1{7,}/.test(String(text || ""));
}

/** 生成随机 hex 字符串 */
export function randomHex(bytes, cryptoMod) {
  return cryptoMod.randomBytes(bytes).toString("hex");
}

/** 从 voice_lines JSON 里挑选一条（避开刚用过的） */
export function pickLine(lines, avoidIndex = -1) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  if (lines.length === 1) return lines[0];
  let idx = avoidIndex;
  for (let i = 0; i < 8 && idx === avoidIndex; i++) {
    idx = Math.floor(Math.random() * lines.length);
  }
  return lines[idx];
}
