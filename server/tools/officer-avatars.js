/* ==========================================================================
   server/tools/officer-avatars.js — 为 4 位 AI 高管登记官方立绘头像
   将 assets/img/avatar-*.png 复制进 data/uploads/avatars/ 并走与真实上传
   相同的登记路径（uploads 表 + users.avatar_upload_id）。
   用法：node server/tools/officer-avatars.js
   ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.HAAVK_DB = process.env.HAAVK_DB || path.resolve(__dirname, "../../data/haavk.db");

const { get, run, withTx, getDb } = await import("../lib/db.js");
const { uploadDir } = await import("../api/media.js");

const JOBS = [
  { match: "%德穆兰%", file: "avatar-demulan.png" },
  { match: "哈德森", file: "avatar-hudson.png" },
  { match: "%罗米修斯%", file: "avatar-romius.png" },
  { match: "首席执行秘书办", file: "avatar-secretary.png" }
];

const imgDir = path.resolve(__dirname, "../../assets/img");
const db = getDb();

function assignFromFile(userId, absFile) {
  const png = fs.readFileSync(absFile);
  const digest = crypto.createHash("sha256").update(png).digest("hex").slice(0, 16);
  const storedName = `${digest}.png`;
  const abs = path.join(uploadDir(), storedName);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, png);
  return withTx(() => {
    let row = get("SELECT id FROM uploads WHERE stored_name = ?", storedName);
    if (row) {
      run("UPDATE uploads SET deleted_at = NULL WHERE id = ?", row.id);
    } else {
      const info = run(
        `INSERT INTO uploads (user_id, kind, stored_name, mime, byte_size, width, height, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        userId,
        "avatar",
        storedName,
        "image/png",
        png.length,
        256,
        256,
        Date.now()
      );
      row = { id: Number(info.lastInsertRowid) };
    }
    run("UPDATE users SET avatar_upload_id = ?, updated_at = ? WHERE id = ?", row.id, Date.now(), userId);
    return storedName;
  });
}

let done = 0;
for (const job of JOBS) {
  // ai_officers 表通过 user_id 关联 users；按 codename 定位
  const officer = get("SELECT id, user_id, codename FROM ai_officers WHERE codename LIKE ?", job.match);
  if (!officer) {
    console.log(`[officer-avatars] 未找到高管 ${job.match}，跳过`);
    continue;
  }
  const stored = assignFromFile(officer.user_id, path.join(imgDir, job.file));
  console.log(`  · ${officer.codename} → /media/avatars/${stored}`);
  done++;
}
console.log(`[officer-avatars] 完成 ${done}/${JOBS.length}`);
db.close();
