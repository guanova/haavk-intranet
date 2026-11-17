/* ==========================================================================
   清理 AI 高管重复发帖
   背景：AI 高管自动发帖过去按 3~5 分钟节流，素材池标题有限，积累出大量
         同 (高管, 标题) 的重复帖，把论坛列表刷得没有阅读价值。
   策略：同 (author_id, title) 只保留最早一条，其余置 is_deleted=1（软删，
         可恢复），不做物理删除，避免动到不该动的东西。
   用法：node server/tools/dedupe-officer-posts.js          # 只看计划
         node server/tools/dedupe-officer-posts.js --yes     # 执行软删
         node server/tools/dedupe-officer-posts.js --yes --purge  # 物理删除
   ========================================================================== */
import { getDb, run, withTx } from "../lib/db.js";

const yes = process.argv.includes("--yes");
const purge = process.argv.includes("--purge");

const db = getDb();

const groups = db
  .prepare(
    `SELECT author_id, title, COUNT(*) AS c, MIN(id) AS keep_id, GROUP_CONCAT(id) AS ids
       FROM posts
      WHERE author_kind = 'ai_officer' AND is_deleted = 0
      GROUP BY author_id, title
     HAVING c > 1`
  )
  .all();

if (!groups.length) {
  console.log("没有重复的高管帖，无需处理。");
  process.exit(0);
}

let softCount = 0;
const duplicated = [];

for (const g of groups) {
  const ids = String(g.ids)
    .split(",")
    .map((n) => Number(n))
    .filter((n) => n && n !== g.keep_id);
  if (!ids.length) continue;
  duplicated.push({ keepId: g.keep_id, dropIds: ids, title: g.title, total: g.c });
  softCount += ids.length;
}

const replyOnDrop = db
  .prepare(
    `SELECT COUNT(*) AS n FROM replies WHERE post_id IN (${duplicated
      .flatMap((d) => d.dropIds)
      .join(",")})`
  )
  .get().n;

console.log("=== 高管重复帖清理计划 ===");
console.log(`重复组：${duplicated.length} 组，可删除副本：${softCount} 条`);
console.log(`这些副本上的回复：${replyOnDrop} 条${
  replyOnDrop ? "（会被迁移到保留帖，不会丢）" : ""
}`);
duplicated
  .slice(0, 10)
  .forEach((d) => console.log(`  ${d.total}x 「${d.title}」 → 保留 #${d.keepId}`));

if (!yes) {
  console.log("\n这是预览。加 --yes 执行（默认软删，加 --purge 物理删除）。");
  process.exit(0);
}

withTx(() => {
  for (const d of duplicated) {
    // 副本上的回复迁到保留帖，避免回复失联
    if (replyOnDrop) {
      run(`UPDATE replies SET post_id = ? WHERE post_id = ?`, d.keepId, ...d.dropIds);
    }
    if (purge) {
      run(
        `DELETE FROM posts WHERE id IN (${d.dropIds.map(() => "?").join(",")})`,
        ...d.dropIds
      );
    } else {
      run(
        `UPDATE posts SET is_deleted = 1, updated_at = ? WHERE id IN (${d.dropIds
          .map(() => "?")
          .join(",")})`,
        Date.now(),
        ...d.dropIds
      );
    }
  }
});

console.log(
  `\n完成：${purge ? "物理删除" : "软删除"} ${softCount} 条副本，保留 ${duplicated.length} 条正本。`
);
