/* ==========================================================================
   views/collect.js — 「资料征集」（原寻人启事位，导航第四项）
   使命：把网站变成活动资料的征集入口——访客无需注册即可投递截图与文字资料。
   布局复用参考版式：左侧说明卡 + 主区表单 + 已收录档案（鸣谢墙）。
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;

  var TYPES = [
    { value: "screenshot", label: "活动页面截图" },
    { value: "lore", label: "设定资料 / 纠错" },
    { value: "copy", label: "员工口吻帖子文案" },
    { value: "asset", label: "素材图源（立绘 / 图标）" },
    { value: "bug", label: "页面捉虫" },
    { value: "other", label: "其他" }
  ];

  var TYPE_LABEL = {};
  TYPES.forEach(function (t) {
    TYPE_LABEL[t.value] = t.label;
  });

  var INTRO = [
    "集团档案处长期向全体员工及外部协作人员征集「网上冲浪」行动相关物资。凡活动影像、设定资料、文字记录，一经收录，即记入集团贡献档案。",
    "征集范围：帖子详情页、彩蛋帖与破译界面、商城物品详情、寻人启事回执、活动规则页等影像资料；部门名称、人物言行、装备参数等文字资料；以及一切有助于还原行动全貌的记录。",
    "影像资料不求精美，能看清字即可，手机拍屏同样受理。",
    "收录者将列入集团贡献名单；在册员工投稿被收录后可获注意力点数奖励。（哈夫克集团保留对收录标准的最终解释权。）"
  ];

  function renderSideCard() {
    return (
      '<aside class="panel">' +
      '<div class="panel__head">' +
      '<div class="panel__title">资料征集 <span>WANTED</span></div>' +
      '<div class="panel__rule"></div>' +
      "</div>" +
      '<div class="panel__body wanted-intro">' +
      INTRO.map(function (t) {
        return '<p class="panel__text">' + util.esc(t) + "</p>";
      }).join("") +
      "</div>" +
      "</aside>"
    );
  }

  function renderForm() {
    var user = NS.store.getState().user;
    return (
      '<section class="panel collect-form">' +
      '<div class="panel__head">' +
      '<div class="panel__title">投递资料 <span>SUBMIT</span></div>' +
      '<div class="panel__rule"></div>' +
      "</div>" +
      '<div class="panel__body">' +
      (user
        ? '<p class="collect-form__hint">当前以工号 <b>' + util.esc(user.displayName || user.username) + "</b> 投递，收录后可获点数奖励。</p>"
        : '<p class="collect-form__hint">无需登录即可投递；<a href="#/register">注册入职</a>后投递，收录可获注意力点数奖励。</p>') +
      '<form id="collect-form" novalidate>' +
      '<div class="field">' +
      '<label class="field__label" for="cf-nick">称呼（选填）</label>' +
      '<input class="input" id="cf-nick" name="nickname" maxlength="32" placeholder="默认「匿名干员」">' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="cf-contact">联系方式（选填）</label>' +
      '<input class="input" id="cf-contact" name="contact" maxlength="64" placeholder="B站UID / QQ / 邮箱，便于回访">' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="cf-type">资料类型</label>' +
      '<select class="input" id="cf-type" name="type">' +
      TYPES.map(function (t) {
        return '<option value="' + t.value + '">' + t.label + "</option>";
      }).join("") +
      "</select>" +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="cf-text">说明文字</label>' +
      '<textarea class="input" id="cf-text" name="text" rows="5" maxlength="2000" placeholder="这是什么页面 / 哪条设定有误 / 图片内容是什么……说清楚就行"></textarea>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label">上传图片（选填）</label>' +
      '<input type="file" id="cf-files" accept="image/png,image/jpeg,image/webp" multiple>' +
      '<p class="field__hint">最多 5 张，单张 8MB 以内，PNG / JPG / WEBP。</p>' +
      '<div class="collect-form__previews" id="cf-previews"></div>' +
      "</div>" +
      '<div class="field collect-form__actions">' +
      '<button type="submit" class="btn btn--primary collect-form__submit" id="cf-submit">提交资料</button>' +
      '<span class="collect-form__status" id="cf-status" role="status"></span>' +
      "</div>" +
      "</form>" +
      "</div>" +
      "</section>"
    );
  }

  function renderCredits(items) {
    if (!items || !items.length) {
      return (
        '<section class="panel collect-credits">' +
        '<div class="panel__head"><div class="panel__title">已收录档案 <span>ARCHIVE</span></div><div class="panel__rule"></div></div>' +
        '<div class="panel__body"><p class="panel__text collect-credits__empty">档案库暂空，等待第一位干员的投递。</p></div>' +
        "</section>"
      );
    }
    return (
      '<section class="panel collect-credits">' +
      '<div class="panel__head"><div class="panel__title">已收录档案 <span>ARCHIVE</span></div><div class="panel__rule"></div></div>' +
      '<div class="panel__body">' +
      '<ul class="collect-credits__list">' +
      items.map(function (it) {
        return (
          '<li class="collect-credits__item">' +
          '<div class="collect-credits__meta">' +
          '<b>' + util.esc(it.nickname) + "</b>" +
          "<span>" + util.esc(TYPE_LABEL[it.type] || "其他") + "</span>" +
          '<time class="u-num">' + util.esc(NS.util.dateTime ? NS.util.dateTime(it.createdAt) : "") + "</time>" +
          "</div>" +
          (it.text ? '<p class="collect-credits__text">' + util.esc(it.text) + "</p>" : "") +
          "</li>"
        );
      }).join("") +
      "</ul>" +
      "</div>" +
      "</section>"
    );
  }

  function render() {
    return (
      '<div class="shell layout-2col layout-2col--top collect-page">' +
      renderSideCard() +
      "<div>" +
      renderForm() +
      '<div id="collect-credits-host">' +
      renderCredits(null) +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function loadCredits(host) {
    NS.api.get("/api/submissions/credits").then(function (res) {
      if (res.ok && host.isConnected) {
        host.innerHTML = renderCredits(res.data.items);
      }
    });
  }

  function mount(root) {
    var form = root.querySelector("#collect-form");
    var fileInput = root.querySelector("#cf-files");
    var previews = root.querySelector("#cf-previews");
    var status = root.querySelector("#cf-status");
    var submitBtn = root.querySelector("#cf-submit");
    var creditsHost = root.querySelector("#collect-credits-host");

    loadCredits(creditsHost);

    // 本地预览（不上传原图之外的任何东西）
    fileInput.addEventListener("change", function () {
      previews.innerHTML = "";
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (files.length > 5) {
        NS.toast.warn("最多 5 张，已只保留前 5 张");
        files = files.slice(0, 5);
      }
      files.forEach(function (f) {
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
          NS.toast.warn("「" + f.name + "」不是支持的图片格式，将不会被上传");
          return;
        }
        var url = URL.createObjectURL(f);
        var img = document.createElement("img");
        img.src = url;
        img.alt = f.name;
        img.className = "collect-form__thumb";
        img.onload = function () {
          URL.revokeObjectURL(url);
        };
        previews.appendChild(img);
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = root.querySelector("#cf-text").value.trim();
      var files = Array.prototype.slice.call(fileInput.files || []).slice(0, 5);
      if (!text && files.length === 0) {
        NS.toast.warn("请至少填写说明文字或选择一张图片");
        return;
      }
      var fd = new FormData();
      fd.append("nickname", root.querySelector("#cf-nick").value.trim());
      fd.append("contact", root.querySelector("#cf-contact").value.trim());
      fd.append("type", root.querySelector("#cf-type").value);
      fd.append("text", text);
      files.forEach(function (f) {
        fd.append("files", f, f.name || "image");
      });

      submitBtn.disabled = true;
      status.textContent = "正在送入档案库…";
      NS.api.request("/api/submissions", { method: "POST", body: fd }).then(function (res) {
        submitBtn.disabled = false;
        if (res.ok) {
          status.textContent = "";
          form.reset();
          previews.innerHTML = "";
          NS.toast.success("资料已进入集团档案库，档案处核验收录后将公示于「已收录档案」");
        } else {
          status.textContent = "";
          NS.toast.error((res.error && res.error.message) || "提交失败，请稍后重试");
        }
      });
    });
  }

  NS.views = NS.views || {};
  NS.views.collect = { render: render, mount: mount };
})(window.HAAVK);
