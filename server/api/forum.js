/* ==========================================================================
   server/api/forum.js — 论坛：板块、帖子、回复、@ 呼叫回执
   关键：发帖/回复与点数扣除在同一事务内完成（要么都成功，要么都不发生）。
   ========================================================================== */
import { all, get, run, scalar, withTx } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { assertSameOrigin, readJsonBody, sendOk } from "../lib/http.js";
import { publicUser, requireAuth, requireHired } from "../lib/auth.js";
import { vString, vInt, RULES, collect } from "../lib/validate.js";
import { POINTS_REASON, MENTION_STATUS, RECEIPT_STAGE, ROLES, formatAssignedTime } from "../constants.js";
import { addPoints, assertCanAfford, rules } from "../lib/points.js";
import {
  advanceMention,
  cooldownState,
  createMentionsForContent,
  mentionByCode,
  mentionsOfPost,
  resolveMentionTargets
} from "../lib/mentions.js";
import { getSettingNumber } from "../lib/settings.js";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

/* ------------------------------ 序列化 ------------------------------ */

export function serializePost(row, { includeBody = true, viewerId = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    boardId: row.board_id,
    boardSlug: row.board_slug || null,
    boardName: row.board_name || null,
    authorId: row.author_id,
    authorKind: row.author_kind,
    authorName: row.author_display_name || row.author_username || "",
    // 角色/头衔：优先 AI 高管或管理员的自定义标题，其次岗位名，最后部门名
    authorTitle: row.author_role_title || row.author_job_name || row.author_title || "",
    authorDepartment: row.author_department_name || "",
    authorAvatarUrl: row.author_avatar ? `/media/avatars/${row.author_avatar}` : "/media/default-avatar.svg",
    tag: row.tag || "",
    title: row.title,
    body: includeBody ? row.body : undefined,
    // 右栏 feed 按参考版式展示全文，excerpt 放宽到 400 字兜底（防超长帖撑爆右栏）
    excerpt: includeBody ? undefined : String(row.body || "").slice(0, 400),
    isPinned: !!row.is_pinned,
    replyCount: row.reply_count,
    likeCount: row.like_count || 0,
    liked: viewerId ? !!row.liked_by_me : false,
    views: row.views,
    lastReplyBy: row.last_reply_by || "",
    lastReplyAt: row.last_reply_at || null,
    hasMention: !!row.has_mention,
    pendingMention: !!row.pending_mention,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function serializeReply(row) {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    authorKind: row.author_kind,
    authorName: row.author_display_name || row.author_username || "",
    authorTitle: row.author_role_title || row.author_job_name || row.author_title || "",
    authorDepartment: row.author_department_name || "",
    authorAvatarUrl: row.author_avatar ? `/media/avatars/${row.author_avatar}` : "/media/default-avatar.svg",
    body: row.body,
    createdAt: row.created_at
  };
}

const POST_SELECT = `
  SELECT p.*,
         b.slug AS board_slug, b.name AS board_name,
         u.display_name AS author_display_name, u.username AS author_username,
         u.title AS author_role_title,
         j.name AS author_job_name,
         d.name AS author_department_name,
         up.stored_name AS author_avatar,
         (SELECT COUNT(*) FROM mentions m WHERE m.post_id = p.id) AS has_mention,
         (SELECT COUNT(*) FROM mentions m WHERE m.post_id = p.id AND m.status IN ('pending','under_review')) AS pending_mention,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) AS liked_by_me
    FROM posts p
    JOIN boards b ON b.id = p.board_id
    JOIN users u  ON u.id = p.author_id
    LEFT JOIN jobs j        ON j.id = u.job_role_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN uploads up    ON up.id = u.avatar_upload_id AND up.deleted_at IS NULL
`;

const REPLY_SELECT = `
  SELECT r.*,
         u.display_name AS author_display_name, u.username AS author_username,
         u.title AS author_role_title,
         j.name AS author_job_name,
         d.name AS author_department_name,
         up.stored_name AS author_avatar
    FROM replies r
    JOIN users u ON u.id = r.author_id
    LEFT JOIN jobs j        ON j.id = u.job_role_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN uploads up    ON up.id = u.avatar_upload_id AND up.deleted_at IS NULL
`;

/* ------------------------------ 板块 ------------------------------ */

export function listBoards(ctx) {
  const items = all(
    `SELECT b.id, b.slug, b.name, b.description, b.sort_order,
            (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id AND p.is_deleted = 0) AS post_count
       FROM boards b WHERE b.is_active = 1 ORDER BY b.sort_order ASC, b.id ASC`
  );
  return sendOk(ctx.res, { items });
}

/* ------------------------------ 帖子列表 ------------------------------ */

export function listPosts(ctx) {
  const q = ctx.query;
  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(q.pageSize, 10) || PAGE_SIZE_DEFAULT));
  const where = ["p.is_deleted = 0"];
  const params = [];

  if (q.board) {
    where.push("b.slug = ?");
    params.push(String(q.board));
  }
  if (q.q) {
    where.push("(p.title LIKE ? OR p.body LIKE ?)");
    const like = `%${String(q.q).slice(0, 40)}%`;
    params.push(like, like);
  }
  if (q.author) {
    where.push("p.author_id = ?");
    params.push(Number.parseInt(q.author, 10) || -1);
  }
  if (q.filter === "ai") where.push("p.author_kind = 'ai_officer'");
  if (q.filter === "mention") where.push("EXISTS (SELECT 1 FROM mentions m WHERE m.post_id = p.id)");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const viewerId = ctx.user ? ctx.user.id : 0;
  const total = scalar(`SELECT COUNT(*) FROM posts p JOIN boards b ON b.id = p.board_id ${whereSql}`, ...params);
  const rows = all(
    `${POST_SELECT} ${whereSql}
     ORDER BY p.is_pinned DESC, p.created_at DESC
     LIMIT ? OFFSET ?`,
    viewerId,
    ...params,
    pageSize,
    (page - 1) * pageSize
  );

  return sendOk(ctx.res, {
    items: rows.map((r) => serializePost(r, { includeBody: false, viewerId })),
    page,
    pageSize,
    total
  });
}

