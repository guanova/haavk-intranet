/* ==========================================================================
   server/api/admin.js — 管理面板（全部要求 site_admin；网站管理员不开放注册，仅后台创建）
   注意：只有 POST /api/admin/users 能创建 site_admin / chief_secretary 角色。
   ========================================================================== */
import { all, get, run, scalar, withTx } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { assertSameOrigin, readJsonBody, sendOk } from "../lib/http.js";
import { createUser, findUserById, findUserByUsername, publicUser, requireAdmin, destroyAllSessions } from "../lib/auth.js";
import { validatePasswordStrength } from "../lib/password.js";
import { vString, vInt, RULES, collect } from "../lib/validate.js";
import { allSettings, updateSettings } from "../lib/settings.js";
import { addPoints } from "../lib/points.js";
import { POINTS_REASON, REQUEST_STATUS, ROLES, USER_STATUS } from "../constants.js";
import { normName } from "../lib/strings.js";

/* ------------------------------ 概览 ------------------------------ */

export function overview(ctx) {
  requireAdmin(ctx);
  const counts = {
    users: scalar("SELECT COUNT(*) FROM users") || 0,
    hired: scalar("SELECT COUNT(*) FROM users WHERE status = 'active' AND role = 'employee'") || 0,
    pendingOnboarding: scalar("SELECT COUNT(*) FROM requests WHERE status = 'pending'") || 0,
    posts: scalar("SELECT COUNT(*) FROM posts WHERE is_deleted = 0") || 0,
    replies: scalar("SELECT COUNT(*) FROM replies WHERE is_deleted = 0") || 0,
    aiOfficers: scalar("SELECT COUNT(*) FROM ai_officers WHERE enabled = 1") || 0,
    mentionsTotal: scalar("SELECT COUNT(*) FROM mentions") || 0,
    mentionsPending: scalar("SELECT COUNT(*) FROM mentions WHERE status IN ('pending','under_review')") || 0,
    mentionsApproved: scalar("SELECT COUNT(*) FROM mentions WHERE status = 'approved'") || 0,
    mentionsRejected: scalar("SELECT COUNT(*) FROM mentions WHERE status = 'rejected'") || 0,
    ledgerSum: scalar("SELECT COALESCE(SUM(delta),0) FROM points_ledger") || 0,
    balanceSum: scalar("SELECT COALESCE(SUM(points_balance),0) FROM users") || 0
  };
  const recentRequests = all(
    `SELECT r.id, r.type, r.status, r.created_at, u.username, u.display_name
       FROM requests r JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC LIMIT 8`
  );
  const recentMentions = all(
    `SELECT m.id, m.code, m.status, m.created_at, o.codename AS officer_name, u.display_name AS requester_name
       FROM mentions m JOIN ai_officers o ON o.id = m.officer_id JOIN users u ON u.id = m.requester_id
      ORDER BY m.id DESC LIMIT 8`
  );
  // 对账快照：流水合计与余额合计必须相等
  const reconciled = counts.ledgerSum === counts.balanceSum;
  return sendOk(ctx.res, { counts, recentRequests, recentMentions, reconciled });
}

/* ------------------------------ 健康检查 ------------------------------ */

/** GET /api/admin/health —— 仅管理员可见，避免对外暴露库路径与版本 */
export function health(ctx) {
  requireAdmin(ctx);
  const row = get("PRAGMA integrity_check");
  const integrity = row ? Object.values(row)[0] : "unknown";
  return sendOk(ctx.res, {
    ok: true,
    now: Date.now(),
    schemaVersion: scalar("SELECT MAX(version) FROM schema_migrations") || 0,
    integrity,
    dbFile: "已配置" // 不回显真实路径，避免信息泄露
  });
}

/* ------------------------------ 入职 / 岗位变更审批 ------------------------------ */

