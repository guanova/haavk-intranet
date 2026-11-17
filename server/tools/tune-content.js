/* ==========================================================================
   server/tools/tune-content.js — 内容运营调优（一次性同步到运行库）
   1) 点数规则：回复扣费 100 → 20（回复比发帖便宜，鼓励讨论）
   2) AI 高管：发言素材池扩充 + 自主发帖间隔拉长到 30/45/60 分钟
      （原 3/4/5 分钟会在一小时内淹没真人帖子）
   幂等：重复执行结果一致。
   运行：node server/tools/tune-content.js
   ========================================================================== */
import { all, run } from "../lib/db.js";
import { AI_OFFICERS } from "../seed-data.js";

let changes = 0;

/* 1) 点数规则 */
const row = all("SELECT value FROM site_settings WHERE key = 'points.reply_cost'");
if (row.length && row[0].value !== "20") {
  run("UPDATE site_settings SET value = '20' WHERE key = 'points.reply_cost'");
  console.log("points.reply_cost: " + row[0].value + " -> 20");
  changes++;
} else {
  console.log("points.reply_cost 已是 20（或无记录）");
}

/* 2) AI 高管素材池与发帖间隔 */
for (const o of AI_OFFICERS) {
  const hit = all("SELECT id, voice_lines, auto_post_interval_sec FROM ai_officers WHERE codename LIKE ?", "%" + o.codename + "%");
  if (!hit.length) {
    console.log("跳过（库中无此高管）：" + o.codename);
    continue;
  }
  const r = hit[0];
  const lines = JSON.stringify(o.voiceLines);
  if (r.voice_lines !== lines || r.auto_post_interval_sec !== o.autoPostIntervalSec) {
    run(
      "UPDATE ai_officers SET voice_lines = ?, auto_post_interval_sec = ? WHERE id = ?",
      lines,
      o.autoPostIntervalSec,
      r.id
    );
    console.log(o.codename + ": 素材 " + o.voiceLines.length + " 条，间隔 " + r.auto_post_interval_sec + "s -> " + o.autoPostIntervalSec + "s");
    changes++;
  } else {
    console.log(o.codename + ": 已是最新");
  }
}

console.log("完成，变更 " + changes + " 项");
