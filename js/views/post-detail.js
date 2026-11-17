/* ==========================================================================
   views/post-detail.js — 帖子详情
   版式对齐活动页参考：作者信息条（头像 / 昵称 / 部门 / 角色徽章 / 装饰许可条）
                       正文 → 底部数据行（时间 / 点赞 / 回复）
                       右栏「员工论坛」相关帖与回复预览
                       @ 审核回执以状态行呈现
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;

  var STATUS_LABEL = { pending: "审核中", under_review: "审核中", approved: "已通过", rejected: "未通过" };

  /** 时间戳格式：09.29 03:13（网络参考实据：MM.DD HH:mm，无年份） */
  function stamp(ts) {
    var d = new Date(ts);
    var p = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return p(d.getMonth() + 1) + "." + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /**
   * 结论尾句不拆行：只在**渲染层**给固定尾句加不换行包裹，
   * 不改动服务端下发的文案本身（文案为硬约束，必须逐字一致）。
   */
  function noWrapTail(escapedMessage) {
    return String(escapedMessage).replace(/已自动转阅。/g, '<span class="nw">已自动转阅。</span>');
  }

  function avatar(url, size, extraClass) {
    return (
      '<img class="pd-avatar ' +
      (extraClass || "") +
      '" src="' +
      util.attr(NS.db.avatarOf(url)) +
      '" width="' +
      size +
      '" height="' +
      size +
      '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' +
      NS.api.defaultAvatar +
      "'\">"
    );
  }

  /** 昵称 + 部门 + 角色徽章 */
  function authorMeta(o, opts) {
    opts = opts || {};
    var badges = "";
    if (o.authorKind === "ai_officer") badges += '<span class="pd-badge pd-badge--officer">集团高管</span>';
    if (o.authorTitle) badges += '<span class="pd-badge">' + util.esc(o.authorTitle) + "</span>";
    return (
      '<div class="pd-author">' +
      avatar(o.authorAvatarUrl, opts.size || 52, opts.avatarClass) +
      '<div class="pd-author__text">' +
      '<div class="pd-author__name">' + util.esc(o.authorName) + "</div>" +
      (o.authorDepartment ? '<div class="pd-author__dept">' + util.esc(o.authorDepartment) + "</div>" : "") +
      (badges ? '<div class="pd-author__badges">' + badges + "</div>" : "") +
      "</div>" +
      (opts.permit === false
        ? ""
        : '<div class="pd-permit" aria-hidden="true"><div class="pd-permit__cn">情况许可</div><div class="pd-permit__en">OPERATION PERMIT</div></div>') +
      "</div>"
    );
  }

  /** @ 审核回执行（参考版式：发布方信息 + 状态 + 结论文案） */
  function receiptBlock(m) {
    var last = (m.receipts || [])[(m.receipts || []).length - 1];
    var message = last ? last.message : "";
    return (
      '<div class="pd-receipt mention-card" data-code="' + util.attr(m.code) + '">' +
      authorMeta(
        {
          authorAvatarUrl: m.officerAvatarUrl,
          authorName: m.officerName,
          authorDepartment: m.officerTitle || "首席执行秘书办",
          authorKind: "ai_officer",
          authorTitle: "审核席"
        },
        { size: 52, permit: false }
      ) +
      '<div class="pd-receipt__body">' +
      '<div class="pd-receipt__meta">' +
      '<span class="pd-badge' +
      (m.status === "approved" ? " pd-badge--ok" : m.status === "rejected" ? " pd-badge--no" : "") +
      '" data-role="status">' +
      util.esc(STATUS_LABEL[m.status] || m.status) +
      "</span>" +
      '<span class="pd-receipt__code">编号 ' + util.esc(m.code) + "</span>" +
      (m.assignedLabel ? '<span class="pd-receipt__code">分配 ' + util.esc(m.assignedLabel) + "</span>" : "") +
      "</div>" +
      '<p class="pd-receipt__text" data-role="message">' + noWrapTail(util.esc(message)) + "</p>" +
      "</div>" +
      "</div>"
    );
  }

  /** 单条回复模板：列表渲染与提交后局部插入共用，避免两套 HTML 走样 */
  function replyHtml(r) {
    return (
      '<article class="pd-reply">' +
      '<div class="pd-author pd-author--reply">' +
      avatar(r.authorAvatarUrl, 44) +
      '<div class="pd-author__text">' +
      '<div class="pd-author__name">' + util.esc(r.authorName) + "</div>" +
      (r.authorDepartment ? '<div class="pd-author__dept">' + util.esc(r.authorDepartment) + "</div>" : "") +
      (r.authorTitle
        ? '<div class="pd-author__badges"><span class="pd-badge' +
          (r.authorKind === "ai_officer" ? " pd-badge--officer" : "") +
          '">' +
          util.esc(r.authorTitle) +
          "</span></div>"
        : "") +
      "</div>" +
      "</div>" +
      '<div class="pd-reply__body">' + util.esc(r.body) + "</div>" +
      '<div class="pd-stat">' +
      '<span class="pd-stat__time">' + util.esc(stamp(r.createdAt)) + "</span>" +
      "</div>" +
      "</article>"
    );
  }

  /** 右栏「员工论坛」feed：作者优先条目（网络参考实据版式）
      条目 = 42×42 头像 + 元信息单行（昵称/部门/实心蓝徽章） + 正文全文 + 时间戳 */
  function sidePanel(posts) {
    /* 首次渲染时右栏数据还没回来：先给骨架，避免先闪一次「暂无相关内容」再被替换 */
    if (posts === null) {
      return (
        '<aside class="pd-side">' +
        '<div class="pd-side__title-bar">员工论坛</div>' +
        '<div class="pd-side__list">' + NS.skeletonRows(3, 96) + "</div>" +
        "</aside>"
      );
    }
    var rows = posts
      .slice(0, 6)
      .map(function (p) {
        return (
          '<a class="pd-side__item" href="#/post/' + util.attr(p.id) + '">' +
          '<img class="pd-side__avatar" src="' + util.attr(NS.db.avatarOf(p.authorAvatarUrl)) + '" width="42" height="42" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + NS.api.defaultAvatar + "'\">" +
          '<div class="pd-side__main">' +
          '<div class="pd-side__meta">' +
          '<span class="pd-side__name">' + util.esc(p.authorName || "") + "</span>" +
          (p.authorDepartment ? '<span class="pd-side__dept">' + util.esc(p.authorDepartment) + "</span>" : "") +
          (p.authorTitle ? '<span class="pd-badge">' + util.esc(p.authorTitle) + "</span>" : "") +
          "</div>" +
          '<p class="pd-side__body">' + util.esc(p.excerpt || "") + "</p>" +
          '<div class="pd-side__time">' + util.esc(stamp(p.createdAt)) + "</div>" +
          "</div>" +
          "</a>"
        );
      })
      .join("");

    return (
      '<aside class="pd-side">' +
      '<div class="pd-side__title-bar">员工论坛</div>' +
      '<div class="pd-side__list">' + (rows || '<div class="mini-note" style="padding:12px 0">暂无相关内容</div>') + "</div>" +
      "</aside>"
    );
  }

  function render(ctx) {
    return (
      '<div class="shell" style="padding-top:var(--sp-6)" id="post-root" data-post-id="' + util.attr(ctx.params.id) + '">' +
      '<div style="margin-bottom:14px"><a class="link" href="#/forum">&lsaquo; 返回员工论坛</a></div>' +
      '<div id="post-host">' + NS.loadingBlock("正在读取帖子…") + "</div>" +
      "</div>"
    );
  }

  function mount(root, ctx) {
    var id = ctx.params.id;
    var host = root.querySelector("#post-host");
    var timers = [];

    function load() {
      host.innerHTML = NS.loadingBlock("正在读取帖子…");
      NS.db.getPost(id).then(function (res) {
        if (!res.ok) {
          host.innerHTML = NS.stateBlock({
            icon: "warn",
            title: res.error.code === "NOT_FOUND" ? "帖子不存在或已被删除" : "帖子加载失败",
            desc: res.error.message,
            actionHtml:
              '<a class="btn btn--primary" href="#/forum">返回员工论坛</a>' +
              '<button type="button" class="btn btn--ghost" id="post-retry" style="margin-left:10px">重试</button>'
          });
          var retry = root.querySelector("#post-retry");
          if (retry) retry.addEventListener("click", load);
          return;
        }
        paint(res.data);
      });
    }

    function paint(data) {
      var post = data.post;
      var replies = data.replies || [];
      var mentions = data.mentions || [];
      // 打开帖子即视为已读（记录当前回复数，供论坛列表「全新未读/有未读回复」判断）
      if (NS.forumRead) NS.forumRead.markRead(post.id, post.replyCount || 0);
      var user = NS.store.getState().user;
      var rules = NS.db.pointsRules();
      var mine = user && post.authorId === user.id;

      var receiptsHtml = mentions.length
        ? '<section class="pd-receipts">' + mentions.map(receiptBlock).join("") + "</section>"
        : "";

      var repliesHtml = replies.length
        ? replies.map(replyHtml).join("")
        : NS.stateBlock({
            icon: "doc",
            title: "暂无回复",
            desc: user ? "来说点什么吧。" : "登录后即可参与讨论。"
          });

      var composer;
      if (!user) {
        composer =
          '<div class="pd-composer">' +
          NS.stateBlock({
            icon: "lock",
            title: "登录后即可回复",
            desc: "参与论坛讨论需要先登录。",
            actionHtml:
              '<a class="btn btn--primary" href="#/login?redirect=%2Fpost%2F' +
              encodeURIComponent(id) +
              '">去登录</a> <a class="btn btn--ghost" href="#/register" style="margin-left:10px">注册新账号</a>'
          }) +
          "</div>";
      } else if (user.status !== "active") {
        composer =
          '<div class="pd-composer"><div class="banner">你尚未完成入职手续，暂时无法回复。<a class="link" href="#/onboarding">前往办理入职</a></div></div>';
      } else {
        composer =
          '<div class="pd-composer">' +
          '<div class="field" style="margin-bottom:10px">' +
          '<label class="field__label" for="reply-body">发表回复</label>' +
          '<textarea class="textarea" id="reply-body" style="min-height:104px" maxlength="1000" placeholder="回复消耗 ' +
          rules.replyCost +
          ' 点注意力；输入 @ 可呼叫集团高级管理人员。"></textarea>' +
          '<div class="field__hint"><span id="reply-count">0</span>/1000</div>' +
          '<div class="field__error" id="reply-error"></div>' +
          "</div>" +
          '<div class="pd-composer__bar">' +
          '<span class="pd-stat__time">余额 <span class="u-num" id="reply-balance">' +
          util.thousands(user.pointsBalance || 0) +
          "</span> 点</span>" +
          '<button type="button" class="btn btn--primary btn--sm" id="reply-submit">' +
          icon("speaker", "", 14) +
          " 回复</button>" +
          "</div>" +
          "</div>";
      }

      host.innerHTML =
        '<div class="pd-layout">' +
        '<div class="pd-main">' +
        // 帖子卡
        '<article class="pd-post">' +
        authorMeta(post) +
        '<h1 class="pd-post__title" id="pd-title">' +
        (post.tag ? '<span class="pd-post__tag">' + util.esc(post.tag) + "</span> " : "") +
        (post.isPinned ? '<span class="pd-post__tag pd-post__tag--pin">置顶</span> ' : "") +
        util.esc(post.title) +
        "</h1>" +
        '<div class="pd-post__body">' + util.esc(post.body) + "</div>" +
        '<div class="pd-stat pd-stat--post">' +
        '<span class="pd-stat__time">' + util.esc(stamp(post.createdAt)) + "</span>" +
        '<button type="button" class="pd-stat__btn' + (post.liked ? " is-on" : "") + '" id="like-btn" title="点赞">' +
        icon("thumb", "", 15) +
        '<span id="like-count">' + util.esc(String(post.likeCount || 0)) + "</span></button>" +
        '<span class="pd-stat__btn" title="回复数">' + icon("chat", "", 15) + util.esc(String(post.replyCount || 0)) + "</span>" +
        '<span class="pd-stat__btn" title="浏览数">' + icon("eye", "", 15) + util.esc(String(post.views || 0)) + "</span>" +
        (mine || NS.store.isAdmin()
          ? '<button type="button" class="pd-stat__btn" id="post-edit" style="margin-left:auto">编辑本帖</button>' +
            '<button type="button" class="pd-stat__btn" id="post-delete">删除本帖</button>'
          : "") +
        "</div>" +
        "</article>" +
        receiptsHtml +
        // 回复区
        '<section class="pd-replies">' +
        '<div class="pd-replies__head"><span>全部回复（' + replies.length + "）</span><span>按时间正序</span></div>" +
        repliesHtml +
        "</section>" +
        composer +
        "</div>" +
        sidePanel(loadSidePosts()) +
        "</div>";

      bindActions(post);
      if (mentions.some(function (m) { return m.status === "pending" || m.status === "under_review"; })) pollReceipts();
    }

    /** 右栏 feed：复用列表接口（最新发帖，参考 feed 含当前帖，不过滤），失败时静默降级 */
    var sideCache = null;
    function loadSidePosts() {
      return sideCache;
    }
    NS.api
      .get("/api/posts", { pageSize: 6 })
      .then(function (res) {
        /* 成功填充列表；失败也要替换掉骨架，降级为「暂无相关内容」而不是永久骨架 */
        sideCache = res.ok ? res.data.items || [] : [];
        var aside = host.querySelector(".pd-side");
        if (aside) {
          var wrap = document.createElement("div");
          wrap.innerHTML = sidePanel(sideCache);
          aside.parentNode.replaceChild(wrap.firstChild, aside);
        }
      });

    function bindActions(post) {
      var likeBtn = host.querySelector("#like-btn");
      if (likeBtn) {
        likeBtn.addEventListener("click", function () {
          var user = NS.store.getState().user;
          if (!user) {
            NS.toast.warn("登录后即可点赞");
            NS.router.go("/login", { redirect: "/post/" + id });
            return;
          }
          likeBtn.disabled = true;
          NS.db.toggleLike(id).then(function (res) {
            likeBtn.disabled = false;
            if (!res.ok) {
              NS.toast.error(res.error.message);
              return;
            }
            likeBtn.classList.toggle("is-on", res.data.liked);
            host.querySelector("#like-count").textContent = res.data.likeCount;
          });
        });
      }

      var body = host.querySelector("#reply-body");
      var count = host.querySelector("#reply-count");
      if (body && count) {
        body.addEventListener("input", function () {
          count.textContent = body.value.length;
        });
      }
      var submit = host.querySelector("#reply-submit");
      if (submit) {
        submit.addEventListener("click", function () {
          var errBox = host.querySelector("#reply-error");
          errBox.textContent = "";
          if (!body.value.trim()) {
            errBox.textContent = "请输入回复内容";
            return;
          }
          submit.disabled = true;
          submit.innerHTML = '<span class="spinner"></span> 提交中…';
          NS.db.createReply(id, body.value.trim()).then(function (res) {
            submit.disabled = false;
            submit.innerHTML = icon("speaker", "", 14) + " 回复";
            if (!res.ok) {
              errBox.textContent = res.error.message;
              NS.toast.error(res.error.message);
              return;
            }
            NS.toast.success("回复已提交");
            NS.db.refreshUser();
            /* 局部插入新回复：保留滚动位置、不重新请求整帖（重载会闪并丢阅读位置） */
            var list = host.querySelector(".pd-replies");
            var newReply = res.data && res.data.reply;
            if (list && newReply) {
              var emptyState = list.querySelector(".state");
              if (emptyState && emptyState.parentNode) emptyState.parentNode.removeChild(emptyState);
              var holder = document.createElement("div");
              holder.innerHTML = replyHtml(newReply);
              var node = holder.firstChild;
              list.appendChild(node);
              var head = list.querySelector(".pd-replies__head span");
              if (head) {
                head.textContent = "全部回复（" + list.querySelectorAll(".pd-reply").length + "）";
              }
              body.value = "";
              if (count) count.textContent = "0";
              var bal = host.querySelector("#reply-balance");
              if (bal && res.data.balance != null) bal.textContent = util.thousands(res.data.balance);
              var countBtn = host.querySelector('.pd-stat--post .pd-stat__btn[title="回复数"]');
              if (countBtn) {
                countBtn.innerHTML = icon("chat", "", 15) + String(list.querySelectorAll(".pd-reply").length);
              }
              node.scrollIntoView({ block: "nearest", behavior: "smooth" });
            } else {
              load();
            }
          });
        });
      }
      var editBtn = host.querySelector("#post-edit");
      if (editBtn) {
        editBtn.addEventListener("click", function () {
          NS.modal.open({
            title: "编辑本帖",
            confirmText: "保存",
            bodyHtml:
              '<div class="field"><label class="field__label" for="edit-title">标题<span class="req">*</span></label>' +
              '<input class="input" id="edit-title" type="text" maxlength="60" value="' +
              util.esc(post.title) +
              '"><div class="field__hint">4–60 字</div></div>' +
              '<div class="field" style="margin-top:12px"><label class="field__label" for="edit-body">正文<span class="req">*</span></label>' +
              '<textarea class="textarea" id="edit-body" style="min-height:180px" maxlength="4000">' +
              util.esc(post.body || "") +
              '</textarea><div class="field__hint"><span id="edit-count">' +
              String(post.body || "").length +
              '</span>/4000</div><div class="field__error" id="edit-error"></div></div>',
            onMount: function (w) {
              var ta = w.querySelector("#edit-body");
              var cnt = w.querySelector("#edit-count");
              ta.addEventListener("input", function () {
                cnt.textContent = ta.value.length;
              });
              ta.focus();
            },
            onConfirm: function (w) {
              var titleEl = w.querySelector("#edit-title");
              var bodyEl = w.querySelector("#edit-body");
              var err = w.querySelector("#edit-error");
              var title = titleEl.value.trim();
              var text = bodyEl.value.trim();
              err.textContent = "";
              if (Array.from(title).length < 4) {
                err.textContent = "标题至少 4 个字符";
                return false;
              }
              if (Array.from(text).length < 5) {
                err.textContent = "正文至少 5 个字符";
                return false;
              }
              NS.db.updatePost(id, { title: title, body: text, tag: post.tag || "" }).then(function (res) {
                if (!res.ok) {
                  err.textContent = res.error.message;
                  NS.toast.error(res.error.message);
                  return;
                }
                var saved = res.data && res.data.post;
                var t = host.querySelector("#pd-title");
                if (t) {
                  /* 保留标题前的标签/置顶徽标，只替换文字部分 */
                  var badges = t.querySelectorAll(".pd-post__tag");
                  var head = "";
                  for (var i = 0; i < badges.length; i++) head += badges[i].outerHTML + " ";
                  t.innerHTML = head + util.esc((saved && saved.title) || title);
                }
                var b = host.querySelector(".pd-post__body");
                if (b) b.textContent = (saved && saved.body) || text;
                NS.toast.success("已保存修改");
                NS.modal.close();
              });
              return false; /* 等接口结果再关闭弹层 */
            }
          });
        });
      }

      var del = host.querySelector("#post-delete");
      if (del) {
        del.addEventListener("click", function () {
          NS.modal.confirm("删除帖子", "删除后本帖及其全部回复都将被移除，且不可恢复。", function () {
            NS.db.deletePost(id).then(function (res) {
              if (res.ok) {
                NS.toast.success("帖子已删除");
                NS.router.go("/forum");
              } else {
                NS.toast.error(res.error.message);
              }
            });
          }, "删除");
        });
      }
    }

    function pollReceipts() {
      var tries = 0;
      var MAX_TRIES = 45; // 约 90 秒；超时后明确提示，避免卡片一直停在“审核中”
      var timer = setInterval(function () {
        tries++;
        var nodes = Array.prototype.slice.call(host.querySelectorAll(".mention-card"));
        /* 已出结论的卡片不再轮询，只盯着还在审核中的 */
        var pending = nodes.filter(function (n) {
          return !n.getAttribute("data-final");
        });
        if (!pending.length) {
          clearInterval(timer);
          return;
        }
        pending.forEach(function (node) {
          NS.db.getMention(node.getAttribute("data-code")).then(function (res) {
            if (!res.ok) return;
            var m = res.data.mention;
            var statusNode = node.querySelector('[data-role="status"]');
            var msgNode = node.querySelector('[data-role="message"]');
            var receipts = m.receipts || [];
            if (statusNode) {
              statusNode.textContent = STATUS_LABEL[m.status] || m.status;
              statusNode.className =
                "pd-badge" + (m.status === "approved" ? " pd-badge--ok" : m.status === "rejected" ? " pd-badge--no" : "");
            }
            if (msgNode && receipts.length) msgNode.textContent = receipts[receipts.length - 1].message;
            if (m.status !== "pending" && m.status !== "under_review") node.setAttribute("data-final", "1");
          });
        });
        if (tries >= MAX_TRIES) {
          clearInterval(timer);
          pending.forEach(function (node) {
            var msgNode = node.querySelector('[data-role="message"]');
            if (msgNode && !node.getAttribute("data-final")) {
              msgNode.textContent = "审核用时较长，稍后刷新本页即可查看结论。";
            }
          });
        }
      }, 2000);
      timers.push(timer);
    }

    load();

    return function cleanup() {
      timers.forEach(function (t) {
        clearInterval(t);
      });
      timers = [];
    };
  }

  NS.views = NS.views || {};
  NS.views.postDetail = { render: render, mount: mount, stamp: stamp };
})(window.HAAVK);
