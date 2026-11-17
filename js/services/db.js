/* ==========================================================================
   js/services/db.js — 领域数据服务（v2：全部经由服务端接口）
   保留与 v1 相同的调用风格（视图层改动最小），但数据一律来自 HTTP API。
   任何写入都落到服务端数据库，浏览器不再保存业务数据。
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var api = NS.api;
  var store = NS.store;

  /* ------------------------------ 启动加载 ------------------------------ */

  /**
   * 应用启动：并行拉取 站点配置 / 目录 / 板块 / 当前用户 / 帖子首页
   * 单项失败不阻塞其它项，但会记录到 bootError，由界面给出降级提示。
   */
  function init() {
    var results = { site: false, catalog: false, boards: false, me: false, posts: false };
    return Promise.all([
      api.loadSite().then(function (r) {
        results.site = r.ok;
        if (r.ok) store.dispatch({ type: "site/set", payload: r.data });
        else throw r.error;
      }),
      api.loadCatalog().then(function (r) {
        results.catalog = r.ok;
        if (r.ok) store.dispatch({ type: "catalog/set", payload: r.data });
      }),
      api.get("/api/boards").then(function (r) {
        results.boards = r.ok;
        if (r.ok) store.dispatch({ type: "boards/set", payload: r.data.items || [] });
      }),
      api.get("/api/me").then(function (r) {
        results.me = r.ok;
        if (r.ok) store.dispatch({ type: "user/set", payload: r.data.user || null });
      })
    ])
      .then(function () {
        store.dispatch({ type: "ready/set", payload: true });
        return results;
      })
      .catch(function (err) {
        store.dispatch({ type: "bootError/set", payload: (err && err.message) || "初始化失败" });
        store.dispatch({ type: "ready/set", payload: true });
        return results;
      });
  }

  /** 刷新当前用户（登录/登出/资料变更后调用） */
  function refreshUser() {
    return api.get("/api/me").then(function (r) {
      if (r.ok) store.dispatch({ type: "user/set", payload: r.data.user || null });
      return r;
    });
  }

  /* ------------------------------ 论坛读取 ------------------------------ */

  function loadPosts(opts) {
    opts = opts || {};
    var filter = Object.assign({}, store.getState().postFilter, opts);
    return api
      .get("/api/posts", { board: filter.board, q: filter.q, page: filter.page, pageSize: filter.pageSize })
      .then(function (r) {
        if (r.ok) store.dispatch({ type: "posts/set", payload: r.data });
        return r;
      });
  }

  function getPost(id) {
    return api.get("/api/posts/" + encodeURIComponent(id));
  }

  function getMention(code) {
    return api.get("/api/mentions/" + encodeURIComponent(code));
  }

  function createPost(payload) {
    return api.post("/api/posts", payload);
  }

  function createReply(postId, body) {
    return api.post("/api/posts/" + encodeURIComponent(postId) + "/replies", { body: body });
  }

  /** 点赞 / 取消点赞 */
  function toggleLike(postId) {
    return api.post("/api/posts/" + encodeURIComponent(postId) + "/like");
  }

  function deletePost(id) {
    return api.del("/api/posts/" + encodeURIComponent(id));
  }

  /** 编辑自己的帖子（标题/正文/标签），不扣点数 */
  function updatePost(id, payload) {
    return api.patch("/api/posts/" + encodeURIComponent(id), payload);
  }

  function loadMentionTargets() {
    return api.get("/api/mention-targets");
  }

  /** 寻人启事：提交线索 */
  function submitClue(targetId, detail) {
    return api.post("/api/wanted/" + encodeURIComponent(targetId) + "/clue", { detail: detail || "" });
  }

  /* ------------------------------ 点数 ------------------------------ */

  function pointsSummary() {
    return api.get("/api/points/summary");
  }

  function claimPoints() {
    return api.post("/api/points/claim");
  }

  function pointsLedger(page) {
    return api.get("/api/points/ledger", { page: page || 1, pageSize: 20 });
  }

  /* ------------------------------ 资料与申请 ------------------------------ */

  function updateProfile(payload) {
    return api.patch("/api/me", payload);
  }

  function changePassword(currentPassword, newPassword) {
    return api.post("/api/me/password", { current_password: currentPassword, new_password: newPassword });
  }

  function myRequests() {
    return api.get("/api/me/requests");
  }

  function submitRequest(payload) {
    return api.post("/api/requests", payload);
  }

  /* ------------------------------ 目录便捷查询 ------------------------------ */

  function departments() {
    var c = store.getState().catalog;
    return (c && c.departments) || [];
  }

  function jobs() {
    var c = store.getState().catalog;
    return (c && c.jobs) || [];
  }

  function aiOfficers() {
    var c = store.getState().catalog;
    return (c && c.aiOfficers) || [];
  }

  function deptById(id) {
    return (
      departments().filter(function (d) {
        return d.id === id;
      })[0] || null
    );
  }

  function jobById(id) {
    return (
      jobs().filter(function (j) {
        return j.id === id;
      })[0] || null
    );
  }

  function boardBySlug(slug) {
    return (
      (store.getState().boards || []).filter(function (b) {
        return b.slug === slug;
      })[0] || null
    );
  }

  function boardById(id) {
    return (
      (store.getState().boards || []).filter(function (b) {
        return b.id === id;
      })[0] || null
    );
  }

  /** 站点内容（四大栏目） */
  function site() {
    return store.getState().site || null;
  }

  /** 页脚备案信息 */
  function filing() {
    var s = site();
    return (s && s.filing) || null;
  }

  function settings() {
    var s = site();
    return (s && s.settings) || null;
  }

  /** 点数规则（服务端下发，前端不写死） */
  function pointsRules() {
    var s = settings();
    return (s && s.points) || { dailyAmount: 500, postCost: 50, replyCost: 20 };
  }

  /** 头像地址兜底：任何空值都回退到服务端默认头像 */
  function avatarOf(url) {
    return url && String(url).trim() ? url : api.defaultAvatar;
  }

  NS.db = {
    init: init,
    refreshUser: refreshUser,
    loadPosts: loadPosts,
    getPost: getPost,
    getMention: getMention,
    createPost: createPost,
    createReply: createReply,
    toggleLike: toggleLike,
    deletePost: deletePost,
    updatePost: updatePost,
    loadMentionTargets: loadMentionTargets,
    submitClue: submitClue,
    pointsSummary: pointsSummary,
    claimPoints: claimPoints,
    pointsLedger: pointsLedger,
    updateProfile: updateProfile,
    changePassword: changePassword,
    myRequests: myRequests,
    submitRequest: submitRequest,
    departments: departments,
    jobs: jobs,
    aiOfficers: aiOfficers,
    deptById: deptById,
    jobById: jobById,
    boardBySlug: boardBySlug,
    boardById: boardById,
    site: site,
    filing: filing,
    settings: settings,
    pointsRules: pointsRules,
    avatarOf: avatarOf
  };
})(window.HAAVK);
