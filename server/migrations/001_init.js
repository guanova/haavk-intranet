/* ==========================================================================
   server/migrations/001_init.js — 初始 schema（版本化迁移，幂等）
   ========================================================================== */
export const version = 1;
export const name = "init";

export const up = [
  // ---------------- 部门 ----------------
  `CREATE TABLE IF NOT EXISTS departments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    name_norm    TEXT    NOT NULL UNIQUE,          -- 归一化名，去重的硬保证
    en_name      TEXT    NOT NULL DEFAULT '',
    description  TEXT    NOT NULL DEFAULT '',
    head_name    TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL DEFAULT '',
    confidence   TEXT    NOT NULL DEFAULT 'game'
                 CHECK (confidence IN ('game','dual','single','pending','custom')),
    is_custom    INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 100,
    created_at   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_departments_active ON departments(is_active, sort_order)`,

  // ---------------- 职业 / 职能 ----------------
  `CREATE TABLE IF NOT EXISTS jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    name_norm    TEXT    NOT NULL UNIQUE,
    en_name      TEXT    NOT NULL DEFAULT '',
    description  TEXT    NOT NULL DEFAULT '',
    weapons      TEXT    NOT NULL DEFAULT '',
    aliases      TEXT    NOT NULL DEFAULT '[]',
    source       TEXT    NOT NULL DEFAULT '',
    confidence   TEXT    NOT NULL DEFAULT 'game'
                 CHECK (confidence IN ('game','dual','single','pending','custom')),
    is_custom    INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 100,
    created_at   INTEGER NOT NULL
  )`,

  // ---------------- 账号 ----------------
  `CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    display_name     TEXT    NOT NULL,
    password_hash    TEXT    NOT NULL,
    password_salt    TEXT    NOT NULL,
    password_algo    TEXT    NOT NULL DEFAULT 'scrypt$1',
    role             TEXT    NOT NULL DEFAULT 'employee'
                     CHECK (role IN ('employee','ai_officer','chief_secretary','site_admin')),
    status           TEXT    NOT NULL DEFAULT 'pending_onboarding'
                     CHECK (status IN ('active','pending_onboarding','suspended')),
    points_balance   INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    department_id    INTEGER REFERENCES departments(id),
    job_role_id      INTEGER REFERENCES jobs(id),
    title            TEXT    NOT NULL DEFAULT '',
    avatar_upload_id INTEGER,
    signature        TEXT    NOT NULL DEFAULT '',
    is_system        INTEGER NOT NULL DEFAULT 0,
    last_login_at    INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_users_role   ON users(role)`,
  `CREATE INDEX IF NOT EXISTS ix_users_status ON users(status)`,

  // ---------------- 会话 ----------------
  `CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT    PRIMARY KEY,
    token_hash  TEXT    NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip          TEXT    NOT NULL DEFAULT '',
    user_agent  TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    revoked_at  INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id)`,

  // ---------------- 上传统一登记 ----------------
  `CREATE TABLE IF NOT EXISTS uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind        TEXT    NOT NULL DEFAULT 'avatar',
    stored_name TEXT    NOT NULL UNIQUE,
    mime        TEXT    NOT NULL,
    byte_size   INTEGER NOT NULL,
    width       INTEGER,
    height      INTEGER,
    created_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  )`,

  // ---------------- 申请（入职 / 岗位变更 / 部门变更）----------------
  `CREATE TABLE IF NOT EXISTS requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT    NOT NULL CHECK (type IN ('onboarding','job_change','dept_change')),
    payload       TEXT    NOT NULL DEFAULT '{}',
    status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reviewer_id   INTEGER REFERENCES users(id),
    review_note   TEXT    NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    reviewed_at   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS ix_requests_status ON requests(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_requests_user   ON requests(user_id, created_at DESC)`,
  // 同一用户同类型同时只允许一个待审申请（重复提交由数据库直接拦截）
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_requests_pending
     ON requests(user_id, type) WHERE status = 'pending'`,

  // ---------------- 板块 ----------------
  `CREATE TABLE IF NOT EXISTS boards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 100,
    is_active   INTEGER NOT NULL DEFAULT 1
  )`,

  // ---------------- 帖子 ----------------
  `CREATE TABLE IF NOT EXISTS posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id      INTEGER NOT NULL REFERENCES boards(id),
    author_id     INTEGER NOT NULL REFERENCES users(id),
    author_kind   TEXT    NOT NULL DEFAULT 'user' CHECK (author_kind IN ('user','ai_officer')),
    tag           TEXT    NOT NULL DEFAULT '',
    title         TEXT    NOT NULL,
    body          TEXT    NOT NULL,
    is_pinned     INTEGER NOT NULL DEFAULT 0,
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    reply_count   INTEGER NOT NULL DEFAULT 0,
    views         INTEGER NOT NULL DEFAULT 0,
    last_reply_by TEXT    NOT NULL DEFAULT '',
    last_reply_at INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_posts_board_created ON posts(board_id, is_pinned DESC, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_posts_author        ON posts(author_id, created_at DESC)`,

  // ---------------- 回复 ----------------
  `CREATE TABLE IF NOT EXISTS replies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id),
    author_kind TEXT    NOT NULL DEFAULT 'user' CHECK (author_kind IN ('user','ai_officer')),
    body        TEXT    NOT NULL,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_replies_post ON replies(post_id, created_at ASC)`,

  // ---------------- 点数流水（只增不改，对账依据）----------------
  `CREATE TABLE IF NOT EXISTS points_ledger (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta         INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason        TEXT    NOT NULL
                  CHECK (reason IN ('signup_bonus','daily_claim','post','reply','admin_adjust')),
    ref_type      TEXT    NOT NULL DEFAULT '',
    ref_id        INTEGER,
    memo          TEXT    NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_ledger_user ON points_ledger(user_id, created_at DESC)`,

  // ---------------- 每日领取（防重的硬保证）----------------
  `CREATE TABLE IF NOT EXISTS daily_claims (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_date TEXT    NOT NULL,
    amount     INTEGER NOT NULL,
    ip         TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, claim_date)
  )`,

  // ---------------- AI 高管代理 ----------------
  `CREATE TABLE IF NOT EXISTS ai_officers (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    codename               TEXT    NOT NULL UNIQUE,
    title                  TEXT    NOT NULL DEFAULT '',
    department_id          INTEGER REFERENCES departments(id),
    persona                TEXT    NOT NULL DEFAULT '',
    voice_lines            TEXT    NOT NULL DEFAULT '[]',
    authority_level        INTEGER NOT NULL DEFAULT 5,
    can_review_mentions    INTEGER NOT NULL DEFAULT 0,
    auto_post_interval_sec INTEGER NOT NULL DEFAULT 0,
    enabled                INTEGER NOT NULL DEFAULT 1,
    created_at             INTEGER NOT NULL
  )`,

  // ---------------- @ 呼叫与审核 ----------------
  `CREATE TABLE IF NOT EXISTS mentions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,
    post_id         INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reply_id        INTEGER REFERENCES replies(id) ON DELETE CASCADE,
    requester_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    officer_id      INTEGER NOT NULL REFERENCES ai_officers(id) ON DELETE CASCADE,
    mention_text    TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','under_review','approved','rejected')),
    decision_reason TEXT    NOT NULL DEFAULT '',
    assigned_minutes INTEGER,
    assigned_at     INTEGER,
    reviewer_id     INTEGER REFERENCES users(id),
    burst_count     INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    decided_at      INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS ix_mentions_post ON mentions(post_id, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS ix_mentions_user ON mentions(requester_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_mentions_officer ON mentions(officer_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_mentions_status ON mentions(status, created_at ASC)`,

  // ---------------- 回执 ----------------
  `CREATE TABLE IF NOT EXISTS mention_receipts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    mention_id INTEGER NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
    stage      TEXT    NOT NULL CHECK (stage IN ('submitted','under_review','approved','rejected')),
    message    TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_receipts_mention ON mention_receipts(mention_id, created_at ASC)`,

  // ---------------- 站点配置 ----------------
  `CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL DEFAULT '',
    label      TEXT    NOT NULL DEFAULT '',
    hint       TEXT    NOT NULL DEFAULT '',
    grp        TEXT    NOT NULL DEFAULT 'general',
    editable   INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id)
  )`,

  // ---------------- 限流桶 ----------------
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT    PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count        INTEGER NOT NULL
  )`,

  // ---------------- 审计日志 ----------------
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT    NOT NULL,
    target_type TEXT    NOT NULL DEFAULT '',
    target_id   TEXT    NOT NULL DEFAULT '',
    detail      TEXT    NOT NULL DEFAULT '{}',
    ip          TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs(created_at DESC)`
];
