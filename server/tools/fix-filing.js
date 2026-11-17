/* 一次性修正：清理被测试污染为空/乱码的备案值，恢复演示值 */
import { get, run, getDb } from "../lib/db.js";
import { DEMO_FILING } from "./demo-filing.js";

for (const [key, value] of Object.entries(DEMO_FILING)) {
  const row = get("SELECT value FROM site_settings WHERE key = ?", key);
  if (!row) continue;
  // 只在"空值 / 编码损坏 / 测试残留"时恢复，不覆盖管理员后来手工填写的正常值
  const broken =
    !row.value ||
    /[锟斤拷]|CP澶|鍙|浜琁/.test(row.value) || // 编码损坏
    /^TEST-|^-?\d+$|SENTINEL/i.test(row.value); // 测试残留（如 TEST-ICP-XYZ / E2E 哨兵值）
  if (!broken) {
    console.log(`  · ${key} 保持现值（长度 ${row.value.length}）`);
    continue;
  }
  run("UPDATE site_settings SET value = ?, updated_at = ? WHERE key = ?", value, Date.now(), key);
  console.log(`  · ${key} 已恢复为：${value}`);
}
console.log("当前备案配置：", JSON.stringify(Object.keys(DEMO_FILING).map((k) => [k, get("SELECT value FROM site_settings WHERE key = ?", k).value])));
getDb().close();
