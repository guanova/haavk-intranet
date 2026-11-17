/* ==========================================================================
   server/lib/mentions.js — @ 呼叫：职级校验、风控、价值评估、状态机
   状态流转：pending → under_review → approved | rejected
   三分支回执文案来自 constants.MENTION_COPY（唯一副本）
   ========================================================================== */
import { all, get, run, scalar } from "./db.js";
import { AppError } from "./errors.js";
import {
  MENTION_STATUS,
  RECEIPT_STAGE,
  QUALITY,
  ROLES,
  renderApprovedCopy,
  MENTION_COPY
} from "../constants.js";
import { getSettingNumber } from "./settings.js";
import { extractMentions, textLength, looksLikeSpam, mentionCode, tidy } from "./strings.js";
import { addPoints } from "./points.js";
import { POINTS_REASON } from "../constants.js";

/* ------------------------------ 回执写入 ------------------------------ */

export function pushReceipt(mentionId, stage, message) {
  run(
    "INSERT INTO mention_receipts (mention_id, stage, message, created_at) VALUES (?,?,?,?)",
    mentionId,
    stage,
    message,
    Date.now()
  );
}

export function receiptsOf(mentionId) {
  return all(
    "SELECT id, stage, message, created_at FROM mention_receipts WHERE mention_id = ? ORDER BY id ASC",
    mentionId
  );
}

/* ------------------------------ 呼叫目标解析 ------------------------------ */

/** 把正文中的 @名称 解析为可用高管（不存在的忽略，避免误报错） */
export function resolveMentionTargets(body) {
  const raw = extractMentions(body);
  if (!raw.length) return { mentions: [], unknown: [] };
  const officers = all("SELECT * FROM ai_officers WHERE enabled = 1");
  const byName = new Map();
  for (const o of officers) {
    byName.set(o.codename, o);
    // 支持用「名字最后一段」呼叫，例如 @德穆兰 命中「阿娜伊斯·德穆兰」
    const parts = String(o.codename).split(/[·\s]+/).filter(Boolean);
    if (parts.length > 1) byName.set(parts[parts.length - 1], o);
  }
  const picked = [];
  const unknown = [];
  const seen = new Set();
  for (const m of raw) {
    const officer = byName.get(m.name);
    if (!officer) {
      unknown.push(m.name);
      continue;
    }
    if (seen.has(officer.id)) continue;
    seen.add(officer.id);
    picked.push({ officer, raw: m.raw, name: m.name });
  }
  return { mentions: picked, unknown };
}

/* ------------------------------ 风控与职级校验 ------------------------------ */

/**
 * 同步预检。命中任一条件即驳回（返回 {ok:false, reason}）。
 * 文案分支由调用方决定，这里只给判定依据。
 */
