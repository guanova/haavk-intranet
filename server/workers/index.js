/* ==========================================================================
   server/workers/index.js — 后台任务
   1) @ 呼叫审核推进（pending → under_review → approved/rejected，并生成转阅回复）
   2) AI 高管自主发帖（按各自 auto_post_interval_sec 轮转）
   3) 会话与限流桶清理
   全部任务串行执行在单进程内，避免并发写竞争；异常只记录不退出。
   ========================================================================== */
import { all, get, run, scalar, withTx } from "../lib/db.js";
import { advanceMention, pendingMentions, pushReceipt } from "../lib/mentions.js";
import { pruneSessions } from "../lib/auth.js";
import { prune } from "../lib/ratelimit.js";
import { MENTION_STATUS, RECEIPT_STAGE, MENTION_COPY } from "../constants.js";
import { AI_POST_SEEDS } from "../seed-data.js";
import { pickLine } from "../lib/strings.js";

let timers = [];
let running = false;

/* ------------------------------ @ 审核推进 ------------------------------ */

export function processMentions(batch = 10) {
  const rows = pendingMentions(batch);
  if (!rows.length) return 0;
  let handled = 0;
  for (const row of rows) {
    try {
      withTx(() => advanceMention(row.id));
      handled++;
    } catch (err) {
      console.error("[worker] 审核推进失败 mention#" + row.id, err);
    }
  }
  return handled;
}

/** 兜底：长时间停留在 under_review 的呼叫按未通过结案（避免永久悬挂） */
export function sweepStaleMentions(maxAgeMs = 10 * 60_000) {
  const cutoff = Date.now() - maxAgeMs;
  const rows = all(
    `SELECT id FROM mentions WHERE status = ? AND created_at < ? LIMIT 20`,
    MENTION_STATUS.UNDER_REVIEW,
    cutoff
  );
  let n = 0;
  for (const r of rows) {
    try {
      withTx(() => {
        run(
          "UPDATE mentions SET status = ?, decision_reason = ?, decided_at = ? WHERE id = ?",
          MENTION_STATUS.REJECTED,
          "TIMEOUT: 审核超时未结案",
          Date.now(),
          r.id
        );
        pushReceipt(r.id, RECEIPT_STAGE.REJECTED, MENTION_COPY.REJECTED);
      });
      n++;
    } catch (err) {
      console.error("[worker] 审核超时结案失败", err);
    }
  }
  return n;
}

/* ------------------------------ AI 高管自主发帖 ------------------------------ */

/**
 * 待发帖的高管：只按「已启用 + 配置了发帖周期」筛选。
 * 具体节流由内存表 lastAutoPost 负责（进程内存即可，重启后重新计时是期望行为）。
 */
function candidateOfficers() {
  return all(
    `SELECT o.*, u.display_name AS display_name
       FROM ai_officers o JOIN users u ON u.id = o.user_id
      WHERE o.enabled = 1 AND o.auto_post_interval_sec > 0
      ORDER BY o.id ASC`
  );
}

/** 每位高管的自主发帖节流时间戳（内存态） */
const lastAutoPost = new Map();

export function runAutoPosts(now = Date.now()) {
  const officers = candidateOfficers();
  let created = 0;
  for (const o of officers) {
    const last = lastAutoPost.get(o.id) || 0;
    if (now - last < o.auto_post_interval_sec * 1000) continue;

    const seed = AI_POST_SEEDS[Math.floor(Math.random() * AI_POST_SEEDS.length)];
    const board = get("SELECT id, slug FROM boards WHERE slug = ? AND is_active = 1", seed.board);
    if (!board) continue;

    // 重复抑制：同一标题 24 小时内不再被任何高管重复发布；
    // 同一高管对同一标题 72 小时内不重发。避免素材池被反复刷成十几份副本。
    const dup = get(
      `SELECT id FROM posts
        WHERE is_deleted = 0 AND author_kind = 'ai_officer' AND title = ?
          AND ((author_id = ? AND created_at > ?) OR created_at > ?)`,
      seed.title,
      o.user_id,
      now - 72 * 3600_000,
      now - 24 * 3600_000
    );
    if (dup) {
      lastAutoPost.set(o.id, now);
      continue;
    }

    try {
      withTx(() => {
        const line = pickLine(safeArray(o.voice_lines));
        const info = run(
          `INSERT INTO posts (board_id, author_id, author_kind, tag, title, body, is_pinned, is_deleted,
                              reply_count, views, last_reply_by, last_reply_at, created_at, updated_at)
           VALUES (?,?,'ai_officer',?,?,?,0,0,0,0,'',?,?,?)`,
          board.id,
          o.user_id,
          seed.tag,
          seed.title,
          `${seed.body}${line ? `\n\n${line}` : ""}`,
          now,
          now,
          now
        );
        return Number(info.lastInsertRowid);
      });
      lastAutoPost.set(o.id, now);
      created++;
    } catch (err) {
      console.error("[worker] 高管自主发帖失败 officer#" + o.id, err);
    }
  }
  return created;
}

