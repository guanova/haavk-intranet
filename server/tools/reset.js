/* 清空全部业务数据（保留 schema），用于压测前重置。需显式传 --yes */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db.js";
import { migrate } from "../lib/migrate.js";
import * as m001 from "../migrations/001_init.js";
import * as m002 from "../migrations/002_post_likes.js";
import { seedAll, seedStats } from "../lib/seed.js";

if (!process.argv.includes("--yes")) {
  console.error("该操作会清空全部账号、帖子、点数与备案配置。确认请加 --yes");
  process.exit(1);
}

const db = getDb();
const tables = [
  "submission_files",
  "submissions",
  "mention_receipts",
  "mentions",
  "post_likes",
  "points_ledger",
  "daily_claims",
  "replies",
  "posts",
  "requests",
  "sessions",
  "ai_officers",
  "audit_logs",
  "uploads",
  "users",
  "boards",
  "jobs",
  "departments",
  "rate_limits"
];

// 关键顺序：先把引用 uploads / users 的外键引用清空，再删表数据，
// 否则会留下悬空的 users.avatar_upload_id，导致所有头像字段查不出文件名（"头像全丢"）。
db.exec("PRAGMA foreign_keys = OFF;");
try {
  db.exec("UPDATE users SET avatar_upload_id = NULL;");
  for (const t of tables) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (exists) db.exec(`DELETE FROM ${t};`);
  }
  const seqTables = tables.filter((t) => t !== "sessions" && t !== "rate_limits");
  if (seqTables.length) {
    db.exec(
      "DELETE FROM sqlite_sequence WHERE name IN (" + seqTables.map((t) => `'${t}'`).join(",") + ");"
    );
  }
} finally {
  db.exec("PRAGMA foreign_keys = ON;");
}
console.log("[reset] 业务数据已清空（含外键引用与自增序列），出厂数据重新播种…");

migrate([m001, m002]);
const summary = seedAll({
  adminPassword: process.env.HAAVK_ADMIN_PASSWORD,
  officerPassword: process.env.HAAVK_OFFICER_PASSWORD
});

// 清空上传的头像文件（只保留默认头像，由服务端动态生成）
const dir = process.env.HAAVK_UPLOAD_DIR || path.resolve(process.cwd(), "data/uploads/avatars");
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir)) {
    if (/^[a-f0-9]{16}\.(png|jpg|webp)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
  console.log(`[reset] 已清理头像文件目录 ${dir}`);
}

console.log("[reset] 完成：", JSON.stringify({ ...summary, stats: seedStats() }));
db.close();
