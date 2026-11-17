/* ==========================================================================
   server/lib/auth.js — 会话、鉴权、角色边界
   会话令牌只以 sha256 哈希入库；Cookie 为 HttpOnly + SameSite=Lax。
   ========================================================================== */
import crypto from "node:crypto";
import { get, run, all } from "./db.js";
import { AppError } from "./errors.js";
import { ROLES, USER_STATUS, SESSION } from "../constants.js";
import { clientIp, parseCookies } from "./http.js";
import { hashPassword, verifyPassword, makeSalt, ALGO } from "./password.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/* ------------------------------ 用户视图 ------------------------------ */

/** 对外暴露的用户结构（绝不包含 password_hash / salt） */
export function publicUser(row, { uploadBase = "/media/avatars" } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    pointsBalance: row.points_balance,
    departmentId: row.department_id,
    departmentName: row.department_name || null,
    jobRoleId: row.job_role_id,
    jobRoleName: row.job_role_name || null,
    title: row.title || "",
    signature: row.signature || "",
    avatarUrl: row.avatar_stored ? `${uploadBase}/${row.avatar_stored}` : "/media/default-avatar.svg",
    isSystem: !!row.is_system,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
}

const USER_SELECT = `
  SELECT u.*, d.name AS department_name, j.name AS job_role_name,
         up.stored_name AS avatar_stored
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN jobs j        ON j.id = u.job_role_id
    LEFT JOIN uploads up    ON up.id = u.avatar_upload_id AND up.deleted_at IS NULL
`;

export function findUserById(id) {
  return get(USER_SELECT + " WHERE u.id = ?", id);
}
export function findUserByUsername(username) {
  return get(USER_SELECT + " WHERE u.username = ? COLLATE NOCASE", String(username || "").trim());
}

/* ------------------------------ 会话 ------------------------------ */

export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const id = crypto.randomUUID();
  run(
    `INSERT INTO sessions (id, token_hash, user_id, ip, user_agent, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    id,
    sha256(token),
    userId,
    clientIp(req),
    String(req.headers["user-agent"] || "").slice(0, 300),
    now,
    now + SESSION.TTL_MS
  );
  return { token, id, expiresAt: now + SESSION.TTL_MS };
}

export function destroySession(token) {
  if (!token) return;
  run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", Date.now(), sha256(token));
}

export function destroyAllSessions(userId) {
  run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", Date.now(), userId);
}

/** 从请求解析当前用户（未登录返回 null） */
export function currentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION.COOKIE];
  if (!token) return null;
  const row = get(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.id AS uid
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    sha256(token)
  );
  if (!row || row.revoked_at || row.expires_at < Date.now()) return null;
  const user = findUserById(row.uid);
  if (!user || user.status === USER_STATUS.SUSPENDED) return null;
  return { ...user, session_id: row.session_id, session_token: token };
}

/* ------------------------------ 鉴权守卫 ------------------------------ */

export function requireAuth(ctx) {
  if (!ctx.user) throw AppError.unauthorized();
  return ctx.user;
}

/** 已完成入职手续（可发帖/回复） */
export function requireHired(ctx) {
  const user = requireAuth(ctx);
  if (user.status !== USER_STATUS.ACTIVE) throw AppError.onboardingRequired();
  return user;
}

export function requireRole(ctx, roles) {
  const user = requireAuth(ctx);
  const list = Array.isArray(roles) ? roles : [roles];
  if (!list.includes(user.role)) throw AppError.forbidden();
  return user;
}

export const requireAdmin = (ctx) => requireRole(ctx, ROLES.SITE_ADMIN);

/* ------------------------------ 注册 / 登录 ------------------------------ */

export function createUser({ username, displayName, password, role = ROLES.EMPLOYEE, status, departmentId = null, jobRoleId = null, title = "", isSystem = 0 }) {
  const now = Date.now();
  const salt = makeSalt();
  const hash = hashPassword(password, salt);
  const info = run(
    `INSERT INTO users (username, display_name, password_hash, password_salt, password_algo,
                        role, status, points_balance, department_id, job_role_id, title, is_system,
                        created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
    String(username).trim(),
    String(displayName).trim(),
    hash,
    salt,
    ALGO,
    role,
    status || (role === ROLES.EMPLOYEE ? USER_STATUS.PENDING_ONBOARDING : USER_STATUS.ACTIVE),
    departmentId,
    jobRoleId,
    title,
    isSystem,
    now,
    now
  );
  return Number(info.lastInsertRowid);
}

export function login(username, password) {
  const user = findUserByUsername(username);
  if (!user) {
    // 用户不存在也执行一次哈希，避免通过响应时间枚举账号
    hashPassword(String(password || ""), "0".repeat(32));
    return null;
  }
  if (!verifyPassword(password, user.password_salt, user.password_hash, user.password_algo)) return null;
  run("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", Date.now(), Date.now(), user.id);
  return findUserById(user.id);
}

export function changePassword(userId, currentPassword, newPassword) {
  const user = findUserById(userId);
  if (!user) throw AppError.unauthorized();
  if (!verifyPassword(currentPassword, user.password_salt, user.password_hash, user.password_algo)) {
    throw AppError.unauthorized("当前密码不正确");
  }
  const salt = makeSalt();
  const hash = hashPassword(newPassword, salt);
  run("UPDATE users SET password_hash = ?, password_salt = ?, password_algo = ?, updated_at = ? WHERE id = ?", hash, salt, ALGO, Date.now(), userId);
  // 改密后吊销其他会话（保留当前会话由调用方决定，这里全部吊销并重建）
  destroyAllSessions(userId);
}

/** 清理过期会话（定时任务） */
export function pruneSessions() {
  run("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL", Date.now() - 3600_000);
}

/** 当前登录会话数（安全审计展示） */
export function activeSessionCount(userId) {
  const row = get("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?", userId, Date.now());
  return row ? row.c : 0;
}

export { all };
