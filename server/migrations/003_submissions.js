/* ==========================================================================
   server/migrations/003_submissions.js — 资料征集（投稿 + 附件 + WebDAV 转存状态）
   ========================================================================== */
export const version = 3;
export const name = "submissions";

export const up = [
  `CREATE TABLE IF NOT EXISTS submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    nickname    TEXT    NOT NULL DEFAULT '',
    contact     TEXT    NOT NULL DEFAULT '',
    type        TEXT    NOT NULL DEFAULT 'screenshot'
                CHECK (type IN ('screenshot','lore','copy','asset','bug','other')),
    text        TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
    review_note TEXT    NOT NULL DEFAULT '',
    ip          TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    reviewed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS ix_submissions_status ON submissions(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS submission_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id   INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    stored_name     TEXT    NOT NULL,
    orig_name       TEXT    NOT NULL DEFAULT '',
    mime            TEXT    NOT NULL DEFAULT '',
    byte_size       INTEGER NOT NULL DEFAULT 0,
    webdav_status   TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (webdav_status IN ('pending','ok','failed','skipped')),
    webdav_path     TEXT    NOT NULL DEFAULT '',
    webdav_attempts INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS ix_submission_files_sub ON submission_files(submission_id)`,
  `CREATE INDEX IF NOT EXISTS ix_submission_files_dav ON submission_files(webdav_status)`
];
