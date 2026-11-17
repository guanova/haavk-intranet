/* ==========================================================================
   js/core/store.js — 单向数据流 store（v2：服务端为唯一数据源）
   · 登录用户、站点配置、目录、帖子列表均由服务端返回后写入
   · 不再持久化任何业务数据到 localStorage；仅保存纯 UI 偏好
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var state = {
    user: null, // 服务端 /api/me 返回的当前用户
    site: null, // /api/site 的站点配置与栏目内容
    catalog: null, // /api/catalog 的部门 / 岗位 / AI 高管
    boards: [], // 论坛板块
    posts: [], // 当前帖子列表
    postsMeta: { page: 1, pageSize: 20, total: 0 },
    postFilter: { board: "", q: "" },
    ready: false,
    bootError: null
  };

  var listeners = [];

  function shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    var ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
    return true;
  }

  var reducers = {
    "user/set": function (s, a) {
      return { user: a.payload };
    },
    "site/set": function (s, a) {
      return { site: a.payload };
    },
    "catalog/set": function (s, a) {
      return { catalog: a.payload };
    },
    "boards/set": function (s, a) {
      return { boards: a.payload };
    },
    "posts/set": function (s, a) {
      return { posts: a.payload.items || [], postsMeta: { page: a.payload.page, pageSize: a.payload.pageSize, total: a.payload.total } };
    },
    "postFilter/set": function (s, a) {
      return { postFilter: Object.assign({}, s.postFilter, a.payload) };
    },
    "ready/set": function (s, a) {
      return { ready: a.payload };
    },
    "bootError/set": function (s, a) {
      return { bootError: a.payload };
    }
  };

  var store = {
    getState: function () {
      return state;
    },
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) {
          return f !== fn;
        });
      };
    },
    dispatch: function (action) {
      if (!action || !action.type) return state;
      var reducer = reducers[action.type];
      if (!reducer) {
        if (window.console) console.warn("[store] 未知 action:", action.type);
        return state;
      }
      var patch = reducer(state, action) || {};
      var next = Object.assign({}, state, patch);
      var changed = false;
      for (var k in patch) {
        if (!shallowEqual(state[k], next[k])) {
          changed = true;
          break;
        }
      }
      state = next;
      if (changed) store.notify(action);
      return state;
    },
    notify: function (action) {
      listeners.slice().forEach(function (fn) {
        try {
          fn(state, action);
        } catch (e) {
          if (window.console) console.error("[store] 订阅者异常", e);
        }
      });
    },
    /** 便捷取用 */
    isAdmin: function () {
      return !!state.user && state.user.role === "site_admin";
    },
    isHired: function () {
      return !!state.user && state.user.status === "active";
    }
  };

  NS.store = store;
})(window.HAAVK);
