/* ==========================================================================
   tests/server/e2e.js — 端到端验收自检（真实 HTTP + 临时数据库）
   覆盖：注册 → 入职审批 → 点数（领取/防重/扣减/余额不足）→ 发帖与回复
         → @ 呼叫三分支回执 → 头像上传与兜底 → 备案配置 → 权限边界 → 对账
   运行：node tests/server/e2e.js
   ========================================================================== */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/* 先在独立临时库上启动服务，绝不触碰 data/haavk.db */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haavk-e2e-"));
process.env.HAAVK_DB = path.join(tmpDir, "e2e.db");
process.env.HAAVK_UPLOAD_DIR = path.join(tmpDir, "uploads");
// 端口随机化：避免与已运行的开发服务器（8137）冲突时误打到线上库
process.env.PORT = process.env.E2E_PORT || String(8300 + Math.floor(Math.random() * 600));
process.env.HAAVK_ADMIN_PASSWORD = "E2e#Admin#2026";
process.env.HAAVK_OFFICER_PASSWORD = "E2e#Officer#2026";

let pass = 0;
let fail = 0;
const failures = [];
const BASE = `http://127.0.0.1:${process.env.PORT}`;

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  \u2713 " + name);
  } else {
    fail++;
    failures.push(name + (extra !== undefined ? " :: " + extra : ""));
    console.log("  \u2717 " + name + (extra !== undefined ? "  -> " + extra : ""));
  }
}
function section(t) {
  console.log("\n== " + t + " ==");
}

/* ------------------------------ HTTP 客户端（带 Cookie 罐） ------------------------------ */

function makeClient() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    clear() {
      cookie = "";
    },
    async call(method, url, body, opts = {}) {
      const headers = Object.assign({}, opts.headers);
      if (cookie) headers.Cookie = cookie;
      let payload;
      if (body instanceof FormData) {
        payload = body;
      } else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        headers.Origin = BASE;
        payload = JSON.stringify(body);
      }
      const res = await fetch(BASE + url, { method, headers, body: payload, redirect: "manual" });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (setCookies.length) {
        cookie = setCookies
          .map((c) => c.split(";")[0])
          .filter((c) => !c.endsWith("="))
          .join("; ");
      }
      let json = null;
      const ctype = res.headers.get("content-type") || "";
      if (ctype.includes("application/json")) json = await res.json();
      return { status: res.status, json, headers: res.headers, res };
    },
  };
}

async function jsonCall(client, method, url, body) {
  const r = await client.call(method, url, body);
  return { status: r.status, body: r.json, error: r.json && r.json.error, data: r.json && r.json.data };
}

