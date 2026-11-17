/* ==========================================================================
   server/lib/points.js — 注意力点数体系（服务端唯一可信来源）
   规则（出厂值，可在管理面板调整，但需求硬性值为 500 / 50 / 100）：
     · 每人每天可领取 500 点，同一用户同一天只能领取一次（由 daily_claims 唯一约束保证）
     · 发帖扣 50 点，回复扣 100 点
     · 所有变动写入 points_ledger，且必须与 users.points_balance 保持一致
   所有扣点都在调用方的事务内执行（见 server/api/posts.js）。
   ========================================================================== */
import { all, get, run } from "./db.js";
import { AppError } from "./errors.js";
import { POINTS_REASON } from "../constants.js";
import { getSettingNumber } from "./settings.js";
import { localDate } from "./strings.js";

/* ------------------------------ 规则读取 ------------------------------ */

export function rules() {
  return {
    dailyAmount: getSettingNumber("points.daily_amount", 500),
    postCost: getSettingNumber("points.post_cost", 50),
    replyCost: getSettingNumber("points.reply_cost", 100)
  };
}

/* ------------------------------ 记账原语 ------------------------------ */

/**
 * 记账（必须在事务内调用）。返回记账后的余额。
 * @param {number} userId
 * @param {number} delta      正数入账，负数出账
 * @param {string} reason     POINTS_REASON
 * @param {{refType?:string, refId?:number, memo?:string}} [ref]
 */
export function addPoints(userId, delta, reason, ref = {}) {
  const row = get("SELECT points_balance FROM users WHERE id = ?", userId);
  if (!row) throw AppError.notFound("账号不存在");
  const balance = row.points_balance;
  const next = balance + delta;
  if (next < 0) {
    throw AppError.insufficient("注意力点数不足", { balance, required: Math.abs(delta), shortfall: Math.abs(delta) - balance });
  }
  run("UPDATE users SET points_balance = ?, updated_at = ? WHERE id = ?", next, Date.now(), userId);
  run(
    `INSERT INTO points_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, memo, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    userId,
    delta,
    next,
    reason,
    ref.refType || "",
    ref.refId == null ? null : ref.refId,
    ref.memo || "",
    Date.now()
  );
  return next;
}

/** 余额不足时抛出带差额的错误（供发帖/回复前置校验用） */
export function assertCanAfford(userId, cost) {
  const row = get("SELECT points_balance FROM users WHERE id = ?", userId);
  if (!row) throw AppError.notFound("账号不存在");
  if (row.points_balance < cost) {
    throw AppError.insufficient(
      `注意力点数不足，本次需要 ${cost} 点，当前余额 ${row.points_balance} 点`,
      { balance: row.points_balance, required: cost, shortfall: cost - row.points_balance }
    );
  }
  return row.points_balance;
}

/* ------------------------------ 每日领取 ------------------------------ */

/**
 * 每日领取。唯一约束是防重的硬保证：
 * 即使并发请求同时通过前置判断，第二次 INSERT 也会因 UNIQUE(user_id, claim_date) 失败。
 * 调用方必须把本函数放在 withTx 内。
 * @returns {{claimed:boolean, amount:number, balance:number, claimDate:string, claimedAt?:number}}
 */
export function claimDaily(userId, ip = "") {
  const { dailyAmount } = rules();
  const claimDate = localDate();

  const existed = get("SELECT id, amount, created_at FROM daily_claims WHERE user_id = ? AND claim_date = ?", userId, claimDate);
  if (existed) {
    const balance = get("SELECT points_balance FROM users WHERE id = ?", userId).points_balance;
    return { claimed: false, amount: 0, balance, claimDate, claimedAt: existed.created_at, alreadyAmount: existed.amount };
  }

  try {
    run("INSERT INTO daily_claims (user_id, claim_date, amount, ip, created_at) VALUES (?,?,?,?,?)", userId, claimDate, dailyAmount, ip, Date.now());
  } catch (err) {
    // UNIQUE 冲突 = 并发下的重复领取，等价于"今日已领取"
    if (String(err.message || "").includes("UNIQUE")) {
      const again = get("SELECT amount, created_at FROM daily_claims WHERE user_id = ? AND claim_date = ?", userId, claimDate);
      const balance = get("SELECT points_balance FROM users WHERE id = ?", userId).points_balance;
      return { claimed: false, amount: 0, balance, claimDate, claimedAt: again ? again.created_at : Date.now() };
    }
    throw err;
  }

  const balance = addPoints(userId, dailyAmount, POINTS_REASON.DAILY_CLAIM, {
    refType: "daily_claim",
    memo: `每日领取 ${claimDate}`
  });
  return { claimed: true, amount: dailyAmount, balance, claimDate };
}

/* ------------------------------ 查询 ------------------------------ */

export function summary(userId) {
  const user = get("SELECT points_balance FROM users WHERE id = ?", userId);
  if (!user) throw AppError.notFound("账号不存在");
  const claimDate = localDate();
  const claim = get("SELECT amount, created_at FROM daily_claims WHERE user_id = ? AND claim_date = ?", userId, claimDate);
  const r = rules();
  return {
    balance: user.points_balance,
    today: {
      claimDate,
      claimed: !!claim,
      amount: claim ? claim.amount : 0,
      claimedAt: claim ? claim.created_at : null,
      dailyAmount: r.dailyAmount,
      postCost: r.postCost,
      replyCost: r.replyCost
    },
    rules: r
  };
}

export function ledger(userId, page = 1, pageSize = 20) {
  const p = Math.max(1, Number.parseInt(page, 10) || 1);
  const size = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const total = get("SELECT COUNT(*) AS c FROM points_ledger WHERE user_id = ?", userId).c;
  const items = all(
    `SELECT id, delta, balance_after, reason, ref_type, ref_id, memo, created_at
       FROM points_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    userId,
    size,
    (p - 1) * size
  );
  return { items, page: p, pageSize: size, total };
}

