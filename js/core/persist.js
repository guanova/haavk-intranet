/* ==========================================================================
   core/persist.js — 浏览器本地存储（v2：仅用于纯 UI 偏好，不存放业务数据）
   业务数据（用户、帖子、点数、备案配置等）一律由服务端数据库持久化。
   这里只保留：草稿、表格筛选等纯前端偏好。
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var NS_PREFIX = "haavk.ui.";
  var memoryStore = {};
  var available = null;
  var warned = false;
  var SCHEMA_VERSION = 2;

  function probe() {
    if (available !== null) return available;
    try {
      var k = NS_PREFIX + "__probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      available = true;
    } catch (e) {
      available = false;
      if (!warned) {
        warned = true;
        NS.util.bus.emit("persist:unavailable", {
          message: "当前浏览器禁止本地存储，草稿与界面偏好将无法保留。"
        });
      }
    }
    return available;
  }

  var persist = {
    SCHEMA_VERSION: SCHEMA_VERSION,

    get available() {
      return probe();
    },

    get: function (key, fallback) {
      var full = NS_PREFIX + key;
      try {
        var raw = probe() ? window.localStorage.getItem(full) : memoryStore[full];
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    set: function (key, value) {
      var full = NS_PREFIX + key;
      var raw;
      try {
        raw = JSON.stringify(value);
      } catch (e) {
        return false;
      }
      try {
        if (probe()) window.localStorage.setItem(full, raw);
        else memoryStore[full] = raw;
        return true;
      } catch (e) {
        memoryStore[full] = raw;
        return false;
      }
    },

    remove: function (key) {
      var full = NS_PREFIX + key;
      try {
        if (probe()) window.localStorage.removeItem(full);
      } catch (e) {
        /* ignore */
      }
      delete memoryStore[full];
    },

    clearAll: function () {
      try {
        if (probe()) {
          Object.keys(window.localStorage)
            .filter(function (k) {
              return k.indexOf(NS_PREFIX) === 0;
            })
            .forEach(function (k) {
              window.localStorage.removeItem(k);
            });
        }
      } catch (e) {
        /* ignore */
      }
      memoryStore = {};
    }
  };

  NS.persist = persist;
})(window.HAAVK);