export function listRequests(ctx) {
  requireAdmin(ctx);
  const status = ctx.query.status && ["pending", "approved", "rejected"].includes(ctx.query.status) ? ctx.query.status : null;
  const rows = all(
    `SELECT r.*, u.username, u.display_name, u.status AS user_status,
            u.department_id AS current_department_id, u.job_role_id AS current_job_role_id,
            d.name AS target_department_name, j.name AS target_job_role_name,
            rd.name AS current_department_name, rj.name AS current_job_role_name
       FROM requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN departments d  ON d.id = CAST(json_extract(r.payload,'$.department_id') AS INTEGER)
       LEFT JOIN jobs j         ON j.id = CAST(json_extract(r.payload,'$.job_role_id') AS INTEGER)
       LEFT JOIN departments rd ON rd.id = u.department_id
       LEFT JOIN jobs rj        ON rj.id = u.job_role_id
      ${status ? "WHERE r.status = ?" : ""}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT 200`,
    ...(status ? [status] : [])
  );
  return sendOk(ctx.res, {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      userStatus: r.user_status,
      reason: safeJson(r.payload).reason || "",
      targetDepartmentId: safeJson(r.payload).department_id,
      targetDepartmentName: r.target_department_name || "",
      targetJobRoleId: safeJson(r.payload).job_role_id,
      targetJobRoleName: r.target_job_role_name || "",
      currentDepartmentName: r.current_department_name || "",
      currentJobRoleName: r.current_job_role_name || "",
      reviewNote: r.review_note || "",
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at
    }))
  });
}

/**
 * POST /api/admin/requests/:id/review
 * 审批通过时在**同一事务**里写入岗位、转正状态并记录审计。
 */
export async function reviewRequest(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const decision = String(body.decision || "");
  if (!["approve", "reject"].includes(decision)) {
    throw AppError.badRequest("审批结论必须为 approve 或 reject", { fields: { decision: "结论不合法" } });
  }
  const note = String(body.note || "").slice(0, 200);

  const result = withTx(() => {
    const req = get("SELECT * FROM requests WHERE id = ?", id);
    if (!req) throw AppError.notFound("申请不存在");
    if (req.status !== REQUEST_STATUS.PENDING) throw AppError.conflict("该申请已被处理");

    const now = Date.now();
    const payload = safeJson(req.payload);

    if (decision === "approve") {
      const dept = get("SELECT id, is_active FROM departments WHERE id = ?", payload.department_id);
      if (!dept || !dept.is_active) throw AppError.badRequest("目标部门已停用，无法通过该申请");
      const job = get("SELECT id, is_active FROM jobs WHERE id = ?", payload.job_role_id);
      if (!job || !job.is_active) throw AppError.badRequest("目标岗位已停用，无法通过该申请");

      run(
        `UPDATE users SET department_id = ?, job_role_id = ?, status = ?, is_system = is_system, updated_at = ?
          WHERE id = ?`,
        payload.department_id,
        payload.job_role_id,
        USER_STATUS.ACTIVE,
        now,
        req.user_id
      );
      run(
        "UPDATE requests SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?",
        REQUEST_STATUS.APPROVED,
        admin.id,
        note,
        now,
        id
      );
    } else {
      run(
        "UPDATE requests SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?",
        REQUEST_STATUS.REJECTED,
        admin.id,
        note || "未通过审批",
        now,
        id
      );
    }

    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      decision === "approve" ? "request.approve" : "request.reject",
      "request",
      String(id),
      JSON.stringify({ userId: req.user_id, type: req.type, note }),
      ctx.ip,
      now
    );

    return { id, status: decision === "approve" ? REQUEST_STATUS.APPROVED : REQUEST_STATUS.REJECTED };
  });

  return sendOk(ctx.res, {
    request: result,
    user: publicUser(findUserById(get("SELECT user_id FROM requests WHERE id = ?", id).user_id))
  });
}

/* ------------------------------ 站点配置（含备案信息） ------------------------------ */

export function listSettingsHandler(ctx) {
  requireAdmin(ctx);
  return sendOk(ctx.res, { items: allSettings() });
}