/* ------------------------------ 对账 ------------------------------ */

/**
 * 全量对账：流水合计 vs 余额；返回差异列表。
 * @param {boolean} fix 是否按流水修正余额
 */
export function reconcile(fix = false) {
  const sums = all(
    `SELECT u.id, u.username, u.points_balance,
            COALESCE((SELECT SUM(delta) FROM points_ledger l WHERE l.user_id = u.id), 0) AS ledger_sum
       FROM users u ORDER BY u.id`
  );
  const diffs = [];
  for (const row of sums) {
    if (row.points_balance !== row.ledger_sum) {
      diffs.push({
        userId: row.id,
        username: row.username,
        balance: row.points_balance,
        ledgerSum: row.ledger_sum,
        delta: row.ledger_sum - row.points_balance
      });
      if (fix) {
        run("UPDATE users SET points_balance = ?, updated_at = ? WHERE id = ?", row.ledger_sum, Date.now(), row.id);
      }
    }
  }
  // 重复领取校验（唯一索引已保证，这里做二次确认）
  const dupClaims = all(
    `SELECT user_id, claim_date, COUNT(*) AS c FROM daily_claims
      GROUP BY user_id, claim_date HAVING c > 1`
  );
  // 回复计数校验
  const badReplyCounts = all(
    `SELECT p.id, p.reply_count,
            COALESCE((SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.is_deleted = 0), 0) AS actual
       FROM posts p
      WHERE p.is_deleted = 0
        AND p.reply_count <> COALESCE((SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id AND r.is_deleted = 0), 0)`
  );
  // 点赞计数校验
  const badLikeCounts = all(
    `SELECT p.id, p.like_count,
            COALESCE((SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id), 0) AS actual
       FROM posts p
      WHERE p.is_deleted = 0
        AND p.like_count <> COALESCE((SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id), 0)`
  );
  // 悬空头像引用校验：指向不存在的 uploads 行会导致头像字段取不到文件名（"头像全丢"）
  const danglingAvatars = all(
    `SELECT u.id, u.username, u.avatar_upload_id
       FROM users u
      WHERE u.avatar_upload_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM uploads up WHERE up.id = u.avatar_upload_id AND up.deleted_at IS NULL
        )`
  );
  return {
    balanceDiffs: diffs,
    duplicateClaims: dupClaims,
    replyCountMismatches: badReplyCounts,
    likeCountMismatches: badLikeCounts,
    danglingAvatars,
    fixed: fix
  };
}
