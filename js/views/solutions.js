/* ==========================================================================
   views/solutions.js — 「解决方案」集团商城
   数据源：服务端 GET /api/site → data.solutions（轮播 / 商品 / 侧栏要点）
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;

  function content() {
    var site = NS.db.site() || {};
    return site.solutions || { promos: [], products: [], sideIntro: [], sidePoints: [] };
  }

  function renderSideCard() {
    var c = content();
    return (
      '<aside class="panel panel--sol">' +
      '<div class="panel__head">' +
      '<div class="panel__title">解决方案 <span>SOLUTIONS</span></div>' +
      '<div class="panel__rule"></div>' +
      "</div>" +
      '<div class="panel__body">' +
      /* 参考 ref14：公告文字直接压卡底、无灰色底框 */
      (c.sideIntro || [])
        .map(function (t, i) {
          return (
            '<p class="panel__text sol-intro' + (i === 0 ? " sol-intro--notice" : "") + '">' +
            util.esc(t) +
            "</p>"
          );
        })
        .join("") +
      (c.sidePoints || [])
        .map(function (t) {
          return (
            '<div class="sentiment">' +
            '<div class="sentiment__icon sentiment__icon--img">' +
            (t.iconImg
              ? '<img src="' + util.attr(t.iconImg) + '" alt="">'
              : icon(t.icon || "hex", "", 28)) +
            "</div>" +
            "<div>" +
            '<div class="sentiment__title">' + util.esc(t.title) + "</div>" +
            '<div class="sentiment__desc">' + util.esc(t.description) + "</div>" +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>" +
      "</aside>"
    );
  }

  /* 轮播全带烘焙图（产品+文字+指示点全部在图内，854×135，ref14/15/16 同位裁切）。
     DOM 只留无障碍标题与 4 个透明指示点点击区；第 4 点无对应素材（参考共 4 点，我们只有 3 屏截图）。 */
  function renderPromo(promo, index) {
    var promos = content().promos || [];
    if (!promo) return "";
    var dots = "";
    for (var i = 0; i < 4; i++) {
      dots +=
        '<button type="button" class="promo__dot' +
        (i === index ? " is-active" : "") +
        (i >= promos.length ? " promo__dot--dead" : "") +
        '" data-index="' + i + '" style="left:' + (188 + i * 22) + 'px" aria-label="切换第 ' + (i + 1) + " 屏\"></button>";
    }
    return (
      '<section class="promo" id="promo-host">' +
      '<img class="promo__img" src="' + util.attr(promo.image) + '" alt="">' +
      '<h2 class="u-sr-only">' + util.esc(promo.title) + " " + util.esc(promo.slogan) + "</h2>" +
      '<div class="promo__dots">' +
      dots +
      "</div>" +
      "</section>"
    );
  }

  /* 商品行 112px：图标槽 72（行内 x13..85）+ 文字列 x102 + 右区居中（价格在上、已售罄块在下） */
  function renderProduct(p) {
    return (
      '<article class="product" data-id="' + util.attr(p.id) + '">' +
      '<img class="product__img" src="' + util.attr(p.image) + '" alt="">' +
      '<div class="product__main">' +
      '<div class="product__name">' +
      util.esc(p.name) +
      '<span class="product__limit">' + util.esc(p.limitText || "") + "</span></div>" +
      '<div class="product__desc">' + util.esc(p.description || "") + "</div>" +
      '<button type="button" class="link product__detail js-detail" data-id="' +
      util.attr(p.id) +
      '">物品详情》</button>' +
      "</div>" +
      '<div class="product__right">' +
      /* 参考价格无千分位逗号（300000） */
      '<span class="product__price">' + icon("coin", "", 16) + "<span>" + String(p.price) + "</span></span>" +
      '<span class="product__sold">' + (p.soldOut ? "已售罄" : "立即申领") + "</span>" +
      "</div>" +
      "</article>"
    );
  }

  function render(ctx) {
    var c = content();
    var products = c.products || [];
    return (
      '<div class="shell layout-2col layout-2col--top">' +
      renderSideCard() +
      '<div class="list-main">' +
      renderPromo((c.promos || [])[0], 0) +
      '<div class="product-list">' +
      (products.length
        ? products.map(renderProduct).join("")
        : NS.stateBlock({ icon: "info", title: "物资目录暂不可用", desc: "请稍后重试或联系网站管理员。" })) +
      /* 参考 ref14：商品列表右缘蓝色竖线（x1194-1196 从列表顶开始 132px） */
      '<i class="sol-rail" aria-hidden="true"></i>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function mount(root) {
    var idx = 0;
    var timer = null;
    var promos = content().promos || [];

    function paint() {
      var host = root.querySelector("#promo-host");
      if (!host || !promos.length) return;
      var tmp = document.createElement("div");
      tmp.innerHTML = renderPromo(promos[idx], idx);
      host.parentNode.replaceChild(tmp.firstChild, host);
      bindDots();
    }

    function bindDots() {
      root.querySelectorAll("#promo-host .promo__dot").forEach(function (d) {
        d.addEventListener("click", function () {
          var next = parseInt(d.getAttribute("data-index"), 10);
          if (next >= promos.length) return; /* 第 4 点为参考原样的装饰点，无对应屏 */
          idx = next;
          paint();
        });
      });
    }
    bindDots();
    if (promos.length > 1) {
      timer = setInterval(function () {
        idx = (idx + 1) % promos.length;
        paint();
      }, 5200);
    }

    root.querySelectorAll(".js-detail").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        var p = (content().products || []).filter(function (x) {
          return x.id === id;
        })[0];
        if (!p) return;
        NS.modal.open({
          title: p.name,
          confirmText: false,
          bodyHtml:
            '<div style="display:flex;gap:16px">' +
            '<img src="' + util.attr(p.image || "assets/item-generic.svg") + '" alt="" style="width:120px;height:120px;object-fit:cover;border:1px solid var(--c-line);background:var(--c-bg-light-2)">' +
            "<div>" +
            '<div style="font-size:13px;font-weight:700">' + util.esc(p.limitText || "") + "</div>" +
            '<p style="margin-top:8px;font-size:13px;line-height:1.8;color:var(--c-text-sub)">' +
            util.esc(p.description || "") +
            "</p>" +
            '<div style="margin-top:10px;font-size:13px">申领价：<span class="u-num">' +
            util.thousands(p.price) +
            "</span> 哈夫克币 · " +
            (p.soldOut ? "已售罄" : "可申领") +
            "</div>" +
            '<div class="mini-note" style="margin-top:10px">申领须在系统内提交工单并注明用途。</div>' +
            "</div></div>"
        });
      });
    });

    /* 侧栏右缘的蓝色滚动指示条（解决方案页更长：参考 ref14 y33.9%→93.2%） */
    var unmountThumb = NS.mountScrollThumb(root.querySelector(".list-main"));
    var thumbEl = root.querySelector(".scroll-thumb");
    if (thumbEl) thumbEl.classList.add("scroll-thumb--long");

    return function cleanup() {
      if (timer) clearInterval(timer);
      timer = null;
      unmountThumb();
    };
  }

  NS.views = NS.views || {};
  NS.views.solutions = { render: render, mount: mount };
})(window.HAAVK);