export async function updateSettingsHandler(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const body = await readJsonBody(ctx.req);
  if (!Array.isArray(body.items)) throw AppError.badRequest("items 必须为数组");
  const updated = withTx(() => {
    const keys = updateSettings(body.items, admin.id);
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      "settings.update",
      "site_settings",
      keys.join(","),
      JSON.stringify({ keys }),
      ctx.ip,
      Date.now()
    );
    return keys;
  });
  return sendOk(ctx.res, { updated, items: allSettings() });
}

/* ------------------------------ 用户管理 ------------------------------ */

export function listUsers(ctx) {
  requireAdmin(ctx);
  const q = String(ctx.query.q || "").trim();
  const role = ctx.query.role || "";
  const where = [];
  const params = [];
  if (q) {
    where.push("(u.username LIKE ? OR u.display_name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (role) {
    where.push("u.role = ?");
    params.push(role);
  }
  const rows = all(
    `SELECT u.*, d.name AS department_name, j.name AS job_role_name, up.stored_name AS avatar_stored
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN jobs j        ON j.id = u.job_role_id
       LEFT JOIN uploads up    ON up.id = u.avatar_upload_id AND up.deleted_at IS NULL
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY CASE u.role WHEN 'site_admin' THEN 0 WHEN 'chief_secretary' THEN 1 WHEN 'ai_officer' THEN 2 ELSE 3 END,
               u.id ASC
      LIMIT 300`,
    ...params
  );
  const pendingRequests = all(
    "SELECT user_id, type, status FROM requests WHERE status = 'pending'"
  );
  const pendingByUser = new Map(pendingRequests.map((r) => [r.user_id, r.type]));
  return sendOk(ctx.res, {
    items: rows.map((r) => ({
      ...publicUser(r),
      hasPendingRequest: pendingByUser.has(r.id),
      pendingRequestType: pendingByUser.get(r.id) || null
    }))
  });
}

/**
 * POST /api/admin/users —— **唯一**可以创建 site_admin / chief_secretary 的入口。
 * 网站管理员（网页运维）不开放注册，只能由既有管理员在后台创建。
 */
export async function createUserHandler(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
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
    { field: "display_name", ...vString(body.display_name, { label: "昵称", min: 2, max: 16 }) },
    { field: "role", ...vString(body.role, { label: "角色", min: 1, max: 32 }) }
  ]);
  if (!Object.values(ROLES).includes(values.role)) {
    throw AppError.badRequest("角色不合法", { fields: { role: "角色不合法" } });
  }
  if (findUserByUsername(values.username)) {
    throw AppError.conflict("该账号已存在", { fields: { username: "该账号已存在" } });
  }
  const pwdErr = validatePasswordStrength(body.password);
  if (pwdErr) throw AppError.badRequest(pwdErr, { fields: { password: pwdErr } });

  const departmentId = body.department_id ? Number.parseInt(body.department_id, 10) : null;
  const jobRoleId = body.job_role_id ? Number.parseInt(body.job_role_id, 10) : null;
  if (departmentId) {
    const d = get("SELECT id FROM departments WHERE id = ?", departmentId);
    if (!d) throw AppError.badRequest("部门不存在", { fields: { department_id: "部门不存在" } });
  }

  // 管理岗 / 秘书办直接为 active；员工岗走入职流程
  const status = values.role === ROLES.EMPLOYEE ? USER_STATUS.PENDING_ONBOARDING : USER_STATUS.ACTIVE;

  const created = withTx(() => {
    const userId = createUser({
      username: values.username,
      displayName: values.display_name,
      password: body.password,
      role: values.role,
      status,
      departmentId,
      jobRoleId,
      title: String(body.title || "").slice(0, 32),
      isSystem: values.role === ROLES.EMPLOYEE ? 0 : 1
    });
    // AI 高管需要额外的代理登记
    if (values.role === ROLES.AI_OFFICER) {
      run(
        `INSERT INTO ai_officers (user_id, codename, title, department_id, persona, voice_lines,
                                  authority_level, can_review_mentions, auto_post_interval_sec, enabled, created_at)
         VALUES (?,?,?,?,'','[]',5,0,0,1,?)`,
        userId,
        values.display_name,
        String(body.title || "").slice(0, 32),
        departmentId,
        Date.now()
      );
    }
    if (values.role === ROLES.SITE_ADMIN || values.role === ROLES.CHIEF_SECRETARY) {
      // 系统账号给予充足点数，避免运营动作被点数阻断
      addPoints(userId, 100000, POINTS_REASON.ADMIN_ADJUST, { memo: "系统账号初始化" });
    }
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      "user.create",
      "user",
      String(userId),
      JSON.stringify({ username: values.username, role: values.role }),
      ctx.ip,
      Date.now()
    );
    return userId;
  });

  return sendOk(ctx.res, { user: publicUser(findUserById(created)) }, 201);
}