/* ------------------------------ 帖子详情 ------------------------------ */

export function getPost(ctx) {
  const id = Number.parseInt(ctx.params.id, 10);
  const viewerId = ctx.user ? ctx.user.id : 0;
  const row = get(`${POST_SELECT} WHERE p.id = ? AND p.is_deleted = 0`, viewerId, id);
  if (!row) throw AppError.notFound("帖子不存在或已被删除");
  run("UPDATE posts SET views = views + 1 WHERE id = ?", id);
  row.views += 1;

  const replies = all(`${REPLY_SELECT} WHERE r.post_id = ? AND r.is_deleted = 0 ORDER BY r.id ASC`, id);
  return sendOk(ctx.res, {
    post: serializePost(row, { viewerId }),
    replies: replies.map(serializeReply),
    mentions: mentionsOfPost(id).map(serializeMention)
  });
}

/**
 * 帖子点赞 / 取消点赞（同一用户对同一帖子最多一条记录，由主键约束保证）
 */
export async function toggleLike(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const postId = Number.parseInt(ctx.params.id, 10);
  const post = get("SELECT id, author_id FROM posts WHERE id = ? AND is_deleted = 0", postId);
  if (!post) throw AppError.notFound("帖子不存在或已被删除");

  const result = withTx(() => {
    const liked = get("SELECT 1 AS x FROM post_likes WHERE post_id = ? AND user_id = ?", postId, user.id);
    if (liked) {
      run("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?", postId, user.id);
      run("UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?", postId);
    } else {
      run("INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?,?,?)", postId, user.id, Date.now());
      run("UPDATE posts SET like_count = like_count + 1 WHERE id = ?", postId);
    }
    const count = get("SELECT like_count FROM posts WHERE id = ?", postId).like_count;
    return { liked: !liked, likeCount: count };
  });

  return sendOk(ctx.res, result);
}

export function serializeMention(m) {
  const label = m.assigned_minutes ? formatAssignedTime(m.assigned_minutes).label : null;
  return {
    id: m.id,
    code: m.code,
    postId: m.post_id,
    replyId: m.reply_id,
    officerId: m.officer_id,
    officerName: m.officer_name,
    officerTitle: m.officer_title || "",
    officerAvatarUrl: m.officer_avatar ? `/media/avatars/${m.officer_avatar}` : "/media/default-avatar.svg",
    mentionText: m.mention_text,
    status: m.status,
    decisionReason: m.decision_reason,
    assignedMinutes: m.assigned_minutes,
    assignedLabel: label,
    assignedAt: m.assigned_at,
    createdAt: m.created_at,
    decidedAt: m.decided_at,
    receipts: (m.receipts || []).map((r) => ({ stage: r.stage, message: r.message, createdAt: r.created_at }))
  };
}

/* ------------------------------ 发帖 ------------------------------ */

/**
 * POST /api/posts
 * 事务：校验余额 → 建帖 → 扣点记账 → 解析并创建 @ 呼叫（含回执）
 */
