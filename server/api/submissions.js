/* ==========================================================================
   server/api/submissions.js — 资料征集投稿
   通道：匿名可投（IP 限流）/ 登录用户记录 user_id；图片魔数校验；
   附件落盘 data/uploads/submissions/ 并由 worker 转存 WebDAV。
   ========================================================================== */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, get, run, withTx } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import {
  assertSameOrigin,
  mimeOf,
  parseMultipartAll,
  sendFile,
  sendOk,
  sniffImageMime
} from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { hit } from "../lib/ratelimit.js";
import { SUBMISSION } from "../constants.js";

export function submissionDir() {
  const dir =
    process.env.HAAVK_SUBMISSION_DIR || path.resolve(process.cwd(), "data/uploads/submissions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const TYPES = new Set(["screenshot", "lore", "copy", "asset", "bug", "other"]);
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g; // eslint 友好：只去控制字符，保留换行/制表

function clampText(v, max) {
  return String(v == null ? "" : v).replace(CONTROL_CHARS, "").trim().slice(0, max);
}

/** POST /api/submissions —— 匿名可投；multipart: 字段 + files[]（图片，≤5 张，单张 ≤8MB） */
export async function createSubmission(ctx) {
  assertSameOrigin(ctx.req);

  const rlKey = `submission:ip:${ctx.ip}`;
  const limit = hit(rlKey, SUBMISSION.MAX_PER_HOUR, 3600_000);
  if (!limit.allowed) throw AppError.rateLimited("投稿过于频繁，请稍后再试", limit.retryAfter);

  const { files, fields } = await parseMultipartAll(
    ctx.req,
    SUBMISSION.MAX_TOTAL_BYTES,
    SUBMISSION.MAX_FILES
  );

  const nickname = clampText(fields.nickname, SUBMISSION.MAX_NAME_LEN);
  const contact = clampText(fields.contact, SUBMISSION.MAX_CONTACT_LEN);
  const text = clampText(fields.text, SUBMISSION.MAX_TEXT_LEN);
  const type = TYPES.has(fields.type) ? fields.type : "other";

  if (!text && files.length === 0) {
    throw AppError.badRequest("请至少填写说明文字或上传一张图片", {
      fields: { text: "说明与图片至少填一项" }
    });
  }

  // 逐文件校验（魔数为准）并落盘
  const stored = [];
  for (const f of files) {
    if (f.buffer.length > SUBMISSION.MAX_FILE_BYTES) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `单张图片不能超过 ${Math.round(SUBMISSION.MAX_FILE_BYTES / 1024 / 1024)}MB`
      );
    }
    const mime = sniffImageMime(f.buffer);
    if (!mime || !SUBMISSION.ALLOWED_MIME.includes(mime)) {
      throw new AppError("UNSUPPORTED_MEDIA", "仅支持 PNG / JPG / WEBP 图片");
    }
    const digest = crypto
      .createHash("sha256")
      .update(f.buffer)
      .update(crypto.randomBytes(8))
      .digest("hex")
      .slice(0, 16);
    const storedName = `${digest}.${EXT_BY_MIME[mime]}`;
    const abs = path.join(submissionDir(), storedName);
    const tmp = `${abs}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, f.buffer);
    fs.renameSync(tmp, abs);
    stored.push({
      storedName,
      origName: clampText(f.filename, 128),
      mime,
      byteSize: f.buffer.length
    });
  }

  const now = Date.now();
  const userId = ctx.user ? ctx.user.id : null;
  const submissionId = withTx(() => {
    const info = run(
      `INSERT INTO submissions (user_id, nickname, contact, type, text, status, ip, created_at)
       VALUES (?,?,?,?,?,'pending',?,?)`,
      userId,
      nickname,
      contact,
      type,
      text,
      String(ctx.ip || ""),
      now
    );
    const sid = Number(info.lastInsertRowid);
    for (const s of stored) {
      run(
        `INSERT INTO submission_files (submission_id, stored_name, orig_name, mime, byte_size, webdav_status)
         VALUES (?,?,?,?,?,'pending')`,
        sid,
        s.storedName,
        s.origName,
        s.mime,
        s.byteSize
      );
    }
    run(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      userId,
      "submission.create",
      "submission",
      String(sid),
      JSON.stringify({ type, files: stored.length, nickname }),
      ctx.ip,
      now
    );
    return sid;
  });

  return sendOk(ctx.res, { id: submissionId, files: stored.length }, 201);
}

/** GET /api/submissions/credits —— 鸣谢墙：已收录投稿（公开，不含联系方式/附件） */
export function listCredits(ctx) {
  const rows = all(
    `SELECT nickname, type, text, created_at
     FROM submissions
     WHERE status = 'approved'
     ORDER BY reviewed_at DESC, id DESC
     LIMIT 100`
  );
  return sendOk(ctx.res, {
    items: rows.map((r) => ({
      nickname: r.nickname || "匿名干员",
      type: r.type,
      text: r.text,
      createdAt: r.created_at
    }))
  });
}

/** GET /media/submissions/:name —— 投稿附件仅管理员可见（征集物可能含未公开内容） */
export function serveSubmissionFile(ctx) {
  requireAdmin(ctx);
  const name = path.basename(String(ctx.params.name || ""));
  if (!/^[a-f0-9]{16}\.(png|jpg|webp)$/i.test(name)) throw AppError.notFound("文件不存在");
  const abs = path.join(submissionDir(), name);
  const sent = sendFile(ctx.req, ctx.res, abs, { cacheSeconds: 0, contentType: mimeOf(abs) });
  if (!sent) throw AppError.notFound("文件不存在");
  return true;
}
