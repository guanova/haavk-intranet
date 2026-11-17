/* ==========================================================================
   views/compose.js — 发帖（@ 呼叫 + 审核回执实时呈现）
   · 输入 @ 弹出高管候选，选中即插入 @代号
   · 发布时服务端同步返回回执（审核中 / 未通过），并在后台推进为通过或驳回
   · 页面内轮询审核状态，三条回执文案均由服务端下发，前端不做任何改写
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;

  var drafts = { title: "", body: "", boardId: 0, tag: "" };

  function boards() {
    return NS.store.getState().boards || [];
  }

  function tags() {
    return ["公告", "建议", "求助", "讨论", "活动通知", "表彰", "提案", "新人报道"];
  }

  function render(ctx) {
    var rules = NS.db.pointsRules();
    var boardList = boards();
    var preselect = ctx.query.board ? NS.db.boardBySlug(ctx.query.board) : null;

    return (
      '<div class="shell" style="padding-top:var(--sp-6)">' +
      '<div style="margin-bottom:14px"><a class="link" href="#/forum">&lsaquo; 返回员工论坛</a></div>' +
      '<div class="compose-grid">' +
      '<section class="compose-card">' +
      '<div class="panel__title">发布新帖 <span>NEW THREAD</span></div>' +
      '<div class="panel__rule"></div>' +
      '<div style="margin-top:22px">' +

      '<div class="field">' +
      '<label class="field__label">所属板块<span class="req">*</span></label>' +
      '<div class="chip-row" id="board-row">' +
      boardList
        .map(function (b) {
          var active = preselect ? preselect.id === b.id : false;
          return (
            '<button type="button" class="choice' +
            (active ? " is-checked" : "") +
            '" data-board="' + util.attr(b.id) + '" title="' + util.attr(b.description || "") + '">' +
            util.esc(b.name) +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="field__error" id="err-board"></div>' +
      "</div>" +

      '<div class="field">' +
      '<label class="field__label">标签（可选）</label>' +
      '<div class="chip-row" id="tag-row">' +
      tags()
        .map(function (t) {
          return '<button type="button" class="choice" data-tag="' + util.attr(t) + '">[' + util.esc(t) + "]</button>";
        })
        .join("") +
      "</div>" +
      "</div>" +

      '<div class="field">' +
      '<label class="field__label" for="f-title">标题<span class="req">*</span></label>' +
      '<input class="input" id="f-title" type="text" maxlength="60" placeholder="4–60 字，简要概括你的问题或观点" value="' +
      util.attr(drafts.title) +
      '">' +
      '<div class="field__hint"><span id="title-count">0</span>/60（至少 4 字）</div>' +
      '<div class="field__error" id="err-title"></div>' +
      "</div>" +

      '<div class="field">' +
      '<label class="field__label" for="f-body">正文<span class="req">*</span></label>' +
      '<textarea class="textarea" id="f-body" maxlength="4000" placeholder="请描述具体诉求。需要集团高级管理人员关注时，可输入 @ 呼叫。">' +
      util.esc(drafts.body) +
      "</textarea>" +
      '<div class="field__hint"><span id="body-count">0</span>/4000 · 输入 @ 可呼叫集团高级管理人员</div>' +
      '<div class="field__error" id="err-body"></div>' +
      "</div>" +

      '<div class="panel" id="mention-hint" style="padding:12px 14px;margin-bottom:16px;display:none">' +
      '<div class="mini-note" id="mention-hint-text" style="line-height:1.9"></div>' +
      "</div>" +

      '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<button type="button" class="btn btn--primary" id="publish-btn">发布帖子</button>' +
      '<button type="button" class="btn btn--ghost" id="draft-btn">保存草稿</button>' +
      '<span class="mini-note">发布消耗 <span class="u-num" id="post-cost">' + rules.postCost + "</span> 点注意力 · 当前余额 <span class=\"u-num\" id=\"compose-balance\">" +
      (NS.store.getState().user ? NS.store.getState().user.pointsBalance : 0) +
      "</span> 点</span>" +
      "</div>" +
      "</div>" +
      "</section>" +

      '<aside>' +
      '<div class="compose-tip">' +
      "<strong>发帖须知</strong><br>" +
      "1. 请按板块发帖，公告、物资与后勤内容请勿混发；<br>" +
      "2. 曼德尔砖智能系统会自动检测舆情特征；<br>" +
      "3. 发帖扣除 " + rules.postCost + " 点，回复扣除 " + rules.replyCost + " 点注意力；<br>" +
      "4. 呼叫集团高级管理人员须经首席执行秘书办审核。" +
      "</div>" +
      '<div id="mention-panel" style="margin-top:16px"></div>' +
      "</aside>" +
      "</div>" +
      "</div>"
    );
  }

  function mount(root) {
    var user = NS.store.getState().user;
    var boardId = drafts.boardId || 0;
    var tag = drafts.tag || "";
    var title = root.querySelector("#f-title");
    var body = root.querySelector("#f-body");
    var hint = root.querySelector("#mention-hint");
    var hintText = root.querySelector("#mention-hint-text");
    var panel = root.querySelector("#mention-panel");
    var rules = NS.db.pointsRules();
    var targets = [];
    var pollTimers = [];

    function syncCount() {
      root.querySelector("#title-count").textContent = title.value.length;
      root.querySelector("#body-count").textContent = body.value.length;
    }
    title.addEventListener("input", syncCount);
    body.addEventListener("input", syncCount);
    syncCount();

    // 板块 / 标签
    root.querySelectorAll("#board-row .choice").forEach(function (btn) {
      if (btn.classList.contains("is-checked")) boardId = Number.parseInt(btn.getAttribute("data-board"), 10);
      btn.addEventListener("click", function () {
        root.querySelectorAll("#board-row .choice").forEach(function (b) {
          b.classList.remove("is-checked");
        });
        btn.classList.add("is-checked");
        boardId = Number.parseInt(btn.getAttribute("data-board"), 10);
        drafts.boardId = boardId;
        root.querySelector("#err-board").textContent = "";
      });
    });
    root.querySelectorAll("#tag-row .choice").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.classList.contains("is-checked")) {
          btn.classList.remove("is-checked");
          tag = "";
        } else {
          root.querySelectorAll("#tag-row .choice").forEach(function (b) {
            b.classList.remove("is-checked");
          });
          btn.classList.add("is-checked");
          tag = btn.getAttribute("data-tag");
        }
        drafts.tag = tag;
      });
    });

    // 加载高管候选用于 @ 提示
    NS.db.loadMentionTargets().then(function (res) {
      if (!res.ok) return;
      targets = res.data.items || [];
      updateMentionHint();
    });

    function updateMentionHint() {
      var mentioned = detectMentions(body.value);
      var matched = mentioned
        .map(function (name) {
          return targets.filter(function (t) {
            return t.codename === name || t.codename.slice(-name.length) === name;
          })[0];
        })
        .filter(Boolean);
      if (!matched.length) {
        hint.style.display = "none";
        return;
      }
      hint.style.display = "";
      hintText.innerHTML =
        "将呼叫：" +
        matched
          .map(function (m) {
            return (
              "<strong>" +
              util.esc(m.codename) +
              "</strong>（" +
              util.esc(m.title || "集团高级管理人员") +
              "）"
            );
          })
          .join("、") +
        "<br>呼叫须经首席执行秘书办审核，审核结论将以回执形式在本帖呈现。" +
        (matched.length > (resRules().maxPerPost || 3)
          ? '<br><span style="color:var(--c-danger)">单帖最多呼叫 ' + (resRules().maxPerPost || 3) + " 位，超出将被驳回。</span>"
          : "");
    }

    function resRules() {
      var s = NS.db.settings();
      return (s && s.mention) || { maxPerPost: 3, cooldownSec: 60, hourlyLimit: 5 };
    }

    body.addEventListener("input", util.debounce(updateMentionHint, 200));

    // 草稿
    root.querySelector("#draft-btn").addEventListener("click", function () {
      drafts.title = title.value;
      drafts.body = body.value;
      NS.toast.success("草稿已保存到本地浏览器");
    });
    var saved = NS.persist.get("composeDraft", null);
    if (saved && !title.value && !body.value) {
      title.value = saved.title || "";
      body.value = saved.body || "";
      syncCount();
      updateMentionHint();
    }

    // 发布
    root.querySelector("#publish-btn").addEventListener("click", function () {
      var errT = root.querySelector("#err-title");
      var errB = root.querySelector("#err-body");
      var errBd = root.querySelector("#err-board");
      errT.textContent = "";
      errB.textContent = "";
      errBd.textContent = "";
      title.classList.remove("is-error");
      body.classList.remove("is-error");

      if (!boardId) errBd.textContent = "请选择所属板块";
      var errTitle = NS.util.textLength ? "" : "";
      void errTitle;
      if (!title.value.trim()) errT.textContent = "请输入帖子标题";
      else if (Array.from(title.value.trim()).length < 4) errT.textContent = "标题至少 4 个字符";
      if (!body.value.trim()) errB.textContent = "请输入正文";
      else if (Array.from(body.value.trim()).length < 5) errB.textContent = "正文至少 5 个字符";
      if (errT.textContent || errB.textContent || errBd.textContent) return;

      var btn = root.querySelector("#publish-btn");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 发布中…';

      NS.db
        .createPost({ board_id: boardId, tag: tag, title: title.value.trim(), body: body.value.trim() })
        .then(function (res) {
          btn.disabled = false;
          btn.textContent = "发布帖子";
          if (!res.ok) {
            var fe = NS.api.fieldErrors(res.error);
            if (fe.title) errT.textContent = fe.title;
            if (fe.body) errB.textContent = fe.body;
            if (fe.board_id) errBd.textContent = fe.board_id;
            NS.toast.error(res.error.message);
            if (res.error.code === "INSUFFICIENT_POINTS") {
              NS.toast.warn("可在页面右上角领取每日注意力点数");
            }
            return;
          }

          NS.persist.remove("composeDraft");
          drafts.title = drafts.body = drafts.tag = "";
          drafts.boardId = 0;
          NS.db.refreshUser();
          NS.toast.success("发布成功");

          var mentions = (res.data.mentions || []).concat(
            (res.data.rejectedMentions || []).map(function (m) {
              return { code: m.code, status: "rejected", officerName: m.officer, receipts: [] };
            })
          );
          if (mentions.length) {
            renderMentionPanel(panel, mentions);
            pollMentions(mentions);
          }
          var postId = res.data.post && res.data.post.id;
          setTimeout(function () {
            NS.router.go("/post/" + postId);
          }, mentions.length ? 1200 : 300);
        });
    });

    function renderMentionPanel(host, mentions) {
      host.innerHTML =
        '<div class="panel" style="padding:16px">' +
        '<div class="panel__title" style="font-size:16px">呼叫审核 <span>MENTION REVIEW</span></div>' +
        '<div class="panel__rule"></div>' +
        '<div style="margin-top:12px" id="mention-receipt-list">' +
        mentions.map(receiptHtml).join("") +
        "</div></div>";
    }

    function receiptHtml(m) {
      var statusLabel = { pending: "审核中", under_review: "审核中", approved: "已通过", rejected: "未通过" };
      var last = (m.receipts || [])[(m.receipts || []).length - 1];
      var message = last ? last.message : "";
      return (
        '<div class="mention-receipt" data-code="' + util.attr(m.code) + '" style="padding:10px 0;border-bottom:1px solid var(--c-line-soft)">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<span class="tag">' + util.esc(m.officerName || "集团高管") + "</span>" +
        '<span class="mini-note">编号 ' + util.esc(m.code) + "</span>" +
        '<span class="mini-note" data-role="status">' + util.esc(statusLabel[m.status] || m.status) + "</span>" +
        "</div>" +
        '<div class="mini-note" data-role="message" style="margin-top:6px;line-height:1.9">' + util.esc(message) + "</div>" +
        "</div>"
      );
    }

    /** 轮询审核状态：服务端会把回执逐条追加，这里只做展示 */
    function pollMentions(mentions) {
      mentions.forEach(function (m) {
        var tries = 0;
        var timer = setInterval(function () {
          tries++;
          NS.db.getMention(m.code).then(function (res) {
            if (!res.ok) return;
            var mention = res.data.mention;
            var node = panel.querySelector('.mention-receipt[data-code="' + mention.code + '"]');
            if (node) {
              var statusNode = node.querySelector('[data-role="status"]');
              var msgNode = node.querySelector('[data-role="message"]');
              var map = { pending: "审核中", under_review: "审核中", approved: "已通过", rejected: "未通过" };
              statusNode.textContent = map[mention.status] || mention.status;
              var receipts = mention.receipts || [];
              if (receipts.length) {
                msgNode.textContent = receipts[receipts.length - 1].message;
              }
              if (mention.status === "approved") statusNode.style.color = "#2fbf71";
              if (mention.status === "rejected") statusNode.style.color = "var(--c-danger)";
            }
            if (mention.status === "approved" || mention.status === "rejected") {
              clearInterval(timer);
            }
          });
          if (tries > 40) clearInterval(timer);
        }, 1500);
        pollTimers.push(timer);
      });
    }

    if (!user || user.status !== "active") {
      NS.toast.warn("请先完成入职手续");
      NS.router.go("/onboarding");
    }
  }

  /** 提取文本中的 @提及名称 */
  function detectMentions(text) {
    var out = [];
    var re = /@([^\s@，。！？、,.!?;:；：()（）[\]【】"'“”]{1,24})/g;
    var m;
    while ((m = re.exec(String(text || "")))) {
      if (out.indexOf(m[1]) < 0) out.push(m[1]);
    }
    return out;
  }

  NS.views = NS.views || {};
  NS.views.compose = { render: render, mount: mount, detectMentions: detectMentions };
})(window.HAAVK);
