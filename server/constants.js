/* ==========================================================================
   server/constants.js — 全局常量与**固定文案**（唯一副本，禁止在其他文件重复定义）
   --------------------------------------------------------------------------
   ⚠️ MENTION_COPY 三段文案是硬约束，不得改动、不得拼接后缀。
      <time> 为运行时动态占位符，由 renderApprovedCopy() 替换。
   ========================================================================== */

/** @ 呼叫三分支固定文案（严格照抄，禁止改动） */
export const MENTION_COPY = Object.freeze({
  UNDER_REVIEW:
    "检测到对集团高级管理人员的呼叫.....正在确认呼叫者职级是否足以支撑该行为...正在评估应答时间和问题价值.....",
  APPROVED:
    "已确认该问题值得高管关注，已计算高管为此分配的最合理时间：<time>。已自动转阅。",
  REJECTED:
    "经哈夫克首席高级秘书办审核讨论，本贴无需转载，请勿短时间内大量呼叫集团高级职员"
});

/** 把 <time> 替换为动态值。minutes 由 evaluateMention() 计算得出。 */
export function renderApprovedCopy(minutes) {
  const totalSec = Math.max(0, Math.round(minutes * 60));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const time = `${m}分${s}秒`;
  return MENTION_COPY.APPROVED.replace("<time>", time);
}

/** 供前端判断是否显示"预计时刻"，与 renderApprovedCopy 保持同源 */
export function formatAssignedTime(minutes) {
  const totalSec = Math.max(0, Math.round(minutes * 60));
  return { minutes: Math.floor(totalSec / 60), seconds: totalSec % 60, label: `${Math.floor(totalSec / 60)}分${totalSec % 60}秒` };
}

/** 用户角色 —— 游客不入库 */
export const ROLES = Object.freeze({
  EMPLOYEE: "employee",
  AI_OFFICER: "ai_officer",
  CHIEF_SECRETARY: "chief_secretary",
  SITE_ADMIN: "site_admin"
});

/** 账号状态 */
export const USER_STATUS = Object.freeze({
  ACTIVE: "active",
  PENDING_ONBOARDING: "pending_onboarding",
  SUSPENDED: "suspended"
});

/** 申请类型 / 状态 */
export const REQUEST_TYPE = Object.freeze({
  ONBOARDING: "onboarding",
  JOB_CHANGE: "job_change",
  DEPT_CHANGE: "dept_change"
});
export const REQUEST_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected"
});

/** 点数流水原因 */
export const POINTS_REASON = Object.freeze({
  SIGNUP_BONUS: "signup_bonus",
  DAILY_CLAIM: "daily_claim",
  POST: "post",
  REPLY: "reply",
  ADMIN_ADJUST: "admin_adjust"
});

/** @ 呼叫状态 */
export const MENTION_STATUS = Object.freeze({
  PENDING: "pending",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected"
});

/** 回执阶段 */
export const RECEIPT_STAGE = Object.freeze({
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected"
});

/** 错误码 → HTTP 状态码 */
export const ERROR_CODES = Object.freeze({
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  INSUFFICIENT_POINTS: 402,
  FORBIDDEN: 403,
  ONBOARDING_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  RATE_LIMITED: 429,
  MENTION_COOLDOWN: 429,
  INTERNAL: 500
});

