/* ==========================================================================
   server/migrations/004_submission_reward.js — 征集稿收录奖励点数落库
   （供管理面板「状态」列展示已发放的奖励）
   ========================================================================== */
export const version = 4;
export const name = "submission_reward_points";

export const up = [
  "ALTER TABLE submissions ADD COLUMN reward_points INTEGER NOT NULL DEFAULT 0"
];
