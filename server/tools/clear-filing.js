/* tools/clear-filing.js — 清空页脚备案演示值（参考活动页状态栏无备案行；管理员仍可在面板重新填写，填写后即显示） */
import { run, get, getDb } from "../lib/db.js";

const keys = ["filing.icp", "filing.police", "filing.police_url", "filing.company", "filing.copyright", "filing.extra"];
for (const k of keys) {
  run("UPDATE site_settings SET value = '', updated_at = ? WHERE key = ?", Date.now(), k);
  console.log(`  · ${k} → (空)`);
}
console.log("当前备案配置：", JSON.stringify(keys.map((k) => [k, (get("SELECT value FROM site_settings WHERE key = ?", k) || {}).value])));
getDb().close();
