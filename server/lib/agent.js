/* ==========================================================================
   server/lib/agent.js — 机器访问令牌
   用途：让自动化管家（脚本 / AI）不带 Cookie 也能以管理员身份调用管理接口。
   安全口径：
     - 令牌以 sha256 入库，明文只在创建时返回一次，之后不可再取回；
     - 令牌绑定到一个具体的管理员账号（owner_id），其权限完全等同该账号；
     - 支持吊销（revoked_at）与使用计数，便于审计。
   ========================================================================== */
import crypto from "node:crypto";
import { get, run, all } from "./db.js";
import { ROLES } from "../constants.js";

export const AGENT_HEADER = "x-agent-token";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/**
 * 创建令牌。
 * @param {{name?:string, ownerId:number, scope?:string}} opts
 * @returns {{id:number, token:string, name:string}}
 */
export function createAgentToken({ name = "agent", ownerId, scope = "admin" } = {}) {
  if (!ownerId) throw new Error("必须指定令牌所属账号");
  const token = "hk_" + crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const info = run(
    "INSERT INTO api_tokens (name, token_hash, owner_id, scope, created_at) VALUES (?,?,?,?,?)",
    String(name || "agent").slice(0, 60),
    sha256(token),
    ownerId,
    String(scope || "admin").slice(0, 30),
    now
  );
  return { id: Number(info.lastInsertRowid), token, name: String(name || "agent") };
}

/** 校验令牌 → 返回绑定的用户行（含会话无关的字段），无效返回 null */
export function userByToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const row = get("SELECT * FROM api_tokens WHERE token_hash = ?", sha256(raw));
  if (!row || row.revoked_at) return null;
  const user = get("SELECT * FROM users WHERE id = ?", row.owner_id);
  if (!user || user.status === "suspended") return null;
  // 令牌只对管理员账号有意义
  if (user.role !== ROLES.SITE_ADMIN) return null;
  run("UPDATE api_tokens SET use_count = use_count + 1, last_used_at = ? WHERE id = ?", Date.now(), row.id);
  return { ...user, agent_token_id: row.id, agent_scope: row.scope };
}

/** 列表（不含哈希与明文） */
export function listAgentTokens() {
  const rows = all(
    `SELECT t.id, t.name, t.scope, t.use_count, t.last_used_at, t.revoked_at, t.created_at,
            u.username AS owner_username, u.display_name AS owner_name
       FROM api_tokens t LEFT JOIN users u ON u.id = t.owner_id
      ORDER BY t.id DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scope: r.scope,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at,
    revoked: Boolean(r.revoked_at),
    createdAt: r.created_at,
    owner: r.owner_name || r.owner_username || "(已删除)"
  }));
}

/** 吊销 */
export function revokeAgentToken(id) {
  const row = get("SELECT id FROM api_tokens WHERE id = ?", id);
  if (!row) return false;
  run("UPDATE api_tokens SET revoked_at = ? WHERE id = ?", Date.now(), id);
  return true;
}