/** POST /api/admin/users/:id/points —— 手工调整点数（写流水，不破坏对账） */
export async function adjustPoints(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const values = collect([
    { field: "delta", ...vInt(body.delta, { label: "调整值", min: -1000000, max: 1000000 }) },
    { field: "memo", ...vString(body.memo, { label: "备注", required: false, max: 120 }) }
  ]);
  const user = get("SELECT id FROM users WHERE id = ?", id);
  if (!user) throw AppError.notFound("账号不存在");

  const balance = withTx(() => {
    const next = addPoints(id, values.delta, POINTS_REASON.ADMIN_ADJUST, {
      memo: values.memo || `管理员调整`,
      refType: "admin",
      refId: admin.id
    });
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      "user.points_adjust",
      "user",
      String(id),
      JSON.stringify({ delta: values.delta, memo: values.memo || "" }),
      ctx.ip,
      Date.now()
    );
    return next;
  });
  return sendOk(ctx.res, { user: publicUser(findUserById(id)), balance });
}

/** POST /api/admin/users/:id/status —— 停用 / 启用；停用会吊销全部会话 */
export async function setUserStatus(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const status = String(body.status || "");
  if (!Object.values(USER_STATUS).includes(status)) {
    throw AppError.badRequest("状态不合法", { fields: { status: "状态不合法" } });
  }
  const user = get("SELECT id, role, is_system FROM users WHERE id = ?", id);
  if (!user) throw AppError.notFound("账号不存在");
  if (user.id === admin.id) throw AppError.badRequest("不能修改自己的账号状态");
  if (user.role === ROLES.SITE_ADMIN && user.is_system) {
    const admins = scalar("SELECT COUNT(*) FROM users WHERE role = 'site_admin' AND status = 'active'");
    if (admins <= 1 && status !== USER_STATUS.ACTIVE) {
      throw AppError.badRequest("系统至少需要保留一名可用的网站管理员");
    }
  }

  withTx(() => {
    run("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", status, Date.now(), id);
    if (status !== USER_STATUS.ACTIVE) destroyAllSessions(id);
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      "user.status",
      "user",
      String(id),
      JSON.stringify({ status }),
      ctx.ip,
      Date.now()
    );
  });
  return sendOk(ctx.res, { user: publicUser(findUserById(id)) });
}

/* ------------------------------ @ 审核管理 ------------------------------ */

export function listMentions(ctx) {
  requireAdmin(ctx);
  const status = ctx.query.status;
  const rows = all(
    `SELECT m.*, o.codename AS officer_name, o.title AS officer_title,
            u.display_name AS requester_name, u.username AS requester_username,
            p.title AS post_title
       FROM mentions m
       JOIN ai_officers o ON o.id = m.officer_id
       JOIN users u ON u.id = m.requester_id
       JOIN posts p ON p.id = m.post_id
      ${status && ["pending", "under_review", "approved", "rejected"].includes(status) ? "WHERE m.status = ?" : ""}
      ORDER BY m.id DESC LIMIT 200`,
    ...(status ? [status] : [])
  );
  return sendOk(ctx.res, {
    items: rows.map((r) => ({
      id: r.id,
      code: r.code,
      postId: r.post_id,
      postTitle: r.post_title,
      officerName: r.officer_name,
      officerTitle: r.officer_title,
      requesterName: r.requester_name,
      status: r.status,
      decisionReason: r.decision_reason,
      assignedMinutes: r.assigned_minutes,
      assignedAt: r.assigned_at,
      burstCount: r.burst_count,
      createdAt: r.created_at,
      decidedAt: r.decided_at
    }))
  });
}

