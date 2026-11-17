/* ==========================================================================
   core/util.js — 通用工具（无框架依赖）
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = {};

  /** 生成短 ID */
  util.uid = function (prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  /** HTML 转义（所有用户输入渲染前必须过这一层） */
  util.esc = function (s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  /** 属性值转义（用于 style / 自定义属性） */
  util.attr = function (s) {
    return util.esc(s).replace(/`/g, "&#96;");
  };

  /**
   * 名称归一化：用于「新建部门」去重。
   * 规则：去首尾空白 → 全角转半角 → 去所有空白 → 转小写。
   */
  util.normName = function (s) {
    if (!s) return "";
    var out = String(s)
      .replace(/[\u3000]/g, " ")
      .replace(/[\uFF01-\uFF5E]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/\s+/g, "")
      .trim()
      .toLowerCase();
    return out;
  };

  /** 相对时间：刚刚 / x 分钟前 / x 小时前 / x 天前 / YYYY-MM-DD */
  util.relTime = function (ts) {
    if (!ts) return "--";
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var min = 60000;
    if (diff < min) return "刚刚";
    if (diff < 60 * min) return Math.floor(diff / min) + " 分钟前";
    if (diff < 24 * 60 * min) return Math.floor(diff / (60 * min)) + " 小时前";
    if (diff < 7 * 24 * 60 * min) return Math.floor(diff / (24 * 60 * min)) + " 天前";
    return util.date(ts);
  };

  util.date = function (ts) {
    var d = new Date(ts);
    var p = function (n) {
      return n < 10 ? "0" + n : "" + n;
    };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };

  util.dateTime = function (ts) {
    var d = new Date(ts);
    var p = function (n) {
      return n < 10 ? "0" + n : "" + n;
    };
    return util.date(ts) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  };

  util.clamp = function (n, a, b) {
    return Math.max(a, Math.min(b, n));
  };

  /** 防抖 */
  util.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments,
        self = this;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(self, args);
      }, wait || 120);
    };
  };

  /** 千分位（哈夫克币 / 悬赏额） */
  util.thousands = function (n) {
    if (n === null || n === undefined || n === "") return "";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  /** 简单事件总线（组件间解耦） */
  util.bus = (function () {
    var map = {};
    return {
      on: function (evt, fn) {
        (map[evt] = map[evt] || []).push(fn);
        return function () {
          map[evt] = map[evt].filter(function (f) {
            return f !== fn;
          });
        };
      },
      emit: function (evt, payload) {
        (map[evt] || []).forEach(function (fn) {
          try {
            fn(payload);
          } catch (e) {
            /* 单个订阅者异常不影响其他订阅者 */
            if (window.console) console.error("[bus]", evt, e);
          }
        });
      }
    };
  })();

  NS.util = util;
})(window.HAAVK);
