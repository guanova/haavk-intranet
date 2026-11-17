/* ==========================================================================
   server/migrations/005_officer_topics.js — AI 高管的自主发帖选题池
   背景：补全高管后若仍共用全局题材池，财务部会发头盔盘点、情报部门会发食堂菜单。
         每位高管自带选题（post_topics），worker 优先用自己的，空了才回退全局池。
   ========================================================================== */
export const version = 5;
export const name = "officer_post_topics";

export const up = [
  "ALTER TABLE ai_officers ADD COLUMN post_topics TEXT NOT NULL DEFAULT '[]'"
];
