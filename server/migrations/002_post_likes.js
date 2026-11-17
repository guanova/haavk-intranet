/* ==========================================================================
   server/migrations/002_post_likes.js — 帖子点赞（版本化迁移，幂等）
   ========================================================================== */
export const version = 2;
export const name = "post_likes";

export const up = [
  `CREATE TABLE IF NOT EXISTS post_likes (
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS ix_post_likes_post ON post_likes(post_id)`,
  // 冗余计数：与 posts.reply_count 同属展示字段，事务内维护，由对账脚本校验
  `ALTER TABLE posts ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0`
];