export async function createPost(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireHired(ctx);
  const body = await readJsonBody(ctx.req);
  const values = collect([
    { field: "board_id", ...vInt(body.board_id, { label: "所属板块", min: 1 }) },
    { field: "title", ...vString(body.title, { label: "标题", min: RULES.title.min, max: RULES.title.max }) },
    { field: "body", ...vString(body.body, { label: "正文", min: RULES.body.min, max: RULES.body.max }) },
    { field: "tag", ...vString(body.tag, { label: "标签", required: false, max: RULES.tag.max }) }
  ]);

  const board = get("SELECT id, is_active FROM boards WHERE id = ?", values.board_id);
  if (!board || !board.is_active) {
    throw AppError.badRequest("所属板块不存在或已停用", { fields: { board_id: "请重新选择板块" } });
  }

  const cost = rules().postCost;
  const targets = resolveMentionTargets(values.body).mentions;

  const result = withTx(() => {
    assertCanAfford(user.id, cost);

    const now = Date.now();
    const info = run(
      `INSERT INTO posts (board_id, author_id, author_kind, tag, title, body, is_pinned, is_deleted,
                          reply_count, views, last_reply_by, last_reply_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,0,0,0,0,'',?,?,?)`,
      values.board_id,
      user.id,
      "user",
      values.tag || "",
      values.title,
      values.body,
      now,
      now,
      now
    );
    const postId = Number(info.lastInsertRowid);

    const balance = addPoints(user.id, -cost, POINTS_REASON.POST, {
      refType: "post",
      refId: postId,
      memo: `发帖《${values.title.slice(0, 20)}》`
    });

    let mentionResult = { created: [], rejected: [] };
    if (targets.length) {
      mentionResult = createMentionsForContent({
        requester: user,
        postId,
        replyId: null,
        body: values.body,
        targets
      });
    }
    return { postId, balance, mentionResult };
  });

  // 立即触发一次审核推进（不阻塞响应：交由 worker 在下一 tick 处理）
  for (const m of result.mentionResult.created) {
    queueMicrotask(() => {
      try {
        withTx(() => advanceMention(m.mentionId));
      } catch (err) {
        console.error("[mention] 自动审核失败", err);
      }
    });
  }

  const row = get(`${POST_SELECT} WHERE p.id = ?`, user.id, result.postId);
  return sendOk(
    ctx.res,
    {
      post: serializePost(row, { viewerId: user.id }),
      points: {
        balance: result.balance,
        cost,
        rules: rules()
      },
      mentions: result.mentionResult.created
        .map((m) => mentionByCode(m.code))
        .filter(Boolean)
        .map(serializeMention),
      rejectedMentions: result.mentionResult.rejected
    },
    201
  );
}

/* ------------------------------ 回复 ------------------------------ */

/**
 * POST /api/posts/:id/replies
 * 事务：校验余额 → 建回复 → 扣点记账 → 维护 reply_count → 处理 @
 */
export async function createReply(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireHired(ctx);
  const postId = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const values = collect([
    { field: "body", ...vString(body.body, { label: "回复内容", min: RULES.replyBody.min, max: RULES.replyBody.max }) }
  ]);

  const post = get("SELECT id, author_id, is_deleted FROM posts WHERE id = ?", postId);
  if (!post || post.is_deleted) throw AppError.notFound("帖子不存在或已被删除");

  const cost = rules().replyCost;
  const targets = resolveMentionTargets(values.body).mentions;

  const result = withTx(() => {
    assertCanAfford(user.id, cost);
    const now = Date.now();
    const info = run(
      "INSERT INTO replies (post_id, author_id, author_kind, body, is_deleted, created_at) VALUES (?,?,?,?,0,?)",
      postId,
      user.id,
      "user",
      values.body,
      now
    );
    const replyId = Number(info.lastInsertRowid);

    const author = get("SELECT display_name FROM users WHERE id = ?", user.id);
    run(
      `UPDATE posts SET reply_count = reply_count + 1, last_reply_by = ?, last_reply_at = ?, updated_at = ?
        WHERE id = ?`,
      author.display_name,
      now,
      now,
      postId
    );

    const balance = addPoints(user.id, -cost, POINTS_REASON.REPLY, {
      refType: "reply",
      refId: replyId,
      memo: "回复帖子"
    });

    let mentionResult = { created: [], rejected: [] };
    if (targets.length) {
      mentionResult = createMentionsForContent({
        requester: user,
        postId,
        replyId,
        body: values.body,
        targets
      });
    }
    return { replyId, balance, mentionResult };
  });

  for (const m of result.mentionResult.created) {
    queueMicrotask(() => {
      try {
        withTx(() => advanceMention(m.mentionId));
      } catch (err) {
        console.error("[mention] 自动审核失败", err);
      }
    });
  }

  const replyRow = get(`${REPLY_SELECT} WHERE r.id = ?`, result.replyId);
  return sendOk(
    ctx.res,
    {
      reply: serializeReply(replyRow),
      points: { balance: result.balance, cost, rules: rules() },
      mentions: result.mentionResult.created
        .map((m) => mentionByCode(m.code))
        .filter(Boolean)
        .map(serializeMention),
      rejectedMentions: result.mentionResult.rejected
    },
    201
  );
}