/* ------------------------------ AI 高管配置 ------------------------------ */

export function listAiOfficers(ctx) {
  requireAdmin(ctx);
  const rows = all(
    `SELECT o.*, u.username, u.status AS user_status, u.points_balance, d.name AS department_name
       FROM ai_officers o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN departments d ON d.id = o.department_id
      ORDER BY o.authority_level DESC, o.id ASC`
  );
  return sendOk(ctx.res, {
    items: rows.map((o) => ({
      id: o.id,
      userId: o.user_id,
      username: o.username,
      codename: o.codename,
      title: o.title,
      departmentId: o.department_id,
      departmentName: o.department_name || "",
      persona: o.persona,
      voiceLines: safeArray(o.voice_lines),
      postTopics: safeArray(o.post_topics),
      authorityLevel: o.authority_level,
      canReviewMentions: !!o.can_review_mentions,
      autoPostIntervalSec: o.auto_post_interval_sec,
      enabled: !!o.enabled,
      pointsBalance: o.points_balance,
      userStatus: o.user_status
    }))
  });
}

/** POST /api/admin/ai-officers/:id —— 更新人设、发言素材、职级、自主发帖周期 */
export async function updateAiOfficer(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const officer = get("SELECT * FROM ai_officers WHERE id = ?", id);
  if (!officer) throw AppError.notFound("AI 高管不存在");

  const patch = {};
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
  if (body.can_review_mentions !== undefined) patch.can_review_mentions = body.can_review_mentions ? 1 : 0;
  if (body.authority_level !== undefined) {
    const n = Number.parseInt(body.authority_level, 10);
    if (!Number.isFinite(n) || n < 1 || n > 10) throw AppError.badRequest("职级须在 1–10 之间", { fields: { authority_level: "职级须在 1–10 之间" } });
    patch.authority_level = n;
  }
  if (body.auto_post_interval_sec !== undefined) {
    const n = Number.parseInt(body.auto_post_interval_sec, 10);
    if (!Number.isFinite(n) || n < 0 || n > 86400) {
      throw AppError.badRequest("自主发帖周期须在 0–86400 秒之间", { fields: { auto_post_interval_sec: "周期不合法" } });
    }
    patch.auto_post_interval_sec = n;
  }
  if (body.persona !== undefined) patch.persona = String(body.persona).slice(0, 300);
  if (body.voice_lines !== undefined) {
    if (!Array.isArray(body.voice_lines)) throw AppError.badRequest("发言素材必须为数组", { fields: { voice_lines: "格式不正确" } });
    const lines = body.voice_lines
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 40)
      .map((x) => x.slice(0, 200));
    if (!lines.length) throw AppError.badRequest("至少保留一条发言素材", { fields: { voice_lines: "不能为空" } });
    patch.voice_lines = JSON.stringify(lines);
  }
    if (body.post_topics !== undefined) {
    if (!Array.isArray(body.post_topics)) throw AppError.badRequest("自主选题必须为数组", { fields: { post_topics: "格式不正确" } });
    const topics = body.post_topics
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((x) => x.slice(0, 200));
    patch.post_topics = JSON.stringify(topics);
  }
if (body.title !== undefined) patch.title = String(body.title).slice(0, 32);

  const keys = Object.keys(patch);
  if (!keys.length) throw AppError.badRequest("没有需要更新的字段");
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const params = keys.map((k) => patch[k]);
  withTx(() => {
    run(`UPDATE ai_officers SET ${setSql} WHERE id = ?`, ...params, id);
    if (patch.title !== undefined) run("UPDATE users SET title = ?, updated_at = ? WHERE id = ?", patch.title, Date.now(), officer.user_id);
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      "ai_officer.update",
      "ai_officer",
      String(id),
      JSON.stringify(patch),
      ctx.ip,
      Date.now()
    );
  });
  return sendOk(ctx.res, { id, updated: keys });
}

