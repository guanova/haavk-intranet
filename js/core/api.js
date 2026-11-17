/* ==========================================================================
   js/core/api.js — 服务端接口客户端
   · 统一 fetch 封装：同源 Cookie 会话、JSON、错误码归一化
   · GET /api/site 结果缓存到 api.siteCache，并广播 "site:loaded"
   · 会话失效（401）自动清理本地登录态并广播 "auth:expired"
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;

  function buildQuery(query) {
    if (!query) return "";
    var parts = [];
    Object.keys(query).forEach(function (k) {
      var v = query[k];
      if (v === undefined || v === null || v === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /**
   * @param {string} path  形如 "/api/posts"
   * @param {object} [opts] { method, body, query, headers, raw }
   * @returns {Promise<{ok:true,data:*} | {ok:false,error:{code,message,details,traceId}}>}
   */
  function request(path, opts) {
    opts = opts || {};
    var url = path + buildQuery(opts.query);
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    var init = {
      method: opts.method || "GET",
      headers: headers,
      credentials: "same-origin"
    };

    if (opts.body !== undefined && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    } else if (opts.body instanceof FormData) {
      init.body = opts.body;
    }

    return fetch(url, init)
      .then(function (res) {
        if (opts.raw) return res;
        var ctype = res.headers.get("content-type") || "";
        if (ctype.indexOf("application/json") < 0) {
          // 非 JSON 响应（多为网关/静态回退），归一化为可读错误
          return res.text().then(function (text) {
            return {
              ok: false,
              error: {
                code: res.status === 404 ? "NOT_FOUND" : "INTERNAL",
                message:
                  res.status === 404
                    ? "接口不存在或服务未启动"
                    : "服务端返回了非预期内容（HTTP " + res.status + "）",
                details: { snippet: String(text || "").slice(0, 120) }
              }
            };
          });
        }
        return res.json().then(function (json) {
          if (json && json.ok === true) {
            return { ok: true, data: json.data === undefined ? {} : json.data };
          }
          var err = (json && json.error) || {};
          var out = {
            ok: false,
            error: {
              code: err.code || "INTERNAL",
              message: err.message || "请求失败（HTTP " + res.status + "）",
              details: err.details || {},
              traceId: err.traceId || ""
            },
            status: res.status
          };
          if (res.status === 401) {
            util.bus.emit("auth:expired", out.error);
          }
          return out;
        });
      })
      .catch(function (e) {
        return {
          ok: false,
          error: {
            code: "NETWORK",
            message: "网络异常，无法连接服务器。请确认服务已启动后重试。",
            details: { raw: String((e && e.message) || e) }
          }
        };
      });
  }

  /** GET /api/site：全局站点配置与四大栏目内容，缓存并广播 */
  function loadSite(force) {
    if (api.siteCache && !force) return Promise.resolve({ ok: true, data: api.siteCache });
    return request("/api/site").then(function (res) {
      if (res.ok) {
        api.siteCache = res.data;
        util.bus.emit("site:loaded", res.data);
      }
      return res;
    });
  }

  /** GET /api/catalog：部门 / 岗位 / AI 高管 */
  function loadCatalog(force) {
    if (api.catalogCache && !force) return Promise.resolve({ ok: true, data: api.catalogCache });
    return request("/api/catalog").then(function (res) {
      if (res.ok) {
        api.catalogCache = res.data;
        util.bus.emit("catalog:loaded", res.data);
      }
      return res;
    });
  }

  var api = {
    request: request,
    get: function (path, query) {
      return request(path, { query: query });
    },
    post: function (path, body) {
      return request(path, { method: "POST", body: body === undefined ? {} : body });
    },
    patch: function (path, body) {
      return request(path, { method: "PATCH", body: body === undefined ? {} : body });
    },
    del: function (path, body) {
      return request(path, { method: "DELETE", body: body });
    },

    /** 头像上传（服务端做魔数校验与落盘） */
    uploadAvatar: function (file) {
      var fd = new FormData();
      fd.append("file", file, file.name || "avatar");
      return request("/api/me/avatar", { method: "POST", body: fd });
    },
    deleteAvatar: function () {
      return request("/api/me/avatar", { method: "DELETE" });
    },

    loadSite: loadSite,
    loadCatalog: loadCatalog,
    siteCache: null,
    catalogCache: null,

    /** 默认头像（服务端提供，永不 404） */
    defaultAvatar: "/media/default-avatar.svg",

    /** 统一的错误提示 */
    toastError: function (err, fallback) {
      var msg = (err && err.message) || fallback || "操作失败，请稍后重试";
      NS.toast.error(msg);
      return msg;
    },

    /**
     * 把错误映射到字段级提示：返回 { fieldName: message }
     * 服务端 details.fields 形如 { username: "该账号已被注册" }
     */
    fieldErrors: function (err) {
      var out = {};
      if (err && err.details && err.details.fields) {
        Object.keys(err.details.fields).forEach(function (k) {
          out[k] = err.details.fields[k];
        });
      }
      return out;
    }
  };

  NS.api = api;
})(window.HAAVK);
