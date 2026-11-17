/* ==========================================================================
   views/forum.js — 员工论坛列表
   版式基准：活动页参考截图
   侧栏（公告 + 舆情三条 + 发帖）/ 深灰表头表格 / 行首复选框 /
   底部「▲ 系统置顶 + 全新未读 / 有未读回复 / 全部已读」三筛选。
   无搜索框、无分页条；已读状态为纯 UI 偏好（localStorage）。
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;

  /* --------------------- 已读状态（纯 UI 偏好） ---------------------
   * readState: { [postId]: 已读时看到的回复数 }
   *   全新未读   = 从未打开过
   *   有未读回复 = 打开过，但之后回复数增加
   *   全部已读   = 打开过且回复数未变
   */
  var READ_KEY = "readState";
  var VIEW_KEY = "forumView"; // 返回论坛时恢复滚动位置与筛选

  function readMap() {
    return NS.persist.get(READ_KEY, {}) || {};
  }

  var forumRead = {
    isUnread: function (p) {
      return readMap()[p.id] === undefined;
    },
    hasNewReplies: function (p) {
      var seen = readMap()[p.id];
      return seen !== undefined && (p.replyCount || 0) > seen;
    },
    isRead: function (p) {
      return !this.isUnread(p) && !this.hasNewReplies(p);
    },
    unreadReplies: function (p) {
      var seen = readMap()[p.id];
      if (seen === undefined) return p.replyCount || 0;
      return Math.max(0, (p.replyCount || 0) - seen);
    },
    markRead: function (id, replyCount) {
      var m = readMap();
      m[id] = replyCount || 0;
      NS.persist.set(READ_KEY, m);
    },
    markUnread: function (id) {
      var m = readMap();
      delete m[id];
      NS.persist.set(READ_KEY, m);
    }
  };
  NS.forumRead = forumRead;

  /* ------------------------------- 侧栏 ------------------------------- */

  function sideCard(intro) {
    intro = intro || { sentiments: [] };
    return (
      '<aside class="panel">' +
      '<div class="panel__head">' +
      '<div class="panel__title">员工论坛 <span>EMPLOYEE FORUM</span></div>' +
      '<div class="panel__rule"></div>' +
      "</div>" +
      '<div class="panel__body" style="padding:0 10px">' +
      '<div class="side-card__notice">' +
      (intro.noticeTop ? "<p>" + util.esc(intro.noticeTop) + "</p>" : "") +
      (intro.notice ? "<p>" + util.esc(intro.notice) + "</p>" : "") +
      "</div>" +
      (intro.sentiments || [])
        .map(function (s) {
          return (
            '<div class="sentiment">' +
            '<div class="sentiment__icon">' +
            icon(s.icon || "speaker", "", 26) +
            "</div>" +
            "<div>" +
            '<div class="sentiment__title">' +
            util.esc(s.title) +
            "</div>" +
            '<div class="sentiment__desc">' +
            util.esc(s.description) +
            "</div>" +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="panel__foot" style="padding:0 8px 16px">' +
      '<a class="btn btn--block btn--flat" href="#/compose" id="forum-post-btn">发帖</a>' +
      "</div>" +
      "</aside>"
    );
  }

  /* ------------------------------- 表格 ------------------------------- */

  /**
   * 头像渲染统一入口：所有 <img> 都带 onerror 兜底到服务端默认头像，
   * 从机制上杜绝"头像全丢"。
   */
  function avatars(url, cls, size) {
    var src = NS.db.avatarOf(url);
    var fallback = NS.api.defaultAvatar;
    var dim = size ? ' style="width:' + size + "px;height:" + size + 'px"' : "";
    return (
      '<img class="' +
      cls +
      '" src="' +
      util.attr(src) +
      '"' +
      dim +
      ' alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' +
      fallback +
      "'\">"
    );
  }

  function rowHtml(p) {
    var unread = forumRead.isUnread(p);
    var fresh = forumRead.hasNewReplies(p);
    var checked = !unread && !fresh;
    /* 置顶行：无复选框，行首是大置顶图标（24×30 含底横杠）；普通行才是复选框 */
    var lead = p.isPinned
      ? '<span class="forum-row__pin forum-row__pin--big" title="置顶">' + icon("pin-top", "", 24) + "</span>"
      : '<input type="checkbox" class="row-check forum-row__check" data-check="' + util.attr(p.id) + '"' +
        (checked ? " checked" : "") + ' aria-label="标记已读">';
    return (
      '<article class="forum-row' + (p.isPinned ? " forum-row--pinned" : "") +
      (unread || fresh ? " is-unread" : "") + '" data-id="' + util.attr(p.id) + '">' +
      '<div class="forum-row__main">' +
      lead +
      '<a class="forum-row__title" href="#/post/' + util.attr(p.id) + '" title="' + util.attr(p.title) + '">' +
      util.esc(p.title) +
      "</a>" +
      "</div>" +
      '<div class="forum-row__author">' +
      avatars(p.authorAvatarUrl, "forum-row__avatar") +
      '<div style="min-width:0">' +
      '<div class="forum-row__author-name">' + util.esc(p.authorName) + "</div>" +
      '<div class="forum-row__author-dept">' + util.esc(p.authorDepartment || "员工") + "</div>" +
      "</div>" +
      "</div>" +
      '<div class="forum-row__replies">' +
      forumRead.unreadReplies(p) +
      '/<span class="u-num">' +
      (p.replyCount || 0) +
      "</span></div>" +
      '<div class="forum-row__last">' + (p.lastReplyBy ? util.esc(p.lastReplyBy) : "--") + "</div>" +
      "</article>"
    );
  }

  var FILTERS = [
    { key: "unread", label: "全新未读", test: function (p) { return forumRead.isUnread(p); } },
    { key: "newreply", label: "有未读回复", test: function (p) { return forumRead.hasNewReplies(p); } },
    { key: "read", label: "全部已读", test: function (p) { return forumRead.isRead(p); } }
  ];

  /**
   * @param {Array} items 已经按当前筛选条件过滤后的行数据
   * @param {string} activeFilter 当前选中的筛选键（仅用于底部高亮）
   */
  function tableHtml(items, activeFilter) {
    var head =
      '<div class="forum-table__head">' +
      "<div>标题</div><div>发帖人</div><div>回复</div><div>最后回复</div>" +
      "</div>";

    var f = null;
    FILTERS.forEach(function (it) {
      if (it.key === activeFilter) f = it;
    });

    var body;
    if (!items.length) {
      body = NS.stateBlock({
        icon: "doc",
        title: f ? "当前筛选下没有帖子" : "还没有帖子",
        desc: f ? "换个筛选条件看看。" : "发布第一条帖子，让更多人看到。",
        actionHtml: '<a class="btn btn--primary" href="#/compose">去发帖</a>'
      });
    } else {
      body = items.map(rowHtml).join("");
    }

    return (
      '<div class="forum-table">' + head + body + "</div>" +
      '<div class="forum-foot">' +
      '<span class="forum-foot__pin">' + icon("arrow-up", "", 13) + " 系统置顶</span>" +
      '<i class="forum-foot__sep"></i>' +
      FILTERS.map(function (it, i) {
        return (
          (i > 0 ? '<i class="forum-foot__sep"></i>' : "") +
          '<button type="button" class="filter-item' +
          (it.key === activeFilter ? " is-active" : "") +
          '" data-filter="' + it.key + '">' + it.label + "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  /* ------------------------------- 视图 ------------------------------- */

  function render(ctx) {
    var site = NS.db.site() || {};
    return (
      '<div class="shell layout-2col layout-2col--top">' +
      sideCard(site.forumIntro) +
      '<div class="list-main">' +
      '<div id="forum-list-host">' + NS.skeletonRows(6) + "</div>" +
      "</div>" +
      "</div>"
    );
  }

  var PAGE_SIZE = 50; // 与服务端 PAGE_SIZE_MAX 保持一致

  function mount(root) {
    var host = root.querySelector("#forum-list-host");
    /* 服务端分页状态：滚动到底部自动续取下一页，不新增可见分页控件（参考图底部无分页条） */
    var state = { page: 1, items: [], total: 0, done: false, loading: false, failed: false };
    var activeFilter = "unread"; // 参考初始态：「全新未读」选中（实心蓝方块）
    /* 从帖子详情返回论坛时恢复原来的滚动位置，翻阅长列表时不被打断 */
    var savedView = NS.persist.get(VIEW_KEY, null) || null;
    var pendingScroll = savedView && savedView.filter === activeFilter && savedView.scrollTop > 120 ? savedView : null;
    var lastY = window.scrollY;
    function rememberView() {
      NS.persist.set(VIEW_KEY, {
        scrollTop: lastY,
        filter: activeFilter,
        count: state.items.length
      });
    }
    function filtered() {
      var f = null;
      FILTERS.forEach(function (it) {
        if (it.key === activeFilter) f = it;
      });
      return f ? state.items.filter(f.test) : state.items.slice();
    }

    function moreHint() {
      if (state.loading) {
        return '<div class="forum-more"><span class="spinner"></span> 正在加载更多…</div>';
      }
      if (state.failed) {
        return '<div class="forum-more forum-more--err"><span>加载失败</span>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="more-retry">重试</button></div>';
      }
      if (state.done && state.items.length) {
        return '<div class="forum-more">已显示全部 ' + state.items.length + " 条</div>";
      }
      return '<div class="forum-more">继续下滑加载更多</div>';
    }

    function paint() {
      var rows = filtered();
      /* 筛选后为空时不追加翻页提示，空态本身已给出下一步引导 */
      host.innerHTML = tableHtml(rows, activeFilter) + (rows.length ? moreHint() : "");

      host.querySelectorAll("[data-filter]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var key = btn.getAttribute("data-filter");
          activeFilter = activeFilter === key ? "" : key;
          paint();
        });
      });

      host.querySelectorAll("[data-check]").forEach(function (box) {
        box.addEventListener("change", function () {
          var id = box.getAttribute("data-check");
          var post = state.items.filter(function (p) {
            return String(p.id) === id;
          })[0];
          if (box.checked) forumRead.markRead(id, post ? post.replyCount : 0);
          else forumRead.markUnread(id);
          paint();
        });
      });

      var retry = host.querySelector("#more-retry");
      if (retry) {
        retry.addEventListener("click", function () {
          state.failed = false;
          load(false);
        });
      }
    }

    function load(reset) {
      if (state.loading) return;
      state.loading = true;
      state.failed = false;
      if (reset) {
        state.page = 1;
        state.items = [];
        state.total = 0;
        state.done = false;
        host.innerHTML = NS.skeletonRows(6);
      } else {
        paint(); // 立即显示「正在加载更多…」
      }
      NS.api
        .get("/api/posts", { page: state.page, pageSize: PAGE_SIZE })
        .then(function (res) {
          state.loading = false;
          if (!res.ok) {
            state.failed = true;
            if (reset) {
              host.innerHTML = NS.stateBlock({
                icon: "warn",
                title: "论坛数据加载失败",
                desc: res.error.message,
                actionHtml: '<button class="btn btn--primary" id="forum-retry">重试</button>'
              });
              var retry = host.querySelector("#forum-retry");
              if (retry) retry.addEventListener("click", function () { load(true); });
            } else {
              paint();
            }
            return;
          }
          var data = res.data || {};
          var incoming = data.items || [];
          state.items = reset ? incoming : state.items.concat(incoming);
          state.total = data.total || 0;
          state.page = (data.page || state.page) + 1;
          state.done = !incoming.length || state.items.length >= state.total;
          paint();
          /* 恢复上次浏览位置：先补齐到当时的条数，再滚回原处 */
          if (pendingScroll) {
            if (state.items.length < pendingScroll.count && !state.done) {
              load(false);
              return;
            }
            var restoreY = pendingScroll.scrollTop;
            pendingScroll = null;
            lastY = restoreY;
            window.scrollTo(0, restoreY);
            return;
          }
          /* 首屏没填满一屏时继续取，避免用户看到半页空白还要手动下滑 */
          if (!state.done && window.innerHeight + window.scrollY >= document.body.scrollHeight - 240) {
            load(false);
          }
        });
    }

    var scrollTimer = null;
    function onScroll() {
      /* 只同步记录真实滚动位置；持久化放到 cleanup，避免依赖定时器 */
      lastY = window.scrollY > 0 || lastY === 0 ? window.scrollY : lastY;
      if (scrollTimer || state.loading || state.done || state.failed) return;
      if (window.innerHeight + window.scrollY < document.body.scrollHeight - 300) return;
      scrollTimer = setTimeout(function () {
        scrollTimer = null;
        if (!state.loading && !state.done && !state.failed) load(false);
      }, 120);
    }
    window.addEventListener("scroll", onScroll, { passive: true });

    load(true);

    /* 侧栏右缘的蓝色滚动指示条（参考活动页版式），卸载时移除监听 */
    var unmountThumb = NS.mountScrollThumb(root.querySelector(".list-main"));
    return function cleanup() {
      window.removeEventListener("scroll", onScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
      rememberView();
      unmountThumb();
    };
  }

  NS.views = NS.views || {};
  NS.views.forum = { render: render, mount: mount, avatars: avatars };
})(window.HAAVK);
