/* 执行数据库迁移（不启动 HTTP 服务） */
import path from "node:path";
import { migrate } from "../lib/migrate.js";
import * as m001 from "../migrations/001_init.js";
import * as m002 from "../migrations/002_post_likes.js";
import * as m003 from "../migrations/003_submissions.js";
import * as m004 from "../migrations/004_submission_reward.js";
import * as m005 from "../migrations/005_officer_topics.js";
import * as m006 from "../migrations/006_notifications_mail_agent.js";
import { seedAll, seedStats } from "../lib/seed.js";
import { getDb } from "../lib/db.js";

const withSeed = process.argv.includes("--seed");
const { applied, current } = migrate([m001, m002, m003, m004, m005, m006]);
console.log(`[migrate] schema 版本 v${current}${applied.length ? `，本次应用：${applied.join(", ")}` : "，无待应用迁移"}`);

if (withSeed) {
  const summary = seedAll({
    adminPassword: process.env.HAAVK_ADMIN_PASSWORD,
    officerPassword: process.env.HAAVK_OFFICER_PASSWORD
  });
  const stats = seedStats();
  console.log("[seed] " + JSON.stringify({ ...summary, stats }, null, 2));
}

getDb().close();
