/* ==========================================================================
   对账工具：校验点数流水与余额、重复领取、回复计数
   用法：node server/tools/reconcile.js [--fix]
   ========================================================================== */
import { reconcile } from "../lib/points.js";
import { getDb, run } from "../lib/db.js";

const fix = process.argv.includes("--fix");
const result = reconcile(fix);

const problems =
  result.balanceDiffs.length +
  result.duplicateClaims.length +
  result.replyCountMismatches.length +
  result.likeCountMismatches.length +
  result.danglingAvatars.length;

console.log("=== 对账报告 ===");
console.log(`余额与流水不一致：${result.balanceDiffs.length} 项`);
for (const d of result.balanceDiffs.slice(0, 20)) {
  console.log(`  · #${d.userId} ${d.username} 余额 ${d.balance} / 流水合计 ${d.ledgerSum}（差额 ${d.delta}）`);
}
console.log(`重复每日领取：${result.duplicateClaims.length} 项（唯一索引应始终保证为 0）`);
for (const d of result.duplicateClaims.slice(0, 10)) {
  console.log(`  · 用户 #${d.userId} ${d.claim_date} 领取 ${d.c} 次`);
}
console.log(`回复计数不一致：${result.replyCountMismatches.length} 项`);
for (const d of result.replyCountMismatches.slice(0, 10)) {
  console.log(`  · 帖子 #${d.id} 冗余计数 ${d.reply_count} / 实际 ${d.actual}`);
}
console.log(`点赞计数不一致：${result.likeCountMismatches.length} 项`);
for (const d of result.likeCountMismatches.slice(0, 10)) {
  console.log(`  · 帖子 #${d.id} 冗余计数 ${d.like_count} / 实际 ${d.actual}`);
}
console.log(`悬空头像引用：${result.danglingAvatars.length} 项（会导致头像字段取不到文件名 → 头像丢失）`);
for (const d of result.danglingAvatars.slice(0, 10)) {
  console.log(`  · 用户 #${d.id} ${d.username} → uploads#${d.avatar_upload_id}（不存在）`);
}
if (result.danglingAvatars.length && fix) {
  for (const d of result.danglingAvatars) run("UPDATE users SET avatar_upload_id = NULL WHERE id = ?", d.id);
  console.log("  已按 --fix 清理悬空引用（头像将回退默认头像）。");
}
if (fix) console.log("\n已按流水修正余额（--fix）。");
console.log(problems === 0 ? "\n结果：0 差异 ✅" : `\n结果：发现 ${problems} 项差异 ❌`);

getDb().close();
process.exit(problems === 0 ? 0 : 1);
