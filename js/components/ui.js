/* ==========================================================================
   components/ui.js — 通用交互组件：icon / toast / modal
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;

  /* ------------------------------- 图标 ------------------------------- */
  /** 生成 <svg><use href="#i-xxx"></svg> */
  function icon(name, cls, size) {
    var s = size || 16;
    return (
      '<svg class="icon ' +
      (cls || "") +
      '" width="' +
      s +
      '" height="' +
      s +
      '" aria-hidden="true"><use href="#i-' +
      util.esc(name) +
      '"/></svg>'
    );
  }

  /* ------------------------------- Toast ------------------------------- */
  var toast = (function () {
    var host = null;
    function ensure() {
      if (!host) {
        host = document.createElement("div");
        host.className = "toasts";
        host.setAttribute("role", "status");
        host.setAttribute("aria-live", "polite");
        document.body.appendChild(host);
      }
      return host;
    }
    function push(type, msg, ms) {
      var h = ensure();
      var el = document.createElement("div");
      el.className = "toast toast--" + type;
      el.textContent = msg;
      h.appendChild(el);
      setTimeout(function () {
        el.style.opacity = "0";
        el.style.transform = "translateX(16px)";
        el.style.transition = "opacity .2s, transform .2s";
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 220);
      }, ms || 2600);
    }
    return {
      info: function (m) {
        push("info", m, 2600);
      },
      success: function (m) {
        push("success", m, 2600);
      },
      error: function (m) {
        push("error", m, 3600);
      },
      warn: function (m) {
        push("warn", m, 3200);
      }
    };
  })();

  /* ------------------------------- Modal ------------------------------- */
  var modal = {
    /**
     * @param {object} opts { title, bodyHtml, confirmText, cancelText, onConfirm, onMount }
     */
    open: function (opts) {
      modal.close();
      var wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.id = "app-modal";
      wrap.innerHTML =
        '<div class="modal__box" role="dialog" aria-modal="true">' +
        '<div class="modal__head"><span>' +
        util.esc(opts.title || "提示") +
        '</span><button class="modal__close" type="button" aria-label="关闭">×</button></div>' +
        '<div class="modal__body">' +
        (opts.bodyHtml || "") +
        "</div>" +
        '<div class="modal__foot"></div>' +
        "</div>";
      document.body.appendChild(wrap);

      var foot = wrap.querySelector(".modal__foot");
      if (opts.cancelText !== false) {
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn btn--ghost";
        cancel.textContent = opts.cancelText || "取消";
        cancel.addEventListener("click", function () {
          modal.close();
        });
        foot.appendChild(cancel);
      }
      if (opts.confirmText !== false) {
        var ok = document.createElement("button");
        ok.type = "button";
        ok.className = "btn btn--primary";
        ok.textContent = opts.confirmText || "确定";
        ok.addEventListener("click", function () {
          var result = opts.onConfirm ? opts.onConfirm(wrap) : true;
          if (result !== false) modal.close();
        });
        foot.appendChild(ok);
      }

      wrap.querySelector(".modal__close").addEventListener("click", modal.close);
      wrap.addEventListener("click", function (e) {
        if (e.target === wrap) modal.close();
      });
      document.addEventListener("keydown", escClose);

      if (opts.onMount) opts.onMount(wrap);
      var first = wrap.querySelector("input,textarea,select,button.btn--primary");
      if (first) first.focus();
      return wrap;
    },

    close: function () {
      var el = document.getElementById("app-modal");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      document.removeEventListener("keydown", escClose);
    },

    /** 二次确认 */
    confirm: function (title, message, onOk, confirmText) {
      modal.open({
        title: title,
        bodyHtml: '<p style="font-size:14px;line-height:1.8;color:var(--c-text-sub)">' + util.esc(message) + "</p>",
        confirmText: confirmText || "确定",
        onConfirm: function () {
          onOk && onOk();
        }
      });
    }
  };

  function escClose(e) {
    if (e.key === "Escape") modal.close();
  }

  /* --------------------------- 空态 / 错误态 --------------------------- */
  function stateBlock(opts) {
    return (
      '<div class="state">' +
      '<div class="state__icon">' +
      icon(opts.icon || "info", "", 46) +
      "</div>" +
      '<div class="state__title">' +
      util.esc(opts.title || "暂无数据") +
      "</div>" +
      (opts.desc ? '<div class="state__desc">' + util.esc(opts.desc) + "</div>" : "") +
      (opts.actionHtml ? '<div class="state__action">' + opts.actionHtml + "</div>" : "") +
      "</div>"
    );
  }

  /** 骨架屏：论坛行 */
  function skeletonRows(n, height) {
    var h = height || 72;
    var out = "";
    for (var i = 0; i < (n || 6); i++) {
      out +=
        '<div class="skeleton-row" style="height:' +
        h +
        'px"><div class="skeleton-bar" style="width:' +
        (40 + ((i * 13) % 45)) +
        '%;margin-bottom:10px"></div><div class="skeleton-bar" style="width:' +
        (18 + ((i * 7) % 22)) +
        '%;height:10px"></div></div>';
    }
    return out;
  }

  function loadingBlock(text) {
    return (
      '<div class="state"><div class="state__title"><span class="spinner"></span> ' +
      util.esc(text || "加载中…") +
      "</div></div>"
    );
  }

  /* --------------------- 列表页滚动指示条 ---------------------
   * 参考活动页版式：论坛/解决方案等列表页，侧栏右缘 gutter 有一条
   * 3px 品牌蓝滚动拇指，随页面滚动下移；静态页（首页/寻人启事）无。
   * @param {HTMLElement} mainCol 主列容器（需带 .list-main 定位上下文）
   * @returns {Function} cleanup —— 交由路由在卸载视图时调用
   */
  function mountScrollThumb(mainCol) {
    if (!mainCol) return function () {};
    /* 纯装饰短竖条：CSS fixed 定位（33vh/46.5vh），无需滚动监听 */
    var thumb = document.createElement("div");
    thumb.className = "scroll-thumb";
    thumb.setAttribute("aria-hidden", "true");
    mainCol.appendChild(thumb);
    return function cleanup() {
      if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
    };
  }

  /* --------------------------- 数据来源角标 --------------------------- */
  /**
   * 根据 confidence 生成来源标记
   * game/dual/custom → 无后缀；single → *；pending → 待确认
   */
  function sourceBadge(item) {
    if (!item) return "";
    if (item.confidence === "pending") return '<span class="tag tag--pending">待确认</span>';
    if (item.confidence === "single") return '<span class="tag">来源单一 *</span>';
    if (item.custom) return '<span class="tag">自建</span>';
    return "";
  }

  /** 详情处展示来源文字（点击展开用） */
  function sourceNote(item) {
    if (!item || !item.source) return "";
    return '<div class="mini-note" style="margin-top:6px">来源：' + util.esc(item.source) + "</div>";
  }

  NS.icon = icon;
  NS.toast = toast;
  NS.modal = modal;
  NS.stateBlock = stateBlock;
  NS.skeletonRows = skeletonRows;
  NS.loadingBlock = loadingBlock;
  NS.sourceBadge = sourceBadge;
  NS.sourceNote = sourceNote;
  NS.mountScrollThumb = mountScrollThumb;
})(window.HAAVK);
