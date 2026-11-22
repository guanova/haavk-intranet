/* ==========================================================================
   server/index.js — HTTP 服务入口
   职责：路由分发 / API 与媒体资源 / 静态文件与 SPA 回退 / 启动时自动迁移与播种
   运行：node server/index.js
   ========================================================================== */
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { getDb, assertSchemaReady } from "./lib/db.js";
import { migrate } from "./lib/migrate.js";
import * as migration001 from "./migrations/001_init.js";
import * as migration002 from "./migrations/002_post_likes.js";
import * as migration003 from "./migrations/003_submissions.js";
import * as migration004 from "./migrations/004_submission_reward.js";
import * as migration005 from "./migrations/005_officer_topics.js";
import * as migration006 from "./migrations/006_notifications_mail_agent.js";
import { seedAll, seedStats } from "./lib/seed.js";

/* ------------------------------ 路由与处理器 ------------------------------ */
import { createRouter } from "./lib/router.js";
import { currentUser } from "./lib/auth.js";
import { sendError, sendJson, sendFile, resolveStatic, clientIp, mimeOf } from "./lib/http.js";
import { AppError } from "./lib/errors.js";
import * as authApi from "./api/auth.js";
import * as pointsApi from "./api/points.js";
import * as forumApi from "./api/forum.js";
import * as catalogApi from "./api/catalog.js";
import * as adminApi from "./api/admin.js";
import * as mediaApi from "./api/media.js";
import * as submissionsApi from "./api/submissions.js";
import * as notificationsApi from "./api/notifications.js";
import * as agentApi from "./api/agent.js";
import { startWorkers } from "./workers/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number.parseInt(process.env.PORT || process.env.HAAVK_PORT || "8137", 10);
const HOST = process.env.HAAVK_HOST || "0.0.0.0";

const api = createRouter();

/* ------------------------------ 认证与账号 ------------------------------ */
api.post("/api/auth/register", authApi.register);
api.post("/api/auth/login", authApi.loginHandler);
api.post("/api/auth/logout", authApi.logout);
api.post("/api/auth/demo-login", authApi.demoLogin);
api.get("/api/me", authApi.me);
api.patch("/api/me", authApi.updateMe);
api.post("/api/me/password", authApi.updatePassword);
api.post("/api/me/avatar", mediaApi.uploadAvatar);
api.delete("/api/me/avatar", mediaApi.deleteAvatar);
api.get("/api/me/requests", authApi.myRequests);
api.get("/api/me/email", authApi.getEmail);
api.patch("/api/me/email", authApi.updateEmail);
api.post("/api/requests", authApi.createRequest);

/* ------------------------------ 点数 ------------------------------ */
api.post("/api/points/claim", pointsApi.claimPoints);
api.get("/api/points/summary", pointsApi.pointsSummary);
api.get("/api/points/ledger", pointsApi.pointsLedger);

/* ------------------------------ 论坛 ------------------------------ */
api.get("/api/boards", forumApi.listBoards);
api.get("/api/posts", forumApi.listPosts);
api.get("/api/posts/:id", forumApi.getPost);
api.post("/api/posts", forumApi.createPost);
api.patch("/api/posts/:id", forumApi.updatePost);
api.delete("/api/posts/:id", forumApi.deletePost);
api.post("/api/posts/:id/replies", forumApi.createReply);
api.post("/api/posts/:id/like", forumApi.toggleLike);
api.get("/api/mentions/:code", forumApi.getMention);
api.get("/api/mention-targets", forumApi.listMentionTargets);

/* ------------------------------ 目录与站点内容 ------------------------------ */
api.get("/api/catalog", catalogApi.getCatalog);
api.get("/api/site", catalogApi.getSite);
api.post("/api/wanted/:id/clue", catalogApi.submitClue);

/* ------------------------------ 资料征集 ------------------------------ */
api.post("/api/submissions", submissionsApi.createSubmission);
api.get("/api/submissions/credits", submissionsApi.listCredits);