/** 站点配置出厂值（与硬性需求一致，管理面板可改） */
export const SETTING_DEFAULTS = Object.freeze([
  // —— 备案信息（仅管理面板可编辑）——
  { key: "filing.icp", value: "", label: "ICP 备案号", hint: "例如：京ICP备00000000号-1", group: "filing", editable: 1 },
  { key: "filing.police", value: "", label: "公安备案号", hint: "例如：京公网安备 11000000000000号", group: "filing", editable: 1 },
  { key: "filing.police_url", value: "", label: "公安备案链接", hint: "点击备案号跳转地址，可留空", group: "filing", editable: 1 },
  { key: "filing.company", value: "", label: "网站主办单位", hint: "显示在页脚版权行", group: "filing", editable: 1 },
  { key: "filing.copyright", value: "", label: "版权声明", hint: "可留空，默认按主办单位与年份生成", group: "filing", editable: 1 },
  { key: "filing.extra", value: "", label: "其他备案信息", hint: "增值电信业务经营许可证等，可留空", group: "filing", editable: 1 },
  // —— 品牌 ——
  { key: "brand.site_name", value: "哈夫克集团", label: "站点名称", hint: "浏览器标题与导航使用", group: "brand", editable: 1 },
  // —— 点数规则（回复定价低于发帖：鼓励讨论，社区互动优先）——
  { key: "points.daily_amount", value: "500", label: "每日可领取点数", hint: "每人每天仅可领取一次", group: "points", editable: 1 },
  { key: "points.post_cost", value: "50", label: "发帖扣除点数", hint: "余额不足则拒绝发帖", group: "points", editable: 1 },
  { key: "points.reply_cost", value: "20", label: "回复扣除点数", hint: "余额不足则拒绝回复", group: "points", editable: 1 },
  // —— @ 呼叫风控 ——
  { key: "mention.cooldown_sec", value: "60", label: "@ 呼叫冷却（秒）", hint: "同一用户对同一高管的最小呼叫间隔", group: "mention", editable: 1 },
  { key: "mention.hourly_limit", value: "5", label: "每小时呼叫上限", hint: "同一用户 1 小时内呼叫总次数", group: "mention", editable: 1 },
  { key: "mention.max_per_post", value: "3", label: "单帖呼叫高管上限", hint: "超出直接驳回", group: "mention", editable: 1 },
  { key: "mention.min_authority", value: "2", label: "@ 受理职级下限", hint: "呼叫者职级分低于该值不予受理（1–10）", group: "mention", editable: 1 },
  // —— 资料征集 / WebDAV 储存 ——
  { key: "webdav.enabled", value: "0", label: "启用 WebDAV 转存", hint: "开启后投稿附件自动转存到 WebDAV", group: "webdav", editable: 1 },
  { key: "webdav.url", value: "", label: "WebDAV 地址", hint: "目录级地址，例如 https://dav.example.com/dav/haavk/", group: "webdav", editable: 1 },
  { key: "webdav.user", value: "", label: "WebDAV 用户名", hint: "", group: "webdav", editable: 1 },
  { key: "webdav.pass", value: "", label: "WebDAV 密码", hint: "仅服务端使用，不会下发到页面", group: "webdav", editable: 1 }
]);

/** 内容质量与审核门槛（代码常量，不可通过面板修改） */
export const QUALITY = Object.freeze({
  MIN_CONTENT_LEN: 15,          // 低于此长度直接驳回
  VALUE_MIN_LEN: 30,            // 价值评估门槛
  BURST_WINDOW_MS: 10 * 60_000, // 刷屏观察窗口
  BURST_LIMIT: 2,               // 窗口内允许的呼叫次数
  DUP_WINDOW_MS: 24 * 3600_000, // 24 小时内不可重复呼叫同一高管
  TIME_BASE_MIN: 8,
  TIME_MAX_MIN: 45,
  TIME_MIN_MIN: 5
});

/** 上传限制 */
export const UPLOAD = Object.freeze({
  MAX_BYTES: 2 * 1024 * 1024,
  ALLOWED_MIME: ["image/png", "image/jpeg", "image/webp"],
  MAX_PER_HOUR: 10
});

/** 资料征集投稿限制 */
export const SUBMISSION = Object.freeze({
  MAX_FILE_BYTES: 8 * 1024 * 1024,   // 单文件 8MB（手机拍屏原图足够）
  MAX_FILES: 5,                      // 单次最多 5 张
  MAX_TOTAL_BYTES: 25 * 1024 * 1024, // 单次请求体上限
  MAX_PER_HOUR: 5,                   // 同 IP 每小时最多 5 次投稿
  MAX_TEXT_LEN: 2000,
  MAX_NAME_LEN: 32,
  MAX_CONTACT_LEN: 64,
  ALLOWED_MIME: ["image/png", "image/jpeg", "image/webp"]
});

/** 会话 */
export const SESSION = Object.freeze({
  COOKIE: "haavk_sid",
  TTL_MS: 7 * 24 * 3600_000
});
