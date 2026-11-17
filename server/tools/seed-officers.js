/* ==========================================================================
   server/tools/seed-officers.js — 幂等补齐 AI 高管（含补全的 12 位部门主管）
   背景：站点最初只有 4 位高管，其余部门在论坛里没有代言人。本工具按
         seed-data.js + seed-data-officers.js 的定义做 upsert：
           · users 不存在 → 建 ai_officer 账号（随机密码，高管不登录）
           · ai_officers 已存在 → 刷新 title / persona / voice_lines /
             authority / 发帖间隔 / post_topics / 所属部门（不会删除任何历史数据）
   用法：node server/tools/seed-officers.js [--dry]
   前置：先跑 node server/tools/migrate.js（需要 005 的 post_topics 列）
   ========================================================================== */
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.HAAVK_DB =
  process.env.HAAVK_DB || path.resolve(__dirname, "../../data/haavk.db");

const { get, run, all } = await import("../lib/db.js");
const { AI_OFFICERS, EXTRA_OFFICERS } = await import("../seed-data.js");
const { ROLES, USER_STATUS, POINTS_REASON } = await import("../constants.js");
const { createUser, findUserByUsername } = await import("../lib/auth.js");
const { addPoints } = await import("../lib/points.js");

const dry = process.argv.includes("--dry");

const cols = all("SELECT name FROM pragma_table_info('ai_officers')").map((r) => r.name);
if (!cols.includes("post_topics")) {
  console.error("[seed-officers] ai_officers 缺少 post_topics 列，请先运行 node server/tools/migrate.js");
  process.exit(1);
}

const list = [...AI_OFFICERS, ...EXTRA_OFFICERS];
const stats = { createdUser: 0, createdOfficer: 0, updated: 0 };

for (const o of list) {
  const deptId = get("SELECT id FROM departments WHERE name = ?", o.department)?.id ?? null;
  if (!deptId) {
    console.warn(`[seed-officers] 跳过「${o.codename}」：找不到部门「${o.department}」`);
    continue;
  }

  let user = findUserByUsername(o.username);
  if (!user) {
    if (dry) {
      console.log(`  [dry] 新建账号 ${o.username}（${o.codename} / ${o.title}）`);
      stats.createdUser++;
      continue;
    }
    const pwd = crypto.randomBytes(12).toString("base64url");
    const userId = createUser({
      username: o.username,
      displayName: o.codename,
      password: pwd,
      role: ROLES.AI_OFFICER,
      status: USER_STATUS.ACTIVE,
      departmentId: deptId,
      title: o.title,
      isSystem: 1
    });
    // 高管账号需要余额支撑「转阅回复」的点数记账
    addPoints(userId, 100000, POINTS_REASON.ADMIN_ADJUST, { memo: "AI 代理初始化" });
    user = { id: userId, username: o.username };
    stats.createdUser++;
  }

  const payload = [
    o.title,
    deptId,
    o.persona,
    JSON.stringify(o.voiceLines || []),
    o.authorityLevel ?? 5,
    o.canReviewMentions ? 1 : 0,
    o.autoPostIntervalSec ?? 0,
    JSON.stringify(o.postTopics || [])
  ];

  const off = get("SELECT id FROM ai_officers WHERE codename = ? OR user_id = ?", o.codename, user.id);
  if (!off) {
    if (dry) {
      console.log(`  [dry] 新建高管档案 ${o.codename}`);
      stats.createdOfficer++;
      continue;
    }
    run(
      `INSERT INTO ai_officers (user_id, codename, title, department_id, persona, voice_lines,
                                authority_level, can_review_mentions, auto_post_interval_sec,
                                post_topics, enabled, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
      user.id,
      o.codename,
      ...payload,
      Date.now()
    );
    stats.createdOfficer++;
    console.log(`  + 新建 ${o.codename}（${o.title}）`);
  } else {
    if (dry) {
      console.log(`  [dry] 更新高管档案 ${o.codename}`);
      stats.updated++;
      continue;
    }
    run(
      `UPDATE ai_officers
          SET title=?, department_id=?, persona=?, voice_lines=?, authority_level=?,
              can_review_mentions=?, auto_post_interval_sec=?, post_topics=?, enabled=1
        WHERE id=?`,
      ...payload,
      off.id
    );
    stats.updated++;
    console.log(`  ~ 更新 ${o.codename}（${o.title}）`);
  }

  // 顺带把 users 上的显示名与职务对齐（改名不影响历史帖子的 author 关联）
  run(
    "UPDATE users SET display_name = ?, title = ?, department_id = ?, updated_at = ? WHERE id = ?",
    o.codename,
    o.title,
    deptId,
    Date.now(),
    user.id
  );
}

const total = all("SELECT COUNT(*) c FROM ai_officers WHERE enabled = 1")[0].c;
console.log(
  `\n[seed-officers] ${dry ? "[dry] " : ""}新建账号 ${stats.createdUser} · 新建档案 ${stats.createdOfficer} · 更新 ${stats.updated} · 当前启用高管 ${total} 位`
);
process.exit(0);
