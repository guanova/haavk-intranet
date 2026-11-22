/* ==========================================================================
   server/api/auth.js — 认证、账号、入职/岗位变更申请
   ========================================================================== */
import { all, get, run, withTx } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { assertSameOrigin, buildSetCookie, readJsonBody, sendOk, setCookieHeader, clientIp } from "../lib/http.js";
import {
  createSession,
  destroySession,
  destroyAllSessions,
  currentUser,
  findUserById,
  findUserByUsername,
  createUser,
  login,
  publicUser,
  changePassword,
  requireAuth
} from "../lib/auth.js";
import { validatePasswordStrength, passwordStrengthScore } from "../lib/password.js";
import { vString, vInt, RULES, collect } from "../lib/validate.js";
import { normName } from "../lib/strings.js";
import { POINTS_REASON, REQUEST_TYPE, REQUEST_STATUS, ROLES, USER_STATUS, SESSION } from "../constants.js";
import { hit } from "../lib/ratelimit.js";
import { getSettingNumber } from "../lib/settings.js";

const SESSION_COOKIE_OPTS = { httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION.TTL_MS };
const SESSION_ONLY_OPTS = { ...SESSION_COOKIE_OPTS };

function setSessionCookie(res, token) {
  setCookieHeader(res, buildSetCookie(SESSION.COOKIE, token, SESSION_COOKIE_OPTS));
}

function pointsRules() {
  return {
    dailyAmount: getSettingNumber("points.daily_amount", 500),
    postCost: getSettingNumber("points.post_cost", 50),
    replyCost: getSettingNumber("points.reply_cost", 100)
  };
}

export function requestIp(ctx) {
  return ctx.ip || clientIp(ctx.req);
}

/* ------------------------------ 注册 ------------------------------ */

/**
 * POST /api/auth/register
 * v2 流程：账号信息 → 办理入职手续（选部门 + 岗位）。
 * 不再包含"指定员工 / 干员"。
 */
export async function register(ctx) {
  assertSameOrigin(ctx.req);
  const ipLimit = hit(`register:ip:${requestIp(ctx)}`, 10, 3600_000);
  if (!ipLimit.allowed) throw AppError.rateLimited("注册过于频繁，请稍后再试", ipLimit.retryAfter);

  const body = await readJsonBody(ctx.req);
  const values = collect([
    {
      field: "username",
      ...vString(body.username, {
        label: "账号",
        min: 3,
        max: 16,
        pattern: RULES.username.pattern,
        patternMessage: RULES.username.message
      })
    },
    {
      field: "display_name",
      ...vString(body.display_name, { label: "昵称", min: RULES.displayName.min, max: RULES.displayName.max })
    },
    { field: "department_id", ...vInt(body.department_id, { label: "所属部门", min: 1 }) },
    { field: "job_role_id", ...vInt(body.job_role_id, { label: "岗位", min: 1 }) },
    { field: "reason", ...vString(body.reason, { label: "入职说明", required: false, max: RULES.reason.max }) }
  ]);

  const pwdErr = validatePasswordStrength(body.password);
  if (pwdErr) throw AppError.badRequest(pwdErr, { fields: { password: pwdErr } });
  if (body.password_confirm !== undefined && String(body.password) !== String(body.password_confirm)) {
    throw AppError.badRequest("两次输入的密码不一致", { fields: { password_confirm: "两次输入的密码不一致" } });
  }

  if (findUserByUsername(values.username)) {
    throw AppError.conflict("该账号已被注册，请更换", { fields: { username: "该账号已被注册" } });
  }

  const dept = get("SELECT id, name, is_active FROM departments WHERE id = ?", values.department_id);
  if (!dept || !dept.is_active) {
    throw AppError.badRequest("所选部门不存在或已停用", { fields: { department_id: "请重新选择部门" } });
  }
  const job = get("SELECT id, name, is_active FROM jobs WHERE id = ?", values.job_role_id);
  if (!job || !job.is_active) {
    throw AppError.badRequest("所选岗位不存在或已停用", { fields: { job_role_id: "请重新选择岗位" } });
  }

  // 事务：建号（待入职）→ 创建入职申请
  const created = withTx(() => {
    const userId = createUser({
      username: values.username,
      displayName: values.display_name,
      password: body.password,
      role: ROLES.EMPLOYEE,
      status: USER_STATUS.PENDING_ONBOARDING
    });
    const info = run(
      "INSERT INTO requests (user_id, type, payload, status, created_at) VALUES (?,?,?,?,?)",
      userId,
      REQUEST_TYPE.ONBOARDING,
      JSON.stringify({
        department_id: values.department_id,
        job_role_id: values.job_role_id,
        reason: values.reason || ""
      }),
      REQUEST_STATUS.PENDING,
      Date.now()
    );
    return { userId, requestId: Number(info.lastInsertRowid) };
  });

  const session = createSession(created.userId, ctx.req);
  setSessionCookie(ctx.res, session.token);

  return sendOk(
    ctx.res,
    {
      user: publicUser(findUserById(created.userId)),
      request: {
        id: created.requestId,
        type: REQUEST_TYPE.ONBOARDING,
        status: REQUEST_STATUS.PENDING,
        departmentName: dept.name,
        jobRoleName: job.name
      },
      pointsRules: pointsRules(),
      pointsHint: { initialBalance: get("SELECT points_balance AS b FROM users WHERE id = ?", created.userId).b }
    },
    201
  );
}

