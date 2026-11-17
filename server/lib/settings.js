/* ==========================================================================
   server/lib/settings.js — 站点配置读写（带缓存）
   备案信息等均来自 site_settings 表，管理面板可编辑。
   ========================================================================== */
import { all, run, get } from "./db.js";
import { SETTING_DEFAULTS } from "../constants.js";

let cache = null;

export function loadSettings(force = false) {
  if (cache && !force) return cache;
  const rows = all("SELECT key, value, label, hint, grp, editable FROM site_settings");
  const map = {};
  for (const r of rows) map[r.key] = r;
  cache = map;
  return cache;
}

export function getSetting(key, fallback = "") {
  ensureSeeded();
  const s = loadSettings();
  const row = s[key];
  if (!row) return fallback;
  return row.value === "" ? fallback : row.value;
}

export function getSettingNumber(key, fallback) {
  const raw = getSetting(key, String(fallback));
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function allSettings() {
  ensureSeeded();
  const s = loadSettings();
  return Object.values(s)
    .map((r) => ({ ...r }))
    .sort((a, b) => (a.grp + a.key).localeCompare(b.grp + b.key));
}

/** 批量更新（仅 editable=1） */
export function updateSettings(items, actorId) {
  const now = Date.now();
  const updated = [];
  for (const item of items) {
    const key = String(item.key || "");
    const row = get("SELECT key, editable FROM site_settings WHERE key = ?", key);
    if (!row) continue;
    if (!row.editable) continue;
    let value = item.value == null ? "" : String(item.value);
    // 数值型配置做范围保护，避免运营误填导致站点不可用
    if (key.startsWith("points.")) {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < 0 || n > 100000) continue;
      value = String(n);
    }
    if (key === "mention.cooldown_sec") {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < 0 || n > 3600) continue;
      value = String(n);
    }
    if (key === "mention.hourly_limit" || key === "mention.max_per_post" || key === "mention.min_authority") {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) continue;
      value = String(n);
    }
    run("UPDATE site_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?", value, now, actorId || null, key);
    updated.push(key);
  }
  loadSettings(true);
  return updated;
}

/** 确保出厂配置存在（幂等，只插入缺失项，不覆盖运营已改的值） */
export function ensureSeeded() {
  const now = Date.now();
  for (const def of SETTING_DEFAULTS) {
    const exists = get("SELECT key FROM site_settings WHERE key = ?", def.key);
    if (!exists) {
      run(
        "INSERT INTO site_settings (key, value, label, hint, grp, editable, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,NULL)",
        def.key,
        def.value,
        def.label,
        def.hint,
        def.group,
        def.editable,
        now
      );
    }
  }
  loadSettings(true);
}

/** 打包给前端的公开配置（不含内部提示文案） */
export function publicSettings() {
  return {
    brand: {
      siteName: getSetting("brand.site_name", "哈夫克集团")
    },
    filing: {
      icp: getSetting("filing.icp"),
      police: getSetting("filing.police"),
      policeUrl: getSetting("filing.police_url"),
      company: getSetting("filing.company"),
      copyright: getSetting("filing.copyright"),
      extra: getSetting("filing.extra")
    },
    points: {
      dailyAmount: getSettingNumber("points.daily_amount", 500),
      postCost: getSettingNumber("points.post_cost", 50),
      replyCost: getSettingNumber("points.reply_cost", 100)
    },
    mention: {
      cooldownSec: getSettingNumber("mention.cooldown_sec", 60),
      hourlyLimit: getSettingNumber("mention.hourly_limit", 5),
      maxPerPost: getSettingNumber("mention.max_per_post", 3),
      minAuthority: getSettingNumber("mention.min_authority", 2)
    }
  };
}
