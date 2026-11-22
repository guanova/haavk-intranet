/* ==========================================================================
   server/api/agent.js — 自动化管家接口（令牌鉴权的站点管理 API）
   设计目标：让脚本 / AI 用一把令牌就能读写站点，不必模拟浏览器登录。
   端点：
     GET    /api/agent/ping              连通性 & 身份自检
     GET    /api/agent/summary           站点数据速览（用户/帖子/通知/征集）
     GET    /api/agent/tokens            令牌列表
     POST   /api/agent/tokens            新建令牌（仅在管理面板/已登录会话下允许）
     POST   /api/agent/tokens/:id/revoke 吊销
   ========================================================================== */
import { all, get } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { sendOk, readJsonBody } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { createAgentToken, listAgentTokens, revokeAgentToken } from "../lib/agent.js";
import { mailConfigured, mailEnabled, subscriberEmails } from "../lib/mailer.js";

/** GET /api/agent/ping — 令牌是否可用 */
export function ping(ctx) {
  const u = ctx.user;
  if (!u) throw AppError.unauthorized("令牌无效或已吊销");
  return sendOk(ctx.res, {
    ok: true,
    identity: { id: u.id, username: u.username, displayName: u.display_name, role: u.role },
    via: u.agent_token_id ? "agent-token" : "session",
    serverTime: Date.now()
  });
}

/** GET /api/agent/summary — 一眼看全站 */
export function summary(ctx) {
  const u = ctx.user;
  if (!u) throw AppError.unauthorized("令牌无效或已吊销");
  const count = (sql, ...args) => {
    const row = get(sql, ...args);
    return row ? row.c : 0;
  };
  return sendOk(ctx.res, {
    users: {
      total: count("SELECT COUNT(*) AS c FROM users"),
      employees: count("SELECT COUNT(*) AS c FROM users WHERE role = 'employee'"),
      aiOfficers: count("SELECT COUNT(*) AS c FROM users WHERE role = 'ai_officer'"),
      admins: count("SELECT COUNT(*) AS c FROM users WHERE role = 'site_admin'"),
      suspended: count("SELECT COUNT(*) AS c FROM users WHERE status = 'suspended'"),
      pendingOnboarding: count("SELECT COUNT(*) AS c FROM users WHERE status = 'pending_onboarding'")
    },
    forum: {
      posts: count("SELECT COUNT(*) AS c FROM posts WHERE is_deleted = 0"),
      replies: count("SELECT COUNT(*) AS c FROM replies WHERE is_deleted = 0"),
      boards: count("SELECT COUNT(*) AS c FROM boards")
    },
    notifications: {
      total: count("SELECT COUNT(*) AS c FROM notifications"),
      published: count("SELECT COUNT(*) AS c FROM notifications WHERE status = 'published'"),
      drafts: count("SELECT COUNT(*) AS c FROM notifications WHERE status = 'draft'")
    },
    submissions: {
      total: count("SELECT COUNT(*) AS c FROM submissions"),
      pending: count("SELECT COUNT(*) AS c FROM submissions WHERE status = 'pending'")
    },
    mail: {
      enabled: mailEnabled(),
      configured: mailConfigured(),
      subscribers: subscriberEmails().length,
      sent: count("SELECT COUNT(*) AS c FROM mail_log WHERE ok = 1"),
      failed: count("SELECT COUNT(*) AS c FROM mail_log WHERE ok = 0")
    },
    recentPosts: all(
      `SELECT p.id, p.title, p.created_at, u.display_name AS author
         FROM posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.is_deleted = 0 ORDER BY p.id DESC LIMIT 5`
    ).map((r) => ({ id: r.id, title: r.title, author: r.author, createdAt: r.created_at }))
  });
}

/** GET /api/agent/tokens — 列表（管理员会话） */
export function listTokens(ctx) {
  requireAdmin(ctx);
  return sendOk(ctx.res, { items: listAgentTokens() });
}

/** POST /api/agent/tokens — 新建（必须走已登录的管理员会话，不能用一个令牌造另一个令牌） */
export async function createToken(ctx) {
  const admin = requireAdmin(ctx);
  if (admin.agent_token_id) throw AppError.forbidden("出于安全考虑，令牌不能通过令牌自身创建");
  const body = await readJsonBody(ctx.req);
  const created = createAgentToken({
    name: String(body.name || "自动化管家"),
    ownerId: admin.id,
    scope: "admin"
  });
  return sendOk(ctx.res, { ...created, note: "请立即保存该令牌，之后无法再次查看明文" }, 201);
}

/** POST /api/agent/tokens/:id/revoke */
export function revokeToken(ctx) {
  const admin = requireAdmin(ctx);
  if (admin.agent_token_id) throw AppError.forbidden("令牌不能吊销其他令牌");
  const id = Number.parseInt(ctx.params.id, 10);
  const ok = revokeAgentToken(id);
  if (!ok) throw AppError.notFound("令牌不存在");
  return sendOk(ctx.res, { revoked: id });
}
