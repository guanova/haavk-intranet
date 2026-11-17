/* ==========================================================================
   views/not-found.js — 404
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;

  function render(ctx) {
    return (
      '<div class="shell">' +
      '<div class="notfound">' +
      '<div class="notfound__code u-num">404</div>' +
      '<div class="state__title" style="margin-top:12px">页面不存在或已被移除</div>' +
      '<div class="state__desc">你访问的路径 <code>' +
      util.esc(ctx.path || window.location.hash) +
      "</code> 不在本站栏目内。哈夫克内网仅开放四个栏目。</div>" +
      '<div class="state__action" style="margin-top:20px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' +
      '<a class="btn btn--primary" href="#/">返回关于我们</a>' +
      '<a class="btn btn--ghost" href="#/forum">员工论坛</a>' +
      '<a class="btn btn--ghost" href="#/solutions">解决方案</a>' +
      '<a class="btn btn--ghost" href="#/collect">资料征集</a>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  NS.views = NS.views || {};
  NS.views.notFound = { render: render };
})(window.HAAVK);