/* ------------------------------ 审计日志 ------------------------------ */

export function listAuditLogs(ctx) {
  requireAdmin(ctx);
  const rows = all(
    `SELECT a.*, u.display_name AS actor_name, u.username AS actor_username
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.id DESC LIMIT 200`
  );
  return sendOk(ctx.res, {
    items: rows.map((r) => ({
      id: r.id,
      actorName: r.actor_name || "系统",
      actorUsername: r.actor_username || "",
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      detail: safeJson(r.detail),
      ip: r.ip,
      createdAt: r.created_at
    }))
  });
}

/* ------------------------------ 部门 / 岗位维护 ------------------------------ */

export async function createDepartment(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const body = await readJsonBody(ctx.req);
  const values = collect([
    { field: "name", ...vString(body.name, { label: "部门名称", min: 2, max: 24 }) },
    { field: "description", ...vString(body.description, { label: "部门职责", required: false, max: 120 }) }
  ]);
  const norm = normName(values.name);
  const dup = get("SELECT id, name FROM departments WHERE name_norm = ?", norm);
  if (dup) throw AppError.conflict(`已存在同名部门「${dup.name}」`, { fields: { name: "部门名称重复" } });

  const order = (scalar("SELECT MAX(sort_order) FROM departments") || 100) + 10;
  const info = run(
    `INSERT INTO departments (name, name_norm, en_name, description, head_name, source, confidence, is_custom, is_active, sort_order, created_at)
     VALUES (?,?,?,?,?,'管理面板创建','custom',1,1,?,?)`,
    values.name,
    norm,
    "",
    values.description || "",
    "",
    order,
    Date.now()
  );
  run(
    "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
    admin.id,
    "department.create",
    "department",
    String(info.lastInsertRowid),
    JSON.stringify({ name: values.name }),
    ctx.ip,
    Date.now()
  );
  return sendOk(ctx.res, { id: Number(info.lastInsertRowid), name: values.name }, 201);
}

export async function toggleDepartment(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const active = body.is_active ? 1 : 0;
  const dept = get("SELECT id, name FROM departments WHERE id = ?", id);
  if (!dept) throw AppError.notFound("部门不存在");
  if (!active) {
    const usersHere = scalar("SELECT COUNT(*) FROM users WHERE department_id = ? AND status = 'active'", id);
    if (usersHere > 0) {
      throw AppError.conflict(`该部门下仍有 ${usersHere} 名在职员工，请先调整其归属再停用`);
    }
  }
  withTx(() => {
    run("UPDATE departments SET is_active = ? WHERE id = ?", active, id);
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      "department.toggle",
      "department",
      String(id),
      JSON.stringify({ is_active: active }),
      ctx.ip,
      Date.now()
    );
  });
  return sendOk(ctx.res, { id, isActive: !!active });
}

function safeJson(text) {
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function safeArray(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/* ------------------------------ 资料征集（投稿审核 + WebDAV） ------------------------------ */

/** GET /api/admin/submissions?status=pending —— 投稿列表（含附件与转存状态） */
export function listSubmissions(ctx) {
  requireAdmin(ctx);
  const status = String(ctx.query.status || "");
  const where = ["pending", "approved", "rejected"].includes(status)
    ? "WHERE s.status = ?"
    : "";
  const rows = where
    ? all(
        `SELECT s.*, u.username AS user_username FROM submissions s
         LEFT JOIN users u ON u.id = s.user_id
         ${where} ORDER BY s.id DESC LIMIT 200`,
        status
      )
    : all(
        `SELECT s.*, u.username AS user_username FROM submissions s
         LEFT JOIN users u ON u.id = s.user_id
         ORDER BY s.id DESC LIMIT 200`
      );
  const files = all(
    `SELECT id, submission_id, stored_name, orig_name, mime, byte_size, webdav_status, webdav_path, webdav_attempts
     FROM submission_files ORDER BY id`
  );
  const bySub = {};
  for (const f of files) {
    (bySub[f.submission_id] = bySub[f.submission_id] || []).push({
      id: f.id,
      url: "/media/submissions/" + f.stored_name,
      origName: f.orig_name,
      byteSize: f.byte_size,
      webdavStatus: f.webdav_status,
      webdavPath: f.webdav_path,
      webdavAttempts: f.webdav_attempts
    });
  }
  return sendOk(ctx.res, {
    items: rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      contact: r.contact,
      type: r.type,
      text: r.text,
      status: r.status,
      reviewNote: r.review_note,
      rewardPoints: r.reward_points || 0,
      username: r.user_username || "",
      ip: r.ip,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
      files: bySub[r.id] || []
    }))
  });
}

