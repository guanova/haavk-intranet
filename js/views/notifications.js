/* ==========================================================================
   views/notifications.js — 通知板块（公开）
   左侧：板块说明 + 邮件订阅状态；右侧：通知列表 / 通知详情（同视图内切换）。
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;
  var api = NS.api;

  var LEVEL_TEXT = { normal: "通知", important: "重要", urgent: "紧急" };

  var INTRO = [
    "本栏用于发布集团层面的公开通知：站点变动、活动进度、资料征集结果与人员安排。",
    "重要通知会同步推送至已订阅的邮箱。员工可在「个人信息」中填写邮箱并开启接收，随时可关闭。",
    "如需回执或申诉，请在员工论坛相应帖子下回复，本栏不接受直接答复。"
  ];

  var state = { items: [], current: null, loading: true, error: "", expanded: null };

  function fmtDate(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    var p = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderSide() {
    return (
      '<aside class="panel notice-side">' +
      '<div class="panel__head">' +
      '<div class="panel__title">集团通知 <span>NOTICE</span></div>' +
      '<div class="panel__rule"></div>' +
      "</div>" +
      '<div class="panel__body">' +
      INTRO.map(function (t) {
        return '<p class="panel__text">' + util.esc(t) + "</p>";
      }).join("") +
      "</div>" +
      "</aside>"
    );
  }

  function renderItem(n) {
    var open = state.expanded === n.id;
    return (
      '<article class="notice-item' +
      (n.level !== "normal" ? " notice-item--" + n.level : "") +
      (n.isPinned ? " notice-item--pinned" : "") +
      '" data-id="' + n.id + '">' +
      '<header class="notice-item__head">' +
      (n.isPinned ? '<span class="notice-item__pin">' + icon("pin-top") + "置顶</span>" : "") +
      '<span class="notice-item__level">' + util.esc(LEVEL_TEXT[n.level] || "通知") + "</span>" +
      '<h3 class="notice-item__title">' + util.esc(n.title) + "</h3>" +
      "</header>" +
      '<div class="notice-item__meta">' +
      "<span>" + util.esc(n.authorName || "集团行政") + "</span>" +
      "<span>" + util.esc(fmtDate(n.publishAt)) + "</span>" +
      "</div>" +
      '<p class="notice-item__summary">' + util.esc(n.summary || "") + "</p>" +
      (open && n.body
        ? '<div class="notice-item__body">' +
          n.body
            .split(/\n{2,}/)
            .map(function (p) {
              return "<p>" + util.esc(p).replace(/\n/g, "<br>") + "</p>";
            })
            .join("") +
          "</div>"
        : "") +
      '<button type="button" class="notice-item__toggle btn btn--flat" data-act="toggle" data-id="' + n.id + '">' +
      (open ? "收起" : "查看全文") +
      "</button>" +
      "</article>"
    );
  }

  function renderList() {
    if (state.loading) return '<div class="notice-empty">正在读取通知…</div>';
    if (state.error) return '<div class="notice-empty notice-empty--error">' + util.esc(state.error) + "</div>";
    if (!state.items.length) return '<div class="notice-empty">暂无已发布的通知。</div>';
    return state.items.map(renderItem).join("");
  }

  function render() {
    return (
      '<div class="shell layout-2col layout-2col--top notice-page list-main">' +
      renderSide() +
      '<section class="panel notice-main">' +
      '<div class="panel__head">' +
      '<div class="panel__title">全部通知 <span>ALL NOTICES</span></div>' +
      '<div class="panel__rule"></div>' +
      "</div>" +
      '<div class="panel__body" id="notice-list">' +
      renderList() +
      "</div>" +
      "</section>" +
      "</div>"
    );
  }

  function repaintList(root) {
    var host = root.querySelector("#notice-list");
    if (host) host.innerHTML = renderList();
  }

  function load(root) {
    state.loading = true;
    repaintList(root);
    api.get("/api/notifications?limit=50").then(function (res) {
      state.loading = false;
      if (res.ok) {
        state.items = (res.data && res.data.items) || [];
        state.error = "";
      } else {
        state.error = (res.error && res.error.message) || "通知读取失败";
      }
      repaintList(root);
    });
  }

  function mount(root) {
    load(root);
    root.addEventListener("click", function (e) {
      var btn = e.target.closest('[data-act="toggle"]');
      if (!btn) return;
      var id = Number(btn.getAttribute("data-id"));
      state.expanded = state.expanded === id ? null : id;
      repaintList(root);
    });
  }

  NS.views = NS.views || {};
  NS.views.notifications = { render: render, mount: mount };
})(window.HAAVK);
