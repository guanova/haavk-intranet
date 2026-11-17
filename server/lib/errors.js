/* ==========================================================================
   server/lib/errors.js — 统一错误类型
   ========================================================================== */
import { ERROR_CODES } from "../constants.js";

export class AppError extends Error {
  /**
   * @param {string} code   见 constants.ERROR_CODES
   * @param {string} message 面向用户的中文提示
   * @param {object} [details] 附加信息（字段级错误 / 差额 / 重试秒数等）
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.httpStatus = ERROR_CODES[code] || 500;
  }

  static badRequest(message, details) {
    return new AppError("BAD_REQUEST", message, details);
  }
  static unauthorized(message = "登录状态已失效，请重新登录") {
    return new AppError("UNAUTHORIZED", message);
  }
  static forbidden(message = "当前身份无权执行该操作") {
    return new AppError("FORBIDDEN", message);
  }
  static notFound(message = "请求的内容不存在") {
    return new AppError("NOT_FOUND", message);
  }
  static conflict(message, details) {
    return new AppError("CONFLICT", message, details);
  }
  static insufficient(message, details) {
    return new AppError("INSUFFICIENT_POINTS", message, details);
  }
  static rateLimited(message, retryAfter) {
    return new AppError("RATE_LIMITED", message, { retryAfter });
  }
  static onboardingRequired(message = "请先完成入职手续后再进行操作") {
    return new AppError("ONBOARDING_REQUIRED", message);
  }
  static mentionCooldown(message, retryAfter) {
    return new AppError("MENTION_COOLDOWN", message, { retryAfter });
  }
  static internal(message = "服务器内部错误，请稍后重试") {
    return new AppError("INTERNAL", message);
  }
}

/** 断言器：条件不成立时抛 AppError */
export function assert(cond, code, message, details) {
  if (!cond) throw new AppError(code, message, details);
}
