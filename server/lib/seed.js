/* ==========================================================================
   server/lib/seed.js — 出厂数据播种（幂等）
   已存在的数据不会覆盖，只补齐缺失项，便于反复执行。
   ========================================================================== */
import { all, get, run, scalar, withTx } from "./db.js";
import { normName } from "./strings.js";
import { createUser, findUserByUsername } from "./auth.js";
import { ensureSeeded as ensureSettingsSeeded } from "./settings.js";
import { ROLES, USER_STATUS, POINTS_REASON } from "../constants.js";
import { addPoints } from "./points.js";
import { DEPARTMENTS, JOBS, BOARDS, AI_OFFICERS, EXTRA_OFFICERS } from "../seed-data.js";

function upsertDepartments() {
  let created = 0;
  DEPARTMENTS.forEach((d, i) => {
    const norm = normName(d.name);
    const exist = get("SELECT id FROM departments WHERE name_norm = ?", norm);
    if (exist) return;
    run(
      `INSERT INTO departments (name, name_norm, en_name, description, head_name, source, confidence, is_custom, is_active, sort_order, created_at)
       VALUES (?,?,?,?,?,?,?,0,1,?,?)`,
      d.name,
      norm,
      d.en || "",
      d.description || "",
      d.head || "",
      d.source || "",
      d.confidence || "game",
      (i + 1) * 10,
      Date.now()
    );
    created++;
  });
  return created;
}

function upsertJobs() {
  let created = 0;
  JOBS.forEach((j, i) => {
    const norm = normName(j.name);
    const exist = get("SELECT id FROM jobs WHERE name_norm = ?", norm);
    if (exist) return;
    run(
      `INSERT INTO jobs (name, name_norm, en_name, description, weapons, aliases, source, confidence, is_custom, is_active, sort_order, created_at)
       VALUES (?,?,?,?,?,?,?,?,0,1,?,?)`,
      j.name,
      norm,
      j.en || "",
      j.description || "",
      j.weapons || "",
      JSON.stringify(j.aliases || []),
      j.source || "",
      j.confidence || "game",
      (i + 1) * 10,
      Date.now()
    );
    created++;
  });
  return created;
}

function upsertBoards() {
  let created = 0;
  for (const b of BOARDS) {
    const exist = get("SELECT id FROM boards WHERE slug = ?", b.slug);
    if (exist) continue;
    run(
      "INSERT INTO boards (slug, name, description, sort_order, is_active) VALUES (?,?,?,?,1)",
      b.slug,
      b.name,
      b.description || "",
      b.sortOrder || 100
    );
    created++;
  }
  return created;
}

/**
 * 创建系统账号：网站管理员（不开放注册）、AI 高管代理。
 * 初始密码取自环境变量，未提供时使用强随机密码并打印一次。
 */
export function seedSystemAccounts({ adminPassword, officerPassword, verbose = true } = {}) {
  const result = { admins: [], officers: [], createdPasswords: {} };

  // —— 网站管理员（网页运维）：仅此途径创建，注册接口永不产生该角色 ——
  let admin = findUserByUsername("webops_admin");
  if (!admin) {
    const pwd = adminPassword || randomStrongPassword();
    const deptId = get("SELECT id FROM departments WHERE name = '网站运维组'")?.id ?? null;
    const id = createUser({
      username: "webops_admin",
      displayName: "网站运维",
      password: pwd,
      role: ROLES.SITE_ADMIN,
      status: USER_STATUS.ACTIVE,
      departmentId: deptId,
      title: "网站管理员",
      isSystem: 1
    });
    withTx(() => addPoints(id, 100000, POINTS_REASON.ADMIN_ADJUST, { memo: "系统账号初始化" }));
    result.admins.push({ id, username: "webops_admin", password: pwd });
    result.createdPasswords["webops_admin"] = pwd;
  }

  // —— AI 高管代理：关联 users(role=ai_officer) + ai_officers 配置 ——
  for (const o of [...AI_OFFICERS, ...EXTRA_OFFICERS]) {
    const existUser = findUserByUsername(o.username);
    if (existUser) {
      const existOfficer = get("SELECT id FROM ai_officers WHERE user_id = ?", existUser.id);
      if (!existOfficer) {
        run(
          `INSERT INTO ai_officers (user_id, codename, title, department_id, persona, voice_lines,
                                    authority_level, can_review_mentions, auto_post_interval_sec,
                                    post_topics, enabled, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
          existUser.id,
          o.codename,
          o.title,
          get("SELECT id FROM departments WHERE name = ?", o.department)?.id ?? null,
          o.persona,
          JSON.stringify(o.voiceLines || []),
          o.authorityLevel,
          o.canReviewMentions ? 1 : 0,
          o.autoPostIntervalSec,
          JSON.stringify(o.postTopics || []),
          Date.now()
        );
      }
      continue;
    }
    const pwd = officerPassword || randomStrongPassword();
    const deptId = get("SELECT id FROM departments WHERE name = ?", o.department)?.id ?? null;
    const userId = createUser({
      username: o.username,
      displayName: o.codename,
      password: pwd,
      role: ROLES.AI_OFFICER,
      status: USER_STATUS.ACTIVE,
      departmentId: deptId,
      title: o.title,
      isSystem: 1
    });
    run(
      `INSERT INTO ai_officers (user_id, codename, title, department_id, persona, voice_lines,
                                authority_level, can_review_mentions, auto_post_interval_sec,
                                post_topics, enabled, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
      userId,
      o.codename,
      o.title,
      deptId,
      o.persona,
      JSON.stringify(o.voiceLines || []),
      o.authorityLevel,
      o.canReviewMentions ? 1 : 0,
      o.autoPostIntervalSec,
      JSON.stringify(o.postTopics || []),
      Date.now()
    );
    // 高管账号需要余额支撑"转阅回复"的记账
    withTx(() => addPoints(userId, 100000, POINTS_REASON.ADMIN_ADJUST, { memo: "AI 代理初始化" }));
    result.officers.push({ id: userId, username: o.username, codename: o.codename, password: pwd });
    result.createdPasswords[o.username] = pwd;
  }

  if (verbose && Object.keys(result.createdPasswords).length) {
    console.log("\n[seed] 已创建系统账号，初始密码（请立即登录后修改）：");
    for (const [u, p] of Object.entries(result.createdPasswords)) {
      console.log(`        ${u}  /  ${p}`);
    }
    console.log("        也可通过环境变量 HAAVK_ADMIN_PASSWORD / HAAVK_OFFICER_PASSWORD 指定。\n");
  }

  return result;
}

function randomStrongPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < 18; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** 完整播种流程 */
export function seedAll(options = {}) {
  const summary = withTx(() => ({
    departments: upsertDepartments(),
    jobs: upsertJobs(),
    boards: upsertBoards()
  }));
  ensureSettingsSeeded();
  const accounts = seedSystemAccounts(options);
  return { ...summary, accounts };
}

/** 统计播种结果，供启动日志与自检使用 */
export function seedStats() {
  return {
    departments: scalar("SELECT COUNT(*) FROM departments") || 0,
    jobs: scalar("SELECT COUNT(*) FROM jobs") || 0,
    boards: scalar("SELECT COUNT(*) FROM boards") || 0,
    admins: scalar("SELECT COUNT(*) FROM users WHERE role = 'site_admin'") || 0,
    aiOfficers: scalar("SELECT COUNT(*) FROM ai_officers") || 0,
    settings: scalar("SELECT COUNT(*) FROM site_settings") || 0
  };
}

export { all };
