/* ==========================================================================
   server/tools/demo-seed.js — 演示数据播种（面向首次上线的可用性）
   用途：在没有真实用户时，让首页与论坛具备可浏览的初始内容。
   特点：全部通过**内部服务层**写入，不绕过业务规则；幂等，可重复执行。
   用法：node server/tools/demo-seed.js
   ========================================================================== */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.HAAVK_DB = process.env.HAAVK_DB || path.resolve(__dirname, "../../data/haavk.db");

const { getDb, get, all, run, withTx, scalar } = await import("../lib/db.js");
const { migrate } = await import("../lib/migrate.js");
const m001 = await import("../migrations/001_init.js");
const { seedAll } = await import("../lib/seed.js");
const { createUser, createSession, findUserByUsername, findUserById } = await import("../lib/auth.js");
const { addPoints, claimDaily } = await import("../lib/points.js");
const { runAutoPosts, runAutoReplies, drainMentions } = await import("../workers/index.js");
const { createMentionsForContent, resolveMentionTargets } = await import("../lib/mentions.js");
const { DEMO_FILING } = await import("./demo-filing.js");
const { POINTS_REASON, ROLES, USER_STATUS, REQUEST_STATUS } = await import("../constants.js");

migrate([m001]);
seedAll({ adminPassword: "Haavk@Admin2026", officerPassword: "Haavk@Officer2026", verbose: false });

const DEMO_PASSWORD = "Haavk#2026";

const EMPLOYEES = [
  { username: "claire", display: "克莱尔", dept: "安全防卫部", job: "突击", sig: "知道我是谁 才知为何而战" },
  { username: "lina", display: "莉娜", dept: "人工智能研发部", job: "侦察", sig: "个人表现灵感 集团栽培进步" },
  { username: "panshi", display: "磐石", dept: "工程部门", job: "工程", sig: "不同职位大小 奉献总有回报" },
  { username: "yexiao", display: "夜枭", dept: "情报部门", job: "侦察", sig: "先理解后执行" },
  { username: "leiting", display: "雷霆", dept: "安全防卫部", job: "支援", sig: "你们已经安全了 剩下的交给我们" },
  { username: "daozhang", display: "道长", dept: "后勤部门", job: "文职行政", sig: "敬畏未知的力量 守护大家的平静" },
  { username: "jinfoe", display: "金佛额", dept: "非必要人员蓄留部", job: "文职行政", sig: "" },
  { username: "mingcao", display: "名草有主", dept: "地方关系分局", job: "文职行政", sig: "" },
  { username: "honest", display: "老实打工", dept: "财务部", job: "文职行政", sig: "" },
  { username: "lowkey", display: "低调拿满绩效", dept: "人力资源中心", job: "文职行政", sig: "" },
  { username: "coffee", display: "咖啡比命贵", dept: "后勤保障部", job: "文职行政", sig: "" },
  { username: "bus", display: "班车最后一排", dept: "后勤保障部", job: "文职行政", sig: "" },
  { username: "workorder", display: "上门请下工单", dept: "技术工程部", job: "工程", sig: "" },
  { username: "hudsonfan", display: "哈德森后援会会长", dept: "效能部", job: "文职行政", sig: "" },
  { username: "fitness", display: "健身先健脑", dept: "外部威胁数据库", job: "文职行政", sig: "" }
];