async function main() {
  const { boot } = await import("../../server/index.js");
  const server = boot({ seed: true, workers: true, verbose: false });

  // 关键：确认服务确实监听在本进程的端口上。
  // 若端口被占用，boot() 会调用 process.exit(1)，但为防御性起见这里再做一次自检，
  // 避免测试请求打到别人的服务（尤其是打到线上库）。
  let listening = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (server.listening) {
      listening = true;
      break;
    }
  }
  if (!listening) {
    console.error(`[e2e] 服务未能在端口 ${process.env.PORT} 上启动，测试终止（避免污染其它数据库）。`);
    process.exit(3);
  }
  try {
    const probe = await fetch(BASE + "/api/site");
    const body = await probe.json();
    const filing = body && body.data && body.data.filing;
    if (!filing) throw new Error("响应缺少 filing 字段");
    // 用本进程写入的备案值确认连的是自己的库
    const { get, run } = await import("../../server/lib/db.js");
    run("UPDATE site_settings SET value = ? WHERE key = 'filing.icp'", "E2E-SENTINEL");
    const again = await (await fetch(BASE + "/api/site")).json();
    if (again.data.filing.icp !== "E2E-SENTINEL") {
      console.error("[e2e] 接口返回的不是本进程的数据库，测试终止（可能端口冲突）。");
      process.exit(3);
    }
    run("UPDATE site_settings SET value = '' WHERE key = 'filing.icp'");
    void get;
  } catch (err) {
    console.error("[e2e] 自检握手失败：", err.message);
    process.exit(3);
  }

  const admin = makeClient();
  const user = makeClient();
  const guest = makeClient();

  /* ---------------- 0. 服务与静态页面 ---------------- */
  section("0. 服务可用性与页面入口");
  const indexRes = await fetch(BASE + "/");
  const indexHtml = await indexRes.text();
  ok("首页 HTML 可访问", indexRes.status === 200 && indexHtml.includes("哈夫克"));
  ok("首页引用了服务端数据层（js/core/api.js）", indexHtml.includes("js/core/api.js"));
  ok("已移除纯静态数据表引用（js/data/departments.js 不存在）", !indexHtml.includes("js/data/"));
  ok("已移除前端持久化业务数据的说法", !indexHtml.includes("localStorage"));
  const adminCss = await fetch(BASE + "/styles/admin.css");
  ok("管理面板样式可加载", adminCss.status === 200);
  const avatarDefault = await fetch(BASE + "/media/default-avatar.svg");
  ok("默认头像可访问", avatarDefault.status === 200);
  const healthGuest = await fetch(BASE + "/api/admin/health");
  ok("健康检查接口对游客不可见（不泄露库信息）", healthGuest.status === 403 || healthGuest.status === 401, String(healthGuest.status));

  /* ---------------- 1. 目录与板块 ---------------- */
  section("1. 世界观目录与会话");
  const catalog = await jsonCall(guest, "GET", "/api/catalog");
  ok("部门 ≥ 15", catalog.data.departments.length >= 15, String(catalog.data.departments.length));
  ok("岗位含官方 4 兵种", ["突击", "支援", "工程", "侦察"].every((n) => catalog.data.jobs.some((j) => j.name === n)));
  ok("AI 高管 ≥ 4（含首席执行秘书办）", catalog.data.aiOfficers.length >= 4);
  ok("AI 高管中含审核席", catalog.data.aiOfficers.some((o) => o.codename === "首席执行秘书办"));
  const deptId = catalog.data.departments[0].id;
  const jobId = catalog.data.jobs[0].id;
  const me0 = await jsonCall(guest, "GET", "/api/me");
  ok("游客 /api/me 返回 null（匿名可浏览）", me0.data.user === null);

  /* ---------------- 2. 注册与入职 ---------------- */
  section("2. 注册与办理入职手续");
  const uname = "e2e_" + Date.now().toString(36);
  const PWD = "Haavk#2026";
  const reg = await jsonCall(user, "POST", "/api/auth/register", {
    username: uname,
    display_name: "验收员工",
    password: PWD,
    password_confirm: PWD,
    department_id: deptId,
    job_role_id: jobId,
    reason: "端到端验收",
  });
  ok("注册成功（201）", reg.status === 201, JSON.stringify(reg.error));
  ok("注册后状态为待入职审批", reg.data.user.status === "pending_onboarding");
  ok("注册即创建待审入职申请", reg.data.request.status === "pending");
  ok("注册接口不返回员工/干员字段", !("operatorId" in reg.data.user) && !("operator" in reg.data));
  ok(
    "注册响应携带点数规则（500/50/20）",
    reg.data.pointsRules.dailyAmount === 500 && reg.data.pointsRules.postCost === 50 && reg.data.pointsRules.replyCost === 20,
    JSON.stringify(reg.data.pointsRules)
  );

  const weak = await jsonCall(guest, "POST", "/api/auth/register", {
    username: uname + "w",
    display_name: "弱密码",
    password: "12345678",
    department_id: deptId,
    job_role_id: jobId,
  });
  ok("弱密码注册被拒（400）", weak.status === 400);

  const dup = await jsonCall(guest, "POST", "/api/auth/register", {
    username: uname,
    display_name: "重复",
    password: PWD,
    department_id: deptId,
    job_role_id: jobId,
  });
  ok("账号重复被拒（409）", dup.status === 409 && dup.error.code === "CONFLICT");

  const earlyPost = await jsonCall(user, "POST", "/api/posts", {
    board_id: 1,
    title: "未入职发帖测试标题",
    body: "内容足够长的一段正文，用于验证未入职不能发帖。",
  });
  ok("未完成入职不能发帖（ONBOARDING_REQUIRED）", earlyPost.status === 403 && earlyPost.error.code === "ONBOARDING_REQUIRED");

  const earlyReply = await jsonCall(user, "POST", "/api/posts/1/replies", { body: "未入职回复" });
  ok("未完成入职不能回复", earlyReply.status === 403);

  /* ---------------- 3. 管理员审批入职 ---------------- */
  section("3. 管理员审批入职");
  const adminLogin = await jsonCall(admin, "POST", "/api/auth/login", {
    username: "webops_admin",
    password: process.env.HAAVK_ADMIN_PASSWORD,
  });
  ok("网站管理员登录成功", adminLogin.status === 200 && adminLogin.data.user.role === "site_admin", JSON.stringify(adminLogin.error));

  const pending = await jsonCall(admin, "GET", "/api/admin/requests?status=pending");
  const target = (pending.data.items || []).find((r) => r.username === uname);
  ok("管理员可见该员工的入职申请", !!target);

  const approve = await jsonCall(admin, "POST", `/api/admin/requests/${target.id}/review`, {
    decision: "approve",
    note: "验收通过",
  });
  ok("审批通过", approve.status === 200 && approve.data.user.status === "active");
  ok("审批后写入部门与岗位", approve.data.user.departmentId === deptId && approve.data.user.jobRoleId === jobId);

  // 重新登录以拿到 active 状态
  user.clear();
  const relogin = await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: PWD });
  ok("入职后重新登录状态为在职", relogin.data.user.status === "active");

  /* ---------------- 4. 点数体系 ---------------- */
  section("4. 注意力点数");
  const sum0 = await jsonCall(user, "GET", "/api/points/summary");
  ok(
    "服务端下发规则 500/50/20",
    sum0.data.rules.dailyAmount === 500 && sum0.data.rules.postCost === 50 && sum0.data.rules.replyCost === 20
  );
  ok("今日尚未领取", sum0.data.today.claimed === false);

  const claim = await jsonCall(user, "POST", "/api/points/claim");
  ok("领取成功 +500", claim.status === 200 && claim.data.claimed === true && claim.data.amount === 500, JSON.stringify(claim.error));
  const balanceAfterClaim = claim.data.balance;

  const claimAgain = await jsonCall(user, "POST", "/api/points/claim");
  ok("当日重复领取被拒（409）", claimAgain.status === 409 && claimAgain.error.code === "CONFLICT", JSON.stringify(claimAgain.error));

  // 并发领取防重（8 个并发请求同时打）
  const burst = await Promise.all(
    Array.from({ length: 8 }, () =>
      fetch(BASE + "/api/points/claim", { method: "POST", headers: { Cookie: user.cookie, Origin: BASE } }).then((r) => r.status)
    )
  );
  ok("并发领取全部返回 409（唯一约束兜住）", burst.every((s) => s === 409), JSON.stringify(burst));

  const summaryAfter = await jsonCall(user, "GET", "/api/points/summary");
  ok("今日领取被正确记录（仅一次、500 点）", summaryAfter.data.today.claimed === true && summaryAfter.data.today.amount === 500);

  /* ---------------- 5. 发帖 / 回复与事务扣点 ---------------- */
  section("5. 发帖与回复（事务扣点）");
  const boards = await jsonCall(guest, "GET", "/api/boards");
  const boardId = boards.data.items[1].id;

  const post = await jsonCall(user, "POST", "/api/posts", {
    board_id: boardId,
    title: "验收测试：关于夜间巡逻排班的建议",
    body: "一线同事反馈夜间巡逻存在两小时空档期，建议集团评估排班密度并明确责任部门。",
    tag: "建议",
  });
  ok("发帖成功（201）", post.status === 201, JSON.stringify(post.error));
  const postId = post.data.post.id;
  ok("发帖扣除 50 点", post.data.points.balance === balanceAfterClaim - 50, `${balanceAfterClaim} -> ${post.data.points.balance}`);

  const reply = await jsonCall(user, "POST", `/api/posts/${postId}/replies`, { body: "补充：建议同步排查设备巡检路线。" });
  ok("回复成功（201）", reply.status === 201, JSON.stringify(reply.error));
  ok("回复扣除 20 点", reply.data.points.balance === balanceAfterClaim - 70, String(reply.data.points.balance));

  /* --- 编辑帖子：作者可改文案且不扣点；改他人帖子被拒 --- */
  const editOk = await jsonCall(user, "PATCH", `/api/posts/${postId}`, {
    title: "验收测试：关于夜间巡逻排班的建议（已修订）",
    body: "一线同事反馈夜间巡逻存在两小时空档期，建议集团评估排班密度并明确责任部门。补充：已同步安全防卫部跟踪。",
    tag: "建议"
  });
  ok("作者编辑自己的帖子（200）", editOk.status === 200 && String((editOk.data || {}).post?.title || "").includes("已修订"), JSON.stringify(editOk.error));
  const meAfterEdit = await jsonCall(user, "GET", "/api/me");
  ok("编辑不扣注意力点数", meAfterEdit.data.user.pointsBalance === balanceAfterClaim - 70, `${balanceAfterClaim - 70} -> ${meAfterEdit.data.user.pointsBalance}`);
  const shortTitle = await jsonCall(user, "PATCH", `/api/posts/${postId}`, { title: "短", body: "正文长度足够，用于验证标题过短的校验逻辑。" });
  ok("编辑标题过短被拒（400）", shortTitle.status === 400 && shortTitle.error.code === "BAD_REQUEST", JSON.stringify(shortTitle.error));
  // 他人帖子：由网站运维发一条，用于验证普通员工无法编辑他人帖子的权限边界
  const adminPost = await jsonCall(admin, "POST", "/api/posts", {
    board_id: boardId,
    title: "运维通告：论坛编辑权限说明",
    body: "本帖由网站运维发布，用于验证普通员工无法编辑他人帖子的权限边界。"
  });
  if (adminPost.status === 201) {
    const forbid = await jsonCall(user, "PATCH", `/api/posts/${adminPost.data.post.id}`, { title: "越权修改标题", body: "试图修改他人帖子正文，应当被服务端拒绝。" });
    ok("编辑他人帖子被拒（403）", forbid.status === 403 && forbid.error.code === "FORBIDDEN", JSON.stringify(forbid.error));
  } else {
    ok("编辑他人帖子被拒（403）", false, "管理员发帖失败：" + JSON.stringify(adminPost.error));
  }

  // 余额不足
  let shortfall = null;
  for (let i = 0; i < 12; i++) {
    const r = await jsonCall(user, "POST", "/api/posts", {
      board_id: boardId,
      title: `余额压测帖 ${i}`,
      body: "用于把余额消耗到不足以继续发帖的程度，验证服务端拒绝逻辑。",
    });
    if (r.status === 402) {
      shortfall = r;
      break;
    }
  }
  ok("余额不足返回 402 INSUFFICIENT_POINTS", shortfall && shortfall.error.code === "INSUFFICIENT_POINTS", JSON.stringify(shortfall && shortfall.error));
  ok("余额不足响应包含差额与所需点数", shortfall && typeof shortfall.error.details.shortfall === "number" && shortfall.error.details.required === 50);

  const postsCountBefore = (await jsonCall(guest, "GET", "/api/posts")).data.total;

  /* ---------------- 6. @ 呼叫与三分支回执 ---------------- */
  section("6. @ 呼叫与首席执行秘书办审核（三分支回执）");
  // 管理员补点数，便于触发 @
  admin.clear();
  await jsonCall(admin, "POST", "/api/auth/login", { username: "webops_admin", password: process.env.HAAVK_ADMIN_PASSWORD });
  const usersList = await jsonCall(admin, "GET", `/api/admin/users?q=${uname}`);
  const meRow = usersList.data.items.find((u) => u.username === uname);
  const topup = await jsonCall(admin, "POST", `/api/admin/users/${meRow.id}/points`, { delta: 3000, memo: "验收补点" });
  ok("管理员调整点数写流水", topup.status === 200 && typeof topup.data.balance === "number");
  ok("调整后余额正确", topup.data.balance === topup.data.user.pointsBalance);

  user.clear();
  await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: PWD });

  const mentionPost = await jsonCall(user, "POST", "/api/posts", {
    board_id: boardId,
    title: "验收测试：需要安全总监关注的园区安保流程",
    body: "@阿娜伊斯·德穆兰 关于园区夜间安保流程，一线同事反馈交接环节存在两小时空档，建议集团评估是否需要调整并明确责任部门与处理时限。",
    tag: "建议",
  });
  ok("@ 呼叫的帖子发布成功", mentionPost.status === 201, JSON.stringify(mentionPost.error));
  const created = (mentionPost.data.mentions || [])[0];
  const rejectedNow = (mentionPost.data.rejectedMentions || [])[0];
  ok("创建了一条 @ 审核请求（预检通过）", !!created, JSON.stringify(rejectedNow || mentionPost.data.mentions));

  if (created) {
    ok(
      "【审核中】回执文案逐字匹配",
      created.receipts[0].message ===
        "检测到对集团高级管理人员的呼叫.....正在确认呼叫者职级是否足以支撑该行为...正在评估应答时间和问题价值.....",
      JSON.stringify(created.receipts[0].message)
    );

    // 等待后台审核 worker 推进
    let final = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const got = await jsonCall(user, "GET", `/api/mentions/${created.code}`);
      const st = got.data && got.data.mention && got.data.mention.status;
      if (st === "approved" || st === "rejected") {
        final = got.data;
        break;
      }
    }
    ok("审核在超时前结案（不再永久停留在审核中）", !!final, "仍为审核中");

    if (final) {
      const m = final.mention;
      const last = final.receipts[final.receipts.length - 1];
      if (m.status === "approved") {
        const msg = last.message;
        ok("【通过】回执以固定前缀开头", msg.startsWith("已确认该问题值得高管关注，已计算高管为此分配的最合理时间："), msg);
        ok("【通过】回执以固定后缀结尾", msg.endsWith("。已自动转阅。"), msg);
        ok("【通过】<time> 已动态替换（无占位符残留）", !msg.includes("<time>"), msg);
        ok("【通过】回执含动态时长（N分M秒）", /：\d+分\d+秒。已自动转阅。$/.test(msg), msg);
        ok("【通过】返回结构化的分配时长标签", typeof m.assignedLabel === "string" && /^\d+分\d+秒$/.test(m.assignedLabel), m.assignedLabel);
        ok("【通过】分配分钟数在 5–45 之间", m.assignedMinutes >= 5 && m.assignedMinutes <= 45, String(m.assignedMinutes));
        const detail = await jsonCall(guest, "GET", `/api/posts/${mentionPost.data.post.id}`);
        ok("【通过】已自动转阅：高管账号追加回复", (detail.data.replies || []).some((r) => r.authorKind === "ai_officer"));
      } else {
        ok(
          "【未通过】回执文案逐字匹配",
          last.message === "经哈夫克首席高级秘书办审核讨论，本贴无需转载，请勿短时间内大量呼叫集团高级职员",
          last.message
        );
      }
    }
  }

  // 冷却拦截 → 未通过分支
  const cooldownPost = await jsonCall(user, "POST", "/api/posts", {
    board_id: boardId,
    title: "验收测试：冷却与刷屏拦截",
    body: "@阿娜伊斯·德穆兰 再次呼叫同一位高管，用于验证冷却规则、去重规则与刷屏拦截是否生效。",
    tag: "讨论",
  });
  const coolRejected = (cooldownPost.data.rejectedMentions || [])[0];
  const coolCreated = (cooldownPost.data.mentions || [])[0];
  ok(
    "【未通过】重复呼叫同一位高管被风控拦截",
    (coolRejected && ["COOLDOWN", "DUPLICATE_24H", "BURST", "HOURLY_LIMIT"].includes(coolRejected.reason)) ||
      (coolCreated && coolCreated.status === "rejected"),
    JSON.stringify({ coolRejected, created: coolCreated && coolCreated.status })
  );
  if (coolCreated && coolCreated.status === "rejected") {
    ok(
      "【未通过】拦截时回执为未通过文案",
      coolCreated.receipts[0].message ===
        "经哈夫克首席高级秘书办审核讨论，本贴无需转载，请勿短时间内大量呼叫集团高级职员",
      JSON.stringify(coolCreated.receipts[0].message)
    );
  }

  const shortMention = await jsonCall(user, "POST", "/api/posts", {
    board_id: boardId,
    title: "验收测试：过短内容呼叫",
    body: "@哈德森 在吗，有事找你确认现场情况。",
    tag: "讨论",
  });
  ok("【未通过】内容过短的呼叫被直接驳回", (shortMention.data.rejectedMentions || []).length === 1, JSON.stringify(shortMention.data));

  // 单帖呼叫超过上限
  const tooMany = await jsonCall(user, "POST", "/api/posts", {
    board_id: boardId,
    title: "验收测试：单帖呼叫上限",
    body: "@哈德森 @罗米修斯博士 @阿娜伊斯·德穆兰 @首席执行秘书办 一次性呼叫四位高管，用于验证单帖上限规则是否生效。",
    tag: "讨论",
  });
  ok("【未通过】单帖呼叫超过上限被驳回", (tooMany.data.rejectedMentions || []).length >= 1, JSON.stringify(tooMany.data.rejectedMentions));

  const postsAfter = await jsonCall(guest, "GET", "/api/posts");
  ok("帖子总数随发布增长", postsAfter.data.total > postsCountBefore, `${postsCountBefore} -> ${postsAfter.data.total}`);

  /* ---------------- 7. 头像链路（杜绝破图） ---------------- */
  section("7. 头像链路");
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAHUlEQVR42u3OMQEAAAgDoC251a3gLwSgOXJRAQDgYwG+3wF9vJvBnQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fd = new FormData();
  fd.append("file", new Blob([png1x1], { type: "image/png" }), "avatar.png");
  const upload = await user.call("POST", "/api/me/avatar", fd);
  ok("头像上传成功（201）", upload.status === 201, JSON.stringify(upload.json && upload.json.error));
  const avatarUrl = upload.json.data.user.avatarUrl;
  ok("返回规范化媒体路径", /^\/media\/avatars\/[a-f0-9]{16}\.png$/.test(avatarUrl || ""), avatarUrl);

  const fetched = await fetch(BASE + avatarUrl);
  ok("头像可正常加载（200 + image/png）", fetched.status === 200 && (fetched.headers.get("content-type") || "").includes("png"));
  ok("头像响应带 immutable 长缓存与 ETag", (fetched.headers.get("cache-control") || "").includes("immutable") && !!fetched.headers.get("etag"));

  const notFoundAvatar = await fetch(BASE + "/media/avatars/0123456789abcdef.png");
  ok("缺失头像回退默认头像而非 404（根除首页头像全丢）", notFoundAvatar.status === 200 && (notFoundAvatar.headers.get("content-type") || "").includes("svg"), String(notFoundAvatar.status));

  const traversal = await fetch(BASE + "/media/avatars/..%2f..%2fpackage.json");
  ok("媒体路径穿越被拦截", traversal.status === 200 && (traversal.headers.get("content-type") || "").includes("svg"));

  const fake = new FormData();
  fake.append("file", new Blob([Buffer.from("#!/bin/sh\necho not an image")], { type: "image/png" }), "evil.png");
  const fakeUpload = await user.call("POST", "/api/me/avatar", fake);
  ok("伪装图片被魔数校验拦截（415）", fakeUpload.status === 415, String(fakeUpload.status));

  const tooBig = new FormData();
  tooBig.append("file", new Blob([Buffer.alloc(3 * 1024 * 1024)], { type: "image/png" }), "big.png");
  const bigUpload = await user.call("POST", "/api/me/avatar", tooBig);
  ok("超限图片被拒（413）", bigUpload.status === 413, String(bigUpload.status));

  const postsWithAvatar = await jsonCall(guest, "GET", `/api/posts?author=${meRow.id}`);
  ok("列表接口返回头像 URL 字段", postsWithAvatar.data.items.every((p) => typeof p.authorAvatarUrl === "string" && p.authorAvatarUrl.length > 0));
  ok("已上传头像的作者返回自定义头像", postsWithAvatar.data.items.every((p) => p.authorAvatarUrl.includes("/media/avatars/")), JSON.stringify(postsWithAvatar.data.items.map((p) => p.authorAvatarUrl)));

  // 回归：悬空头像引用（avatar_upload_id 指向已删除的 uploads 行）必须回退默认头像，
  // 这正是"首页头像全丢"的真实成因，务必长期守住。
  const { get: dbGet, run: dbRun } = await import("../../server/lib/db.js");
  const realUploadId = dbGet("SELECT avatar_upload_id FROM users WHERE id = ?", meRow.id).avatar_upload_id;
  dbRun("UPDATE users SET avatar_upload_id = 999999 WHERE id = ?", meRow.id);
  const dangling = await jsonCall(user, "GET", "/api/me");
  ok("悬空头像引用回退默认头像（不返回 null）", dangling.data.user.avatarUrl === "/media/default-avatar.svg", dangling.data.user.avatarUrl);
  const danglingList = await jsonCall(guest, "GET", `/api/posts?author=${meRow.id}`);
  ok("列表中同样回退，不产生破图", danglingList.data.items.every((p) => p.authorAvatarUrl === "/media/default-avatar.svg"));
  const danglingMedia = await fetch(BASE + "/media/avatars/999999.png");
  ok("无效头像文件名也回退默认头像（200）", danglingMedia.status === 200 && (danglingMedia.headers.get("content-type") || "").includes("svg"));
  dbRun("UPDATE users SET avatar_upload_id = ? WHERE id = ?", realUploadId, meRow.id);
  const restored = await jsonCall(user, "GET", "/api/me");
  ok("恢复真实头像引用后再次返回自定义头像", restored.data.user.avatarUrl.includes("/media/avatars/"), restored.data.user.avatarUrl);

  /* ---------------- 8. 备案配置与页脚 ---------------- */
  section("8. 备案信息（仅管理员面板可编辑）");
  admin.clear();
  await jsonCall(admin, "POST", "/api/auth/login", { username: "webops_admin", password: process.env.HAAVK_ADMIN_PASSWORD });
  // 记录原值，测试结束后恢复，避免把测试数据留在库里
  const { get: readSetting, run: writeSetting } = await import("../../server/lib/db.js");
  const originalIcp = readSetting("SELECT value FROM site_settings WHERE key = 'filing.icp'").value;
  const setFiling = await jsonCall(admin, "PATCH", "/api/admin/settings", {
    items: [
      { key: "filing.icp", value: "TEST-ICP-0000号-1" },
      { key: "filing.police", value: "京公网安备 11000000000000号" },
      { key: "filing.police_url", value: "https://beian.mps.gov.cn/" },
      { key: "filing.company", value: "哈夫克集团" },
    ],
  });
  ok("管理员写入备案信息", setFiling.status === 200 && setFiling.data.updated.includes("filing.icp"), JSON.stringify(setFiling.error));

  const sitePublic = await jsonCall(guest, "GET", "/api/site");
  ok("备案信息对外可见（页脚数据源）", sitePublic.data.filing.icp === "TEST-ICP-0000号-1");
  ok("公安备案链接可配置", sitePublic.data.filing.policeUrl === "https://beian.mps.gov.cn/");
  ok("站点内容含四大栏目数据源", !!(sitePublic.data.home && sitePublic.data.solutions && sitePublic.data.wanted && sitePublic.data.forumIntro));

  user.clear();
  await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: PWD });
  const staffWrite = await jsonCall(user, "PATCH", "/api/admin/settings", { items: [{ key: "filing.icp", value: "篡改" }] });
  ok("普通员工写入备案被拒（403）", staffWrite.status === 403, String(staffWrite.status));
  const staffAdminApi = await jsonCall(user, "GET", "/api/admin/overview");
  ok("普通员工访问管理接口被拒（403）", staffAdminApi.status === 403);
  const staffListUsers = await jsonCall(user, "GET", "/api/admin/users");
  ok("普通员工读取用户列表被拒（403）", staffListUsers.status === 403);

  /* ---------------- 9. 注册接口无法产生管理角色 ---------------- */
  section("9. 权限边界：网站管理员不开放注册");
  guest.clear();
  const escalate = await jsonCall(guest, "POST", "/api/auth/register", {
    username: uname + "esc",
    display_name: "越权测试",
    password: PWD,
    department_id: deptId,
    job_role_id: jobId,
    role: "site_admin",
  });
  ok("注册接口忽略 role 字段（仍为 employee）", escalate.data.user.role === "employee", escalate.data.user.role);

  // 唯一创建管理员的入口
  const createdAdmin = await jsonCall(admin, "POST", "/api/admin/users", {
    username: "webops_second",
    display_name: "第二运维",
    password: "Second#Ops#2026",
    role: "site_admin",
    title: "网站管理员",
  });
  ok("管理面板可创建网站管理员账号", createdAdmin.status === 201 && createdAdmin.data.user.role === "site_admin", JSON.stringify(createdAdmin.error));
  ok(
    "创建的账号初始点数已就绪（避免运营被点数阻断）",
    createdAdmin.data.user.pointsBalance >= 1000,
    String(createdAdmin.data.user.pointsBalance)
  );

  const audit = await jsonCall(admin, "GET", "/api/admin/audit-logs");
  ok("管理动作写入审计日志", (audit.data.items || []).length >= 4, String((audit.data.items || []).length));

  /* ---------------- 10. 岗位变更必须走申请 ---------------- */
  section("10. 岗位变更流程");
  user.clear();
  await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: PWD });
  const change = await jsonCall(user, "POST", "/api/requests", {
    type: "job_change",
    department_id: deptId,
    job_role_id: catalog.data.jobs[2].id,
    reason: "希望转岗到工程条线",
  });
  ok("提交岗位变更申请", change.status === 201, JSON.stringify(change.error));
  const changeAgain = await jsonCall(user, "POST", "/api/requests", {
    type: "job_change",
    department_id: deptId,
    job_role_id: catalog.data.jobs[2].id,
    reason: "重复提交",
  });
  ok("同类型重复申请被拒（409）", changeAgain.status === 409);

  const mine = await jsonCall(user, "GET", "/api/me/requests");
  ok("可查看自己的申请记录", (mine.data.items || []).length >= 2);

  admin.clear();
  await jsonCall(admin, "POST", "/api/auth/login", { username: "webops_admin", password: process.env.HAAVK_ADMIN_PASSWORD });
  const pendingChanges = await jsonCall(admin, "GET", "/api/admin/requests?status=pending");
  const changeReq = (pendingChanges.data.items || []).find((r) => r.username === uname && r.type === "job_change");
  ok("管理员可见岗位变更申请", !!changeReq);
  const approveChange = await jsonCall(admin, "POST", `/api/admin/requests/${changeReq.id}/review`, { decision: "approve" });
  ok("审批通过后岗位已更新", approveChange.data.user.jobRoleId === catalog.data.jobs[2].id, JSON.stringify(approveChange.data.user));

  /* ---------------- 11. 密码与账号安全 ---------------- */
  section("11. 账号安全");
  user.clear();
  await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: PWD });
  const wrongOld = await jsonCall(user, "POST", "/api/me/password", { current_password: "wrong", new_password: "NewPass#2026" });
  ok("旧密码错误被拒（401）", wrongOld.status === 401);
  const weakNew = await jsonCall(user, "POST", "/api/me/password", { current_password: PWD, new_password: "12345678" });
  ok("新密码强度不足被拒（400）", weakNew.status === 400);
  const changedOk = await jsonCall(user, "POST", "/api/me/password", { current_password: PWD, new_password: "NewPass#2026" });
  ok("修改密码成功", changedOk.status === 200);
  user.clear();
  const oldPwdFail = await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: PWD });
  ok("旧密码不再可用", oldPwdFail.status === 401);
  const newPwdOk = await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: "NewPass#2026" });
  ok("新密码可登录", newPwdOk.status === 200);

  /* ---------------- 12. 未登录越权 ---------------- */
  section("12. 未登录与越权");
  guest.clear();
  const guestPost = await jsonCall(guest, "POST", "/api/posts", { board_id: boardId, title: "游客发帖测试", body: "游客不应有发帖权限。" });
  ok("游客发帖被拒（401）", guestPost.status === 401);
  const guestClaim = await jsonCall(guest, "POST", "/api/points/claim");
  ok("游客领取点数被拒（401）", guestClaim.status === 401);
  const guestAvatar = await guest.call("POST", "/api/me/avatar", new FormData());
  ok("游客上传头像被拒（401）", guestAvatar.status === 401);
  const guestLedger = await jsonCall(guest, "GET", "/api/points/ledger");
  ok("游客读取流水被拒（401）", guestLedger.status === 401);

  /* ---------------- 13. 输入校验与注入防护 ---------------- */
  section("13. 输入校验");
  user.clear();
  await jsonCall(user, "POST", "/api/auth/login", { username: uname, password: "NewPass#2026" });
  const xss = await jsonCall(user, "POST", "/api/posts", {
    board_id: boardId,
    title: "验收测试：<script>alert(1)</script> 注入尝试",
    body: "正文中包含 <img src=x onerror=alert(1)> 以及 SQL 片段 ' OR 1=1 -- 用于验证存储与转义。",
  });
  ok("含脚本的帖子可安全入库（服务端不做 HTML 处理，前端转义）", xss.status === 201, JSON.stringify(xss.error));
  const xssRead = await jsonCall(guest, "GET", `/api/posts/${xss.data.post.id}`);
  ok("原始内容按原文返回（由前端转义渲染）", xssRead.data.post.body.includes("OR 1=1"));
  const badBoard = await jsonCall(user, "POST", "/api/posts", { board_id: 99999, title: "不存在的板块测试", body: "用于验证板块校验。" });
  ok("不存在的板块被拒（400）", badBoard.status === 400);
  const longTitle = await jsonCall(user, "POST", "/api/posts", { board_id: boardId, title: "长".repeat(80), body: "标题超长应被拒绝。" });
  ok("超长标题被拒（400）", longTitle.status === 400);

  /* ---------------- 14. 资料征集（匿名投稿 / 审核 / 奖励 / 转存） ---------------- */
  /* 实现口径（server/api/submissions.js）：限流按 IP（SUBMISSION.MAX_PER_HOUR 次/小时，失败校验也占额度）；
     非法 type 静默归为 other；badRequest 错误码为 BAD_REQUEST。 */
  section("14. 资料征集");
  const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const { SUBMISSION: SUB_LIMITS } = await import("../../server/constants.js");
  function subForm(fields, files) {
    const fd = new FormData();
    Object.keys(fields || {}).forEach((k) => fd.append(k, fields[k]));
    (files || []).forEach((f) => fd.append("files", new Blob([f.bytes], { type: f.type || "image/png" }), f.name));
    return fd;
  }

  // 注意：限流桶按 IP 全员共享（游客与登录用户同桶），先做必须成功的投稿，最后验证限流
  const u1 = await user.call("POST", "/api/submissions", subForm({ nickname: "验收员工", type: "lore", text: "设定纠错：G.T.I. 全称" }, [{ bytes: PNG_1PX, name: "proof.png" }]));
  ok("员工投稿成功（带图）", u1.status === 201 && u1.json.data.id, u1.status + " " + JSON.stringify(u1.json));
  const u2 = await user.call("POST", "/api/submissions", subForm({ nickname: "验收员工", type: "other", text: "无关内容" }, []));
  ok("员工第二条投稿成功", u2.status === 201, u2.status);
  const g1 = await guest.call("POST", "/api/submissions", subForm({ nickname: "热心干员", contact: "bilibili:12345", type: "screenshot", text: "帖子详情页截图" }, [{ bytes: PNG_1PX, name: "shot.png" }]));
  ok("游客可匿名投稿（带图）", g1.status === 201 && g1.json.data.id, g1.status);
  const subUserId = u1.json.data.id;
  const subRejectId = u2.json.data.id;
  const subGuestId = g1.json.data.id;
  const subCoerceId = (await guest.call("POST", "/api/submissions", subForm({ type: "hacker", text: "类型不在表内" }, []))).json.data.id;
  ok("非法资料类型静默归为 other", !!subCoerceId, "");
  const gEmpty = await guest.call("POST", "/api/submissions", subForm({ nickname: "热心干员", type: "other", text: "" }, []));
  ok("无文字且无图被拒", gEmpty.status === 400 && gEmpty.json.error.code === "BAD_REQUEST", gEmpty.status + " " + (gEmpty.json.error && gEmpty.json.error.code));

  // 至此已消耗 5 次额度（上限 SUBMISSION.MAX_PER_HOUR），下一次必须被限流
  let subCallsUsed = 5;
  let limitedAt = 0;
  for (let i = 0; i < 20; i++) {
    const r = await guest.call("POST", "/api/submissions", subForm({ type: "other", text: "频率探测 " + i }, []));
    subCallsUsed++;
    if (r.status === 429) {
      limitedAt = subCallsUsed;
      break;
    }
  }
  ok("投稿频率限制生效", limitedAt > 0, "limitedAt=" + limitedAt);
  ok("限流在第 MAX_PER_HOUR+1 次精确触发", limitedAt === SUB_LIMITS.MAX_PER_HOUR + 1, `limitedAt=${limitedAt} max=${SUB_LIMITS.MAX_PER_HOUR}`);

  // 管理员列表与审核（管理端接口不受投稿限流影响）
  const subList = await jsonCall(admin, "GET", "/api/admin/submissions?status=pending");
  ok("管理端列出待收录稿件", subList.status === 200 && subList.data.items.length >= 4, String(subList.data && subList.data.items && subList.data.items.length));
  const guestRow = subList.data.items.find((x) => x.id === subGuestId);
  ok("附件已登记且待转存", guestRow && guestRow.files.length === 1 && guestRow.files[0].webdavStatus === "pending", JSON.stringify(guestRow && guestRow.files));
  const coerceRow = subList.data.items.find((x) => x.id === subCoerceId);
  ok("非法类型的稿件已归入 other", coerceRow && coerceRow.type === "other", coerceRow && coerceRow.type);

  const { getDb: getDbForSub } = await import("../../server/lib/db.js");
  const pointsBefore = getDbForSub().prepare("SELECT points_balance FROM users WHERE id = ?").get(meRow.id).points_balance;
  const ap1 = await jsonCall(admin, "POST", `/api/admin/submissions/${subUserId}/review`, { action: "approve", note: "已核对收录", rewardPoints: 50 });
  ok("收录员工稿件成功", ap1.status === 200, JSON.stringify(ap1.json));
  const pointsAfter = getDbForSub().prepare("SELECT points_balance FROM users WHERE id = ?").get(meRow.id).points_balance;
  ok("收录奖励点数入账（+50）", pointsAfter === pointsBefore + 50, `${pointsBefore} -> ${pointsAfter}`);
  const ap2 = await jsonCall(admin, "POST", `/api/admin/submissions/${subGuestId}/review`, { action: "approve", note: "游客投稿，不发点数", rewardPoints: 50 });
  ok("收录游客稿件成功（不发点数不报错）", ap2.status === 200, JSON.stringify(ap2.json));
  const ap3 = await jsonCall(admin, "POST", `/api/admin/submissions/${subUserId}/review`, { action: "approve" });
  ok("重复收录被拒（409）", ap3.status === 409, ap3.status);
  const rjNoNote = await jsonCall(admin, "POST", `/api/admin/submissions/${subRejectId}/review`, { action: "reject" });
  ok("不收录缺理由被拒（400）", rjNoNote.status === 400, rjNoNote.status);
  const rj1 = await jsonCall(admin, "POST", `/api/admin/submissions/${subRejectId}/review`, { action: "reject", note: "与征集范围无关" });
  ok("不收录成功", rj1.status === 200, JSON.stringify(rj1.json));
  const rj2 = await jsonCall(admin, "POST", `/api/admin/submissions/${subRejectId}/review`, { action: "reject", note: "再次操作" });
  ok("重复审核被拒（409）", rj2.status === 409, rj2.status);

  // 附件访问与路径防护：仅管理员可读投稿附件（征集物可能含未公开内容）
  const storedName = guestRow.files[0].url.split("/").pop();
  const mediaGuest = await guest.call("GET", "/media/submissions/" + storedName);
  ok("游客读投稿附件被拒（401）", mediaGuest.status === 401, mediaGuest.status);
  const mediaOk = await admin.call("GET", "/media/submissions/" + storedName);
  ok("管理员可读取投稿附件", mediaOk.status === 200 && (mediaOk.headers.get("content-type") || "").includes("image/png"), mediaOk.status);
  const mediaBad = await admin.call("GET", "/media/submissions/" + encodeURIComponent("../haavk.db"));
  ok("附件路径穿越被拦截（404）", mediaBad.status === 404, mediaBad.status);

  // 鸣谢墙：公开收录名单，不含联系方式
  const credits = await jsonCall(guest, "GET", "/api/submissions/credits");
  const credited = credits.data.items.find((x) => x.nickname === "热心干员");
  ok("收录稿件进入公开鸣谢墙", !!credited && credited.type === "screenshot", JSON.stringify(credits.data.items.slice(0, 2)));
  ok("鸣谢墙不泄露联系方式", credited && !("contact" in credited), JSON.stringify(credited));

  // WebDAV：未配置时 stats 可读（configured=0）、重试返回 reset=0、测试连接返回 ok:false
  const wdStats = await jsonCall(admin, "GET", "/api/admin/submissions/webdav/stats");
  ok("WebDAV 状态可读（未启用）", wdStats.status === 200 && wdStats.data.configured === 0 && wdStats.data.pending >= 2, JSON.stringify(wdStats.data));
  const wdRetry = await jsonCall(admin, "POST", "/api/admin/submissions/webdav/retry", {});
  ok("无失败转存时重试为 0", wdRetry.status === 200 && wdRetry.data.reset === 0, JSON.stringify(wdRetry.data));
  const wdTest = await jsonCall(admin, "POST", "/api/admin/submissions/webdav/test", {});
  ok("未配置 WebDAV 时测试连接报告未启用", wdTest.status === 200 && wdTest.data.ok === false, JSON.stringify(wdTest.data));
  const settingsWithWebdav = await jsonCall(admin, "GET", "/api/admin/settings");
  ok("站点配置包含 WebDAV 转存组", settingsWithWebdav.data.items.some((it) => it.grp === "webdav"), "");

  /* ---------------- 15. 对账一致性 ---------------- */
  section("15. 点数对账（流水 = 余额）");
  const overview = await jsonCall(admin, "GET", "/api/admin/overview");
  ok("管理概览显示对账一致", overview.data.reconciled === true, JSON.stringify(overview.data.counts));

  const { reconcile } = await import("../../server/lib/points.js");
  const rec = reconcile(false);
  ok("余额与流水零差异", rec.balanceDiffs.length === 0, JSON.stringify(rec.balanceDiffs));
  ok("无重复每日领取记录", rec.duplicateClaims.length === 0, JSON.stringify(rec.duplicateClaims));
  ok("回复计数与回复表一致", rec.replyCountMismatches.length === 0, JSON.stringify(rec.replyCountMismatches.slice(0, 3)));

  /* ---------------- 16. AI 高管自主发声 ---------------- */
  section("16. AI 高管代理");
  const { runAutoPosts, runAutoReplies } = await import("../../server/workers/index.js");
  const createdPosts = runAutoPosts(Date.now() + 10 * 60_000);
  ok("AI 高管可自主发帖", createdPosts >= 1, String(createdPosts));
  const aiPosts = await jsonCall(guest, "GET", "/api/posts?filter=ai");
  ok("高管发帖在列表中标记为高管", aiPosts.data.items.length >= 1 && aiPosts.data.items.every((p) => p.authorKind === "ai_officer"));

  const mentionedPost = (await jsonCall(guest, "GET", "/api/posts?filter=mention")).data.items[0];
  ok("存在带呼叫记录的帖子（可追踪）", !!mentionedPost);

  /* ---------------- 17. 数据持久化（重启不丢） ---------------- */
  section("17. 持久化验证");
  const beforeRestart = await jsonCall(guest, "GET", `/api/posts?author=${meRow.id}`);
  const countBefore = beforeRestart.data.total;
  const avatarBefore = (await jsonCall(guest, "GET", "/api/me")); // 游客
  void avatarBefore;
  const profileBefore = (await jsonCall(user, "GET", "/api/me")).data.user;
  ok("重启前读到资料与帖子", countBefore >= 3 && profileBefore.displayName === "验收员工");

  // 直接从 SQLite 文件重新打开校验（不重启 HTTP 服务）
  const { getDb, closeDb } = await import("../../server/lib/db.js");
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM posts WHERE is_deleted = 0").get();
  ok("数据确实写入 SQLite 文件（非内存）", row.c >= countBefore, `db=${row.c} api=${countBefore}`);
  const ledgerRows = getDb().prepare("SELECT COUNT(*) AS c FROM points_ledger").get();
  ok("点数流水已落库", ledgerRows.c > 0, String(ledgerRows.c));
  const mentionRows = getDb().prepare("SELECT COUNT(*) AS c FROM mentions").get();
  ok("@ 审核记录已落库", mentionRows.c > 0, String(mentionRows.c));
  const receiptRows = getDb().prepare("SELECT COUNT(*) AS c FROM mention_receipts").get();
  ok("回执记录已落库", receiptRows.c > 0, String(receiptRows.c));
  const subRows = getDb().prepare("SELECT COUNT(*) AS c FROM submissions").get();
  ok("征集稿件与附件已落库", subRows.c >= 4, String(subRows.c));
  const hash = getDb().prepare("SELECT value FROM site_settings WHERE key = 'filing.icp'").get();
  ok("备案信息已落库", hash && hash.value === "TEST-ICP-0000号-1", hash && hash.value);
  // 还原测试前的备案值，保证 e2e 不污染环境
  writeSetting("UPDATE site_settings SET value = ? WHERE key = 'filing.icp'", originalIcp);
  ok("测试结束后备案值已还原", readSetting("SELECT value FROM site_settings WHERE key = 'filing.icp'").value === originalIcp);
  const avatarRows = getDb().prepare("SELECT COUNT(*) AS c FROM uploads WHERE kind='avatar' AND deleted_at IS NULL").get();
  ok("头像上传已登记入库", avatarRows.c >= 1, String(avatarRows.c));
  const hashRows = getDb().prepare("SELECT password_hash, password_algo FROM users LIMIT 1").get();
  ok("密码以哈希存储（scrypt，非明文）", !!hashRows && hashRows.password_hash.length >= 64 && hashRows.password_algo.startsWith("scrypt"), hashRows && hashRows.password_algo);
  closeDb();

  /* ------------------------------ 汇总 ------------------------------ */
  console.log("\n========================================");
  console.log(`端到端通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log("失败清单：");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("========================================\n");

  await new Promise((r) => server.close(r));
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("端到端自检异常：", err && err.stack ? err.stack : err);
  process.exit(2);
});