/* ------------------------------ 管理面板 ------------------------------ */
api.get("/api/admin/overview", adminApi.overview);
api.get("/api/admin/health", adminApi.health); // 需管理员身份，避免公开暴露内部信息
api.get("/api/admin/requests", adminApi.listRequests);
api.post("/api/admin/requests/:id/review", adminApi.reviewRequest);
api.get("/api/admin/settings", adminApi.listSettingsHandler);
api.patch("/api/admin/settings", adminApi.updateSettingsHandler);
api.get("/api/admin/users", adminApi.listUsers);
api.post("/api/admin/users", adminApi.createUserHandler);
api.post("/api/admin/users/:id/points", adminApi.adjustPoints);
api.post("/api/admin/users/:id/status", adminApi.setUserStatus);
api.get("/api/admin/mentions", adminApi.listMentions);
api.get("/api/admin/ai-officers", adminApi.listAiOfficers);
api.post("/api/admin/ai-officers/:id", adminApi.updateAiOfficer);
api.get("/api/admin/audit-logs", adminApi.listAuditLogs);
api.post("/api/admin/departments", adminApi.createDepartment);
api.post("/api/admin/departments/:id/toggle", adminApi.toggleDepartment);
api.get("/api/admin/submissions", adminApi.listSubmissions);
api.post("/api/admin/submissions/:id/review", adminApi.reviewSubmission);
api.post("/api/admin/submissions/webdav/retry", adminApi.retryWebdav);
api.post("/api/admin/submissions/webdav/test", adminApi.testWebdav);
api.get("/api/admin/submissions/webdav/stats", adminApi.webdavStats);

/* ------------------------------ 通知板块 ------------------------------ */
api.get("/api/notifications", notificationsApi.listPublic);
api.get("/api/notifications/:id", notificationsApi.getPublic);
api.get("/api/admin/notifications", notificationsApi.listAdmin);
api.post("/api/admin/notifications", notificationsApi.create);
api.patch("/api/admin/notifications/:id", notificationsApi.update);
api.delete("/api/admin/notifications/:id", notificationsApi.remove);
api.post("/api/admin/notifications/:id/publish", notificationsApi.publish);
api.post("/api/admin/notifications/:id/push-mail", notificationsApi.pushMail);
api.get("/api/admin/notifications/:id/mail-log", notificationsApi.mailLog);
api.post("/api/admin/mail/test", notificationsApi.testSmtp);
api.get("/api/admin/mail/status", notificationsApi.mailStatus);

/* ------------------------------ 自动化管家（令牌鉴权） ------------------------------ */
api.get("/api/agent/ping", agentApi.ping);
api.get("/api/agent/summary", agentApi.summary);
api.get("/api/agent/tokens", agentApi.listTokens);
api.post("/api/agent/tokens", agentApi.createToken);
api.post("/api/agent/tokens/:id/revoke", agentApi.revokeToken);

/* ------------------------------ 媒体 ------------------------------ */
api.get("/media/avatars/:name", mediaApi.serveAvatar);
api.get("/media/default-avatar.svg", mediaApi.serveDefaultAvatar);
api.get("/media/submissions/:name", submissionsApi.serveSubmissionFile);

/* ------------------------------ 请求处理 ------------------------------ */

function parseUrl(req) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  return { pathname: url.pathname, query: Object.fromEntries(url.searchParams.entries()) };
}