/* ------------------------------ 删除帖子 ------------------------------ */

export async function deletePost(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const postId = Number.parseInt(ctx.params.id, 10);
  const post = get("SELECT id, author_id FROM posts WHERE id = ? AND is_deleted = 0", postId);
  if (!post) throw AppError.notFound("帖子不存在或已被删除");
  if (post.author_id !== user.id && user.role !== ROLES.SITE_ADMIN) {
    throw AppError.forbidden("只能删除自己发布的帖子");
  }
  run("UPDATE posts SET is_deleted = 1, updated_at = ? WHERE id = ?", Date.now(), postId);
  return sendOk(ctx.res, { ok: true });
}

/* ------------------------------ 编辑帖子 ------------------------------ */

/**
 * PATCH /api/posts/:id
 * 作者本人或站点管理员可修改标题/正文/标签；不扣点数，也不重新解析 @ 呼叫
 * （编辑只改文案，不应额外触发一次高管审核）。
 */
export async function updatePost(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const postId = Number.parseInt(ctx.params.id, 10);
  const body = await readJsonBody(ctx.req);
  const values = collect([
    { field: "title", ...vString(body.title, { label: "标题", min: RULES.title.min, max: RULES.title.max }) },
    { field: "body", ...vString(body.body, { label: "正文", min: RULES.body.min, max: RULES.body.max }) },
    { field: "tag", ...vString(body.tag, { label: "标签", required: false, max: RULES.tag.max }) }
  ]);

  const post = get("SELECT id, author_id, author_kind FROM posts WHERE id = ? AND is_deleted = 0", postId);
  if (!post) throw AppError.notFound("帖子不存在或已被删除");
  const isOwner = post.author_id === user.id && post.author_kind === "user";
  if (!isOwner && user.role !== ROLES.SITE_ADMIN) {
    throw AppError.forbidden("只能编辑自己发布的帖子");
  }

  run(
    "UPDATE posts SET title = ?, body = ?, tag = ?, updated_at = ? WHERE id = ?",
    values.title,
    values.body,
    values.tag || "",
    Date.now(),
    postId
  );
  const row = get(`${POST_SELECT} WHERE p.id = ?`, user.id, postId);
  return sendOk(ctx.res, { post: serializePost(row, { viewerId: user.id }) });
}

/* ------------------------------ @ 回执查询 ------------------------------ */

export function getMention(ctx) {
  const m = mentionByCode(ctx.params.code);
  if (!m) throw AppError.notFound("审核编号不存在");
  return sendOk(ctx.res, {
    mention: serializeMention(m),
    receipts: m.receipts.map((r) => ({ stage: r.stage, message: r.message, createdAt: r.created_at }))
  });
}

/** 前端输入 @ 时的候选高管列表（含冷却状态） */
export function listMentionTargets(ctx) {
  const officers = all(
    `SELECT o.id, o.codename, o.title, o.authority_level, d.name AS department_name
       FROM ai_officers o LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.enabled = 1 ORDER BY o.authority_level DESC, o.id ASC`
  );
  const items = officers.map((o) => ({
    id: o.id,
    codename: o.codename,
    title: o.title,
    authorityLevel: o.authority_level,
    departmentName: o.department_name || "",
    cooldown: ctx.user ? cooldownState(ctx.user.id, o.id) : { cooling: false, retryAfter: 0, cooldownSec: getSettingNumber("mention.cooldown_sec", 60) }
  }));
  return sendOk(ctx.res, {
    items,
    rules: {
      maxPerPost: getSettingNumber("mention.max_per_post", 3),
      cooldownSec: getSettingNumber("mention.cooldown_sec", 60),
      hourlyLimit: getSettingNumber("mention.hourly_limit", 5)
    }
  });
}

export { MENTION_STATUS, RECEIPT_STAGE };
