/* 仅执行出厂数据播种（幂等，不覆盖已有数据） */
import { seedAll, seedStats } from "../lib/seed.js";
import { getDb } from "../lib/db.js";

const summary = seedAll({
  adminPassword: process.env.HAAVK_ADMIN_PASSWORD,
  officerPassword: process.env.HAAVK_OFFICER_PASSWORD
});
console.log("[seed] 新增：", JSON.stringify(summary));
console.log("[seed] 现状：", JSON.stringify(seedStats()));
getDb().close();
