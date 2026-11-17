/* ==========================================================================
   views/wanted.js — 「寻人启事」
   左侧说明卡 / 通缉卡列表（含线索提交）
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;

  /**
   * 通缉卡数据源：服务端站点内容 GET /api/site → data.wanted.targets
   * 侧栏文案同样来自服务端，便于运营在管理面板调整。
   */
  function wantedData() {
    var site = NS.db.site() || {};
    var w = site.wanted || {};
    var list = Array.isArray(w) ? w : w.targets || [];
    return { intro: (w && w.intro) || [], points: (w && w.points) || [], targets: list };
  }

  function renderSideCard() {
    var data = wantedData();
    return (
      '<aside class="panel">' +
      '<div class="panel__head">' +
      '<div class="panel__title">寻人启事 <span>WANTED</span></div>' +
      '<div class="panel__rule"></div>' +
      "</div>" +
      /* 参考 ref17：侧栏只有 4 段正文（P1→P2 无空行、P3/P4 前各一空行），无功能条目 */
      '<div class="panel__body wanted-intro">' +
      data.intro
        .map(function (t) {
          return '<p class="panel__text">' + util.esc(t) + "</p>";
        })
        .join("") +
      "</div>" +
      "</aside>"
    );
  }

  /* 参考 ref17 通缉卡：顶部藏青标签带（白蓝字、无下划线）→ 代号 → 一行任务 → 底部悬赏 + 已提交。
     费莱尔卡代号首字「?」为近乎不可见的残影（故障/redacted 效果），以低透明度渲染。 */
  function renderCard(w) {
    var code = util.esc(w.code);
    if (code.charAt(0) === "?") {
      code = '<span class="wanted-card__glitch">?</span>' + code.slice(1);
    }
    var reward =
      w.rewardKind === "number"
        ? '<div class="wanted-card__reward u-num">' + util.thousands(w.rewardValue) + "</div>"
        : '<div class="wanted-card__reward">' + util.esc(w.rewardValue) + "</div>";

    return (
      '<article class="wanted-card" data-id="' +
      util.attr(w.id) +
      '">' +
      '<img class="wanted-card__img" src="' +
      util.attr(w.image) +
      '" alt="">' +
      '<div class="wanted-card__veil"></div>' +
      '<div class="wanted-card__band">' +
      w.tags
        .map(function (t) {
          return "<span>" + util.esc(t) + "</span>";
        })
        .join("") +
      "</div>" +
      '<div class="wanted-card__code">' + code + "</div>" +
      '<div class="wanted-card__task">' + util.esc(w.task) + "</div>" +
      '<div class="wanted-card__bottom">' +
      '<div class="wanted-card__reward-label">' + util.esc(w.rewardLabel) + "</div>" +
      reward +
      '<button type="button" class="wanted-card__btn js-submit-clue"' +
      (w.submitted ? " disabled" : "") +
      ">" +
      (w.submitted ? "已提交" : "提交线索") +
      "</button>" +
      "</div>" +
      "</article>"
    );
  }

  /** 通缉卡列表（补齐前端渲染所需字段） */
  function wantedTargets() {
    return wantedData().targets.map(function (t) {
      var out = Object.assign({}, t);
      if (out.nameUncertain === undefined && out.uncertain !== undefined) out.nameUncertain = !!out.uncertain;
      if (!out.image) out.image = "assets/wanted-placeholder.svg";
      return out;
    });
  }

  function render(ctx) {
    return (
      '<div class="shell layout-2col layout-2col--top">' +
      renderSideCard() +
      "<div>" +
      '<div class="wanted-grid">' +
      wantedTargets().map(renderCard).join("") +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function mount(root) {
    root.querySelectorAll(".js-submit-clue").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest(".wanted-card");
        var id = card.getAttribute("data-id");
        if (!NS.store.getState().user) {
          NS.toast.warn("请先登录后再提交线索");
          NS.router.go("/login", { redirect: "/wanted" });
          return;
        }
        NS.modal.confirm(
          "提交线索",
          "提交后将由安全防卫部核验并归档，核验通过后按集团标准发放奖励。",
          function () {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 提交中…';
            NS.db.submitClue(id).then(function (res) {
              if (res.ok) {
                btn.disabled = false;
                btn.textContent = "已提交";
                NS.toast.success(res.data.receipt || "线索已提交，安全防卫部将进行核验");
              } else {
                btn.disabled = false;
                btn.textContent = "提交线索";
                if (res.error.code === "UNAUTHORIZED") {
                  NS.router.go("/login", { redirect: "/wanted" });
                  return;
                }
                NS.toast.error(res.error.message);
              }
            });
          },
          "确认提交"
        );
      });
    });
  }

  NS.views = NS.views || {};
  NS.views.wanted = { render: render, mount: mount };
})(window.HAAVK);