/* ------------------------------ 登录 / 登出 / 当前用户 ------------------------------ */

export async function loginHandler(ctx) {
  assertSameOrigin(ctx.req);
  const ipLimit = hit(`login:ip:${requestIp(ctx)}`, 20, 15 * 60_000);
  if (!ipLimit.allowed) throw AppError.rateLimited("登录尝试过于频繁，请稍后再试", ipLimit.retryAfter);

  const body = await readJsonBody(ctx.req);
  const values = collect([
    { field: "username", ...vString(body.username, { label: "账号", min: 1, max: 32 }) },
    { field: "password", ...vString(body.password, { label: "密码", min: 1, max: 64, trim: false }) }
  ]);

  const userLimit = hit(`login:user:${normName(values.username)}`, 10, 15 * 60_000);
  if (!userLimit.allowed) {
    throw AppError.rateLimited("该账号登录尝试过多，请 15 分钟后再试", userLimit.retryAfter);
  }

  const user = login(values.username, values.password);
  if (!user) throw AppError.unauthorized("账号或密码不正确");
  if (user.status === USER_STATUS.SUSPENDED) throw AppError.forbidden("该账号已被停用，请联系网站管理员");

  const session = createSession(user.id, ctx.req);
  setSessionCookie(ctx.res, session.token);
  return sendOk(ctx.res, { user: publicUser(findUserById(user.id)) });
}

export async function logout(ctx) {
  assertSameOrigin(ctx.req);
  if (ctx.user) destroySession(ctx.user.session_token);
  setCookieHeader(ctx.res, buildSetCookie(SESSION.COOKIE, "", { ...SESSION_ONLY_OPTS, maxAge: 0 }));
  return sendOk(ctx.res, { ok: true });
}

export function me(ctx) {
  return sendOk(ctx.res, { user: ctx.user ? publicUser(ctx.user) : null });
}

/**
 * 仅供本地验收使用的免密登录开关。
 * 只有显式设置环境变量 HAAVK_DEMO_LOGIN=<用户名> 时才生效（默认完全关闭），
 * 用于无头浏览器截图与端到端验收；生产环境不要设置该变量。
 */
export async function demoLogin(ctx) {
  assertSameOrigin(ctx.req);
  const target = process.env.HAAVK_DEMO_LOGIN;
  if (!target) throw AppError.notFound("接口不存在");
  const user = findUserByUsername(target);
  if (!user) throw AppError.notFound("演示账号不存在");
  const session = createSession(user.id, ctx.req);
  setSessionCookie(ctx.res, session.token);
  console.warn(`[warning] HAAVK_DEMO_LOGIN 已生效：为 ${target}（用户 #${user.id}）建立了免密会话。生产环境请移除该环境变量。`);
  return sendOk(ctx.res, { user: publicUser(user), demo: true });
}

export async function updateMe(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const body = await readJsonBody(ctx.req);
  const values = collect([
    {
      field: "display_name",
      ...vString(body.display_name ?? user.display_name, {
        label: "昵称",
        min: RULES.displayName.min,
        max: RULES.displayName.max
      })
    },
    {
      field: "signature",
      ...vString(body.signature ?? "", { label: "个性签名", required: false, max: RULES.signature.max })
    }
  ]);
  run(
    "UPDATE users SET display_name = ?, signature = ?, updated_at = ? WHERE id = ?",
    values.display_name,
    values.signature || "",
    Date.now(),
    user.id
  );
  return sendOk(ctx.res, { user: publicUser(findUserById(user.id)) });
}

/**
 * 邮箱订阅设置（通知推送）
 * 只接受合法地址；关闭订阅时保留地址，便于下次恢复。
 */
export async function updateEmail(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const body = await readJsonBody(ctx.req);
  const raw = String(body.email == null ? "" : body.email).trim();
  const optIn = body.optIn === true || body.optIn === 1 || body.optIn === "1";

  if (raw && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(raw)) {
    throw AppError.badRequest("邮箱格式不正确", { fields: { email: "邮箱格式不正确" } });
  }
  if (raw.length > 160) throw AppError.badRequest("邮箱地址过长");
  if (optIn && !raw) {
    throw AppError.badRequest("开启邮件通知前请先填写邮箱", { fields: { email: "请填写邮箱地址" } });
  }

  run(
    "UPDATE users SET email = ?, email_opt = ?, updated_at = ? WHERE id = ?",
    raw,
    optIn && raw ? 1 : 0,
    Date.now(),
    user.id
  );
  const row = findUserById(user.id);
  return sendOk(ctx.res, { user: publicUser(row), email: raw, optIn: Boolean(row.email_opt) });
}

