/* ==========================================================================
   server/api/notifications.js — 通知板块（公告）
   公开：列表 / 详情
   管理：增删改 / 发布 / 邮件推送 / 投递记录
   ========================================================================== */
import { all, get, run } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { sendOk, readJsonBody } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { mailEnabled, mailConfigured, pushNotification, publishNotification, testMail, subscriberEmails } from "../lib/mailer.js";

const LEVELS = ["normal", "important", "urgent"];

function serialize(n, withBody = true) {
  const out = {
    id: n.id,
    title: n.title,
    summary: n.summary || "",
    level: n.level,
    isPinned: Boolean(n.is_pinned),
    authorName: n.author_name || "集团行政",
    publishAt: n.publish_at || n.created_at,
    createdAt: n.created_at,
    emailState: n.email_state,
    emailTotal: n.email_total,
    emailOk: n.email_ok,
    emailFail: n.email_fail
  };
  if (withBody) out.body = n.body || "";
  return out;
}

function summaryOf(n) {
  if (n.summary && n.summary.trim()) return n.summary.trim();
  const plain = String(n.body || "").replace(/\s+/g, " ").trim();
  return plain.length > 80 ? plain.slice(0, 80) + "…" : plain;
}

function validatePayload(body, { partial = false } = {}) {
  const out = {};
  if (body.title !== undefined || !partial) {
    const title = String(body.title || "").trim();
    if (!title) throw AppError.badRequest("请填写通知标题");
    if (title.length > 120) throw AppError.badRequest("标题过长（最多 120 字）");
    out.title = title;
  }
  if (body.body !== undefined || !partial) {
    const text = String(body.body || "").trim();
    if (!text) throw AppError.badRequest("请填写通知正文");
    if (text.length > 20000) throw AppError.badRequest("正文过长（最多 20000 字）");
    out.body = text;
  }
  if (body.summary !== undefined) out.summary = String(body.summary || "").trim().slice(0, 300);
  if (body.level !== undefined) {
    const lv = String(body.level || "normal");
    if (!LEVELS.includes(lv)) throw AppError.badRequest("通知级别不合法");
    out.level = lv;
  }
  if (body.isPinned !== undefined) out.is_pinned = body.isPinned ? 1 : 0;
  return out;
}

/* ------------------------------ 公开接口 ------------------------------ */

/** GET /api/notifications — 已发布通知列表 */
export function listPublic(ctx) {
  const limit = Math.min(Math.max(Number.parseInt(ctx.query.limit, 10) || 20, 1), 100);
  const rows = all(
    `SELECT * FROM notifications
      WHERE status = 'published' AND publish_at <= ?
      ORDER BY is_pinned DESC, publish_at DESC, id DESC
      LIMIT ?`,
    Date.now(),
    limit
  );
  return sendOk(ctx.res, { items: rows.map((n) => serialize(n, false)) });
}

/** GET /api/notifications/:id — 通知详情 */
export function getPublic(ctx) {
  const id = Number.parseInt(ctx.params.id, 10);
  const n = get("SELECT * FROM notifications WHERE id = ? AND status = 'published'", id);
  if (!n) throw AppError.notFound("通知不存在或尚未发布");
  return sendOk(ctx.res, serialize(n, true));
}

/* ------------------------------ 管理接口 ------------------------------ */

/** GET /api/admin/notifications */
export function listAdmin(ctx) {
  requireAdmin(ctx);
  const rows = all("SELECT * FROM notifications ORDER BY is_pinned DESC, created_at DESC LIMIT 200");
  return sendOk(ctx.res, {
    items: rows.map((n) => ({ ...serialize(n, true), status: n.status, emailSentAt: n.email_sent_at })),
    mail: { enabled: mailEnabled(), configured: mailConfigured(), subscribers: subscriberEmails().length }
  });
}

