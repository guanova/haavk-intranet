/* ==========================================================================
   views/admin.js — 管理面板（#/admin，仅 site_admin）
   · 全部数据来自 server/api/admin.js；本视图不直接写 fetch，统一走 HAAVK.api
   · 内部 tab 切换（不换路由）：概览 / 入职审批 / 站点配置 / 用户 / @审核 / AI高管 / 审计
   · 每个数据区块都实现三态：加载（骨架）/ 空态（stateBlock）/ 错误态（stateBlock + 重试）
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;
  var api = NS.api;

  /* ----------------------------- 文案映射 ----------------------------- */

  var TABS = [
    { id: "overview", label: "概览", icon: "hex", sub: "OVERVIEW" },
    { id: "requests", label: "入职审批", icon: "doc", sub: "REQUESTS" },
    { id: "submissions", label: "资料征集", icon: "gift", sub: "COLLECT" },
    { id: "notifications", label: "通知", icon: "info", sub: "NOTICE" },
    { id: "settings", label: "站点配置", icon: "shield", sub: "SETTINGS" },
    { id: "users", label: "用户", icon: "user", sub: "USERS" },
    { id: "mentions", label: "＠审核", icon: "speaker", sub: "MENTIONS" },
    { id: "officers", label: "AI 高管", icon: "target", sub: "OFFICERS" },
    { id: "audit", label: "审计日志", icon: "search", sub: "AUDIT" }
  ];

  var ROLE_LABEL = {
    employee: "员工",
    ai_officer: "AI 高管",
    chief_secretary: "首席执行秘书办",
    site_admin: "网站管理员"
  };

  var STATUS_LABEL = {
    active: "在职",
    pending_onboarding: "待办理入职",
    suspended: "已停用"
  };

  var REQ_TYPE_LABEL = {
    onboarding: "办理入职",
    job_change: "岗位变更",
    dept_change: "部门变更"
  };

  var REQ_STATUS_LABEL = {
    pending: "待审批",
    approved: "已通过",
    rejected: "已驳回"
  };

  var MENTION_STATUS_LABEL = {
    pending: "待受理",
    under_review: "审核中",
    approved: "已通过",
    rejected: "已驳回"
  };

  var GROUP_LABEL = {
    filing: "备案信息",
    brand: "品牌",
    points: "点数规则",
    mention: "@ 呼叫风控",
    webdav: "WebDAV 转存",
    mail: "邮件推送（SMTP）"
  };

  var GROUP_DESC = {
    filing: "页脚展示的备案与版权信息，对外可见，请与真实备案一致。",
    brand: "站点名称，用于浏览器标题与导航。",
    points: "点数发放与消耗规则；数值型配置有服务端范围保护。",
    mention: "@ 呼叫的冷却、频次与职级门槛。",
    webdav: "征集稿件图片的异地转存设置；base_url 示例 https://dav.example.com/dav/haavk。密码修改后只会写回配置，已入队文件沿用新配置重试。",
    mail: "发布通知时向订阅邮箱推送。QQ/163 邮箱请填「授权码」而非登录密码；端口 465 为加密直连（推荐），587 走 STARTTLS。填完点「通知」页的「测试连接」验证。"
  };

  var COUNT_CARDS = [
    { key: "users", label: "用户总数", icon: "user" },
    { key: "hired", label: "在职员工", icon: "shield" },
    { key: "pendingOnboarding", label: "待审入职", icon: "doc" },
    { key: "posts", label: "帖子", icon: "speaker" },
    { key: "replies", label: "回复", icon: "hex" },
    { key: "aiOfficers", label: "AI 高管（启用）", icon: "target" },
    { key: "mentionsTotal", label: "＠审核总数", icon: "search" },
    { key: "mentionsPending", label: "待审", icon: "warn" },
    { key: "mentionsApproved", label: "通过", icon: "shield" },
    { key: "mentionsRejected", label: "驳回", icon: "trash" },
    { key: "ledgerSum", label: "流水合计", icon: "coin" },
    { key: "balanceSum", label: "余额合计", icon: "coin" }
  ];

  /* ----------------------------- 视图内状态 ----------------------------- */

  var TAB_IDS = TABS.map(function (t) {
    return t.id;
  });

  var activeTab = "overview";
  // tabId -> { data, error, loading }
  var tabData = {};
  var loading = {};
  var rootEl = null;
  var generation = 0;
  var offAuthExpired = null;

  function reset() {
    activeTab = "overview";
    tabData = {};
    loading = {};
  }

  /** 当前管理员（render 阶段只读 store，不发请求） */
  function currentUser() {
    var st = NS.store && NS.store.getState ? NS.store.getState() : {};
    return (st && st.user) || null;
  }

  function isAdmin() {
    var u = currentUser();
    return !!u && u.role === "site_admin";
  }

  function userName() {
    var u = currentUser();
    if (!u) return "未登录";
    return u.displayName || u.username || "管理员";
  }

  /** 异步任务守卫：视图已卸载 / 已重新渲染时不再写 DOM */
  function alive(gen) {
    return !!rootEl && gen === generation;
  }

  function esc(v) {
    return util.esc(v);
  }

  function show(v, emptyText) {
    if (v === null || v === undefined || v === "") return emptyText || "—";
    return util.esc(v);
  }

  function tag(text, cls) {
    return '<span class="tag ' + (cls || "") + '">' + esc(text) + "</span>";
  }

  function stateTag(status, map) {
    var cls =
      status === "pending" || status === "under_review"
        ? "tag--pending"
        : status === "rejected" || status === "suspended"
        ? "tag--red"
        : "";
    return tag((map && map[status]) || status, cls);
  }

  /* ----------------------------- 静态骨架 ----------------------------- */

  function headerHtml() {
    var u = currentUser() || {};
    return (
      '<header class="admin-top">' +
      '<div class="admin-top__id">' +
      '<div class="admin-top__title">管理面板 <span>HAAVK ADMIN CONSOLE</span></div>' +
      '<div class="admin-top__who">当前管理员：<b>' +
      esc(userName()) +
      "</b>" +
      (u.username ? '<span class="tag tag--dark">' + esc(u.username) + "</span>" : "") +
      "</div>" +
      "</div>" +
      '<div class="admin-top__ops">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-act="refresh">' +
      icon("target", "", 14) +
      "刷新当前页</button>" +
      '<button type="button" class="btn btn--danger btn--sm" data-act="logout">' +
      icon("lock", "", 14) +
      "退出登录</button>" +
      "</div>" +
      "</header>"
    );
  }

  function sideHtml() {
    return (
      '<nav class="admin-side" aria-label="管理面板导航">' +
      '<div class="admin-side__cap">后台功能</div>' +
      TABS.map(function (t) {
        return (
          '<button type="button" class="admin-side__item' +
          (t.id === activeTab ? " is-active" : "") +
          '" data-tab="' +
          t.id +
          '" aria-current="' +
          (t.id === activeTab ? "page" : "false") +
          '">' +
          '<span class="admin-side__icon">' +
          icon(t.icon, "", 18) +
          "</span>" +
          '<span class="admin-side__text">' +
          '<span class="admin-side__label">' +
          esc(t.label) +
          "</span>" +
          '<span class="admin-side__sub">' +
          esc(t.sub) +
          "</span>" +
          "</span>" +
          "</button>"
        );
      }).join("") +
      '<div class="admin-side__note mini-note">网站管理员不开放注册，仅可由既有管理员在「用户」页创建。</div>' +
      "</nav>"
    );
  }

  function skeletonBlock() {
    return (
      '<div class="admin-panel__body">' +
      NS.skeletonRows(6, 64) +
      "</div>"
    );
  }

  function errorBlock(err, retryTab) {
    var msg = (err && err.message) || "请求失败";
    return (
      '<div class="admin-panel__body">' +
      NS.stateBlock({
        icon: "warn",
        title: "数据加载失败",
        desc: msg,
        actionHtml:
          '<button type="button" class="btn btn--primary btn--sm" data-act="retry" data-tab="' +
          esc(retryTab) +
          '">重试</button>'
      }) +
      "</div>"
    );
  }

  function emptyBlock(text, actionHtml) {
    return (
      '<div class="admin-panel__body">' +
      NS.stateBlock({ icon: "info", title: text || "暂无数据", actionHtml: actionHtml || "" }) +
      "</div>"
    );
  }

  /**
   * 通用区块三态渲染
   * @param {string} tabId
   * @param {function} dataHtml (data) => string
   * @param {object} opts { emptyText, isEmpty, toolbarHtml }
   */
  function block(tabId, dataHtml, opts) {
    opts = opts || {};
    var t = tabData[tabId];
    var head = opts.toolbarHtml
      ? '<div class="admin-toolbar">' + opts.toolbarHtml + "</div>"
      : "";

    if (loading[tabId] && !t) {
      return '<section class="panel admin-panel">' + head + skeletonBlock() + "</section>";
    }
    if (t && t.error) {
      return '<section class="panel admin-panel">' + head + errorBlock(t.error, tabId) + "</section>";
    }
    if (!t) {
      return '<section class="panel admin-panel">' + head + skeletonBlock() + "</section>";
    }
    var isEmpty = opts.isEmpty ? opts.isEmpty(t.data) : false;
    if (isEmpty) {
      return (
        '<section class="panel admin-panel">' +
        head +
        emptyBlock(opts.emptyText, opts.emptyActionHtml) +
        "</section>"
      );
    }
    return '<section class="panel admin-panel">' + head + dataHtml(t.data) + "</section>";
  }

  /* ----------------------------- 表格工具 ----------------------------- */

  function titled(title, sub) {
    return (
      '<div class="panel__head admin-panel__head">' +
      '<div class="panel__title">' +
      esc(title) +
      (sub ? "<span>" + esc(sub) + "</span>" : "") +
      "</div>" +
      '<div class="panel__rule"></div>' +
      "</div>"
    );
  }

  /**
   * 网格表格：列宽由各面板按内容给出，minWidth 保证窄屏横向滚动而不是挤压列。
   */
  function gridTable(cols, minWidth, headHtml, rowsHtml) {
    var style = ' style="grid-template-columns:' + cols + ';--min-w:' + minWidth + 'px"';
    return (
      '<div class="admin-table">' +
      '<div class="forum-table__head"' +
      style +
      ">" +
      headHtml +
      "</div>" +
      rowsHtml +
      "</div>"
    );
  }

  /** 从列定义估算网格总宽，避免行与表头宽度不一致 */
  function colsSum(cols) {
    var total = 0;
    String(cols)
      .split(/\s+/)
      .forEach(function (part) {
        var n = /(\d+)px/.exec(part);
        if (n) total += Number(n[1]);
        else if (/1fr/.test(part)) total += 140; // auto / 1fr 按经验值计入
      });
    return total;
  }

  function row(cols, innerHtml, extraCls) {
    return (
      '<div class="forum-row admin-row' +
      (extraCls ? " " + extraCls : "") +
      '" style="grid-template-columns:' +
      cols +
      ";--min-w:" +
      colsSum(cols) +
      'px">' +
      innerHtml +
      "</div>"
    );
  }

  function cell(cls, html, title) {
    return (
      '<div class="' +
      cls +
      '"' +
      (title ? ' title="' + util.attr(title) + '"' : "") +
      ">" +
      html +
      "</div>"
    );
  }

  /* ============================== 概览 ============================== */

  function renderOverview() {
    return block(
      "overview",
      function (d) {
        var counts = d.counts || {};
        var cards = COUNT_CARDS.map(function (c) {
          var v = counts[c.key];
          return (
            '<div class="admin-count' +
            (c.key === "ledgerSum" || c.key === "balanceSum" ? " admin-count--ledger" : "") +
            '">' +
            '<div class="admin-count__icon">' +
            icon(c.icon, "", 18) +
            "</div>" +
            '<div class="admin-count__label">' +
            esc(c.label) +
            "</div>" +
            '<div class="admin-count__value u-num">' +
            esc(util.thousands(v === undefined || v === null ? 0 : v)) +
            "</div>" +
            "</div>"
          );
        }).join("");

        var reconciled =
          d.reconciled === true
            ? '<div class="admin-recon admin-recon--ok">' +
              icon("shield", "", 18) +
              "<b>对账一致</b><span>流水合计与用户余额合计相等（" +
              esc(util.thousands(counts.ledgerSum || 0)) +
              "）。</span></div>"
            : '<div class="admin-recon admin-recon--bad">' +
              icon("warn", "", 18) +
              "<b>对账异常</b><span>流水合计 " +
              esc(util.thousands(counts.ledgerSum || 0)) +
              " ≠ 余额合计 " +
              esc(util.thousands(counts.balanceSum || 0)) +
              "，请立即核查点数流水。</span></div>";

        var reqs = d.recentRequests || [];
        var reqRows = reqs.length
          ? gridTable(
              "1.4fr 150px 110px 160px",
              660,
              "<span>申请人</span><span>类型</span><span>状态</span><span>时间</span>",
              reqs
                .map(function (r) {
                  return row(
                    "1.4fr 150px 110px 160px",
                    cell("admin-cell", esc(r.display_name || r.username || "—")) +
                      cell("admin-cell", esc(REQ_TYPE_LABEL[r.type] || r.type)) +
                      cell("admin-cell", stateTag(r.status, REQ_STATUS_LABEL)) +
                      cell("admin-cell admin-cell--mute", esc(util.dateTime(r.created_at)))
                  );
                })
                .join("")
            )
          : '<div class="admin-panel__body"><div class="mini-note">暂无最近的入职 / 变更申请。</div></div>';

        var mentions = d.recentMentions || [];
        var menRows = mentions.length
          ? gridTable(
              "150px 1.2fr 1.2fr 110px 160px",
              760,
              "<span>编号</span><span>目标高管</span><span>呼叫者</span><span>状态</span><span>时间</span>",
              mentions
                .map(function (m) {
                  return row(
                    "150px 1.2fr 1.2fr 110px 160px",
                    cell("admin-cell admin-cell--code", esc(m.code || "—")) +
                      cell("admin-cell", esc(m.officer_name || "—")) +
                      cell("admin-cell", esc(m.requester_name || "—")) +
                      cell("admin-cell", stateTag(m.status, MENTION_STATUS_LABEL)) +
                      cell("admin-cell admin-cell--mute", esc(util.dateTime(m.created_at)))
                  );
                })
                .join("")
            )
          : '<div class="admin-panel__body"><div class="mini-note">暂无最近的 @ 呼叫记录。</div></div>';

        return (
          '<div class="admin-panel__body">' +
          reconciled +
          '<div class="admin-counts">' +
          cards +
          "</div>" +
          '<div class="admin-sub">' +
          titled("最近申请", "RECENT REQUESTS") +
          '<div class="admin-panel__body">' +
          reqRows +
          "</div>" +
          "</div>" +
          '<div class="admin-sub">' +
          titled("最近 ＠ 呼叫", "RECENT MENTIONS") +
          '<div class="admin-panel__body">' +
          menRows +
          "</div>" +
          "</div>" +
          "</div>"
        );
      },
      { toolbarHtml: '<span class="mini-note">实时统计数据</span>' }
    );
  }

  /* ============================== 入职审批 ============================== */

  var reqStatus = "pending";

  function renderRequests() {
    var filterHtml =
      '<div class="admin-filters">' +
      '<span class="admin-filters__label">状态</span>' +
      ["pending", "approved", "rejected"]
        .map(function (s) {
          return (
            '<button type="button" class="admin-chip' +
            (reqStatus === s ? " is-active" : "") +
            '" data-act="req-status" data-value="' +
            s +
            '">' +
            esc(REQ_STATUS_LABEL[s]) +
            "</button>"
          );
        })
        .join("") +
      "</div>";

    return block(
      "requests",
      function (d) {
        var items = d.items || [];
        var cols = "170px 90px 1.3fr 1fr 160px 168px";
        var rows = items
          .map(function (r) {
            var target =
              r.targetDepartmentName || r.targetJobRoleName
                ? esc(r.targetDepartmentName || "—") +
                  " / " +
                  esc(r.targetJobRoleName || "—")
                : '<span class="mini-note">—</span>';
            var current =
              r.currentDepartmentName || r.currentJobRoleName
                ? '<div class="mini-note">当前：' +
                  esc(r.currentDepartmentName || "—") +
                  " / " +
                  esc(r.currentJobRoleName || "—") +
                  "</div>"
                : "";
            var ops =
              r.status === "pending"
                ? '<button type="button" class="btn btn--primary btn--sm" data-act="review-approve" data-id="' +
                  esc(r.id) +
                  '">通过</button>' +
                  '<button type="button" class="btn btn--danger btn--sm" data-act="review-reject" data-id="' +
                  esc(r.id) +
                  '">驳回</button>'
                : '<span class="mini-note">' +
                  (r.reviewNote ? "理由：" + esc(r.reviewNote) : "已处理") +
                  "</span>";

            return row(
              cols,
              cell(
                "admin-cell",
                esc(r.displayName || r.username || "—") +
                  '<div class="mini-note">@' +
                  esc(r.username || "—") +
                  "</div>"
              ) +
                cell("admin-cell", esc(REQ_TYPE_LABEL[r.type] || r.type)) +
                cell("admin-cell admin-cell--wrap", target + current) +
                cell("admin-cell admin-cell--wrap", r.reason ? esc(r.reason) : '<span class="mini-note">—</span>') +
                cell("admin-cell admin-cell--mute", esc(util.dateTime(r.createdAt))) +
                cell("admin-cell admin-ops", ops)
            );
          })
          .join("");

        return (
          titled("入职与岗位变更审批", "REQUESTS") +
          '<div class="admin-panel__body">' +
          gridTable(
            cols,
            1040,
            "<span>申请人</span><span>类型</span><span>目标部门 / 岗位</span><span>说明</span><span>提交时间</span><span>操作</span>",
            rows
          ) +
          "</div>"
        );
      },
      {
        emptyText: REQ_STATUS_LABEL[reqStatus] + "的申请为空",
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml: filterHtml
      }
    );
  }

  /* ============================== 资料征集 ============================== */

  var subStatus = "pending";

  var SUB_STATUS_LABEL = {
    pending: "待收录",
    approved: "已收录",
    rejected: "未收录"
  };

  var SUB_TYPE_LABEL = {
    screenshot: "活动截图",
    lore: "设定资料",
    copy: "帖子文案",
    asset: "素材图源",
    bug: "页面捉虫",
    other: "其他"
  };

  function renderSubmissions() {
    var filterHtml =
      '<div class="admin-filters">' +
      '<span class="admin-filters__label">状态</span>' +
      ["pending", "approved", "rejected"]
        .map(function (s) {
          return (
            '<button type="button" class="admin-chip' +
            (subStatus === s ? " is-active" : "") +
            '" data-act="sub-status" data-value="' +
            s +
            '">' +
            esc(SUB_STATUS_LABEL[s]) +
            "</button>"
          );
        })
        .join("") +
      "</div>";

    return block(
      "submissions",
      function (d) {
        var items = d.items || [];
        var stats = d.stats || { configured: 0, pending: 0, ok: 0, failed: 0 };
        var webdavBar =
          '<div class="admin-webdav">' +
          '<span class="admin-webdav__label">' + icon("upload") + " 图片转存</span>" +
          (stats.configured
            ? '<span class="mini-note">待转存 <b class="u-num">' + stats.pending + "</b> · 已转存 <b class=\"u-num\">" + stats.ok + "</b> · 失败 <b class=\"u-num\">" + stats.failed + "</b></span>" +
              (stats.failed > 0
                ? '<button type="button" class="btn btn--ghost btn--sm" data-act="webdav-retry-all">重试全部失败</button>'
                : "") +
              '<span class="mini-note">转存设置在「站点配置 · WebDAV 转存」</span>'
            : '<span class="mini-note">未启用——图片仅保存在本机档案库；在「站点配置 · WebDAV 转存」填入地址与账号后自动开始转存。</span>') +
          "</div>";

        var cols = "150px 100px 1.4fr 140px 110px 150px 130px 190px";
        var rows = items
          .map(function (it) {
            var thumbs = (it.files || [])
              .map(function (a) {
                var st =
                  a.webdavStatus === "ok"
                    ? '<i class="sub-thumb__badge is-done" title="已转存">✓</i>'
                    : a.webdavStatus === "failed"
                      ? '<i class="sub-thumb__badge is-failed" title="转存失败">!</i>'
                      : "";
                return (
                  '<a class="sub-thumb" href="' + esc(a.url) + '" target="_blank" rel="noopener" title="' + esc(a.origName || "") + '">' +
                  '<img src="' + esc(a.url) + '" alt="" loading="lazy">' +
                  st +
                  "</a>"
                );
              })
              .join("");
            var statusCell =
              stateTag(it.status, SUB_STATUS_LABEL) +
              (it.rewardPoints
                ? '<div class="mini-note">奖励 +' + esc(String(it.rewardPoints)) + "</div>"
                : "") +
              (it.reviewNote ? '<div class="mini-note">' + esc(it.reviewNote) + "</div>" : "");
            var ops =
              it.status === "pending"
                ? '<button type="button" class="btn btn--primary btn--sm" data-act="sub-approve" data-id="' + esc(it.id) + '" data-name="' + esc(it.nickname || "匿名干员") + '">收录</button>' +
                  '<button type="button" class="btn btn--danger btn--sm" data-act="sub-reject" data-id="' + esc(it.id) + '" data-name="' + esc(it.nickname || "匿名干员") + '">不收录</button>'
                : '<span class="mini-note">已处理</span>';
            var hasFailedAttach = (it.attachments || []).some(function (a) {
              return a.webdav_status === "failed";
            });
            if (hasFailedAttach) {
              ops += '<button type="button" class="btn btn--ghost btn--sm" data-act="sub-retry" data-id="' + esc(it.id) + '">重试转存</button>';
            }
            return row(
              cols,
              cell("admin-cell", esc(it.nickname || "匿名干员") + (it.contact ? '<div class="mini-note">' + esc(it.contact) + "</div>" : "")) +
                cell("admin-cell", esc(SUB_TYPE_LABEL[it.type] || "其他")) +
                cell("admin-cell admin-cell--wrap", it.text ? esc(it.text) : '<span class="mini-note">—</span>') +
                cell("admin-cell", thumbs ? '<div class="sub-thumbs">' + thumbs + "</div>" : '<span class="mini-note">无图</span>') +
                cell("admin-cell admin-cell--mute", it.username ? "@" + esc(it.username) : '<span class="mini-note">游客</span>') +
                cell("admin-cell admin-cell--mute", esc(util.dateTime(it.created_at))) +
                cell("admin-cell", statusCell) +
                cell("admin-cell admin-ops", ops)
            );
          })
          .join("");

        return (
          titled("资料征集", "COLLECT") +
          '<div class="admin-panel__body">' +
          webdavBar +
          gridTable(
            cols,
            1280,
            "<span>称呼 / 联系</span><span>类型</span><span>说明</span><span>图片</span><span>投稿人</span><span>时间</span><span>状态</span><span>操作</span>",
            rows
          ) +
          "</div>"
        );
      },
      {
        emptyText: SUB_STATUS_LABEL[subStatus] + "的稿件为空",
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml: filterHtml
      }
    );
  }

  /* ============================== 站点配置 ============================== */

  function renderSettings() {
    return block(
      "settings",
      function (d) {
        var items = (d.items || []).filter(function (it) {
          return it.editable === 1 || it.editable === true;
        });
        var groups = {};
        items.forEach(function (it) {
          var g = it.grp || "other";
          (groups[g] = groups[g] || []).push(it);
        });
        var order = ["filing", "brand", "points", "mention"];
        var keys = order.filter(function (g) {
          return groups[g];
        }).concat(
          Object.keys(groups).filter(function (g) {
            return order.indexOf(g) < 0;
          })
        );

        return (
          titled("站点配置", "SETTINGS") +
          '<div class="admin-panel__body">' +
          '<form class="admin-form" id="admin-settings-form" novalidate>' +
          keys
            .map(function (g) {
              var isNum = g === "points" || g === "mention";
              return (
                '<fieldset class="admin-group">' +
                '<legend class="admin-group__title">' +
                esc(GROUP_LABEL[g] || g) +
                "</legend>" +
                (GROUP_DESC[g] ? '<div class="mini-note admin-group__desc">' + esc(GROUP_DESC[g]) + "</div>" : "") +
                '<div class="field-grid">' +
                groups[g]
                  .map(function (it) {
                    return (
                      '<div class="field admin-field">' +
                      '<label class="field__label" for="set-' +
                      util.attr(it.key) +
                      '">' +
                      esc(it.label || it.key) +
                      "</label>" +
                      '<input class="input" id="set-' +
                      util.attr(it.key) +
                      '" name="' +
                      util.attr(it.key) +
                      '" type="text"' +
                      (isNum ? ' inputmode="numeric"' : "") +
                      ' value="' +
                      util.attr(it.value == null ? "" : it.value) +
                      '" data-key="' +
                      util.attr(it.key) +
                      '" data-original="' +
                      util.attr(it.value == null ? "" : it.value) +
                      '" autocomplete="off">' +
                      (it.hint ? '<div class="field__hint">' + esc(it.hint) + "</div>" : "") +
                      "</div>"
                    );
                  })
                  .join("") +
                "</div>" +
                "</fieldset>"
              );
            })
            .join("") +
          '<div class="admin-form__foot">' +
          '<span class="mini-note" id="admin-settings-dirty">未修改任何配置项，保存按钮不会提交数据。</span>' +
          '<button type="button" class="btn btn--primary" data-act="settings-save" disabled>保存改动</button>' +
          "</div>" +
          "</form>" +
          "</div>"
        );
      },
      {
        emptyText: "没有可编辑的站点配置项",
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml:
          '<span class="mini-note">仅提交改动过的项，保存后即时生效。</span>'
      }
    );
  }

  /* ============================== 用户管理 ============================== */

  var userQuery = { q: "", role: "" };

  function renderUsers() {
    var toolbar =
      '<div class="admin-filters">' +
      '<label class="admin-search">' +
      icon("search", "", 14) +
      '<input class="input" type="search" id="admin-user-q" placeholder="搜索账号或昵称" value="' +
      util.attr(userQuery.q) +
      '" autocomplete="off">' +
      "</label>" +
      '<select class="select admin-select" id="admin-user-role">' +
      '<option value="">全部角色</option>' +
      Object.keys(ROLE_LABEL)
        .map(function (r) {
          return (
            '<option value="' +
            r +
            '"' +
            (userQuery.role === r ? " selected" : "") +
            ">" +
            esc(ROLE_LABEL[r]) +
            "</option>"
          );
        })
        .join("") +
      "</select>" +
      '<span class="admin-filters__spacer"></span>' +
      '<button type="button" class="btn btn--primary btn--sm" data-act="user-create">' +
      icon("plus", "", 14) +
      "新建管理账号</button>" +
      "</div>";

    return block(
      "users",
      function (d) {
        var items = d.items || [];
        // 7 列合计 ≈810px，适配 1390px 视口下约 834px 的可用宽度
        var cols = "110px 100px 120px minmax(0,128px) 86px 76px 190px";
        var rows = items
          .map(function (u) {
            var roleCell =
              tag(ROLE_LABEL[u.role] || u.role, u.role === "site_admin" ? "" : u.role === "ai_officer" ? "tag--dark" : "") +
              (u.hasPendingRequest ? ' <span class="tag tag--pending">有申请待审</span>' : "");
            var statusCell = stateTag(u.status, STATUS_LABEL);
            var isSelf = currentUser() && currentUser().id === u.id;
            var nextStatus = u.status === "suspended" ? "active" : "suspended";
            var ops =
              '<button type="button" class="btn btn--ghost btn--sm" data-act="user-points" data-id="' +
              esc(u.id) +
              '" data-name="' +
              util.attr(u.displayName || u.username) +
              '">调整点数</button>' +
              (isSelf
                ? '<button type="button" class="btn btn--ghost btn--sm" disabled title="不能修改自己的账号状态">停用/启用</button>'
                : '<button type="button" class="btn ' +
                  (u.status === "suspended" ? "btn--primary" : "btn--danger") +
                  ' btn--sm" data-act="user-status" data-id="' +
                  esc(u.id) +
                  '" data-status="' +
                  nextStatus +
                  '" data-name="' +
                  util.attr(u.displayName || u.username) +
                  '">' +
                  (u.status === "suspended" ? "启用" : "停用") +
                  "</button>");

            return row(
              cols,
              cell("admin-cell", esc(u.username || "—") + (u.isSystem ? '<div class="mini-note">系统账号</div>' : "")) +
                cell("admin-cell", esc(u.displayName || "—")) +
                cell("admin-cell", roleCell) +
                cell("admin-cell admin-cell--wrap", esc(u.departmentName || "—") + '<div class="mini-note">' + esc(u.jobRoleName || "未分配岗位") + "</div>") +
                cell("admin-cell admin-cell--num u-num", esc(util.thousands(u.pointsBalance == null ? 0 : u.pointsBalance))) +
                cell("admin-cell", statusCell) +
                cell("admin-cell admin-ops", ops)
            );
          })
          .join("");

        return (
          titled("用户管理", "USERS") +
          '<div class="admin-panel__body">' +
          gridTable(
            cols,
            810,
            "<span>账号</span><span>昵称</span><span>角色</span><span>部门 / 岗位</span><span>点数余额</span><span>状态</span><span>操作</span>",
            rows
          ) +
          '<div class="mini-note admin-table__note">共 ' +
          esc(items.length) +
          " 个账号；AI 高管为系统内置账号，管理面板不提供创建入口。</div>" +
          "</div>"
        );
      },
      {
        emptyText: "没有匹配的账号",
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml: toolbar
      }
    );
  }

  /* ============================== @ 审核记录 ============================== */

  var mentionStatus = "";

  function renderMentions() {
    var filterHtml =
      '<div class="admin-filters">' +
      '<span class="admin-filters__label">状态</span>' +
      [["", "全部"]]
        .concat([
          ["pending", MENTION_STATUS_LABEL.pending],
          ["under_review", MENTION_STATUS_LABEL.under_review],
          ["approved", MENTION_STATUS_LABEL.approved],
          ["rejected", MENTION_STATUS_LABEL.rejected]
        ])
        .map(function (pair) {
          return (
            '<button type="button" class="admin-chip' +
            (mentionStatus === pair[0] ? " is-active" : "") +
            '" data-act="mention-status" data-value="' +
            util.attr(pair[0]) +
            '">' +
            esc(pair[1]) +
            "</button>"
          );
        })
        .join("") +
      "</div>";

    return block(
      "mentions",
      function (d) {
        var items = d.items || [];
        var cols = "90px 1.2fr 110px 150px 90px 1fr 80px 160px";
        var rows = items
          .map(function (m) {
            return row(
              cols,
              cell("admin-cell admin-cell--code", esc(m.code || "—")) +
                cell("admin-cell admin-cell--wrap", esc(m.postTitle || "—")) +
                cell("admin-cell", esc(m.requesterName || "—")) +
                cell("admin-cell admin-cell--wrap", esc(m.officerName || "—") + (m.officerTitle ? '<div class="mini-note">' + esc(m.officerTitle) + "</div>" : "")) +
                cell("admin-cell", stateTag(m.status, MENTION_STATUS_LABEL)) +
                cell("admin-cell admin-cell--wrap", m.decisionReason ? esc(m.decisionReason) : '<span class="mini-note">—</span>') +
                cell(
                  "admin-cell admin-cell--num u-num",
                  m.assignedMinutes === null || m.assignedMinutes === undefined || m.assignedMinutes === ""
                    ? '<span class="mini-note">—</span>'
                    : esc(m.assignedMinutes) + " 分"
                ) +
                cell("admin-cell admin-cell--mute", esc(util.dateTime(m.createdAt)))
            );
          })
          .join("");

        return (
          titled("＠ 审核记录", "MENTIONS") +
          '<div class="admin-panel__body">' +
          gridTable(
            cols,
            1240,
            "<span>编号</span><span>帖子标题</span><span>呼叫者</span><span>目标高管</span><span>状态</span><span>判定依据</span><span>分配分钟</span><span>时间</span>",
            rows
          ) +
          '<div class="mini-note admin-table__note">最近 200 条记录。</div>' +
          "</div>"
        );
      },
      {
        emptyText: "没有符合条件的 ＠ 审核记录",
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml: filterHtml
      }
    );
  }

  /* ============================== AI 高管配置 ============================== */

  function renderOfficers() {
    return block(
      "officers",
      function (d) {
        var items = d.items || [];
        var cards = items
          .map(function (o) {
            return (
              '<article class="admin-officer" data-officer="' +
              esc(o.id) +
              '">' +
              '<div class="admin-officer__head">' +
              '<div class="admin-officer__name">' +
              esc(o.codename || "—") +
              (o.title ? '<span class="admin-officer__title">' + esc(o.title) + "</span>" : "") +
              "</div>" +
              '<div class="admin-officer__tags">' +
              tag("UID " + (o.username || o.userId), "tag--dark") +
              (o.canReviewMentions ? tag("审核席") : "") +
              (o.enabled ? tag("已启用") : tag("已停用", "tag--red")) +
              "</div>" +
              "</div>" +
              '<div class="admin-officer__body">' +
              '<div class="field-grid field-grid--3">' +
              '<div class="field admin-field">' +
              '<label class="field__label" for="off-lv-' +
              esc(o.id) +
              '">职级 authorityLevel</label>' +
              '<input class="input" id="off-lv-' +
              esc(o.id) +
              '" type="text" inputmode="numeric" value="' +
              util.attr(o.authorityLevel == null ? "" : o.authorityLevel) +
              '" data-field="authority_level">' +
              '<div class="field__hint">1–10，越高越优先受理 ＠ 呼叫</div>' +
              "</div>" +
              '<div class="field admin-field">' +
              '<label class="field__label" for="off-ap-' +
              esc(o.id) +
              '">自主发帖周期（秒）</label>' +
              '<input class="input" id="off-ap-' +
              esc(o.id) +
              '" type="text" inputmode="numeric" value="' +
              util.attr(o.autoPostIntervalSec == null ? 0 : o.autoPostIntervalSec) +
              '" data-field="auto_post_interval_sec">' +
              '<div class="field__hint">0–86400，0 表示不自动发帖</div>' +
              "</div>" +
              '<div class="field admin-field">' +
              '<label class="field__label">开关</label>' +
              '<div class="admin-switches">' +
              '<label class="checkbox"><input type="checkbox" data-field="enabled"' +
              (o.enabled ? " checked" : "") +
              "> 启用该高管</label>" +
              '<label class="checkbox"><input type="checkbox" data-field="can_review_mentions"' +
              (o.canReviewMentions ? " checked" : "") +
              "> 具备审核席资格</label>" +
              "</div>" +
              '<div class="field__hint">停用后不再参与 ＠ 受理</div>' +
              "</div>" +
              "</div>" +
              '<div class="field admin-field">' +
              '<label class="field__label" for="off-p-' +
              esc(o.id) +
              '">人设 persona</label>' +
              '<textarea class="textarea admin-textarea" id="off-p-' +
              esc(o.id) +
              '" data-field="persona" rows="4">' +
              esc(o.persona || "") +
              "</textarea>" +
              '<div class="field__hint">最多 300 字</div>' +
              "</div>" +
              '<div class="field admin-field">' +
              '<label class="field__label" for="off-v-' +
              esc(o.id) +
              '">发言素材 voiceLines（每行一条）</label>' +
              '<textarea class="textarea admin-textarea" id="off-v-' +
              esc(o.id) +
              '" data-field="voice_lines" rows="5">' +
              esc((o.voiceLines || []).join("\n")) +
              "</textarea>" +
              '<div class="field__hint">至少保留一条；最多 40 条，每条 200 字以内</div>' +
              "</div>" +
              '<div class="field admin-field"><label class="field__label" for="off-t-' + esc(o.id) + '">自主选题 postTopics（每行一条）</label><textarea class="textarea admin-textarea" id="off-t-' + esc(o.id) + '" data-field="post_topics" rows="4">' + esc((o.postTopics || []).join("\n")) + '</textarea><div class="field__hint">留空则回退通用素材池；最多 20 条</div></div>' +
              "</div>" +
              '<div class="admin-officer__foot">' +
              '<span class="mini-note">' +
              esc(o.departmentName || "未分配部门") +
              " · 余额 " +
              esc(util.thousands(o.pointsBalance == null ? 0 : o.pointsBalance)) +
              "</span>" +
              '<button type="button" class="btn btn--primary btn--sm" data-act="officer-save" data-id="' +
              esc(o.id) +
              '">保存</button>' +
              "</div>" +
              "</article>"
            );
          })
          .join("");

        return (
          titled("AI 高管配置", "AI OFFICERS") +
          '<div class="admin-panel__body">' +
          '<div class="admin-officers">' +
          cards +
          "</div>" +
          '<div class="mini-note admin-table__note">仅保存本卡片内修改过的字段。</div>' +
          "</div>"
        );
      },
      {
        emptyText: "尚未配置 AI 高管",
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml: '<span class="mini-note">AI 高管为系统内置账号，此处仅调整人设与运行参数。</span>'
      }
    );
  }

  /* ============================== 审计日志 ============================== */

  function renderAudit() {
    return block(
      "audit",
      function (d) {
        var items = d.items || [];
        var cols = "160px 150px 150px 130px 1fr 110px";
        var rows = items
          .map(function (a) {
            var detail = "";
            if (a.detail && typeof a.detail === "object") {
              try {
                detail = JSON.stringify(a.detail);
              } catch (e) {
                detail = "";
              }
            }
            return row(
              cols,
              cell("admin-cell admin-cell--mute", esc(util.dateTime(a.createdAt))) +
                cell("admin-cell", esc(a.actorName || "系统") + (a.actorUsername ? '<div class="mini-note">@' + esc(a.actorUsername) + "</div>" : "")) +
                cell("admin-cell admin-cell--code", esc(a.action || "—")) +
                cell("admin-cell", esc(a.targetType || "—") + (a.targetId ? "#" + esc(a.targetId) : "")) +
                cell("admin-cell admin-cell--wrap admin-cell--code", detail ? esc(detail) : '<span class="mini-note">—</span>') +
                cell("admin-cell admin-cell--mute", esc(a.ip || "—"))
            );
          })
          .join("");

        return (
          titled("审计日志", "AUDIT LOGS") +
          '<div class="admin-panel__body">' +
          gridTable(
            cols,
            1080,
            "<span>时间</span><span>操作人</span><span>动作</span><span>目标</span><span>详情</span><span>IP</span>",
            rows
          ) +
          '<div class="mini-note admin-table__note">最近 200 条记录。</div>' +
          "</div>"
        );
      },
      {
        emptyText: "暂无审计记录",
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml: '<span class="mini-note">全量操作留痕，按时间倒序</span>'
      }
    );
  }


  /* ============================== 通知 ============================== */

  var LEVEL_LABEL = { normal: "通知", important: "重要", urgent: "紧急" };
  var MAIL_STATE_LABEL = { none: "未推送", sending: "推送中", sent: "已推送", failed: "推送失败" };

  function renderNotifications() {
    return block(
      "notifications",
      function (d) {
        var items = d.items || [];
        var mail = d.mail || {};
        var cols = "1fr 90px 80px 110px 150px 210px";
        var rows = items
          .map(function (n) {
            var badge =
              n.status === "published"
                ? '<span class="tag tag--ok">已发布</span>'
                : '<span class="tag">草稿</span>';
            var mailCell =
              n.emailState && n.emailState !== "none"
                ? '<span class="tag' +
                  (n.emailState === "sent" ? " tag--ok" : "") +
                  '">' +
                  esc(MAIL_STATE_LABEL[n.emailState] || n.emailState) +
                  "</span> " +
                  '<span class="mini-note">' +
                  (n.emailOk || 0) +
                  "/" +
                  (n.emailTotal || 0) +
                  "</span>"
                : '<span class="mini-note">—</span>';
            var actions =
              '<button type="button" class="btn btn--flat btn--sm" data-act="notice-edit" data-id="' + esc(n.id) + '">编辑</button>' +
              (n.status === "published"
                ? ""
                : '<button type="button" class="btn btn--flat btn--sm" data-act="notice-publish" data-id="' + esc(n.id) + '">发布</button>') +
              (n.emailState && n.emailState !== "none" && n.emailState !== "sending"
                ? '<button type="button" class="btn btn--flat btn--sm" data-act="notice-mail-log" data-id="' + esc(n.id) + '">记录</button>'
                : "") +
              (n.status === "published" && mail.configured && mail.enabled
                ? '<button type="button" class="btn btn--flat btn--sm" data-act="notice-push" data-id="' + esc(n.id) + '">推送</button>'
                : "") +
              '<button type="button" class="btn btn--flat btn--sm" data-act="notice-del" data-id="' + esc(n.id) + '">删除</button>';
            return row(
              cols,
              cell(
                "admin-cell admin-cell--wrap",
                '<b>' +
                  (n.isPinned ? '<span class="tag tag--pin">置顶</span> ' : "") +
                  esc(n.title) +
                  "</b>" +
                  (n.summary ? '<div class="mini-note">' + esc(n.summary.slice(0, 70)) + "</div>" : "")
              ) +
                cell("admin-cell", badge) +
                cell("admin-cell", '<span class="tag">' + esc(LEVEL_LABEL[n.level] || n.level) + "</span>") +
                cell("admin-cell admin-cell--mute", esc(util.dateTime(n.publishAt || n.createdAt))) +
                cell("admin-cell", mailCell) +
                cell("admin-cell admin-ops", actions)
            );
          })
          .join("");

        var mailBanner =
          '<div class="admin-mailbar">' +
          '<span class="admin-mailbar__state">邮件服务：' +
          (mail.enabled
            ? mail.configured
              ? '<b class="is-ok">已启用</b>'
              : '<b class="is-warn">已启用但未配置完整</b>'
            : '<b>未启用</b>') +
          "</span>" +
          '<span class="mini-note">订阅邮箱 ' + esc(mail.subscribers || 0) + " 个</span>" +
          '<button type="button" class="btn btn--flat btn--sm" data-act="mail-test">测试连接</button>' +
          '<a class="btn btn--flat btn--sm" href="#/admin?tab=settings">前往配置</a>' +
          "</div>";

        return (
          titled("集团通知", "NOTIFICATIONS") +
          '<div class="admin-panel__body">' +
          mailBanner +
          gridTable(
            cols,
            1080,
            "<span>标题</span><span>状态</span><span>级别</span><span>发布时间</span><span>邮件</span><span>操作</span>",
            rows
          ) +
          '<div class="mini-note admin-table__note">发布后员工可在「通知」中查看（须发布通知并明确要求推送邮件才会发信）。</div>' +
          "</div>"
        );
      },
      {
        emptyText: "暂无通知，先新建一条",
        emptyActionHtml: '<button type="button" class="btn btn--primary" data-act="notice-new">新建通知</button>',
        isEmpty: function (d) {
          return !(d.items && d.items.length);
        },
        toolbarHtml:
          '<button type="button" class="btn btn--primary btn--sm" data-act="notice-new">新建通知</button>' +
          '<span class="mini-note">通知同时作为站内公告与邮件推送的内容源</span>'
      }
    );
  }

  /** 新建 / 编辑通知弹窗 */
  function askNotice(notice) {
    var isNew = !notice;
    var n = notice || { title: "", summary: "", body: "", level: "normal", isPinned: false };
    var body =
      '<div class="field admin-field"><label class="field__label" for="nt-title">标题<span class="req">*</span></label>' +
      '<input class="input" id="nt-title" type="text" maxlength="120" value="' + esc(n.title) + '" autocomplete="off">' +
      '<div class="field__error" id="nt-title-err"></div></div>' +
      '<div class="field admin-field"><label class="field__label" for="nt-summary">列表摘要</label>' +
      '<input class="input" id="nt-summary" type="text" maxlength="300" value="' + esc(n.summary || "") + '" placeholder="留空则自动截取正文前 80 字" autocomplete="off"></div>' +
      '<div class="field admin-field"><label class="field__label" for="nt-level">级别</label>' +
      '<select class="select input" id="nt-level">' +
      ["normal", "important", "urgent"]
        .map(function (v) {
          return '<option value="' + v + '"' + (n.level === v ? " selected" : "") + ">" + LEVEL_LABEL[v] + "</option>";
        })
        .join("") +
      "</select></div>" +
      '<div class="field admin-field"><label class="field__label" for="nt-body">正文<span class="req">*</span></label>' +
      '<textarea class="textarea admin-textarea" id="nt-body" rows="10" placeholder="支持空行分段；邮件会原样发送这段文字">' +
      esc(n.body || "") +
      "</textarea>" +
      '<div class="field__error" id="nt-body-err"></div></div>' +
      '<label class="admin-check"><input type="checkbox" id="nt-pin"' + (n.isPinned ? " checked" : "") + "> 置顶显示</label>";
    return modalResult(body, isNew ? "新建通知" : "编辑通知", isNew ? "保存并发布" : "保存修改", function (wrap) {
      var title = wrap.querySelector("#nt-title");
      var bodyEl = wrap.querySelector("#nt-body");
      var tErr = wrap.querySelector("#nt-title-err");
      var bErr = wrap.querySelector("#nt-body-err");
      var tv = ((title && title.value) || "").trim();
      var bv = ((bodyEl && bodyEl.value) || "").trim();
      var bad = false;
      if (!tv) {
        if (tErr) tErr.textContent = "请填写标题";
        if (title) title.classList.add("is-error");
        bad = true;
      }
      if (!bv) {
        if (bErr) bErr.textContent = "请填写正文";
        if (bodyEl) bodyEl.classList.add("is-error");
        bad = true;
      }
      if (bad) return false;
      var lv = wrap.querySelector("#nt-level");
      var sm = wrap.querySelector("#nt-summary");
      var pin = wrap.querySelector("#nt-pin");
      return {
        title: tv,
        body: bv,
        summary: ((sm && sm.value) || "").trim(),
        level: (lv && lv.value) || "normal",
        isPinned: Boolean(pin && pin.checked)
      };
    });
  }

  function saveNotice(id, data) {
    var req = id
      ? api.patch("/api/admin/notifications/" + id, data)
      : api.post("/api/admin/notifications", Object.assign({ publish: true }, data));
    return req.then(function (res) {
      if (res.ok) {
        NS.toast.success(id ? "通知已保存" : "通知已发布");
        delete tabData.notifications;
        loadTab("notifications", { force: true });
      } else {
        apiError(res.error, "保存失败");
      }
    });
  }


  function renderActivePanel() {
    switch (activeTab) {
      case "requests":
        return renderRequests();
      case "submissions":
        return renderSubmissions();
      case "notifications":
        return renderNotifications();
      case "settings":
        return renderSettings();
      case "users":
        return renderUsers();
      case "mentions":
        return renderMentions();
      case "officers":
        return renderOfficers();
      case "audit":
        return renderAudit();
      default:
        return renderOverview();
    }
  }

  /* ------------------------------ render ------------------------------ */

  function render(ctx) {
    // 权限守卫：非 site_admin 不渲染任何数据
    if (!isAdmin()) {
      return (
        '<div class="shell admin-root">' +
        '<div class="admin-guard">' +
        NS.stateBlock({
          icon: "lock",
          title: "仅网站管理员可访问该后台",
          desc: "当前账号没有网站管理员（site_admin）权限。若需申请，请联系集团信息技术部。",
          actionHtml:
            '<a class="btn btn--primary" href="#/">返回首页</a>' +
            '<a class="btn btn--ghost" href="#/login" style="margin-left:12px">切换账号</a>'
        }) +
        "</div>" +
        "</div>"
      );
    }

    // 支持 #/admin?tab=xxx 直达：先于首次渲染同步，避免闪一次概览
    var hashTab = readHashTab();
    if (hashTab) activeTab = hashTab;

    return (
      '<div class="shell admin-root">' +
      headerHtml() +
      '<div class="admin-main">' +
      sideHtml() +
      '<div class="admin-content" id="admin-panel-host">' +
      renderActivePanel() +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  /* ------------------------------ 数据加载 ------------------------------ */

  var LOADERS = {
    overview: function () {
      return api.get("/api/admin/overview");
    },
    requests: function () {
      return api.get("/api/admin/requests", reqStatus ? { status: reqStatus } : undefined);
    },
    submissions: function () {
      return Promise.all([
        api.get("/api/admin/submissions", subStatus ? { status: subStatus } : undefined),
        api.get("/api/admin/submissions/webdav/stats")
      ]).then(function (pair) {
        var list = pair[0];
        var stats = pair[1];
        if (!list.ok) return list;
        return {
          ok: true,
          data: {
            items: (list.data && list.data.items) || [],
            stats: stats.ok ? stats.data : null
          }
        };
      });
    },
    settings: function () {
      return api.get("/api/admin/settings");
    },
    notifications: function () {
      return api.get("/api/admin/notifications");
    },
    users: function () {
      return api.get("/api/admin/users", { q: userQuery.q || undefined, role: userQuery.role || undefined });
    },
    mentions: function () {
      return api.get("/api/admin/mentions", mentionStatus ? { status: mentionStatus } : undefined);
    },
    officers: function () {
      return api.get("/api/admin/ai-officers");
    },
    audit: function () {
      return api.get("/api/admin/audit-logs");
    }
  };

  /** 加载某个 tab；silent=true 时不显示骨架（用于刷新） */
  function loadTab(tab, opts) {
    opts = opts || {};
    var gen = generation;
    var loader = LOADERS[tab];
    if (!loader) return Promise.resolve();

    if (!opts.silent) {
      loading[tab] = true;
      if (tab === activeTab) paint();
    }

    return loader()
      .then(function (res) {
        if (!alive(gen)) return;
        loading[tab] = false;
        if (res && res.ok) {
          tabData[tab] = { data: res.data, error: null };
        } else {
          tabData[tab] = { data: null, error: (res && res.error) || { message: "请求失败" } };
          if (res && res.error && res.error.code === "UNAUTHORIZED") {
            NS.toast.warn("登录状态已失效，请重新登录");
            NS.router.go("/login", { redirect: "/admin" });
            return;
          }
        }
        if (tab === activeTab) paint();
      })
      .catch(function (e) {
        if (!alive(gen)) return;
        loading[tab] = false;
        tabData[tab] = { data: null, error: { message: (e && e.message) || "请求失败" } };
        if (tab === activeTab) paint();
      });
  }

  function loadActive(opts) {
    if (tabData[activeTab] && tabData[activeTab].data && !(opts && opts.force)) {
      paint();
      return Promise.resolve();
    }
    if (opts && opts.force) delete tabData[activeTab];
    return loadTab(activeTab, opts);
  }

  /* ------------------------------ 局部重绘 ------------------------------ */

  function paint() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#admin-panel-host");
    if (!host) return;
    host.innerHTML = renderActivePanel();
    if (activeTab === "settings") syncSettingsDirty();
  }

  function paintSide() {
    if (!rootEl) return;
    var side = rootEl.querySelector(".admin-side");
    if (!side) return;
    var host = side.parentNode;
    var tmp = document.createElement("div");
    tmp.innerHTML = sideHtml();
    host.replaceChild(tmp.firstChild, side);
  }

  function paintHeaderWho() {
    if (!rootEl) return;
    var who = rootEl.querySelector(".admin-top__who");
    if (!who) return;
    var u = currentUser() || {};
    who.innerHTML =
      "当前管理员：<b>" +
      esc(userName()) +
      "</b>" +
      (u.username ? '<span class="tag tag--dark">' + esc(u.username) + "</span>" : "");
  }

  /* ------------------------------ 交互：确认框 ------------------------------ */

  /**
   * modal.open 没有回调告诉调用方「被取消」，
   * 因此统一在弹窗关闭后立刻检测 #app-modal 是否已移除，未确认即视为取消。
   */
  /**
   * modal.open 不提供「被取消」的回调，所以这里在弹窗打开后轮询
   * #app-modal 是否已从 DOM 移除；移除即视为取消（Promise 已被确认分支结束时
   * settled 为 true，不再处理）。
   *
   * 注意：不要用 setTimeout(0) 判断取消——那会在弹窗刚打开时就立刻触发，
   * 把 Promise 提前置为 null，导致确认后不再执行后续请求。
   */
  function modalResult(bodyHtml, title, confirmText, validate) {
    return new Promise(function (resolve) {
      var settled = false;

      function settle(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }

      NS.modal.open({
        title: title,
        bodyHtml: bodyHtml,
        confirmText: confirmText,
        onConfirm: function (wrap) {
          var out = validate(wrap);
          if (out === false || out === undefined) return false; // 保持弹窗打开
          settle(out);
          return true;
        }
      });

      (function pollClosed() {
        if (settled) return;
        if (!document.getElementById("app-modal")) {
          settle(null);
          return;
        }
        setTimeout(pollClosed, 120);
      })();
    });
  }

  /** 通用确认弹窗（返回 Promise<true|null>） */
  function askConfirm(title, message, confirmText) {
    return modalResult(
      '<p class="admin-modal-text">' + esc(message) + "</p>",
      title,
      confirmText || "确定",
      function () {
        return true;
      }
    );
  }

  /** 驳回理由：必填 */
  function askReject() {
    return modalResult(
      '<div class="field"><label class="field__label" for="admin-reject-note">驳回理由<span class="req">*</span></label>' +
        '<textarea class="textarea admin-textarea" id="admin-reject-note" rows="4" placeholder="请说明驳回原因，将记录到审计日志并入档申请人回执"></textarea>' +
        '<div class="field__error" id="admin-reject-err"></div></div>',
      "驳回申请",
      "确认驳回",
      function (wrap) {
        var ta = wrap.querySelector("#admin-reject-note");
        var err = wrap.querySelector("#admin-reject-err");
        var v = ((ta && ta.value) || "").trim();
        if (!v) {
          if (err) err.textContent = "驳回理由为必填项";
          if (ta) ta.classList.add("is-error");
          if (ta) ta.focus();
          return false;
        }
        return v; // 字符串即理由
      }
    );
  }

  /** 调整点数：可负值 + 备注 */
  function askPoints(displayName, userId) {
    return modalResult(
      '<div class="field"><label class="field__label" for="admin-points-delta">增减值<span class="req">*</span></label>' +
        '<input class="input" id="admin-points-delta" type="text" inputmode="numeric" placeholder="例如 500 或 -200" autocomplete="off">' +
        '<div class="field__hint">正数为增加，负数为扣减；范围 -1000000 ~ 1000000。</div>' +
        '<div class="field__error" id="admin-points-err"></div></div>' +
        '<div class="field"><label class="field__label" for="admin-points-memo">备注</label>' +
        '<input class="input" id="admin-points-memo" type="text" maxlength="120" placeholder="记录用途，便于审计追溯" autocomplete="off"></div>',
      "调整点数 · " + displayName,
      "确认调整",
      function (wrap) {
        var input = wrap.querySelector("#admin-points-delta");
        var err = wrap.querySelector("#admin-points-err");
        var raw = ((input && input.value) || "").trim();
        var n = Number(raw);
        if (!raw || !isFinite(n) || Math.floor(n) !== n) {
          if (err) err.textContent = "请输入整数增减值（可为负数）";
          if (input) input.classList.add("is-error");
          return false;
        }
        if (n === 0) {
          if (err) err.textContent = "增减值不能为 0";
          if (input) input.classList.add("is-error");
          return false;
        }
        if (n < -1000000 || n > 1000000) {
          if (err) err.textContent = "增减值超出允许范围";
          if (input) input.classList.add("is-error");
          return false;
        }
        var memoEl = wrap.querySelector("#admin-points-memo");
        return { delta: n, memo: String((memoEl && memoEl.value) || "").trim(), userId: userId };
      }
    );
  }

  /** 收录稿件：可选备注 + 奖励点数（投稿者在册时才会实际发放） */
  function askSubApprove(nickname) {
    return modalResult(
      '<div class="field"><label class="field__label" for="admin-sub-reward">奖励点数</label>' +
        '<input class="input" id="admin-sub-reward" type="text" inputmode="numeric" value="50" autocomplete="off">' +
        '<div class="field__hint">投稿者为在册员工时打入其账户；游客投稿自动跳过。0 表示不奖励。</div>' +
        '<div class="field__error" id="admin-sub-reward-err"></div></div>' +
        '<div class="field"><label class="field__label" for="admin-sub-note">收录备注</label>' +
        '<input class="input" id="admin-sub-note" type="text" maxlength="200" placeholder="选填，记录到档案" autocomplete="off"></div>',
      "收录稿件 · " + nickname,
      "确认收录",
      function (wrap) {
        var input = wrap.querySelector("#admin-sub-reward");
        var err = wrap.querySelector("#admin-sub-reward-err");
        var raw = ((input && input.value) || "").trim();
        var n = raw === "" ? 0 : Number(raw);
        if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n > 100000) {
          if (err) err.textContent = "请输入 0–100000 的整数";
          if (input) input.classList.add("is-error");
          return false;
        }
        var noteEl = wrap.querySelector("#admin-sub-note");
        return { reward: n, note: String((noteEl && noteEl.value) || "").trim() };
      }
    );
  }

  /** 不收录稿件：理由必填 */
  function askSubReject(nickname) {
    return modalResult(
      '<div class="field"><label class="field__label" for="admin-subrej-note">不收录原因<span class="req">*</span></label>' +
        '<textarea class="textarea admin-textarea" id="admin-subrej-note" rows="3" placeholder="将记录到档案，便于后续追溯"></textarea>' +
        '<div class="field__error" id="admin-subrej-err"></div></div>',
      "不收录稿件 · " + nickname,
      "确认不收录",
      function (wrap) {
        var ta = wrap.querySelector("#admin-subrej-note");
        var err = wrap.querySelector("#admin-subrej-err");
        var v = ((ta && ta.value) || "").trim();
        if (!v) {
          if (err) err.textContent = "请填写原因";
          if (ta) ta.classList.add("is-error");
          if (ta) ta.focus();
          return false;
        }
        return v;
      }
    );
  }

  /** 新建管理账号：角色下拉仅 site_admin / chief_secretary */
  function askCreateUser() {
    return modalResult(
      '<div class="field"><label class="field__label" for="admin-nu-username">账号<span class="req">*</span></label>' +
        '<input class="input" id="admin-nu-username" type="text" maxlength="16" placeholder="3–16 位，字母开头" autocomplete="off">' +
        '<div class="field__error" data-err="username"></div></div>' +
        '<div class="field"><label class="field__label" for="admin-nu-display">昵称<span class="req">*</span></label>' +
        '<input class="input" id="admin-nu-display" type="text" maxlength="16" placeholder="2–16 个字" autocomplete="off">' +
        '<div class="field__error" data-err="display_name"></div></div>' +
        '<div class="field"><label class="field__label" for="admin-nu-password">密码<span class="req">*</span></label>' +
        '<input class="input" id="admin-nu-password" type="password" placeholder="需满足强度要求" autocomplete="new-password">' +
        '<div class="field__error" data-err="password"></div></div>' +
        '<div class="field"><label class="field__label" for="admin-nu-role">角色<span class="req">*</span></label>' +
        '<select class="select" id="admin-nu-role">' +
        '<option value="site_admin">网站管理员</option>' +
        '<option value="chief_secretary">首席执行秘书办</option>' +
        "</select>" +
        '<div class="field__hint">网站管理员不开放注册，仅可在此创建。员工与 AI 高管不在本入口创建（AI 高管为系统内置账号）。</div>' +
        '<div class="field__error" data-err="role"></div></div>',
      "新建管理账号",
      "创建账号",
      function (wrap) {
        var body = {
          username: ((wrap.querySelector("#admin-nu-username") || {}).value || "").trim(),
          display_name: ((wrap.querySelector("#admin-nu-display") || {}).value || "").trim(),
          password: (wrap.querySelector("#admin-nu-password") || {}).value || "",
          role: (wrap.querySelector("#admin-nu-role") || {}).value || ""
        };
        wrap.querySelectorAll("[data-err]").forEach(function (el) {
          el.textContent = "";
        });
        var problems = [];
        if (!body.username) problems.push("username");
        if (!body.display_name) problems.push("display_name");
        if (!body.password) problems.push("password");
        if (["site_admin", "chief_secretary"].indexOf(body.role) < 0) problems.push("role");
        if (problems.length) {
          problems.forEach(function (f) {
            var el = wrap.querySelector('[data-err="' + f + '"]');
            if (el) el.textContent = "此项为必填";
          });
          return false;
        }
        return { body: body, wrap: wrap };
      }
    );
  }

  /* ------------------------------ 交互：动作 ------------------------------ */

  function apiError(err, fallback) {
    NS.toast.error((err && err.message) || fallback || "操作失败");
    return err;
  }

  function reviewRequest(id, decision) {
    var flow;
    if (decision === "reject") {
      flow = askReject().then(function (note) {
        return note ? { note: note } : null;
      });
    } else {
      flow = askConfirm(
        "通过申请",
        "通过后该申请人将直接更新为申请中的部门与岗位，并转为在职状态。是否继续？",
        "确认通过"
      ).then(function (yes) {
        return yes ? { note: "" } : null;
      });
    }
    return flow
      .then(function (payload) {
        if (!payload) return null;
        return api.post("/api/admin/requests/" + id + "/review", {
          decision: decision,
          note: payload.note
        });
      })
      .then(function (res) {
        if (!res) return;
        if (res.ok) {
          NS.toast.success(decision === "approve" ? "已通过该申请" : "已驳回该申请");
          loadTab("requests", { silent: true });
        } else {
          apiError(res.error, "审批失败");
        }
      });
  }

  function saveSettings() {
    var form = rootEl && rootEl.querySelector("#admin-settings-form");
    if (!form) return;
    var items = [];
    form.querySelectorAll("[data-key]").forEach(function (input) {
      var now = input.value == null ? "" : String(input.value);
      var before = input.getAttribute("data-original") || "";
      if (now !== before) items.push({ key: input.getAttribute("data-key"), value: now });
    });
    if (!items.length) {
      NS.toast.info("没有检测到改动，未提交任何配置");
      return;
    }
    api.patch("/api/admin/settings", { items: items }).then(function (res) {
      if (res.ok) {
        NS.toast.success("备案信息已更新");
        tabData.settings = { data: res.data, error: null };
        NS.router.resolve();
      } else {
        apiError(res.error, "配置保存失败");
      }
    });
  }

  function syncSettingsDirty() {
    if (!rootEl) return;
    var form = rootEl.querySelector("#admin-settings-form");
    if (!form) return;
    var changed = 0;
    form.querySelectorAll("[data-key]").forEach(function (input) {
      var now = input.value == null ? "" : String(input.value);
      var before = input.getAttribute("data-original") || "";
      input.classList.toggle("is-dirty", now !== before);
      if (now !== before) changed++;
    });
    var btn = form.querySelector('[data-act="settings-save"]');
    if (btn) btn.disabled = changed === 0;
    var note = rootEl.querySelector("#admin-settings-dirty");
    if (note) {
      note.textContent = changed
        ? "已修改 " + changed + " 项，保存时仅提交这些项。"
        : "未修改任何配置项，保存按钮不会提交数据。";
    }
  }

  function createUser() {
    askCreateUser().then(function (r) {
      if (!r) return;
      return api.post("/api/admin/users", r.body).then(function (res) {
        if (res.ok) {
          NS.toast.success("管理账号已创建");
          NS.modal.close();
          loadTab("users", { silent: true, force: true });
        } else {
          var fields = NS.api.fieldErrors(res.error);
          Object.keys(fields).forEach(function (k) {
            var el = r.wrap.querySelector('[data-err="' + k + '"]');
            if (el) el.textContent = fields[k];
          });
          if (!Object.keys(fields).length) apiError(res.error, "创建失败");
          else NS.toast.error((res.error && res.error.message) || "创建失败");
          return false;
        }
      });
    });
  }

  function saveOfficer(id) {
    if (!rootEl) return;
    var card = rootEl.querySelector('[data-officer="' + id + '"]');
    if (!card) return;

    var lv = card.querySelector('[data-field="authority_level"]');
    var ap = card.querySelector('[data-field="auto_post_interval_sec"]');
    var persona = card.querySelector('[data-field="persona"]');
    var voice = card.querySelector('[data-field="voice_lines"]');
    var topicsEl = card.querySelector('[data-field="post_topics"]');
    var topicsArr = String((topicsEl && topicsEl.value) || "")
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    var enabled = card.querySelector('[data-field="enabled"]');
    var canReview = card.querySelector('[data-field="can_review_mentions"]');

    var lvNum = Number((lv && lv.value || "").trim());
    var apNum = Number((ap && ap.value || "").trim());
    if (!isFinite(lvNum) || lvNum < 1 || lvNum > 10) {
      NS.toast.warn("职级须为 1–10 的整数");
      if (lv) lv.focus();
      return;
    }
    if (!isFinite(apNum) || apNum < 0 || apNum > 86400) {
      NS.toast.warn("自主发帖周期须为 0–86400 的整数秒");
      if (ap) ap.focus();
      return;
    }
    var lines = String((voice && voice.value) || "")
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (!lines.length) {
      NS.toast.warn("至少保留一条发言素材");
      if (voice) voice.focus();
      return;
    }

    api
      .post("/api/admin/ai-officers/" + id, {
        authority_level: lvNum,
        auto_post_interval_sec: apNum,
        persona: String((persona && persona.value) || ""),
        voice_lines: lines,
        post_topics: topicsArr,
        enabled: !!(enabled && enabled.checked),
        can_review_mentions: !!(canReview && canReview.checked)
      })
      .then(function (res) {
        if (res.ok) {
          NS.toast.success("AI 高管配置已保存");
          loadTab("officers", { silent: true, force: true });
        } else {
          apiError(res.error, "保存失败");
        }
      });
  }

  function logout() {
    askConfirm("退出登录", "退出后需要重新登录才能回到管理面板。是否继续？", "退出登录").then(function (yes) {
      if (!yes) return;
      api.post("/api/auth/logout", {}).then(function (res) {
        if (!res.ok) {
          NS.toast.warn((res.error && res.error.message) || "服务端登出未成功，本地会话已清除");
        }
        NS.store.dispatch({ type: "user/set", payload: null });
        NS.toast.info("已退出登录");
        NS.router.go("/login");
      });
    });
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function onRootClick(e) {
    // 先判 data-act：重试按钮同时带 data-tab（用于指明要重载哪个 tab），
    // 若先判 data-tab 会把「重试」误当成切换 tab，导致重试无效。
    var actEl = e.target.closest("[data-act]");
    if (!actEl) {
      var tabBtn = e.target.closest("[data-tab]");
      if (tabBtn) {
        selectTab(tabBtn.getAttribute("data-tab"));
        return;
      }
      var link = e.target.closest("a[href^='#']");
      if (link && link.getAttribute("href") === "#/login") NS.store.dispatch({ type: "user/set", payload: null });
      return;
    }

    var act = actEl.getAttribute("data-act");
    var id = actEl.getAttribute("data-id");

    if (act === "logout") return logout();
    if (act === "refresh") {
      delete tabData[activeTab];
      loadTab(activeTab, { force: true });
      return;
    }
    if (act === "retry") {
      var t = actEl.getAttribute("data-tab") || activeTab;
      delete tabData[t];
      loadTab(t);
      return;
    }
    if (act === "req-status") {
      reqStatus = actEl.getAttribute("data-value") || "pending";
      delete tabData.requests;
      loadTab("requests");
      return;
    }
    if (act === "mention-status") {
      mentionStatus = actEl.getAttribute("data-value") || "";
      delete tabData.mentions;
      loadTab("mentions");
      return;
    }
    if (act === "review-approve") return reviewRequest(id, "approve");
    if (act === "review-reject") return reviewRequest(id, "reject");
    if (act === "sub-status") {
      subStatus = actEl.getAttribute("data-value") || "pending";
      delete tabData.submissions;
      loadTab("submissions");
      return;
    }
    if (act === "sub-approve") {
      return askSubApprove(actEl.getAttribute("data-name") || "匿名干员").then(function (r) {
        if (!r) return;
        return api
          .post("/api/admin/submissions/" + id + "/review", { action: "approve", note: r.note, rewardPoints: r.reward })
          .then(function (res) {
            if (res.ok) {
              NS.toast.success("已收录" + (r.reward > 0 ? "，奖励点数 +" + r.reward : ""));
              delete tabData.submissions;
              loadTab("submissions", { force: true });
            } else {
              apiError(res.error, "收录失败");
            }
          });
      });
    }
    if (act === "sub-reject") {
      return askSubReject(actEl.getAttribute("data-name") || "匿名干员").then(function (note) {
        if (!note) return;
        return api
          .post("/api/admin/submissions/" + id + "/review", { action: "reject", note: note })
          .then(function (res) {
            if (res.ok) {
              NS.toast.success("已标记为不收录");
              delete tabData.submissions;
              loadTab("submissions", { force: true });
            } else {
              apiError(res.error, "操作失败");
            }
          });
      });
    }
    if (act === "sub-retry") {
      return api.post("/api/admin/submissions/webdav/retry", { ids: [Number(id)] }).then(function (res) {
        if (res.ok) {
          NS.toast.success("已重新排队，等待下一轮转存");
          delete tabData.submissions;
          loadTab("submissions", { force: true });
        } else {
          apiError(res.error, "操作失败");
        }
      });
    }
    if (act === "webdav-retry-all") {
      return api.post("/api/admin/submissions/webdav/retry", {}).then(function (res) {
        if (res.ok) {
          NS.toast.success("已重新排队 " + (res.data && res.data.count != null ? res.data.count : 0) + " 个失败文件");
          delete tabData.submissions;
          loadTab("submissions", { force: true });
        } else {
          apiError(res.error, "操作失败");
        }
      });
    }
    if (act === "settings-save") return saveSettings();
    if (act === "notice-new") {
      return askNotice(null).then(function (data) {
        if (!data) return;
        return saveNotice(null, data);
      });
    }
    if (act === "notice-edit") {
      var cur = ((tabData.notifications && tabData.notifications.data && tabData.notifications.data.items) || []).filter(function (x) {
        return String(x.id) === String(id);
      })[0];
      return askNotice(cur).then(function (data) {
        if (!data) return;
        return saveNotice(id, data);
      });
    }
    if (act === "notice-publish") {
      return askConfirm("发布通知", "发布后全体员工可在「通知」中看到。邮件推送需在发布后单独操作。", "确认发布").then(function (r) {
        if (!r) return;
        return api.post("/api/admin/notifications/" + id + "/publish", { pushMail: false }).then(function (res) {
          if (res.ok) {
            NS.toast.success("已发布");
            delete tabData.notifications;
            loadTab("notifications", { force: true });
          } else {
            apiError(res.error, "发布失败");
          }
        });
      });
    }
    if (act === "notice-push") {
      return askConfirm("推送邮件", "将向所有已订阅邮箱逐封发送该通知，可能耗时较久。确认推送？", "开始推送").then(function (r) {
        if (!r) return;
        NS.toast.info("正在推送，请稍候…");
        return api.post("/api/admin/notifications/" + id + "/push-mail", {}).then(function (res) {
          if (res.ok) {
            var m = res.data || {};
            NS.toast.success("推送完成：成功 " + (m.ok || 0) + " 封，失败 " + (m.fail || 0) + " 封");
            delete tabData.notifications;
            loadTab("notifications", { force: true });
          } else {
            apiError(res.error, "推送失败");
          }
        });
      });
    }
    if (act === "notice-mail-log") {
      return api.get("/api/admin/notifications/" + id + "/mail-log").then(function (res) {
        if (!res.ok) return apiError(res.error, "读取投递记录失败");
        var items = (res.data && res.data.items) || [];
        var html = items.length
          ? '<div class="admin-maillog">' +
            items
              .map(function (x) {
                return (
                  '<div class="admin-maillog__row">' +
                  '<span class="admin-maillog__addr">' + esc(x.to) + "</span>" +
                  '<span class="tag' + (x.ok ? " tag--ok" : "") + '">' + (x.ok ? "成功" : "失败") + "</span>" +
                  '<span class="admin-maillog__err mini-note">' + esc(x.error || util.dateTime(x.createdAt)) + "</span>" +
                  "</div>"
                );
              })
              .join("") +
            "</div>"
          : '<div class="mini-note">还没有投递记录。</div>';
        return modalResult(html, "邮件投递记录", "关闭", function () {
          return true;
        });
      });
    }
    if (act === "notice-del") {
      return askConfirm("删除通知", "删除后不可恢复，且会同时清除其邮件投递记录。", "确认删除").then(function (r) {
        if (!r) return;
        return api.del("/api/admin/notifications/" + id).then(function (res) {
          if (res.ok) {
            NS.toast.success("已删除");
            delete tabData.notifications;
            loadTab("notifications", { force: true });
          } else {
            apiError(res.error, "删除失败");
          }
        });
      });
    }
    if (act === "mail-test") {
      return api.post("/api/admin/mail/test", {}).then(function (res) {
        if (res.ok) {
          var m = res.data || {};
          if (m.ok) NS.toast.success("邮件服务正常：" + (m.message || ""));
          else NS.toast.error("连接失败：" + (m.message || "未知原因"));
        } else {
          apiError(res.error, "测试失败");
        }
      });
    }
    if (act === "user-create") return createUser();
    if (act === "user-points") {
      var uname = actEl.getAttribute("data-name") || "该账号";
      return askPoints(uname, id).then(function (r) {
        if (!r) return;
        return api.post("/api/admin/users/" + id + "/points", { delta: r.delta, memo: r.memo }).then(function (res) {
          if (res.ok) {
            NS.toast.success("点数已调整：" + (r.delta > 0 ? "+" : "") + r.delta);
            delete tabData.users;
            loadTab("users", { force: true });
          } else {
            apiError(res.error, "点数调整失败");
          }
        });
      });
    }
    if (act === "user-status") {
      var uname2 = actEl.getAttribute("data-name") || "该账号";
      var target = actEl.getAttribute("data-status");
      var verb = target === "suspended" ? "停用" : "启用";
      return askConfirm(
        verb + "账号",
        verb + "「" + uname2 + "」后" + (target === "suspended" ? "其全部会话会被立刻吊销。" : "该账号可重新登录。"),
        "确认" + verb
      ).then(function (yes) {
        if (!yes) return;
        return api.post("/api/admin/users/" + id + "/status", { status: target }).then(function (res) {
          if (res.ok) {
            NS.toast.success("账号已" + verb);
            delete tabData.users;
            loadTab("users", { force: true });
          } else {
            apiError(res.error, "状态修改失败");
          }
        });
      });
    }
    if (act === "officer-save") return saveOfficer(id);
  }

  function onRootInput(e) {
    if (e.target && e.target.closest && e.target.closest("#admin-settings-form")) syncSettingsDirty();
  }

  var userSearch = null;

  function onRootChange(e) {
    if (!e.target) return;
    if (e.target.id === "admin-user-role") {
      userQuery.role = e.target.value || "";
      delete tabData.users;
      loadTab("users");
      return;
    }
    if (e.target.id === "admin-user-q") {
      userQuery.q = e.target.value || "";
      if (userSearch) userSearch();
    }
  }

  function onRootKeyup(e) {
    if (e.target && e.target.id === "admin-user-q") {
      if (userSearch) userSearch();
    }
  }

  function selectTab(id) {
    if (TAB_IDS.indexOf(id) < 0 || id === activeTab) return;
    activeTab = id;
    writeHashTab(id);
    paintSide();
    paint();
    loadActive();
  }

  /** 把当前 tab 写到 hash 的 ?tab=，便于分享 / 刷新后停留 */
  function writeHashTab(id) {
    var hash = window.location.hash || "#/admin";
    var base = hash.split("?")[0];
    var next = base + (id === "overview" ? "" : "?tab=" + id);
    if (next !== hash) {
      try {
        history.replaceState(null, "", next);
      } catch (e) {
        /* file:// 或旧浏览器的安全限制：忽略 */
      }
    }
  }

  function readHashTab() {
    var hash = window.location.hash || "";
    var q = hash.split("?")[1] || "";
    var m = /(?:^|&)tab=([^&]+)/.exec(q);
    if (!m) return null;
    var v = decodeURIComponent(m[1]);
    return TAB_IDS.indexOf(v) >= 0 ? v : null;
  }

  /* ------------------------------ mount / unmount ------------------------------ */

  function mount(root, ctx) {
    rootEl = root;
    generation++;
    reset();

    if (!isAdmin()) return;

    var hashTab = readHashTab();
    if (hashTab) activeTab = hashTab;

    userSearch = util.debounce(function () {
      delete tabData.users;
      loadTab("users");
    }, 320);

    root.addEventListener("click", onRootClick);
    root.addEventListener("input", onRootInput);
    root.addEventListener("change", onRootChange);
    root.addEventListener("keyup", onRootKeyup);

    // 会话失效：交给 api.js 广播的 auth:expired
    offAuthExpired = util.bus.on("auth:expired", function () {
      if (!rootEl) return;
      generation++;
      rootEl.innerHTML =
        '<div class="admin-guard">' +
        NS.stateBlock({
          icon: "lock",
          title: "登录状态已失效",
          desc: "请重新登录后再访问管理面板。",
          actionHtml: '<a class="btn btn--primary" href="#/login">前往登录</a>'
        }) +
        "</div>";
    });

    // 管理员身份可能在 mount 前尚未写入 store（首次直达 #/admin）：
    // 由 app.js / 启动流程负责拉取 /api/me；此处若仍无 user，则自行补一次。
    var startLoad = function () {
      paintHeaderWho();
      loadActive();
    };
    var st = NS.store.getState();
    if (st.user) {
      startLoad();
      return;
    }

    // 首次直达 #/admin 时启动流程可能还没写入 user：自行补一次 /api/me。
    // 注意此时 render 已经把「仅管理员可访问」渲染出来了（因为 store 里没有 user）。
    api.get("/api/me").then(function (res) {
      if (!rootEl) return;

      var payload = res && res.ok && res.data ? res.data.user || res.data : null;
      var alreadyAdmin = NS.store.isAdmin && NS.store.isAdmin();
      if (payload && !alreadyAdmin) {
        NS.store.dispatch({ type: "user/set", payload: payload });
        if (NS.store.isAdmin && NS.store.isAdmin()) alreadyAdmin = true;
      }

      if (alreadyAdmin) {
        rootEl.innerHTML = render(ctx);
        startLoad();
      }
      // 仍非管理员：保持 render 渲染出的守卫生效（store 若变化会触发路由重绘）
    });
  }

  function unmount() {
    generation++;
    if (offAuthExpired) {
      offAuthExpired();
      offAuthExpired = null;
    }
    if (rootEl) {
      rootEl.removeEventListener("click", onRootClick);
      rootEl.removeEventListener("input", onRootInput);
      rootEl.removeEventListener("change", onRootChange);
      rootEl.removeEventListener("keyup", onRootKeyup);
    }
    rootEl = null;
    userSearch = null;
    reset();
  }

  NS.views = NS.views || {};
  NS.views.admin = { render: render, mount: mount, unmount: unmount };
})(window.HAAVK);
