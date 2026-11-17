/* ==========================================================================
   server/api/points.js — 注意力点数：领取、汇总、流水
   领取必须事务化：daily_claims 的 UNIQUE(user_id, claim_date) 是防重的硬保证。
   ========================================================================== */
import { withTx } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { assertSameOrigin, sendOk } from "../lib/http.js";
import { requireAuth } from "../lib/auth.js";
import { claimDaily, ledger, summary } from "../lib/points.js";
import { hit } from "../lib/ratelimit.js";
import { localDate } from "../lib/strings.js";

/** POST /api/points/claim —— 每人每天一次，500 点 */
export async function claimPoints(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);

  // IP 维度粗粒度防刷（同一 IP 下大量不同账号刷领取）
  const ipLimit = hit(`claim:ip:${ctx.ip}`, 60, 3600_000);
  if (!ipLimit.allowed) throw AppError.rateLimited("领取过于频繁，请稍后再试", ipLimit.retryAfter);

  const result = withTx(() => claimDaily(user.id, ctx.ip));

  if (!result.claimed) {
    throw AppError.conflict(`今日（${result.claimDate}）的注意力点数已领取`, {
      claimDate: result.claimDate,
      claimedAt: result.claimedAt,
      balance: result.balance
    });
  }
  return sendOk(ctx.res, {
    claimed: true,
    amount: result.amount,
    balance: result.balance,
    claimDate: result.claimDate
  });
}

/** GET /api/points/summary */
export function pointsSummary(ctx) {
  const user = requireAuth(ctx);
  return sendOk(ctx.res, summary(user.id));
}

/** GET /api/points/ledger */
export function pointsLedger(ctx) {
  const user = requireAuth(ctx);
  const { page, pageSize } = ctx.query;
  const data = ledger(user.id, page, pageSize);
  return sendOk(ctx.res, {
    ...data,
    items: data.items.map((r) => ({
      id: r.id,
      delta: r.delta,
      balanceAfter: r.balance_after,
      reason: r.reason,
      refType: r.ref_type,
      refId: r.ref_id,
      memo: r.memo,
      createdAt: r.created_at
    }))
  });
}

/** 供内部与测试使用 */
export { localDate };