const POSTS = [
  {
    board: "announce",
    author: "webops_admin",
    tag: "公告",
    title: "关于集团员工论坛正式启用的公告",
    body: "集团员工论坛即日起正式启用。请各部门按板块归类发帖，涉密内容不得在公开版面讨论。\n\n论坛内容仅限集团内部交流使用，请各位同事遵守相关信息管理规定。",
    pinned: true
  },
  {
    board: "welfare",
    author: "coffee",
    tag: "求助",
    title: "在线等，在咖啡馆被我司巡逻队扣住了！",
    body: "在线等。我在咖啡馆被巡逻队扣住了，说是区域管制。有人能来证明我是自己人吗？我工牌在办公室，进不去。"
  },
  {
    board: "equipment",
    author: "jinfoe",
    tag: "讨论",
    title: "公司是否会考虑再次发放装备以收集作战数据？",
    body: "上一批发放的装备我已经用完了。想问问公司是否会考虑再发一轮，顺便收集一下作战数据？毕竟数据也是资产。"
  },
  {
    board: "tech",
    author: "workorder",
    tag: "求助",
    title: "求教如何重置AI助手",
    body: "AI 助手最近总是答非所问，有没有办法重置？工单已经提了三次了，技术工程部至今没有回复。"
  },
  {
    board: "welfare",
    author: "bus",
    tag: "讨论",
    title: "食堂今天的土豆又是没削皮的，我服了",
    body: "连着三天了。削皮机到底修没修？后勤的同事能不能回应一下，这事已经影响到用午餐的心情了。"
  },
  {
    board: "tech",
    author: "lina",
    tag: "讨论",
    title: "合理质疑我集团AI",
    body: "我集团 AI 最近的表现值得质疑。在多个场景下给出的结论与实测数据不符，希望人工智能研发部的同事出来解释一下评估口径。",
    mention: "阿娜伊斯·德穆兰"
  },
  {
    board: "announce",
    author: "hudsonfan",
    tag: "活动通知",
    title: "【活动通知】效能部工作精神宣传讲座",
    body: "效能部将于本周五举办工作精神宣传讲座，请各部门派员参加。座位有限，先到先得。"
  },
  {
    board: "voices",
    author: "fitness",
    tag: "讨论",
    title: "二号优秀员工换造型了！？",
    body: "宣传图上的二号优秀员工换造型了，你们发现了吗？我个人觉得新的造型更符合集团形象。"
  },
  {
    board: "general",
    author: "mingcao",
    tag: "讨论",
    title: "感谢上次大家的建言献策，我准备求婚了",
    body: "感谢各位上次的建言献策，礼物已经选好了。我准备求婚了，成了请大家喝咖啡（自费）。"
  },
  {
    board: "general",
    author: "daozhang",
    tag: "讨论",
    title: "公司内部有没有射箭爱好者的协会啊？",
    body: "想找个射箭的同好，公司内部有没有相关协会？周末可以约着一起练。"
  }
];

const COMMENTS = [
  "已记录，请按流程提交工单，我们会安排跟进。",
  "这个问题我也遇到过，建议同步反馈给后勤保障部。",
  "先理解后执行，理解框架执行越好。",
  "同意。建议把具体时间与地点补充清楚，便于核查。",
  "已转交相关部门，请等待处理结果。",
  "请在工单中注明设备编号，便于现场排查。",
  "不同职位大小，奉献总有回报。",
  "祝顺利。",
  "报价方面请以系统内公示为准。",
  "以上。"
];

function upsertEmployee(e) {
  const exists = findUserByUsername(e.username);
  if (exists) return exists.id;
  const deptId = get("SELECT id FROM departments WHERE name = ?", e.dept)?.id ?? null;
  const jobId = get("SELECT id FROM jobs WHERE name = ?", e.job)?.id ?? null;
  return withTx(() => {
    const id = createUser({
      username: e.username,
      displayName: e.display,
      password: DEMO_PASSWORD,
      role: ROLES.EMPLOYEE,
      status: USER_STATUS.ACTIVE,
      departmentId: deptId,
      jobRoleId: jobId
    });
    run("UPDATE users SET signature = ?, updated_at = ? WHERE id = ?", e.sig || "", Date.now(), id);
    // 入职申请留档（已通过），保持数据自洽
    run(
      "INSERT INTO requests (user_id, type, payload, status, created_at, reviewed_at, review_note) VALUES (?,?,'{}',?,?,?,?)",
      id,
      "onboarding",
      REQUEST_STATUS.APPROVED,
      Date.now() - 86400000 * 3,
      Date.now() - 86400000 * 3,
      "演示数据初始化"
    );
    // 每个演示员工领取一次当日点数，并留出可发帖的余额
    claimDaily(id, "127.0.0.1");
    addPoints(id, 2000, POINTS_REASON.ADMIN_ADJUST, { memo: "演示数据初始化" });
    return id;
  });
}

