/* ==========================================================================
   core/router.js — hash 路由 + 登录守卫
   路由表在 js/app.js 中注册，避免循环依赖。
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var routes = [];
  var current = null;
  var notFoundHandler = null;
  var mounted = null; // { view, params }

  function parse(hash) {
    var raw = (hash || "").replace(/^#/, "");
    if (!raw || raw === "/") return { path: "/", query: {} };
    var qIndex = raw.indexOf("?");
    var query = {};
    var path = raw;
    if (qIndex >= 0) {
      path = raw.slice(0, qIndex);
      raw
        .slice(qIndex + 1)
        .split("&")
        .forEach(function (pair) {
          if (!pair) return;
          var kv = pair.split("=");
          query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
        });
    }
    if (path.length > 1 && path.slice(-1) === "/") path = path.slice(0, -1);
    return { path: path, query: query };
  }

  /** 把 "/post/:id" 编译为正则 + 参数名（两端锚定，避免 "/" 误匹配任意路径） */
  function compile(pattern) {
    var names = [];
    var source = pattern
      .split("/")
      .map(function (seg) {
        if (seg.charAt(0) === ":") {
          names.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { re: new RegExp("^" + source + "$"), names: names };
  }

  var router = {
    /** 已注册的路由模式（调试用） */
    routes: function () {
      return routes.map(function (r) {
        return r.path;
      });
    },

    /** 注册路由：{ path, view, requireAuth, title } */
    add: function (route) {
      var c = compile(route.path);
      routes.push(Object.assign({}, route, { re: c.re, names: c.names }));
      return router;
    },

    setNotFound: function (fn) {
      notFoundHandler = fn;
    },

    /** 解析当前 hash，返回匹配项 */
    match: function (hash) {
      var parsed = parse(hash);
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        var m = r.re.exec(parsed.path);
        if (m) {
          var params = {};
          r.names.forEach(function (name, idx) {
            params[name] = decodeURIComponent(m[idx + 1]);
          });
          return { route: r, params: params, query: parsed.query, path: parsed.path };
        }
      }
      return null;
    },

    /** 跳转 */
    go: function (path, query) {
      var qs = "";
      if (query) {
        qs =
          "?" +
          Object.keys(query)
            .map(function (k) {
              return encodeURIComponent(k) + "=" + encodeURIComponent(query[k]);
            })
            .join("&");
      }
      var next = "#" + path + qs;
      if (window.location.hash === next) {
        router.resolve();
      } else {
        window.location.hash = next;
      }
    },

    /** 当前路由信息 */
    current: function () {
      return current;
    },

    /** 启动：监听 hashchange 并执行首次解析 */
    start: function (render) {
      router._render = render;
      window.addEventListener("hashchange", function () {
        router.resolve();
      });
      if (!window.location.hash) {
        window.location.hash = "#/";
      }
      router.resolve();
    },

    /** 执行路由解析 + 守卫 + 渲染 */
    resolve: function () {
      var hit = router.match(window.location.hash);
      var state = NS.store.getState();

      // 未匹配到路由：交给 404 处理器，并**继续渲染**（早期版本这里 return，
      // 会导致未知路径不刷新视图，一直停留在上一页）
      if (!hit) {
        notFoundHandler && notFoundHandler();
        if (mounted && mounted.cleanup) {
          try {
            mounted.cleanup();
          } catch (e) {
            if (window.console) console.error("[router] cleanup 异常", e);
          }
        }
        mounted = null;
        current = { path: window.location.hash, params: {}, query: {}, route: null };
        document.title = "页面不存在 · 哈福克 HAAVK";
        if (typeof router._render === "function") router._render(current);
        return;
      }

      var route = hit.route;

      // 登录守卫
      if (route.requireAuth && !state.user) {
        NS.toast.warn("请先登录");
        router.go("/login", { redirect: hit.path });
        return;
      }
      // 入职守卫：未完成入职手续不能进入发帖等业务页面
      if (route.requireHired && state.user && state.user.status !== "active") {
        NS.toast.warn("请先办理入职手续");
        router.go("/onboarding");
        return;
      }
      // 管理员守卫
      if (route.requireAdmin && (!state.user || state.user.role !== "site_admin")) {
        NS.toast.error("仅网站管理员可访问该页面");
        router.go("/");
        return;
      }
      // 已登录访问登录/注册页 → 回个人信息
      if (route.guestOnly && state.user) {
        router.go("/profile");
        return;
      }

      current = {
        path: hit.path,
        params: hit.params,
        query: hit.query,
        route: route
      };

      if (route.title) document.title = route.title + " · 哈福克 HAAVK";
      else document.title = "哈福克 HAAVK";

      // 卸载上一视图
      if (mounted && mounted.cleanup) {
        try {
          mounted.cleanup();
        } catch (e) {
          if (window.console) console.error("[router] cleanup 异常", e);
        }
      }

      if (typeof router._render === "function") {
        router._render(current);
      }
    },

    /** 由 app.js 记录当前视图，route 切换时执行 cleanup 释放定时器/订阅 */
    setMounted: function (entry) {
      mounted = entry || null;
    },

    /** 滚回顶部（路由切换时） */
    resetScroll: function (keep) {
      if (!keep) window.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  NS.router = router;
})(window.HAAVK);