export function precheck({ requester, officer, body, mentionCount }) {
  const contentLen = textLength(tidy(body));
  const cooldownSec = getSettingNumber("mention.cooldown_sec", 60);
  const hourlyLimit = getSettingNumber("mention.hourly_limit", 5);
  const maxPerPost = getSettingNumber("mention.max_per_post", 3);
  const now = Date.now();

  if (!officer.enabled) {
    return { ok: false, reason: "TARGET_DISABLED", detail: "呼叫对象当前未开放受理" };
  }

  if (mentionCount > maxPerPost) {
    return { ok: false, reason: "TOO_MANY_PER_POST", detail: `单帖呼叫不得超过 ${maxPerPost} 位` };
  }

  if (contentLen < QUALITY.MIN_CONTENT_LEN) {
    return { ok: false, reason: "TOO_SHORT", detail: `内容有效长度不足 ${QUALITY.MIN_CONTENT_LEN} 字` };
  }

  if (looksLikeSpam(body)) {
    return { ok: false, reason: "SPAM", detail: "内容存在异常重复字符" };
  }

  // 冷却：同一用户对同一高管
  const lastSame = get(
    "SELECT created_at FROM mentions WHERE requester_id = ? AND officer_id = ? ORDER BY id DESC LIMIT 1",
    requester.id,
    officer.id
  );
  if (lastSame) {
    const elapsed = now - lastSame.created_at;
    if (elapsed < cooldownSec * 1000) {
      return {
        ok: false,
        reason: "COOLDOWN",
        detail: `重复间隔需不小于 ${cooldownSec} 秒`,
        retryAfter: Math.ceil((cooldownSec * 1000 - elapsed) / 1000)
      };
    }
    // 24 小时内不可对同一位高管重复呼叫
    if (elapsed < QUALITY.DUP_WINDOW_MS) {
      return { ok: false, reason: "DUPLICATE_24H", detail: "24 小时内已呼叫过该高管" };
    }
  }

  // 每小时总量
  const hourly = scalar(
    "SELECT COUNT(*) FROM mentions WHERE requester_id = ? AND created_at >= ?",
    requester.id,
    now - 3600_000
  );
  if (hourly >= hourlyLimit) {
    const oldest = get(
      "SELECT created_at FROM mentions WHERE requester_id = ? AND created_at >= ? ORDER BY created_at ASC LIMIT 1",
      requester.id,
      now - 3600_000
    );
    return {
      ok: false,
      reason: "HOURLY_LIMIT",
      detail: `每小时呼叫上限为 ${hourlyLimit} 次`,
      retryAfter: oldest ? Math.max(1, Math.ceil((oldest.created_at + 3600_000 - now) / 1000)) : 3600
    };
  }

  // 短时间集中呼叫（刷屏观察窗口）
  const burst = scalar(
    "SELECT COUNT(*) FROM mentions WHERE requester_id = ? AND created_at >= ?",
    requester.id,
    now - QUALITY.BURST_WINDOW_MS
  );
  if (burst >= QUALITY.BURST_LIMIT) {
    return { ok: false, reason: "BURST", detail: `10 分钟内已呼叫 ${burst} 次`, burst };
  }

  // 职级门槛：呼叫者的职级分必须达到站点配置的受理下限。
  // 说明：原本按「目标高管职级 × 0.55」计算，会让新员工（职级分 2）永远无法通过，
  // 导致"审核通过"分支实际不可达。现改为**与目标无关的固定受理下限**（可配置），
  // 而目标高管的 authority_level 仍参与 <time> 计算，用于体现受理优先级。
  const requesterLevel = authorityOf(requester);
  const minAuthority = getSettingNumber("mention.min_authority", 2);
  if (requesterLevel < minAuthority) {
    return {
      ok: false,
      reason: "INSUFFICIENT_AUTHORITY",
      detail: `呼叫者职级分 ${requesterLevel}，低于受理下限 ${minAuthority}`
    };
  }

  return { ok: true, contentLen, burst, requesterLevel, minAuthority, cooldownSec, hourlyLimit, maxPerPost };
}

/**
 * 职级分标尺（0–10）：
 *   1  受限账号（停用/异常）
 *   3  新入职员工（基线）
 *   4  活跃员工
 *   6  资深员工 / 工程或情报条线
 *   7  部门负责人级
 *   9  集团高级管理人员（AI 高管）
 *   10 网站管理员
 * 员工分会随「入职时长 + 发帖量 + 历史被采纳的呼叫」自然提升。
 */
export function authorityOf(user) {
  if (user.role === ROLES.SITE_ADMIN) return 10;
  if (user.role === ROLES.CHIEF_SECRETARY) return 9;
  if (user.role === ROLES.AI_OFFICER) {
    const o = get("SELECT authority_level FROM ai_officers WHERE user_id = ?", user.id);
    return o ? o.authority_level : 6;
  }
  if (user.status && user.status !== "active") return 1;
  const days = Math.max(0, (Date.now() - user.created_at) / 86400_000);
  const posts = scalar("SELECT COUNT(*) FROM posts WHERE author_id = ? AND is_deleted = 0", user.id) || 0;
  const accepted = scalar("SELECT COUNT(*) FROM mentions WHERE requester_id = ? AND status = ?", user.id, MENTION_STATUS.APPROVED) || 0;
  const score = 3 + Math.min(1, Math.floor(days / 3)) + Math.min(1, Math.floor(posts / 5)) + Math.min(2, accepted);
  return Math.min(9, score);
}