/** POST /api/admin/notifications */
export async function create(ctx) {
  requireAdmin(ctx);
  const body = await readJsonBody(ctx.req);
  const data = validatePayload(body, { partial: false });
  const now = Date.now();
  const publishNow = body.publish !== false;
  run(
    `INSERT INTO notifications
      (title, summary, body, level, status, is_pinned, author_id, author_name, publish_at, email_state, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    data.title,
    data.summary || summaryOf(data),
    data.body,
    data.level || "normal",
    publishNow ? "published" : "draft",
    data.is_pinned || 0,
    ctx.user.id,
    ctx.user.display_name || ctx.user.username,
    publishNow ? now : 0,
    "none",
    now,
    now
  );
  const row = get("SELECT * FROM notifications ORDER BY id DESC LIMIT 1");
  return sendOk(ctx.res, serialize(row, true), 201);
}

/** PATCH /api/admin/notifications/:id */
export async function update(ctx) {
  requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const n = get("SELECT * FROM notifications WHERE id = ?", id);
  if (!n) throw AppError.notFound("通知不存在");

  const body = await readJsonBody(ctx.req);
  const data = validatePayload(body, { partial: true });
  const sets = [];
  const args = [];
  for (const [col, val] of Object.entries(data)) {
    sets.push(`${col} = ?`);
    args.push(val);
  }
  if (body.summary === "" ) {
    sets.push("summary = ?");
    args.push(summaryOf({ ...n, ...data }));
  }
  if (body.status !== undefined) {
    const st = String(body.status);
    if (!["draft", "published"].includes(st)) throw AppError.badRequest("状态不合法");
    sets.push("status = ?");
    args.push(st);
    if (st === "published" && !n.publish_at) {
      sets.push("publish_at = ?");
      args.push(Date.now());
    }
  }
  if (!sets.length) throw AppError.badRequest("没有需要修改的内容");

  sets.push("updated_at = ?");
  args.push(Date.now(), id);
  run(`UPDATE notifications SET ${sets.join(", ")} WHERE id = ?`, ...args);
  return sendOk(ctx.res, serialize(get("SELECT * FROM notifications WHERE id = ?", id), true));
}

/** DELETE /api/admin/notifications/:id */
export function remove(ctx) {
  requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const n = get("SELECT id FROM notifications WHERE id = ?", id);
  if (!n) throw AppError.notFound("通知不存在");
  run("DELETE FROM notifications WHERE id = ?", id);
  run("DELETE FROM mail_log WHERE notification_id = ?", id);
  return sendOk(ctx.res, { deleted: id });
}

/** POST /api/admin/notifications/:id/publish — 发布（可选立即推送邮件） */
export async function publish(ctx) {
  requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const n = get("SELECT * FROM notifications WHERE id = ?", id);
  if (!n) throw AppError.notFound("通知不存在");

  const body = await readJsonBody(ctx.req).catch(() => ({}));
  const row = publishNotification(id, Number.parseInt(body.publishAt, 10) || 0);

  // 邮件推送：默认不推，必须显式要求（避免误发站内信）
  if (body.pushMail === true) {
    if (!mailEnabled()) throw AppError.badRequest("邮件通知未启用，请先在站点设置中开启");
    if (!mailConfigured()) throw AppError.badRequest("邮件服务未配置完整");
    const result = await pushNotification(id);
    return sendOk(ctx.res, { notification: serialize(get("SELECT * FROM notifications WHERE id = ?", id), true), mail: result });
  }
  return sendOk(ctx.res, { notification: serialize(row, true), mail: null });
}

/** POST /api/admin/notifications/:id/push-mail — 单独推送邮件 */
export async function pushMail(ctx) {
  requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const n = get("SELECT * FROM notifications WHERE id = ?", id);
  if (!n) throw AppError.notFound("通知不存在");
  if (n.status !== "published") throw AppError.badRequest("草稿状态的通知不能推送，请先发布");
  if (!mailEnabled()) throw AppError.badRequest("邮件通知未启用，请先在站点设置中开启");
  if (!mailConfigured()) throw AppError.badRequest("邮件服务未配置完整");
  const result = await pushNotification(id);
  return sendOk(ctx.res, result);
}

/** GET /api/admin/notifications/:id/mail-log — 投递明细 */
export function mailLog(ctx) {
  requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const rows = all("SELECT id, to_addr, subject, ok, error, created_at FROM mail_log WHERE notification_id = ? ORDER BY id DESC LIMIT 200", id);
  return sendOk(ctx.res, {
    items: rows.map((r) => ({ id: r.id, to: r.to_addr, subject: r.subject, ok: Boolean(r.ok), error: r.error, createdAt: r.created_at }))
  });
}

/** POST /api/admin/mail/test — SMTP 自检 */
export async function testSmtp(ctx) {
  requireAdmin(ctx);
  const result = await testMail();
  return sendOk(ctx.res, result);
}

/** GET /api/admin/mail/status — 邮件服务状态 */
export function mailStatus(ctx) {
  requireAdmin(ctx);
  return sendOk(ctx.res, {
    enabled: mailEnabled(),
    configured: mailConfigured(),
    subscribers: subscriberEmails().length
  });
}
