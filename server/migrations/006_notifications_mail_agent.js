/* ==========================================================================
   server/migrations/006_notifications_mail_agent.js
   通知板块 + 邮件投递记录 + 机器访问令牌（供自动化管家直接管理站点）
   ========================================================================== */
export const version = 6;
export const name = "notifications_mail_agent";

export const up = [
  // ---------------- 站点通知（公告板） ----------------
  `CREATE TABLE IF NOT EXISTS notifications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    summary        TEXT    NOT NULL DEFAULT '',   -- 列表页摘要（留空则截取正文）
    body           TEXT    NOT NULL DEFAULT '',
    level          TEXT    NOT NULL DEFAULT 'normal'
                   CHECK (level IN ('normal','important','urgent')),
    status         TEXT    NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','published')),
    is_pinned      INTEGER NOT NULL DEFAULT 0,
    author_id      INTEGER,
    author_name    TEXT    NOT NULL DEFAULT '',
    publish_at     INTEGER NOT NULL DEFAULT 0,     -- 发布时间（毫秒），0 表示按 created_at
    email_state    TEXT    NOT NULL DEFAULT 'none'
                   CHECK (email_state IN ('none','sending','sent','failed')),
    email_sent_at  INTEGER,
    email_total    INTEGER NOT NULL DEFAULT 0,
    email_ok       INTEGER NOT NULL DEFAULT 0,
    email_fail     INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_notifications_list ON notifications(status, is_pinned, publish_at, id)`,

  // ---------------- 邮件发送记录 ----------------
  `CREATE TABLE IF NOT EXISTS mail_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER,
    to_addr         TEXT    NOT NULL,
    subject         TEXT    NOT NULL DEFAULT '',
    ok              INTEGER NOT NULL DEFAULT 0,
    error           TEXT    NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_mail_log_created ON mail_log(created_at DESC)`,

  // ---------------- 机器访问令牌（自动化管家） ----------------
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL DEFAULT 'agent',
    token_hash   TEXT    NOT NULL UNIQUE,
    owner_id     INTEGER,                          -- 绑定的管理员账号，令牌以其身份行事
    scope        TEXT    NOT NULL DEFAULT 'admin',
    use_count    INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    revoked_at   INTEGER,
    created_at   INTEGER NOT NULL
  )`,

  // ---------------- 用户邮箱订阅 ----------------
  `ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN email_opt INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS ix_users_email ON users(email)`
];
