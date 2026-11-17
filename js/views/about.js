/* ==========================================================================
   views/about.js — 「关于我们」首页
   主视觉轮播 / 优秀员工 / 员工之声（版式基准：活动页参考截图，无其他区块）
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;

  /**
   * 首页内容全部来自服务端 GET /api/site → data.home
   * （主视觉 3 屏 / 集团简介 / 优秀员工 / 员工之声），运营侧可在服务端调整。
   */
  var HERO_ASSETS = ["assets/img/hero-full-1.jpg", "assets/img/hero-full-2.jpg", "assets/img/hero-full-3.jpg"];
  var EXCELLENT_ASSETS = ["assets/img/excellent-full-1.jpg", "assets/img/excellent-full-2.jpg"];
  var VOICE_ASSETS = ["assets/img/voice-full-1.jpg", "assets/img/voice-full-2.jpg", "assets/img/voice-full-3.jpg", "assets/img/voice-full-4.jpg"];

  function home() {
    var site = NS.db.site() || {};
    return site.home || {};
  }

  function slides() {
    var raw = home().heroSlides || [];
    return raw.map(function (s, i) {
      return {
        id: s.id || "s" + (i + 1),
        title: s.title || "",
        sub: s.subtitle || s.sub || "",
        signature: !!s.signature,
        hero: s.hero || HERO_ASSETS[i % HERO_ASSETS.length]
      };
    });
  }

  function excellentList() {
    return (home().excellent || []).map(function (e, i) {
      return {
        id: e.id,
        name: e.name,
        sub: e.subtitle || e.sub || "",
        motto: e.motto || [],
        dept: e.department || "",
        asset: e.asset || EXCELLENT_ASSETS[i % EXCELLENT_ASSETS.length]
      };
    });
  }

  function voiceList() {
    return (home().voices || []).map(function (v, i) {
      return {
        id: v.id,
        name: v.name,
        dept: v.department || "",
        motto: v.motto || [],
        asset: v.asset || VOICE_ASSETS[i % VOICE_ASSETS.length]
      };
    });
  }

  /* ------------------------------- 渲染 ------------------------------- */

  /* 主视觉为整幅烘焙图（标题/副标题/签名/人物/蓝块/轮播点/区块标题全部在图内，
     与参考照片一致）；DOM 只保留透明轮播点击区与无障碍标题。 */
  function renderHero(slide) {
    return (
      '<section class="hero">' +
      '<img class="hero__unit" src="' +
      util.attr(slide.hero) +
      '" alt="' +
      util.attr(slide.title) +
      '">' +
      '<h1 class="u-sr-only">' +
      util.esc(slide.title) +
      "</h1>" +
      '<div class="hero__dots" id="hero-dots">' +
      slides()
        .map(function (s, i) {
        return (
          '<button type="button" class="hero__dot" data-index="' +
          i +
          '" aria-label="切换第 ' +
          (i + 1) +
          '屏"' +
          (s.id === slide.id ? ' aria-current="true"' : "") +
          "></button>"
        );
      }).join("") +
      "</div>" +
      "</section>"
    );
  }

  /* 卡片同为整卡烘焙（名字/部门/标语/蓝色渐层在图内），DOM 不再叠字 */
  function renderExcellentCard(e) {
    return (
      '<article class="emp-card">' +
      '<img class="emp-card__img" src="' +
      util.attr(e.asset) +
      '" alt="' +
      util.attr(e.name) +
      '">' +
      "</article>"
    );
  }

  function renderVoiceCard(v) {
    return (
      '<article class="voice-card">' +
      '<img class="voice-card__img" src="' +
      util.attr(v.asset) +
      '" alt="' +
      util.attr(v.name) +
      '">' +
      "</article>"
    );
  }

  var current = 0;
  var timer = null;

  function render(ctx) {
    current = 0;
    var list = slides();
    if (!list.length) {
      return (
        '<div class="shell" style="padding-top:var(--sp-6)">' +
        NS.stateBlock({ icon: "info", title: "页面内容加载中", desc: "若长时间未显示，请刷新页面或联系网站管理员。" }) +
        "</div>"
      );
    }
    return (
      '<div class="about">' +
      renderHero(list[current]) +
      '<section class="dark-band">' +
      '<div class="band-ticks" aria-hidden="true"></div>' +
      '<div class="band-grid">' +
      '<div class="emp-row">' +
      excellentList().map(renderExcellentCard).join("") +
      "</div>" +
      '<div class="voice-row">' +
      voiceList().map(renderVoiceCard).join("") +
      "</div>" +
      "</div>" +
      "</section>" +
      "</div>"
    );
  }

  function mount(root) {
    var list = slides();
    if (!list.length) return;
    // 轮播自动切换
    function go(i) {
      current = (i + list.length) % list.length;
      var hero = root.querySelector(".hero");
      if (!hero) return;
      var wrap = document.createElement("div");
      wrap.innerHTML = renderHero(list[current]);
      hero.parentNode.replaceChild(wrap.firstChild, hero);
      bindDots(root);
    }
    function bindDots(scope) {
      scope.querySelectorAll("#hero-dots .hero__dot").forEach(function (d) {
        d.addEventListener("click", function () {
          go(parseInt(d.getAttribute("data-index"), 10));
        });
      });
    }
    bindDots(root);
    if (list.length > 1) {
      timer = setInterval(function () {
        go(current + 1);
      }, 6000);
    }
  }

  function unmount() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  NS.views = NS.views || {};
  NS.views.about = { render: render, mount: mount, unmount: unmount };
})(window.HAAVK);