async function handle(req, res) {
  const { pathname, query } = parseUrl(req);

  // —— API 与媒体：先匹配路由 ——
  const hit = api.match(req.method, pathname);
  if (hit && hit.handler) {
    const ctx = {
      req,
      res,
      params: hit.params,
      query,
      ip: clientIp(req),
      user: currentUser(req)
    };
    try {
      const result = await hit.handler(ctx);
      // 处理器直接操作 res 时返回 undefined/true，不再二次发送
      if (result === undefined || result === true) return;
      return sendJson(res, 200, result);
    } catch (err) {
      return sendError(res, err);
    }
  }
  if (hit && hit.methodNotAllowed) {
    return sendError(res, new AppError("BAD_REQUEST", `该地址不支持 ${req.method} 方法`));
  }

  // —— /api 与 /media 前缀下的未匹配：明确 404，绝不回退到 HTML ——
  if (pathname.startsWith("/api/") || pathname === "/api") {
    if (!hit) return sendError(res, AppError.notFound("接口不存在"));
  }

  // —— 静态资源 ——
  if (req.method === "GET" || req.method === "HEAD") {
    let filePath = resolveStatic(ROOT, pathname === "/" ? "/index.html" : pathname);

    // 服务端源码、数据目录、测试与开发资产均不通过静态服务暴露
    const blocked = [
      "/data/",
      "/tests/",
      "/server/",
      "/tools/",
      "/docs/",
      "/previews/",
      "/references/",
      "/backup/",
      "/video/",
      "/.git",
      "/node_modules/"
    ];
    if (filePath && blocked.some((b) => pathname.startsWith(b))) {
      filePath = null;
    }
    // 根目录只放行 index.html：dev-*.html 之类的调试页（可自动登录）不得对外提供
    if (filePath && /^\/[^/]+\.html$/.test(pathname) && pathname !== "/index.html") {
      filePath = null;
    }

    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      /* 代码类资源（html/js/css/json）必须每次回源校验（ETag 命中走 304），
         否则改版后浏览器会拿着 1 小时前的旧脚本跑，表现为「改了没生效」。
         图片与字体才是真正可以长缓存的资产。 */
      const ext = path.extname(filePath).toLowerCase();
      const codeLike = /^(\.html|\.js|\.css|\.json|\.svg|\.webmanifest)$/.test(ext);
      const sent = sendFile(req, res, filePath, {
        cacheSeconds: codeLike ? 0 : 86400,
        contentType: mimeOf(filePath)
      });
      if (sent) return;
    }

    // SPA 回退：非资源类路径返回入口页
    const looksLikeAsset = /\.[a-z0-9]{1,8}$/i.test(pathname);
    if (!looksLikeAsset) {
      const indexPath = path.join(ROOT, "index.html");
      if (sendFile(req, res, indexPath, { cacheSeconds: 0, contentType: "text/html; charset=utf-8" })) return;
    }
    return sendError(res, AppError.notFound("资源不存在"));
  }

  return sendError(res, new AppError("BAD_REQUEST", "不支持的请求方法"));
}

/* ------------------------------ 启动 ------------------------------ */

export function boot({ seed = true, workers = true, verbose = true } = {}) {
  const dbFile = process.env.HAAVK_DB || path.resolve(process.cwd(), "data/haavk.db");
  const { applied, current } = migrate([migration001, migration002, migration003, migration004, migration005, migration006]);
  assertSchemaReady();
  if (verbose) {
    console.log(`[db] ${dbFile}`);
    console.log(`[db] schema v${current}${applied.length ? `（本次应用迁移：${applied.join(", ")}）` : ""}`);
  }

  if (seed) {
    const summary = seedAll({
      adminPassword: process.env.HAAVK_ADMIN_PASSWORD,
      officerPassword: process.env.HAAVK_OFFICER_PASSWORD,
      verbose
    });
    const stats = seedStats();
    if (verbose) {
      console.log(
        `[seed] 部门 ${stats.departments} · 岗位 ${stats.jobs} · 板块 ${stats.boards} · ` +
          `管理员 ${stats.admins} · AI 高管 ${stats.aiOfficers} · 配置项 ${stats.settings}` +
          (summary.departments + summary.jobs + summary.boards + summary.accounts.admins.length + summary.accounts.officers.length
            ? `（本次新增 部门${summary.departments}/岗位${summary.jobs}/板块${summary.boards}/账号${summary.accounts.admins.length + summary.accounts.officers.length}）`
            : "（全部已存在）")
      );
    }
  }

  if (workers) startWorkers();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[fatal] 未捕获的请求异常", err);
      try {
        sendError(res, err);
      } catch {
        /* 响应可能已发送 */
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`\n  哈夫克内网  http://127.0.0.1:${PORT}/`);
    console.log(`  管理面板     http://127.0.0.1:${PORT}/#/admin`);
    console.log(`  接口自检     node server/tools/smoke.js\n`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[fatal] 端口 ${PORT} 已被占用。请设置 PORT 环境变量后重试。`);
    } else {
      console.error("[fatal] 服务启动失败", err);
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`\n[shutdown] 收到 ${signal}，正在关闭…`);
    server.close(() => {
      try {
        getDb().close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) boot();
