/* 清理本人实测引入的临时账号与申请，让库回到干净基线 */
import { all, get, run, getDb } from "../../server/lib/db.js";

const patterns = ["pending_%", "114514"];

for (const p of patterns) {
  const users = all("SELECT id, username FROM users WHERE username LIKE ?", p);
  for (const u of users) {
    run("DELETE FROM requests WHERE user_id = ?", u.id);
    run("DELETE FROM points_ledger WHERE user_id = ?", u.id);
    run("DELETE FROM daily_claims WHERE user_id = ?", u.id);
    run("DELETE FROM sessions WHERE user_id = ?", u.id);
    run("DELETE FROM users WHERE id = ?", u.id);
    console.log(`[cleanup] 已删除临时账号 ${u.username}（#${u.id}）及其关联记录`);
  }
}

const stats = {
  users: get("SELECT COUNT(*) AS c FROM users").c,
  employees: get("SELECT COUNT(*) AS c FROM users WHERE role='employee'").c,
  pendingRequests: get("SELECT COUNT(*) AS c FROM requests WHERE status='pending'").c,
  posts: get("SELECT COUNT(*) AS c FROM posts WHERE is_deleted=0").c,
  mentions: get("SELECT COUNT(*) AS c FROM mentions").c
};
console.log("[cleanup] 现状：", JSON.stringify(stats));

// 顺带复核对账
const { reconcile } = await import("../../server/lib/points.js");
const rec = reconcile(false);
console.log(
  "[cleanup] 对账：余额差异 %d · 重复领取 %d · 回复计数 %d · 点赞计数 %d · 悬空头像 %d",
  rec.balanceDiffs.length,
  rec.duplicateClaims.length,
  rec.replyCountMismatches.length,
  rec.likeCountMismatches.length,
  rec.danglingAvatars.length
);

getDb().close();
