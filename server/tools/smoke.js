/* ==========================================================================
   接口冒烟自检：启动服务 → 逐项打真实 HTTP 请求 → 输出通过/失败
   用法：node server/tools/smoke.js [baseUrl]
   若不传 baseUrl，会在临时数据库上自动启动服务。
   ========================================================================== */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const tmpDir = path.join(os.tmpdir(), "haavk-smoke-" + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
process.env.HAAVK_DB = path.join(tmpDir, "smoke.db");
process.env.HAAVK_UPLOAD_DIR = path.join(tmpDir, "uploads");
process.env.PORT = process.env.SMOKE_PORT || "8151";
process.env.HAAVK_ADMIN_PASSWORD = "Smoke#Admin#2026";
process.env.HAAVK_OFFICER_PASSWORD = "Smoke#Officer#2026";

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  \u2713 " + name);
  } else {
    fail++;
    failures.push(name + (extra ? " :: " + extra : ""));
    console.log("  \u2717 " + name + (extra ? "  -> " + extra : ""));
  }
}

const BASE = process.argv[2] || `http://127.0.0.1:${process.env.PORT}`;

let cookie = "";
async function call(method, url, { body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) {
    h["Content-Type"] = "application/json";
    h.Origin = BASE;
  }
  const res = await fetch(BASE + url, {
    method,
    headers: h,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (raw) return res;
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function main() {
  let server = null;
  if (!process.argv[2]) {
    const { boot } = await import("../index.js");
    server = boot({ seed: true, workers: true, verbose: false });
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log("\n=== 接口冒烟自检 " + BASE + " ===\n");

  // ---------- 公共接口 ----------
  const site = await call("GET", "/api/site");
  ok("GET /api/site 返回站点内容", site.status === 200 && site.json?.ok === true && !!site.json.data.home);
  ok("站点内容含四大栏目的数据源", !!(site.json?.data.home && site.json?.data.solutions && site.json?.data.wanted));

  const catalog = await call("GET", "/api/catalog");
  ok("GET /api/catalog 返回部门与岗位", catalog.json?.data?.departments?.length >= 15 && catalog.json?.data?.jobs?.length >= 5);
  ok("目录包含 AI 高管列表", catalog.json?.data?.aiOfficers?.length >= 4);
  const deptId = catalog.json.data.departments[0].id;
  const jobId = catalog.json.data.jobs[0].id;

  const boards = await call("GET", "/api/boards");
  ok("GET /api/boards 返回 7 个板块", boards.json?.data?.items?.length === 7, String(boards.json?.data?.items?.length));

  const me0 = await call("GET", "/api/me");
  ok("未登录 GET /api/me 返回 user:null", me0.json?.data?.user === null);

  // ---------- 注册与入职 ----------
  const uname = "smoke_" + Date.now().toString(36);
  const reg = await call("POST", "/api/auth/register", {
    body: {
      username: uname,
      display_name: "冒烟测试员",
      password: "Smoke#2026",
      password_confirm: "Smoke#2026",
      department_id: deptId,
      job_role_id: jobId,
      reason: "自动化冒烟"
    }
  });
  ok("注册成功并返回用户", reg.status === 201 && reg.json?.data?.user?.username === uname, JSON.stringify(reg.json?.error));
  ok("注册后处于待入职状态", reg.json?.data?.user?.status === "pending_onboarding");
  ok("注册返回入职申请", reg.json?.data?.request?.status === "pending");
  ok("注册响应中不含员工/干员字段", !("operator" in (reg.json?.data?.user || {})));

  const dupReg = await call("POST", "/api/auth/register", {
    body: { username: uname, display_name: "重复", password: "Smoke#2026", department_id: deptId, job_role_id: jobId }
  });
  ok("重复账号注册被拒（CONFLICT）", dupReg.status === 409 && dupReg.json?.error?.code === "CONFLICT");

  const weakReg = await call("POST", "/api/auth/register", {
    body: { username: uname + "x", display_name: "弱密码", password: "12345678", department_id: deptId, job_role_id: jobId }
  });
  ok("弱密码注册被拒", weakReg.status === 400);

  // 未入职不能发帖
  const earlyPost = await call("POST", "/api/posts", { body: { board_id: boards.json.data.items[0].id, title: "未入职发帖测试", body: "这是一段足够长的正文内容用于校验。" } });
  ok("未完成入职发帖被拒（ONBOARDING_REQUIRED）", earlyPost.status === 403 && earlyPost.json?.error?.code === "ONBOARDING_REQUIRED", earlyPost.json?.error?.code);

  // 管理员登录并审批
  cookie = "";
  const adminLogin = await call("POST", "/api/auth/login", { body: { username: "webops_admin", password: "Smoke#Admin#2026" } });
  ok("网站管理员登录成功", adminLogin.status === 200 && adminLogin.json?.data?.user?.role === "site_admin", JSON.stringify(adminLogin.json?.error));

  const reqList = await call("GET", "/api/admin/requests?status=pending");
  ok("管理员可见待审入职申请", Array.isArray(reqList.json?.data?.items) && reqList.json.data.items.length >= 1);
  const myReq = reqList.json.data.items.find((r) => r.username === uname);
  ok("找到该用户的入职申请", !!myReq);

  const review = await call("POST", `/api/admin/requests/${myReq.id}/review`, { body: { decision: "approve", note: "冒烟通过" } });
  ok("审批通过", review.status === 200 && review.json?.data?.user?.status === "active", JSON.stringify(review.json?.error));
  ok("审批后写入了部门与岗位", review.json?.data?.user?.departmentId === deptId && review.json?.data?.user?.jobRoleId === jobId);

  // 审批后必须重新登录普通员工会话（上面的会话已被管理员登录覆盖）
  cookie = "";
  const relogin = await call("POST", "/api/auth/login", { body: { username: uname, password: "Smoke#2026" } });
  ok("入职后重新登录，状态为在职", relogin.json?.data?.user?.status === "active", JSON.stringify(relogin.json?.data?.user));

  // 备案配置（这组断言必须使用管理员会话）
  cookie = "";
  const adminLogin2 = await call("POST", "/api/auth/login", { body: { username: "webops_admin", password: "Smoke#Admin#2026" } });
  ok("管理员再次登录成功", adminLogin2.status === 200);
  const setRes = await call("PATCH", "/api/admin/settings", {
    body: { items: [{ key: "filing.icp", value: "京ICP备12345678号-1" }, { key: "filing.company", value: "哈夫克集团" }] }
  });
  ok("管理员可写入备案信息", setRes.status === 200 && setRes.json.data.updated.includes("filing.icp"), JSON.stringify(setRes.json?.error));
  const site2 = await call("GET", "/api/site");
  ok("备案信息对外可见", site2.json?.data?.filing?.icp === "京ICP备12345678号-1", JSON.stringify(site2.json?.data?.filing));

  const notEditable = await call("PATCH", "/api/admin/settings", { body: { items: [{ key: "points.daily_amount", value: "-5" }] } });
  ok("非法数值配置被范围保护拒绝", notEditable.status === 200 && notEditable.json.data.updated.length === 0);
  const stillOk = await call("GET", "/api/site");
  ok("点数规则未被非法值污染（仍为 500）", stillOk.json?.data?.settings?.points?.dailyAmount === 500);

  // 非管理员不得写入配置
  cookie = "";
  const login2 = await call("POST", "/api/auth/login", { body: { username: uname, password: "Smoke#2026" } });
  ok("普通员工登录成功", login2.status === 200 && login2.json?.data?.user?.role === "employee");
  const forbid = await call("PATCH", "/api/admin/settings", { body: { items: [{ key: "filing.icp", value: "hacked" }] } });
  ok("普通员工写配置被拒（FORBIDDEN）", forbid.status === 403, String(forbid.status));

  // 注册接口不能产生管理员（使用独立未登录会话，避免覆盖当前登录态）
  const savedCookie = cookie;
  cookie = "";
  const roleEscalate = await call("POST", "/api/auth/register", {
    body: { username: uname + "y", display_name: "越权", password: "Smoke#2026", department_id: deptId, job_role_id: jobId, role: "site_admin" }
  });
  ok("注册接口无法自定义角色（仍为 employee）", roleEscalate.json?.data?.user?.role === "employee");
  cookie = savedCookie;

  // ---------- 点数 ----------
  const sum0 = await call("GET", "/api/points/summary");
  ok("点数规则为 500 / 50 / 20", sum0.json?.data?.rules?.dailyAmount === 500 && sum0.json?.data?.rules?.postCost === 50 && sum0.json?.data?.rules?.replyCost === 20, JSON.stringify(sum0.json?.data?.rules));

  const claim1 = await call("POST", "/api/points/claim");
  ok("首次领取成功 +500", claim1.status === 200 && claim1.json?.data?.claimed === true && claim1.json?.data?.amount === 500, JSON.stringify(claim1.json?.error));
  const balanceAfterClaim = claim1.json.data.balance;

  const claim2 = await call("POST", "/api/points/claim");
  ok("当日重复领取被拒（CONFLICT）", claim2.status === 409 && claim2.json?.error?.code === "CONFLICT", JSON.stringify(claim2.json?.error));

  // 并发领取防重
  const burst = await Promise.all(
    Array.from({ length: 8 }, () =>
      fetch(BASE + "/api/points/claim", { method: "POST", headers: { Cookie: cookie, Origin: BASE } }).then((r) => r.status)
    )
  );
  ok("并发领取仅成功 0 次（今日已领）", burst.every((s) => s === 409), JSON.stringify(burst));

  // ---------- 发帖扣点 ----------
  const post = await call("POST", "/api/posts", {
    body: { board_id: boards.json.data.items[1].id, title: "冒烟测试：关于班车时刻的反馈", body: "这是一条用于冒烟自检的帖子正文，内容长度足够触发价值评估流程。", tag: "讨论" }
  });
  ok("发帖成功", post.status === 201 && !!post.json?.data?.post?.id, JSON.stringify(post.json?.error));
  ok("发帖扣除 50 点", post.json?.data?.points?.balance === balanceAfterClaim - 50, `${balanceAfterClaim} -> ${post.json?.data?.points?.balance}`);
  const postId = post.json.data.post.id;

  const reply = await call("POST", `/api/posts/${postId}/replies`, { body: { body: "冒烟测试回复内容。" } });
  ok("回复成功", reply.status === 201 && !!reply.json?.data?.reply?.id, JSON.stringify(reply.json?.error));
  ok("回复扣除 20 点", reply.json?.data?.points?.balance === balanceAfterClaim - 70, String(reply.json?.data?.points?.balance));

  // 余额不足
  let shortfallSeen = null;
  for (let i = 0; i < 10; i++) {
    const r = await call("POST", "/api/posts", { body: { board_id: boards.json.data.items[1].id, title: `余额压测帖 ${i}`, body: "用于把余额消耗到不足以继续发帖的程度。" } });
    if (r.status === 402) {
      shortfallSeen = r;
      break;
    }
  }
  ok("余额不足时返回 402 INSUFFICIENT_POINTS", shortfallSeen && shortfallSeen.json?.error?.code === "INSUFFICIENT_POINTS", JSON.stringify(shortfallSeen?.json?.error));
  ok("余额不足响应包含差额", shortfallSeen && typeof shortfallSeen.json?.error?.details?.shortfall === "number");

  // ---------- @ 呼叫三分支 ----------
  await call("POST", "/api/points/claim"); // 已领，忽略
  // 给该用户补足点数以便触发 @
  cookie = "";
  await call("POST", "/api/auth/login", { body: { username: "webops_admin", password: "Smoke#Admin#2026" } });
  const usersList = await call("GET", "/api/admin/users?q=" + uname);
  const targetUser = usersList.json.data.items.find((u) => u.username === uname);
  await call("POST", `/api/admin/users/${targetUser.id}/points`, { body: { delta: 5000, memo: "冒烟补点" } });

  cookie = "";
  await call("POST", "/api/auth/login", { body: { username: uname, password: "Smoke#2026" } });

  const mentionPost = await call("POST", "/api/posts", {
    body: {
      board_id: boards.json.data.items[1].id,
      title: "冒烟测试：需要安全总监关注的园区夜间巡逻安排",
      body: "@阿娜伊斯·德穆兰 关于园区夜间巡逻的排班密度，一线同事反馈存在两小时的空档期，希望集团评估是否需要调整，并明确责任部门。",
      tag: "建议"
    }
  });
  ok("@ 呼叫的帖子发布成功", mentionPost.status === 201, JSON.stringify(mentionPost.json?.error));
  const created = mentionPost.json?.data?.mentions?.[0];
  const rejectedAtCreate = mentionPost.json?.data?.rejectedMentions?.[0];
  ok(
    "创建了一条 @ 审核请求（未被预检驳回）",
    !!created,
    JSON.stringify(rejectedAtCreate || mentionPost.json?.data?.mentions)
  );

  if (created) {
    ok(
      "审核中回执文案逐字匹配",
      created?.receipts?.[0]?.message ===
        "检测到对集团高级管理人员的呼叫.....正在确认呼叫者职级是否足以支撑该行为...正在评估应答时间和问题价值.....",
      JSON.stringify(created?.receipts?.[0]?.message)
    );

    // 等待后台审核推进
    let finalMention = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const got = await call("GET", `/api/mentions/${created.code}`);
      const st = got.json?.data?.mention?.status;
      if (st === "approved" || st === "rejected") {
        finalMention = got.json.data;
        break;
      }
    }
    ok("审核在超时前结案", !!finalMention, "仍停留在审核中");
    if (finalMention) {
      const last = finalMention.receipts[finalMention.receipts.length - 1];
      if (finalMention.mention.status === "approved") {
        const msg = last.message;
        ok("【通过分支】回执以固定前缀开头", msg.startsWith("已确认该问题值得高管关注，已计算高管为此分配的最合理时间："), msg);
        ok("【通过分支】回执以固定后缀结尾", msg.endsWith("。已自动转阅。"), msg);
        ok("【通过分支】<time> 已被动态替换", !msg.includes("<time>"), msg);
        ok("【通过分支】回执含动态时长（N分M秒）", /：\d+分\d+秒。已自动转阅。$/.test(msg), msg);
        ok("【通过分支】分配的分钟数落在 5–45 区间", finalMention.mention.assignedMinutes >= 5 && finalMention.mention.assignedMinutes <= 45, String(finalMention.mention.assignedMinutes));
        // 转阅：该高管账号应在原帖留下一条回复
        const detail = await call("GET", `/api/posts/${mentionPost.json.data.post.id}`);
        const forwarded = (detail.json?.data?.replies || []).find((r) => r.authorKind === "ai_officer");
        ok("【通过分支】已自动转阅：高管账号在原帖追加回复", !!forwarded, JSON.stringify((detail.json?.data?.replies || []).map((r) => r.authorKind)));
      } else {
        ok(
          "【未通过分支】回执文案逐字匹配",
          last.message === "经哈夫克首席高级秘书办审核讨论，本贴无需转载，请勿短时间内大量呼叫集团高级职员",
          last.message
        );
      }
    }
  } else {
    ok("审核中回执文案逐字匹配（跳过）", false, "预检驳回：" + (rejectedAtCreate?.reason || "unknown"));
  }

  // 冷却：立刻再次呼叫同一位高管 —— 必须被风控拦截，且回执为「未通过」分支
  const cooldownPost = await call("POST", "/api/posts", {
    body: {
      board_id: boards.json.data.items[1].id,
      title: "冒烟测试：冷却校验帖",
      body: "@阿娜伊斯·德穆兰 再次呼叫同一位高管，用于验证冷却与去重规则是否生效。",
      tag: "讨论"
    }
  });
  const cool = cooldownPost.json?.data?.rejectedMentions?.[0];
  const coolDirect = cooldownPost.json?.data?.mentions?.[0];
  ok(
    "【未通过分支】重复呼叫同一位高管被风控拦截",
    (cool && ["COOLDOWN", "DUPLICATE_24H", "BURST", "HOURLY_LIMIT"].includes(cool.reason)) ||
      (coolDirect && coolDirect.status === "rejected"),
    JSON.stringify({ cool, status: coolDirect?.status })
  );
  if (coolDirect && coolDirect.status === "rejected") {
    ok(
      "【未通过分支】被拦截时回执为未通过文案",
      coolDirect.receipts?.[0]?.message === "经哈夫克首席高级秘书办审核讨论，本贴无需转载，请勿短时间内大量呼叫集团高级职员",
      JSON.stringify(coolDirect.receipts?.[0]?.message)
    );
  }

  // 内容过短直接驳回
  const shortPost = await call("POST", "/api/posts", {
    body: {
      board_id: boards.json.data.items[1].id,
      title: "冒烟测试：过短内容呼叫",
      body: "@哈德森 在吗，有事找你确认一下现场情况。",
      tag: "讨论"
    }
  });
  const shortRejected = shortPost.json?.data?.rejectedMentions?.[0];
  ok("【未通过分支】内容过短的 @ 呼叫被直接驳回", !!shortRejected, JSON.stringify(shortPost.json?.data?.mentions));

  // ---------- 头像链路 ----------
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAHUlEQVR42u3OMQEAAAgDoC251a3gLwSgOXJRAQDgYwG+3wF9vJvBnQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), "avatar.png");
  const up = await fetch(BASE + "/api/me/avatar", { method: "POST", headers: { Cookie: cookie, Origin: BASE }, body: fd });
  const upJson = await up.json();
  ok("头像上传成功", up.status === 201 && !!upJson.data?.user?.avatarUrl, JSON.stringify(upJson?.error));
  const avatarUrl = upJson.data?.user?.avatarUrl;
  ok("返回的是 /media/avatars/ 规范路径", /^\/media\/avatars\/[a-f0-9]{16}\.png$/.test(avatarUrl || ""), avatarUrl);

  const mediaRes = await fetch(BASE + avatarUrl);
  ok("头像可通过 URL 正常访问（200 + 图片类型）", mediaRes.status === 200 && (mediaRes.headers.get("content-type") || "").includes("png"));
  ok("头像响应带长缓存与 ETag", (mediaRes.headers.get("cache-control") || "").includes("max-age=31536000") && !!mediaRes.headers.get("etag"));

  const def = await fetch(BASE + "/media/default-avatar.svg");
  ok("默认头像可访问且永不 404", def.status === 200 && (def.headers.get("content-type") || "").includes("svg"));

  const bad = await fetch(BASE + "/media/avatars/not-a-real-file.png");
  ok("不存在的头像回退到默认头像（而非 404）", bad.status === 200 && (bad.headers.get("content-type") || "").includes("svg"), String(bad.status));

  const evil = await fetch(BASE + "/media/avatars/..%2f..%2fpackage.json");
  ok("头像路径穿越被拦截", evil.status === 200 && (evil.headers.get("content-type") || "").includes("svg"), String(evil.status));

  const wrongType = new FormData();
  wrongType.append("file", new Blob([Buffer.from("not an image")], { type: "image/png" }), "evil.png");
  const up2 = await fetch(BASE + "/api/me/avatar", { method: "POST", headers: { Cookie: cookie, Origin: BASE }, body: wrongType });
  const up2Json = await up2.json();
  ok("伪装成 PNG 的非图片被魔数校验拦截（415）", up2.status === 415, up2Json?.error?.code);

  // ---------- 删除自己帖子 + 越权 ----------
  const del = await call("DELETE", "/api/posts/" + postId);
  ok("作者可删除自己的帖子", del.status === 200);
  const delOther = await call("DELETE", "/api/posts/1");
  ok("删除他人帖子被拒或不存在", [403, 404].includes(delOther.status), String(delOther.status));

  // ---------- 岗位变更必须走申请 ----------
  cookie = "";
  const login3 = await call("POST", "/api/auth/login", { body: { username: uname, password: "Smoke#2026" } });
  ok("重新登录成功", login3.status === 200);
  const changeReq = await call("POST", "/api/requests", {
    body: { type: "job_change", department_id: deptId, job_role_id: catalog.json.data.jobs[1].id, reason: "希望转岗" }
  });
  ok("岗位变更申请提交成功", changeReq.status === 201, JSON.stringify(changeReq.json?.error));
  const changeReq2 = await call("POST", "/api/requests", {
    body: { type: "job_change", department_id: deptId, job_role_id: catalog.json.data.jobs[1].id, reason: "重复提交" }
  });
  ok("重复提交同类型申请被拒（CONFLICT）", changeReq2.status === 409, String(changeReq2.status));

  // ---------- 密码哈希与审计 ----------
  cookie = "";
  await call("POST", "/api/auth/login", { body: { username: "webops_admin", password: "Smoke#Admin#2026" } });
  const audit = await call("GET", "/api/admin/audit-logs");
  ok("管理动作写入审计日志", Array.isArray(audit.json?.data?.items) && audit.json.data.items.length >= 3, String(audit.json?.data?.items?.length));

  const overview = await call("GET", "/api/admin/overview");
  ok("管理概览可用且对账一致", overview.status === 200 && overview.json?.data?.reconciled === true, JSON.stringify(overview.json?.data?.counts));
  ok("概览统计包含 @ 审核数据", typeof overview.json?.data?.counts?.mentionsTotal === "number");

  const aiList = await call("GET", "/api/admin/ai-officers");
  ok("AI 高管列表可用（≥4）", aiList.json?.data?.items?.length >= 4);
  const officer = aiList.json.data.items.find((o) => o.codename === "哈德森");
  const upd = await call("POST", `/api/admin/ai-officers/${officer.id}`, {
    body: { authority_level: 9, auto_post_interval_sec: 0, voice_lines: ["先给数据，再谈立场。", "排期以产出为准。"] }
  });
  ok("管理员可更新 AI 高管配置", upd.status === 200);

  // 健康检查
  const health = await call("GET", "/api/admin/health");
  ok("健康检查返回 schema 版本与完整性", health.json?.data?.integrity === "ok" && health.json?.data?.schemaVersion >= 1, JSON.stringify(health.json?.data));

  console.log("\n========================================");
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log("失败清单：");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("========================================\n");

  if (server) {
    await new Promise((r) => server.close(r));
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("冒烟自检异常：", err);
  process.exit(2);
});
