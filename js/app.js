/* ==========================================================================
   js/app.js — 应用启动、路由注册、视图挂载与清理（v2：服务端数据源）
   ========================================================================== */
(function (NS) {
  "use strict";

  function renderRoute(current) {
    var viewHost = document.getElementById("view-host");
    if (!viewHost) return;

    var view = current.route && current.route.view;
    if (!view) view = NS.views.notFound;
    if (!view) return;

    // 清理上一个视图
    if (NS._cleanup) {
      try {
        NS._cleanup();
      } catch (e) {
        if (window.console) console.error("[app] cleanup", e);
      }
      NS._cleanup = null;
    }

    NS.shell.updateNav(current.path);

    try {
      viewHost.innerHTML = view.render(current);
    } catch (e) {
      if (window.console) console.error("[app] render", e);
      viewHost.innerHTML = NS.stateBlock({
        icon: "warn",
        title: "页面渲染失败",
        desc: "发生内部错误：" + ((e && e.message) || "未知错误"),
        actionHtml: '<button class="btn btn--primary" onclick="location.reload()">重新加载</button>'
      });
      return;
    }

    if (typeof view.mount === "function") {
      try {
        var cleanup = view.mount(viewHost, current);
        NS._cleanup =
          typeof cleanup === "function"
            ? cleanup
            : typeof view.unmount === "function"
            ? view.unmount.bind(null, viewHost, current)
            : null;
      } catch (e) {
        if (window.console) console.error("[app] mount", e);
        NS.toast.error("页面交互初始化失败：" + ((e && e.message) || "未知错误"));
      }
    }

    NS.router.resetScroll();
  }

  function start() {
    var app = document.getElementById("app");
    app.innerHTML = NS.shell.render();

    NS.router
      .add({ path: "/", view: NS.views.about, title: "关于我们" })
      .add({ path: "/forum", view: NS.views.forum, title: "员工论坛" })
      .add({ path: "/post/:id", view: NS.views.postDetail, title: "帖子详情" })
      .add({ path: "/compose", view: NS.views.compose, title: "发布新帖", requireAuth: true, requireHired: true })
      .add({ path: "/solutions", view: NS.views.solutions, title: "解决方案" })
      .add({ path: "/collect", view: NS.views.collect, title: "资料征集" })
      .add({ path: "/wanted", view: { render: function () { NS.router.go("/collect"); return ""; }, mount: function () {} }, title: "资料征集" })
      .add({ path: "/profile", view: NS.views.profile, title: "个人信息", requireAuth: true })
      .add({ path: "/onboarding", view: NS.views.onboarding, title: "办理入职手续", requireAuth: true })
      .add({ path: "/admin", view: NS.views.admin, title: "管理面板", requireAuth: true, requireAdmin: true })
      .add({ path: "/login", view: NS.views.login, title: "登录", guestOnly: true })
      .add({ path: "/register", view: NS.views.register, title: "注册", guestOnly: true });

    NS.router.start(renderRoute);

    // 站点配置加载完成后刷新页脚（备案信息）
    NS.util.bus.on("site:loaded", function () {
      if (NS.shell.refreshFiling) NS.shell.refreshFiling();
    });

    // 用户状态变化时刷新导航
    NS.store.subscribe(function (state, action) {
      if (!action) return;
      if (action.type === "user/set") {
        var cur = NS.router.current();
        if (cur && cur.path) NS.shell.updateNav(cur.path);
      }
    });

    // 快捷键：1..6 切换栏目
    document.addEventListener("keydown", function (e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var map = { "1": "/", "2": "/forum", "3": "/solutions", "4": "/collect", "5": "/profile", "6": "/onboarding" };
      if (map[e.key]) NS.router.go(map[e.key]);
    });

    // 注意力点数显示刷新
    NS.store.subscribe(function (state, action) {
      if (action && action.type === "user/set") NS.shell.refreshAttention();
    });
  }

  function boot() {
    // 先把外壳渲染出来（含加载态），避免白屏
    var app = document.getElementById("app");
    app.innerHTML = '<div class="shell" style="padding:60px 0">' + NS.loadingBlock("正在连接哈夫克内网…") + "</div>";

    NS.db
      .init()
      .then(function () {
        start();
        var results = NS.store.getState();
        if (!results.site) {
          NS.toast.error("站点配置加载失败，部分内容可能不可用。请确认服务已启动。");
        }
      })
      .catch(function (err) {
        app.innerHTML =
          '<div class="shell" style="padding:60px 0">' +
          NS.stateBlock({
            icon: "warn",
            title: "无法连接服务器",
            desc: "哈夫克内网需要服务端支持。请确认已启动服务后刷新页面。（" + ((err && err.message) || "未知错误") + "）",
            actionHtml: '<button class="btn btn--primary" onclick="location.reload()">重新加载</button>'
          }) +
          "</div>";
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.HAAVK);