/** POST /api/admin/submissions/:id/review —— { action: 'approve'|'reject', note?, rewardPoints? } */
export async function reviewSubmission(ctx) {
  assertSameOrigin(ctx.req);
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const action = String(body.action || "");
  if (!["approve", "reject"].includes(action)) throw AppError.badRequest("action 只能是 approve/reject");
  const sub = get("SELECT * FROM submissions WHERE id = ?", id);
  if (!sub) throw AppError.notFound("投稿不存在");
  if (sub.status !== "pending") throw AppError.conflict("该稿件已处理过，不能重复审核");

  const note = String(body.note || "").slice(0, 200);
  if (action === "reject" && !note.trim()) throw AppError.badRequest("不收录时请填写理由，会同步给投稿人");
  const reward = Math.max(0, Math.min(5000, Number.parseInt(body.rewardPoints, 10) || 0));
  const now = Date.now();

  withTx(() => {
    run(
      "UPDATE submissions SET status = ?, review_note = ?, reviewed_at = ?, reward_points = ? WHERE id = ?",
      action === "approve" ? "approved" : "rejected",
      note,
      now,
      action === "approve" ? reward : 0,
      id
    );
    // 收录奖励：投稿者是在册用户且管理员填了奖励点数 → 走统一入账（不破坏对账）
    if (action === "approve" && reward > 0 && sub.user_id) {
      addPoints(sub.user_id, reward, POINTS_REASON.ADMIN_ADJUST, {
        memo: `资料征集收录奖励（投稿 #${id}）`,
        refType: "submission",
        refId: id
      });
    }
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      admin.id,
      "submission.review",
      "submission",
      String(id),
      JSON.stringify({ action, note, reward }),
      ctx.ip,
      now
    );
  });
  return sendOk(ctx.res, { id, status: action === "approve" ? "approved" : "rejected" });
}

/** POST /api/admin/submissions/webdav/retry —— 把 failed 的文件重置为 pending 让 worker 重传；body.ids 可限定指定投稿 */
export async function retryWebdav(ctx) {
  requireAdmin(ctx);
  let ids = [];
  try {
    const body = await readJsonBody(ctx.req);
    ids = Array.isArray(body && body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    ids = [];
  }
  const info = ids.length
    ? run(
        `UPDATE submission_files SET webdav_status = 'pending', webdav_attempts = 0
         WHERE webdav_status = 'failed' AND submission_id IN (${ids.map(() => "?").join(",")})`,
        ...ids
      )
    : run(
        "UPDATE submission_files SET webdav_status = 'pending', webdav_attempts = 0 WHERE webdav_status = 'failed'"
      );
  return sendOk(ctx.res, { reset: info.changes || 0 });
}

/** POST /api/admin/submissions/webdav/test —— 测试 WebDAV 连接 */
export async function testWebdav(ctx) {
  requireAdmin(ctx);
  const { testConnection } = await import("../lib/webdav.js");
  const r = await testConnection();
  return sendOk(ctx.res, r);
}

/** GET /api/admin/submissions/webdav/stats —— 转存状态计数 */
export async function webdavStats(ctx) {
  requireAdmin(ctx);
  const { davStats } = await import("../lib/webdav.js");
  return sendOk(ctx.res, davStats());
}