/** AI 高管对热门帖的自主回复（仅在该帖已有真人回复时参与） */
const lastAutoReply = new Map();

export function runAutoReplies(now = Date.now()) {
  const officers = all(
    "SELECT * FROM ai_officers WHERE enabled = 1 AND auto_post_interval_sec > 0 ORDER BY RANDOM() LIMIT 2"
  );
  let n = 0;
  for (const o of officers) {
    const last = lastAutoReply.get(o.id) || 0;
    if (now - last < Math.max(120_000, o.auto_post_interval_sec * 1500)) continue;

    const post = get(
      `SELECT p.id, p.title, p.author_kind, p.created_at
         FROM posts p
        WHERE p.is_deleted = 0 AND p.author_kind = 'user'
          AND p.created_at > ?
          AND EXISTS (SELECT 1 FROM replies r WHERE r.post_id = p.id AND r.author_kind = 'user')
          AND NOT EXISTS (SELECT 1 FROM replies r2 WHERE r2.post_id = p.id AND r2.author_id = ?)
        ORDER BY p.created_at DESC LIMIT 1`,
      now - 6 * 3600_000,
      o.user_id
    );
    if (!post) continue;

    try {
      withTx(() => {
        const line = pickLine(safeArray(o.voice_lines));
        const body = line || "已阅。";
        run(
          "INSERT INTO replies (post_id, author_id, author_kind, body, is_deleted, created_at) VALUES (?,?,'ai_officer',?,0,?)",
          post.id,
          o.user_id,
          body,
          now
        );
        run(
          "UPDATE posts SET reply_count = reply_count + 1, last_reply_by = ?, last_reply_at = ?, updated_at = ? WHERE id = ?",
          o.codename,
          now,
          now,
          post.id
        );
      });
      lastAutoReply.set(o.id, now);
      n++;
    } catch (err) {
      console.error("[worker] 高管自主回复失败 officer#" + o.id, err);
    }
  }
  return n;
}

function safeArray(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/* ------------------------------ 调度器 ------------------------------ */

export function startWorkers({ mentionIntervalMs = 2500, housekeepingMs = 300_000 } = {}) {
  if (running) return;
  running = true;

  // @ 审核：高频小批量，保证用户 3–10 秒内看到回执更新
  timers.push(
    setInterval(() => {
      try {
        processMentions(10);
        sweepStaleMentions();
      } catch (err) {
        console.error("[worker] mentions tick 异常", err);
      }
    }, mentionIntervalMs)
  );

  // AI 高管：自主发帖 + 自主回复
  timers.push(
    setInterval(() => {
      try {
        runAutoPosts();
        runAutoReplies();
      } catch (err) {
        console.error("[worker] auto-post tick 异常", err);
      }
    }, 60_000)
  );

  // 清理：会话、限流桶
  timers.push(
    setInterval(() => {
      try {
        pruneSessions();
        prune();
      } catch (err) {
        console.error("[worker] housekeeping 异常", err);
      }
    }, housekeepingMs)
  );

  // 资料征集：WebDAV 转存推进（未配置时 pumpWebdav 内部直接跳过）
  timers.push(
    setInterval(() => {
      (async () => {
        try {
          const { pumpWebdav } = await import("../lib/webdav.js");
          const { submissionDir } = await import("../api/submissions.js");
          const r = await pumpWebdav(submissionDir);
          if (r.done || r.failed) {
            console.log(`[worker] webdav 转存：成功 ${r.done} · 失败 ${r.failed}`);
          }
        } catch (err) {
          console.error("[worker] webdav tick 异常", err);
        }
      })();
    }, 120_000)
  );

  // 启动后立即跑一轮，缩短首屏等待
  setTimeout(() => {
    try {
      processMentions(20);
    } catch (err) {
      console.error("[worker] 首次审核异常", err);
    }
  }, 800);

  console.log("[worker] 已启动：@ 审核推进 / AI 高管自主发声 / 定期清理");
}

export function stopWorkers() {
  timers.forEach((t) => clearInterval(t));
  timers = [];
  running = false;
}

/** 供自检调用：一次性地把所有待审呼叫处理完 */
export function drainMentions(maxRounds = 50) {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    const n = processMentions(20);
    total += n;
    if (n === 0) break;
  }
  return total;
}

export { scalar };