/* ------------------------------ <time> 动态计算 ------------------------------ */

/** 计算高管为此分配的最合理时间（分钟）。结果不得写死。 */
export function computeAssignedMinutes({ officer, contentLen, hourlyLoad, authorityGap }) {
  let minutes = QUALITY.TIME_BASE_MIN;
  if (contentLen >= 120) minutes += 4;
  minutes += Math.min(12, hourlyLoad * 2);
  minutes += Math.max(0, authorityGap) * 2;
  return Math.max(QUALITY.TIME_MIN_MIN, Math.min(QUALITY.TIME_MAX_MIN, Math.round(minutes)));
}

/* ------------------------------ 价值评估 ------------------------------ */

export function evaluateValue({ body, burst }) {
  const len = textLength(tidy(body));
  if (len < QUALITY.VALUE_MIN_LEN) {
    return { approved: false, reason: "LOW_VALUE_LENGTH", detail: `有效长度 ${len} 字，未达 ${QUALITY.VALUE_MIN_LEN} 字门槛` };
  }
  if (looksLikeSpam(body)) {
    return { approved: false, reason: "SPAM", detail: "内容存在异常重复" };
  }
  if (burst > QUALITY.BURST_LIMIT) {
    return { approved: false, reason: "BURST", detail: `10 分钟内呼叫 ${burst} 次，判定为异常集中呼叫` };
  }
  return { approved: true, reason: "VALUE_CONFIRMED", detail: `有效长度 ${len} 字，覆盖具体诉求` };
}

/* ------------------------------ 创建呼叫（事务内调用） ------------------------------ */

/**
 * 为一条内容创建 @ 呼叫。返回 { created:[{mentionId, code, officer, status, receipt}], rejected:[...] }
 * 注意：本方法只插入记录与首条回执，不做异步审核。
 */