function ensurePost(p) {
  const exists = get("SELECT id FROM posts WHERE title = ? AND is_deleted = 0", p.title);
  if (exists) return null;
  const board = get("SELECT id FROM boards WHERE slug = ?", p.board);
  const author = findUserByUsername(p.author);
  if (!board || !author) return null;
  const body = p.mention ? `${p.body}\n\n@${p.mention} 请集团评估是否需要调整相关流程并明确责任部门与处理时限。` : p.body;
  const now = Date.now() - Math.floor(Math.random() * 6) * 3600000;
  const info = run(
    `INSERT INTO posts (board_id, author_id, author_kind, tag, title, body, is_pinned, is_deleted,
                        reply_count, views, last_reply_by, last_reply_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,0,0,?, '', ?, ?, ?)`,
    board.id,
    author.id,
    author.role === ROLES.AI_OFFICER ? "ai_officer" : "user",
    p.tag || "",
    p.title,
    body,
    p.pinned ? 1 : 0,
    20 + Math.floor(Math.random() * 300),
    now,
    now,
    now
  );
  const postId = Number(info.lastInsertRowid);

  // 正文含 @ 时，按业务规则正式创建审核请求（与线上发帖路径完全一致）
  const targets = resolveMentionTargets(body).mentions;
  if (targets.length) {
    const requester = findUserById(author.id);
    withTx(() =>
      createMentionsForContent({ requester, postId, replyId: null, body, targets })
    );
  }

  // 补充若干员工回复，形成真实讨论感
  const employees = all("SELECT id, display_name FROM users WHERE role = 'employee' LIMIT 8");
  const replyCount = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < replyCount; i++) {
    const who = employees[(i * 3 + postId) % employees.length];
    if (!who) break;
    const at = now + (i + 1) * 900000;
    run(
      "INSERT INTO replies (post_id, author_id, author_kind, body, is_deleted, created_at) VALUES (?,?,'user',?,0,?)",
      postId,
      who.id,
      COMMENTS[(i + postId) % COMMENTS.length],
      at
    );
    run("UPDATE posts SET reply_count = reply_count + 1, last_reply_by = ?, last_reply_at = ? WHERE id = ?", who.display_name, at, postId);
  }
  return postId;
}

/* ------------------------------ 执行 ------------------------------ */

const summary = { employees: 0, posts: 0, autoPosts: 0, autoReplies: 0, mentions: 0 };

for (const e of EMPLOYEES) {
  const before = findUserByUsername(e.username);
  const id = upsertEmployee(e);
  if (!before && id) summary.employees++;
}

for (const p of POSTS) {
  const id = ensurePost(p);
  if (id) summary.posts++;
}

// 触发 AI 高管自主发声与对热帖回复
summary.autoPosts = runAutoPosts(Date.now() + 10 * 60_000);
summary.autoReplies = runAutoReplies(Date.now() + 10 * 60_000);

// 推进所有 @ 呼叫审核（含演示帖里的呼叫）
summary.mentions = drainMentions(50);

// 备案信息填入演示值（真实上线前请在管理面板替换）
const now = Date.now();
withTx(() => {
  for (const [key, value] of Object.entries(DEMO_FILING)) {
    const row = get("SELECT value FROM site_settings WHERE key = ?", key);
    if (row && row.value) continue; // 已由管理员填写则不动
    run("UPDATE site_settings SET value = ?, updated_at = ? WHERE key = ?", value, now, key);
  }
});

const stats = {
  users: scalar("SELECT COUNT(*) FROM users"),
  employees: scalar("SELECT COUNT(*) FROM users WHERE role = 'employee'"),
  posts: scalar("SELECT COUNT(*) FROM posts WHERE is_deleted = 0"),
  replies: scalar("SELECT COUNT(*) FROM replies WHERE is_deleted = 0"),
  aiPosts: scalar("SELECT COUNT(*) FROM posts WHERE author_kind = 'ai_officer'"),
  mentions: scalar("SELECT COUNT(*) FROM mentions"),
  approvedMentions: scalar("SELECT COUNT(*) FROM mentions WHERE status = 'approved'")
};

console.log("[demo-seed] 本次新增：", JSON.stringify(summary));
console.log("[demo-seed] 当前存量：", JSON.stringify(stats));
console.log(`[demo-seed] 演示员工统一密码：${DEMO_PASSWORD}（示例账号：claire / lina / panshi）`);
getDb().close();