/** GET /api/me/email */
export function getEmail(ctx) {
  const user = requireAuth(ctx);
  return sendOk(ctx.res, { email: user.email || "", optIn: Boolean(user.email_opt) });
}

export async function updatePassword(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const body = await readJsonBody(ctx.req);
  const newPwdErr = validatePasswordStrength(body.new_password);
  if (newPwdErr) throw AppError.badRequest(newPwdErr, { fields: { new_password: newPwdErr } });
  if (String(body.new_password) === String(body.current_password)) {
    throw AppError.badRequest("新密码不能与当前密码相同", { fields: { new_password: "新密码不能与当前密码相同" } });
  }

  changePassword(user.id, body.current_password || "", body.new_password);

  // 改密后吊销全部会话并重建当前会话（不把本人踢下线）
  destroyAllSessions(user.id);
  const session = createSession(user.id, ctx.req);
  setSessionCookie(ctx.res, session.token);
  return sendOk(ctx.res, { ok: true, strength: passwordStrengthScore(body.new_password) });
}

/* ------------------------------ 入职 / 岗位变更申请 ------------------------------ */

/**
 * POST /api/requests
 * 入职（onboarding）/ 岗位变更（job_change）/ 部门变更（dept_change）
 * 同一类型同时只允许一个待审申请（由 ux_requests_pending 部分唯一索引保证）。
 */
export async function createRequest(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const body = await readJsonBody(ctx.req);

  const type = String(body.type || REQUEST_TYPE.ONBOARDING);
  if (!Object.values(REQUEST_TYPE).includes(type)) {
    throw AppError.badRequest("申请类型不合法", { fields: { type: "申请类型不合法" } });
  }
  if (user.role !== ROLES.EMPLOYEE) {
    throw AppError.forbidden("管理岗与 AI 岗位无需提交入职或岗位变更申请");
  }

  const values = collect([
    { field: "department_id", ...vInt(body.department_id, { label: "目标部门", min: 1 }) },
    { field: "job_role_id", ...vInt(body.job_role_id, { label: "目标岗位", min: 1 }) },
    { field: "reason", ...vString(body.reason, { label: "申请说明", required: false, max: RULES.reason.max }) }
  ]);

  const dept = get("SELECT id, is_active FROM departments WHERE id = ?", values.department_id);
  if (!dept || !dept.is_active) {
    throw AppError.badRequest("目标部门不存在或已停用", { fields: { department_id: "请重新选择部门" } });
  }
  const job = get("SELECT id, is_active FROM jobs WHERE id = ?", values.job_role_id);
  if (!job || !job.is_active) {
    throw AppError.badRequest("目标岗位不存在或已停用", { fields: { job_role_id: "请重新选择岗位" } });
  }

  const pending = get(
    "SELECT id FROM requests WHERE user_id = ? AND type = ? AND status = ?",
    user.id,
    type,
    REQUEST_STATUS.PENDING
  );
  if (pending) {
    throw AppError.conflict("你已有一份待审批的申请，请等待网站管理员处理", { fields: { type: "已有待审申请" } });
  }

  const info = run(
    "INSERT INTO requests (user_id, type, payload, status, created_at) VALUES (?,?,?,?,?)",
    user.id,
    type,
    JSON.stringify({
      department_id: values.department_id,
      job_role_id: values.job_role_id,
      reason: values.reason || ""
    }),
    REQUEST_STATUS.PENDING,
    Date.now()
  );

  return sendOk(ctx.res, { request: { id: Number(info.lastInsertRowid), type, status: REQUEST_STATUS.PENDING } }, 201);
}

export function myRequests(ctx) {
  const user = requireAuth(ctx);
  const items = all(
    `SELECT r.id, r.type, r.status, r.review_note, r.created_at, r.reviewed_at,
            d.name AS department_name, j.name AS job_role_name,
            CAST(json_extract(r.payload,'$.department_id') AS INTEGER) AS department_id,
            CAST(json_extract(r.payload,'$.job_role_id') AS INTEGER)   AS job_role_id,
            json_extract(r.payload,'$.reason') AS reason
       FROM requests r
       LEFT JOIN departments d ON d.id = CAST(json_extract(r.payload,'$.department_id') AS INTEGER)
       LEFT JOIN jobs j        ON j.id = CAST(json_extract(r.payload,'$.job_role_id') AS INTEGER)
      WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50`,
    user.id
  );
  const current = get(
    `SELECT r.id, r.type, r.status, r.review_note
       FROM requests r WHERE r.user_id = ? AND r.status = ? ORDER BY r.id DESC LIMIT 1`,
    user.id,
    REQUEST_STATUS.PENDING
  );
  return sendOk(ctx.res, { items, pending: current || null });
}

export { currentUser };
