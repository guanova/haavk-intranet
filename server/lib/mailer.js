/* ==========================================================================
   server/lib/mailer.js — 邮件服务层
   从 site_settings 读 SMTP 配置 → 组装 cfg → 调 smtp.js 发信 → 写 mail_log。
   通知推送走「批量投递」：逐封发送、逐封记录，单封失败不影响其余。
   ========================================================================== */
import { sendMail, verifySmtp } from "./smtp.js";
import { getSetting, getSettingNumber } from "./settings.js";
import { get, run, all } from "./db.js";

/** 从站点配置组装 SMTP 参数 */
export function smtpConfig() {
  return {
    host: getSetting("mail.host", "").trim(),
    port: getSettingNumber("mail.port", 465),
    secure: getSetting("mail.secure", "1") === "1",
    user: getSetting("mail.user", "").trim(),
    pass: getSetting("mail.pass", ""),
    from: getSetting("mail.from", "").trim() || getSetting("mail.user", "").trim(),
    timeoutMs: 20000
  };
}

export function mailEnabled() {
  return getSetting("mail.enabled", "0") === "1";
}

/** 配置是否完整（启用 + 服务器 + 账号） */
export function mailConfigured() {
  const c = smtpConfig();
  return Boolean(c.host && c.from);
}

export function siteUrl() {
  const raw = getSetting("mail.site_url", "").trim();
  return raw ? raw.replace(/\/+$/, "") : "";
}

/** 连接与账号自检 */
export async function testMail() {
  const cfg = smtpConfig();
  if (!cfg.host) return { ok: false, message: "尚未填写 SMTP 服务器地址" };
  return verifySmtp({ ...cfg, from: cfg.from });
}

/** 记录一封邮件的投递结果 */
function logMail(notificationId, to, subject, ok, error) {
  run(
    "INSERT INTO mail_log (notification_id, to_addr, subject, ok, error, created_at) VALUES (?,?,?,?,?,?)",
    notificationId || null,
    String(to || "").slice(0, 200),
    String(subject || "").slice(0, 300),
    ok ? 1 : 0,
    String(error || "").slice(0, 500),
    Date.now()
  );
}

/**
 * 把一条通知组装成邮件正文。
 * @param {{title:string,summary:string,body:string,level:string,id:number}} n
 */
export function composeNotificationMail(n) {
  const base = siteUrl();
  const levelText = { normal: "通知", important: "重要通知", urgent: "紧急通知" }[n.level] || "通知";
  const link = base ? `${base}/#/notifications` : "";
  const lines = [
    `【${levelText}】${n.title}`,
    "",
    n.summary || "",
    "",
    n.body || "",
    ""
  ];
  if (link) {
    lines.push(`查看完整通知：${link}`);
    lines.push("");
  }
  lines.push("——");
  lines.push("本邮件由哈夫克集团内部站点自动发送，请勿直接回复。");
  return lines.join("\n");
}

/** 取订阅了邮件的收件人（去重、过滤空地址） */
export function subscriberEmails() {
  const rows = all(
    "SELECT email FROM users WHERE email_opt = 1 AND email <> '' AND status <> 'suspended'"
  );
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const addr = String(r.email || "").trim().toLowerCase();
    if (!addr || seen.has(addr)) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/**
 * 推送一条通知给所有订阅者。
 * @param {number} notificationId
 * @param {{concurrency?:number}} opts
 * @returns {Promise<{total:number,ok:number,fail:number,errors:string[]}>}
 */
export async function pushNotification(notificationId) {
  const n = get("SELECT * FROM notifications WHERE id = ?", notificationId);
  if (!n) throw new Error("通知不存在");

  const cfg = smtpConfig();
  if (!cfg.host || !cfg.from) throw new Error("邮件服务未配置完整（缺少服务器或发件人）");

  const targets = subscriberEmails();
  if (!targets.length) {
    run(
      "UPDATE notifications SET email_state = 'sent', email_sent_at = ?, email_total = 0, email_ok = 0, email_fail = 0, updated_at = ? WHERE id = ?",
      Date.now(),
      Date.now(),
      notificationId
    );
    return { total: 0, ok: 0, fail: 0, errors: ["暂无订阅邮箱"] };
  }

  const subject = `【哈夫克集团】${n.title}`.slice(0, 180);
  const text = composeNotificationMail(n);

  run("UPDATE notifications SET email_state = 'sending', updated_at = ? WHERE id = ?", Date.now(), notificationId);

  let ok = 0;
  let fail = 0;
  const errors = [];
  // 串行发送：多数免费 SMTP 有并发/频率限制，逐封更稳
  for (const to of targets) {
    try {
      await sendMail(cfg, { to, subject, text });
      ok += 1;
      logMail(notificationId, to, subject, true, "");
    } catch (err) {
      fail += 1;
      const msg = String((err && err.message) || err).slice(0, 300);
      errors.push(`${to}: ${msg}`);
      logMail(notificationId, to, subject, false, msg);
    }
  }

  const state = fail === 0 ? "sent" : ok > 0 ? "sent" : "failed";
  run(
    "UPDATE notifications SET email_state = ?, email_sent_at = ?, email_total = ?, email_ok = ?, email_fail = ?, updated_at = ? WHERE id = ?",
    state,
    Date.now(),
    targets.length,
    ok,
    fail,
    Date.now(),
    notificationId
  );

  return { total: targets.length, ok, fail, errors: errors.slice(0, 10) };
}

/**
 * 发布通知并（可选）立即推送邮件。发布与推送分开，避免邮件慢导致接口超时。
 */
export function publishNotification(id, publishAt) {
  const now = Date.now();
  run(
    "UPDATE notifications SET status = 'published', publish_at = ?, updated_at = ? WHERE id = ?",
    publishAt && publishAt > 0 ? publishAt : now,
    now,
    id
  );
  return get("SELECT * FROM notifications WHERE id = ?", id);
}
