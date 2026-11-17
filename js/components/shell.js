/* ==========================================================================
   components/shell.js — 页面外壳：L1 顶栏 / L2 主导航 / 书签条 / 页脚状态栏
   页脚版权与备案信息全部来自服务端 /api/site，不在前端硬编码。
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var icon = NS.icon;

  var NAV = [
    { path: "/", label: "关于我们" },
    { path: "/forum", label: "员工论坛" },
    { path: "/solutions", label: "解决方案" },
    { path: "/collect", label: "资料征集" }
  ];

  /* --------------------------- 服务端配置读取 --------------------------- */

  /** 取站点配置（api.js 会缓存 GET /api/site 的结果） */
  function siteConfig() {
    var api = NS.api;
    if (!api || !api.siteCache) return null;
    var c = api.siteCache;
    // 兼容 { data: {...} } 与直接缓存 data 的两种形态
    return c.data || c;
  }

  function str(v) {
    return v === null || v === undefined ? "" : String(v).trim();
  }

  function currentUser() {
    var s = NS.store && NS.store.getState ? NS.store.getState() : {};
    return s.user || s.account || null;
  }

  function currentPoints() {
    var s = NS.store && NS.store.getState ? NS.store.getState() : {};
    var u = s.user || s.account;
    if (u && typeof u.pointsBalance === "number") return u.pointsBalance;
    if (typeof s.attention === "number") return s.attention;
    return 0;
  }

  function avatarOf(u) {
    if (u && u.avatarUrl) return u.avatarUrl;
    if (u && u.id != null && NS.db && typeof NS.db.avatarOf === "function") {
      try {
        var v = NS.db.avatarOf(u.id);
        if (v) return v;
      } catch (e) {
        /* 忽略：回退到服务端默认头像 */
      }
    }
    return "/media/default-avatar.svg";
  }

  /** L1 顶栏 */
  function renderTopbar() {
    return (
      '<div class="topbar"><div class="shell" style="display:flex;align-items:center;justify-content:space-between;width:100%">' +
      '<a class="topbar__back" href="#/" title="返回活动">' +
      icon("chevron-left", "", 18) +
      '<i class="topbar__sep" aria-hidden="true"></i>' +
      "<span>活动</span></a>" +
      '<div class="topbar__deco" aria-hidden="true"></div>' +
      "</div></div>"
    );
  }

  /** L2 主导航 */
  function renderMainNav(activePath) {
    var items = NAV.map(function (n) {
      var active =
        n.path === "/"
          ? activePath === "/"
          : activePath.indexOf(n.path) === 0;
      return (
        '<a class="mainnav__item' +
        (active ? " is-active" : "") +
        '" href="#' +
        n.path +
        '">' +
        util.esc(n.label) +
        "</a>"
      );
    }).join("");

    var u = currentUser();
    var user = "";
    /* 注意力点数簇仅登录后显示（参考图为游戏内登录态；游客只见登录/注册） */
    var attention = "";
    if (u) {
      attention =
        '<button type="button" class="attention" id="attention-btn" title="领取今日注意力点数">' +
        '<span class="attention__icon" style="display:inline-flex">' +
        icon("target", "", 18) +
        "</span>" +
        '<span class="attention__label">注意力点数</span>' +
        '<span class="attention__sep">|</span>' +
        '<span class="attention__value" id="attention-value">' +
        util.thousands(currentPoints()) +
        "</span>" +
        "</button>";
    }
    if (u) {
      var nick = util.esc(u.displayName || u.nickname || u.username || "");
      user =
        '<div class="navuser">' +
        '<img class="navuser__avatar" src="' +
        util.attr(avatarOf(u)) +
        '" alt="" onerror="this.onerror=null;this.src=\'assets/avatar-placeholder.svg\'">' +
        '<a class="navuser__name" href="#/profile" title="个人信息面板">' +
        nick +
        "</a>" +
        '<button type="button" class="link js-logout" style="background:none;border:none;padding:0">退出</button>' +
        "</div>";
    } else {
      user =
        '<div class="navuser">' +
        '<a class="link" href="#/login">登录</a>' +
        '<span class="u-muted">/</span>' +
        '<a class="link" href="#/register">注册</a>' +
        "</div>";
    }

    return (
      '<nav class="mainnav" aria-label="主导航"><div class="shell" style="display:flex;align-items:center;width:100%;height:100%;position:relative">' +
      '<a class="mainnav__logo" href="#/" title="哈夫克集团"><img src="assets/img/haavk-nav-logo.png" alt="HAAVK"></a>' +
      '<div class="mainnav__menu">' +
      items +
      "</div>" +
      '<div class="mainnav__right">' +
      attention +
      user +
      "</div>" +
      "</div></nav>"
    );
  }

  /**
   * 页脚：版权与备案信息。
   * 数据全部来自服务端配置；任一字段缺失或为空都不输出占位文字，
   * 整块都没有可用数据时返回空串（该行不渲染）。
   */
  function renderFiling() {
    var site = siteConfig();
    if (!site) return "";
    var filing = site.filing || {};
    var brand = site.brand || {};

    var siteName = str(brand.siteName);
    var company = str(filing.company);
    var copyright = str(filing.copyright);
    var icp = str(filing.icp);
    var police = str(filing.police);
    var policeUrl = str(filing.policeUrl);
    var extra = str(filing.extra);

    // 备案相关字段全空 → 不渲染该行
    if (!icp && !police && !company && !copyright && !extra) return "";

    var seg = [];
    if (copyright) {
      seg.push(util.esc(copyright));
    } else {
      var holder = company || siteName;
      if (holder) seg.push("© " + util.esc(holder) + " " + new Date().getFullYear());
    }
    if (icp) seg.push(util.esc(icp));
    if (police) {
      seg.push(
        policeUrl
          ? '<a href="' +
            util.attr(policeUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            util.esc(police) +
            "</a>"
          : util.esc(police)
      );
    }
    if (extra) seg.push(util.esc(extra));
    if (!seg.length) return "";

    return (
      '<span class="statusbar__uid" id="statusbar-filing">' +
      seg.join('<span class="u-muted"> · </span>') +
      "</span>"
    );
  }

  /** 页脚：仅承载备案信息（管理员在站点配置中维护）。
      备案为空时整条不渲染（statusbar--empty 隐藏），页面底部不再有任何常驻元素。 */
  function renderStatusBar() {
    var filing = renderFiling();
    return (
      '<footer class="statusbar' + (filing ? "" : " statusbar--empty") + '"><div class="shell">' +
      '<span class="statusbar__spacer"></span>' +
      filing +
      "</div></footer>"
    );
  }

  /** 重新渲染页脚（站点配置到达后调用；缺失数据时静默跳过） */
  function refreshFiling() {
    var el = document.querySelector(".statusbar");
    if (!el || !el.parentNode) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = renderStatusBar();
    var next = tmp.firstChild;
    if (next) el.parentNode.replaceChild(next, el);
    /* 状态栏可见性广播：论坛筛选条等 sticky 元素据此避让 */
    document.body.classList.toggle(
      "has-statusbar",
      !!(next && next.querySelector && next.querySelector(".statusbar__uid"))
    );
  }

  /** 首次渲染骨架 */
  function renderShell() {
    return (
      renderTopbar() +
      '<div id="mainnav-host"></div>' +
      '<main class="content" id="view-host"></main>' +
      renderStatusBar()
    );
  }

  /** 更新导航（每次路由变化调一次） */
  function updateNav(activePath) {
    var host = document.getElementById("mainnav-host");
    if (host) host.innerHTML = renderMainNav(activePath);
    bindNav(host);
    // 首屏时 siteCache 可能尚未到达，这里补一次页脚渲染
    refreshFiling();
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function setAttentionValue(n) {
    var v = document.getElementById("attention-value");
    if (v) v.textContent = util.thousands(n);
  }

  function isOk(res) {
    if (!res) return false;
    if (res.ok === true) return true;
    if (res.ok === false) return false;
    return res.status >= 200 && res.status < 300;
  }

  function errCode(res) {
    var e = res && res.error;
    if (!e) return res && res.code ? String(res.code) : "";
    if (typeof e === "string") return e;
    return String(e.code || "");
  }

  function errText(res, fallback) {
    var e = res && res.error;
    if (!e) return fallback;
    if (typeof e === "string") return e;
    return e.message || fallback;
  }

  /** 领取今日注意力点数（服务端定权：每人每天一次） */
  function claimPoints(btn) {
    var api = NS.api;
    if (!api || typeof api.request !== "function") {
      NS.toast.error("服务暂不可用，请稍后重试");
      return;
    }
    if (btn) btn.disabled = true;

    api
      .request("/api/points/claim", { method: "POST" })
      .then(function (res) {
        if (btn) btn.disabled = false;
        var status = res && res.status;
        var code = errCode(res);

        if (isOk(res)) {
          var data = (res && res.data) || {};
          var balance = typeof data.balance === "number" ? data.balance : null;
          if (balance !== null) {
            var u = currentUser();
            if (u) {
              NS.store.dispatch({
                type: "user/set",
                payload: Object.assign({}, u, { pointsBalance: balance })
              });
            }
            setAttentionValue(balance);
          }
          var amount = typeof data.amount === "number" ? data.amount : null;
          NS.toast.success(
            "已领取 " +
              (amount === null ? "今日点数" : util.thousands(amount) + " 点") +
              (balance === null ? "" : "（当前 " + util.thousands(balance) + "）")
          );
          return;
        }

        if (status === 401 || code === "UNAUTHORIZED") {
          NS.toast.warn("请先登录后再领取");
          NS.router.go("/login");
          return;
        }
        if (status === 409 || code === "CONFLICT") {
          NS.toast.info("今日已领取");
          return;
        }
        NS.toast.error(errText(res, "领取失败，请稍后重试"));
      })
      .catch(function (e) {
        if (btn) btn.disabled = false;
        NS.toast.error("网络异常，领取失败" + (e && e.message ? "：" + e.message : ""));
      });
  }

  function bindNav(host) {
    if (!host) return;
    var btn = host.querySelector("#attention-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        claimPoints(btn);
      });
    }
    var logout = host.querySelector(".js-logout");
    if (logout) {
      logout.addEventListener("click", function () {
        NS.modal.confirm("退出登录", "退出后需要重新登录才能发帖与维护资料。", function () {
          var res = NS.auth.logout();
          var finish = function () {
            NS.toast.info("已退出登录");
            NS.router.go("/login");
          };
          if (res && typeof res.then === "function") res.then(finish, finish);
          else finish();
        }, "退出");
      });
    }
  }

  /** 更新右上角注意力数值（发帖/回复或登录状态变化后） */
  function refreshAttention() {
    setAttentionValue(currentPoints());
  }

  // 站点配置加载完成后重渲染页脚（app.js 也会调用一次，重复调用无副作用）
  if (NS.util && NS.util.bus && typeof NS.util.bus.on === "function") {
    NS.util.bus.on("site:loaded", refreshFiling);
  }

  NS.shell = {
    render: renderShell,
    updateNav: updateNav,
    refreshAttention: refreshAttention,
    renderMainNav: renderMainNav,
    refreshFiling: refreshFiling
  };
})(window.HAAVK);
