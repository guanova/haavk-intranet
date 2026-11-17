/* ==========================================================================
   server/lib/db.js — SQLite 连接、事务、通用查询助手
   使用 Node 内置 node:sqlite（Node ≥ 22.5），零第三方依赖。
   事务统一用 BEGIN IMMEDIATE，避免两个并发扣点读到同一余额。
   ========================================================================== */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

let db = null;
let txDepth = 0;

/** 打开（并缓存）数据库连接 */
export function getDb() {
  if (db) return db;
  const file = process.env.HAAVK_DB || path.resolve(process.cwd(), "data/haavk.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  // WAL 提升并发读性能；foreign_keys 打开级联删除；busy_timeout 避免瞬时锁失败
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/** 查询多行 */
export function all(sql, ...params) {
  return getDb().prepare(sql).all(...flatten(params));
}

/** 查询单行（无结果返回 null） */
export function get(sql, ...params) {
  const row = getDb().prepare(sql).get(...flatten(params));
  return row === undefined ? null : row;
}

/** 执行写入，返回 { changes, lastInsertRowid } */
export function run(sql, ...params) {
  return getDb().prepare(sql).run(...flatten(params));
}

/** 取单列标量 */
export function scalar(sql, ...params) {
  const row = get(sql, ...params);
  if (!row) return null;
  return row[Object.keys(row)[0]];
}

/**
 * 事务包装：支持嵌套（内层复用外层事务，任一失败整体回滚）。
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function withTx(fn) {
  const conn = getDb();
  const isOuter = txDepth === 0;
  if (isOuter) conn.exec("BEGIN IMMEDIATE;");
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    if (isOuter) conn.exec("COMMIT;");
    return result;
  } catch (err) {
    txDepth--;
    if (isOuter) {
      try {
        conn.exec("ROLLBACK;");
      } catch {
        /* 回滚失败：连接已不可用，交由上层重启进程 */
      }
    }
    throw err;
  }
}

/** 目前不支持数组风格参数展开，这里只做防御性处理 */
function flatten(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

/** 服务启动时自检：表是否就绪 */
export function assertSchemaReady() {
  const row = get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
  if (!row) {
    throw new Error("数据库尚未初始化，请先执行 `npm run migrate` 或启动服务自动迁移");
  }
}
