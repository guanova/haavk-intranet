/* ==========================================================================
   server/lib/migrate.js — 迁移执行器
   迁移记录写在 schema_migrations(version, name, applied_at)，幂等。
   ========================================================================== */
import { getDb, all, run } from "./db.js";

/**
 * @param {Array<{version:number,name:string,up:string[]}>} migrations
 * @returns {{applied:number[], current:number}}
 */
export function migrate(migrations) {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const done = new Set(all("SELECT version FROM schema_migrations").map((r) => r.version));
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const applied = [];

  for (const m of ordered) {
    if (done.has(m.version)) continue;
    db.exec("BEGIN IMMEDIATE;");
    try {
      for (const sql of m.up) db.exec(sql);
      run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)", m.version, m.name, Date.now());
      db.exec("COMMIT;");
      applied.push(m.version);
    } catch (err) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        /* ignore */
      }
      throw new Error(`迁移 v${m.version} (${m.name}) 失败：${err.message}`);
    }
  }

  const current = Math.max(0, ...all("SELECT version FROM schema_migrations").map((r) => r.version));
  return { applied, current };
}