export function createMentionsForContent({ requester, postId, replyId, body, targets }) {
  const now = Date.now();
  const created = [];
  const rejected = [];
  const mentionCount = targets.length;

  for (const t of targets) {
    const pre = precheck({ requester, officer: t.officer, body, mentionCount });
    const seq = (scalar("SELECT COUNT(*) FROM mentions") || 0) + 1;
    const code = mentionCode(seq);

    if (!pre.ok) {
      const info = run(
        `INSERT INTO mentions (code, post_id, reply_id, requester_id, officer_id, mention_text,
                               status, decision_reason, burst_count, created_at, decided_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        code,
        postId,
        replyId,
        requester.id,
        t.officer.id,
        t.raw,
        MENTION_STATUS.REJECTED,
        `${pre.reason}: ${pre.detail}`,
        pre.burst || 0,
        now,
        now
      );
      const id = Number(info.lastInsertRowid);
      pushReceipt(id, RECEIPT_STAGE.REJECTED, MENTION_COPY.REJECTED);
      rejected.push({ mentionId: id, code, officer: t.officer.codename, reason: pre.reason, detail: pre.detail, retryAfter: pre.retryAfter || 0 });
      continue;
    }

    const info = run(
      `INSERT INTO mentions (code, post_id, reply_id, requester_id, officer_id, mention_text,
                             status, decision_reason, burst_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      code,
      postId,
      replyId,
      requester.id,
      t.officer.id,
      t.raw,
      MENTION_STATUS.PENDING,
      `PRECHECK_OK: 职级 ${pre.requesterLevel}/${pre.required}`,
      pre.burst,
      now
    );
    const id = Number(info.lastInsertRowid);
    pushReceipt(id, RECEIPT_STAGE.SUBMITTED, MENTION_COPY.UNDER_REVIEW);
    created.push({ mentionId: id, code, officer: t.officer, status: MENTION_STATUS.PENDING, pre });
  }

  return { created, rejected };
}

/* ------------------------------ 审核（后台 worker 调用） ------------------------------ */

/**
 * 推进一条 pending 呼叫：先进入 under_review，再做价值评估。
 * 全程事务；通过时生成高管转阅回复。
 * @returns {{status:string, minutes?:number, assignedAt?:number}|null}
 */
export function advanceMention(mentionId, { reviewerId = null } = {}) {
  const mention = get("SELECT * FROM mentions WHERE id = ?", mentionId);
  if (!mention || mention.status !== MENTION_STATUS.PENDING) return null;

  const officer = get("SELECT * FROM ai_officers WHERE id = ?", mention.officer_id);
  const post = get("SELECT * FROM posts WHERE id = ?", mention.post_id);
  const requester = get("SELECT * FROM users WHERE id = ?", mention.requester_id);
  if (!officer || !post) {
    run("UPDATE mentions SET status = ?, decision_reason = ?, decided_at = ? WHERE id = ?", MENTION_STATUS.REJECTED, "TARGET_OR_POST_MISSING", Date.now(), mentionId);
    pushReceipt(mentionId, RECEIPT_STAGE.REJECTED, MENTION_COPY.REJECTED);
    return { status: MENTION_STATUS.REJECTED };
  }

  if (!receiptsOf(mentionId).some((r) => r.stage === RECEIPT_STAGE.UNDER_REVIEW)) {
    pushReceipt(mentionId, RECEIPT_STAGE.UNDER_REVIEW, MENTION_COPY.UNDER_REVIEW);
  }
  run("UPDATE mentions SET status = ? WHERE id = ?", MENTION_STATUS.UNDER_REVIEW, mentionId);

  const now = Date.now();
  // 近 10 分钟该用户的呼叫次数（审计与价值评估共用）
  const burst = scalar(
    "SELECT COUNT(*) FROM mentions WHERE requester_id = ? AND created_at >= ?",
    mention.requester_id,
    now - QUALITY.BURST_WINDOW_MS
  );
  const verdict = evaluateValue({ body: post.body, burst: Math.max(mention.burst_count, burst) });

  if (!verdict.approved) {
    run(
      "UPDATE mentions SET status = ?, decision_reason = ?, reviewer_id = ?, decided_at = ? WHERE id = ?",
      MENTION_STATUS.REJECTED,
      `${verdict.reason}: ${verdict.detail}`,
      reviewerId,
      now,
      mentionId
    );
    pushReceipt(mentionId, RECEIPT_STAGE.REJECTED, MENTION_COPY.REJECTED);
    return { status: MENTION_STATUS.REJECTED, reason: verdict.reason };
  }

  // 动态计算「最合理时间」
  const hourlyLoad = scalar(
    "SELECT COUNT(*) FROM mentions WHERE officer_id = ? AND created_at >= ?",
    officer.id,
    now - 3600_000
  );
  const authorityGap = officer.authority_level - authorityOf(requester || { role: "employee", id: 0, created_at: now });
  const contentLen = textLength(tidy(post.body));
  const minutes = computeAssignedMinutes({ officer, contentLen, hourlyLoad, authorityGap });
  const assignedAt = now + minutes * 60_000;

  run(
    `UPDATE mentions SET status = ?, decision_reason = ?, assigned_minutes = ?, assigned_at = ?,
                         reviewer_id = ?, decided_at = ? WHERE id = ?`,
    MENTION_STATUS.APPROVED,
    `APPROVED: ${verdict.detail}`,
    minutes,
    assignedAt,
    reviewerId,
    now,
    mentionId
  );
  pushReceipt(mentionId, RECEIPT_STAGE.APPROVED, renderApprovedCopy(minutes));

  // 转阅：由该高管账号在原帖追加一条回复
  forwardToOfficer({ mentionId, officer, post, minutes });

  return { status: MENTION_STATUS.APPROVED, minutes, assignedAt };
}

/** 生成高管转阅回复（AI 代理发声） */
function forwardToOfficer({ mentionId, officer, post, minutes }) {
  const lines = safeJsonArray(officer.voice_lines);
  const line = lines.length ? lines[Math.floor(Math.random() * lines.length)] : officer.codename;
  const body = `${line}`;
  const info = run(
    "INSERT INTO replies (post_id, author_id, author_kind, body, is_deleted, created_at) VALUES (?,?,?,?,0,?)",
    post.id,
    officer.user_id,
    "ai_officer",
    body,
    Date.now()
  );
  const replyId = Number(info.lastInsertRowid);
  run(
    `UPDATE posts SET reply_count = reply_count + 1, last_reply_by = ?, last_reply_at = ?, updated_at = ? WHERE id = ?`,
    officer.codename,
    Date.now(),
    Date.now(),
    post.id
  );
  // 高管账号也按回复成本记账（保持流水完整；余额由系统初始额度支撑）
  try {
    addPoints(officer.user_id, -getSettingNumber("points.reply_cost", 100), POINTS_REASON.REPLY, {
      refType: "mention_forward",
      refId: mentionId,
      memo: `转阅回复（分配 ${minutes} 分钟）`
    });
  } catch {
    // 高管点数不足时不影响转阅，仅跳过记账
  }
  return replyId;
}

function safeJsonArray(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
}

/* ------------------------------ 查询 ------------------------------ */

export function mentionByCode(code) {
  const m = get(
    `SELECT m.*, o.codename AS officer_name, o.title AS officer_title, u.display_name AS requester_name,
            up.stored_name AS officer_avatar
       FROM mentions m
       JOIN ai_officers o ON o.id = m.officer_id
       JOIN users u ON u.id = m.requester_id
       LEFT JOIN uploads up ON up.id = u.avatar_upload_id AND up.deleted_at IS NULL
      WHERE m.code = ?`,
    code
  );
  if (!m) return null;
  return { ...m, receipts: receiptsOf(m.id) };
}

export function mentionsOfPost(postId) {
  const rows = all(
    `SELECT m.*, o.codename AS officer_name, o.title AS officer_title,
            up.stored_name AS officer_avatar
       FROM mentions m
       JOIN ai_officers o ON o.id = m.officer_id
       LEFT JOIN users ou ON ou.id = o.user_id
       LEFT JOIN uploads up ON up.id = ou.avatar_upload_id AND up.deleted_at IS NULL
      WHERE m.post_id = ? ORDER BY m.id ASC`,
    postId
  );
  return rows.map((r) => ({ ...r, receipts: receiptsOf(r.id) }));
}

/** 待审核队列（worker 用） */
export function pendingMentions(limit = 5) {
  return all("SELECT id FROM mentions WHERE status = ? ORDER BY id ASC LIMIT ?", MENTION_STATUS.PENDING, limit);
}

/** @ 冷却状态查询（前端按钮倒计时用） */
export function cooldownState(userId, officerId) {
  const cooldownSec = getSettingNumber("mention.cooldown_sec", 60);
  const last = get(
    "SELECT created_at FROM mentions WHERE requester_id = ? AND officer_id = ? ORDER BY id DESC LIMIT 1",
    userId,
    officerId
  );
  if (!last) return { cooling: false, retryAfter: 0, cooldownSec };
  const elapsed = Date.now() - last.created_at;
  const remain = Math.max(0, Math.ceil((cooldownSec * 1000 - elapsed) / 1000));
  return { cooling: remain > 0, retryAfter: remain, cooldownSec };
}
