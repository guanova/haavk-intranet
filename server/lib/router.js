/* ==========================================================================
   server/lib/router.js — 极简路由（方法 + 参数化路径）
   支持 /api/posts/:id 形式；按注册顺序匹配。
   ========================================================================== */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler, opts = {}) {
    const names = [];
    const source = pattern
      .split("/")
      .map((seg) => {
        if (seg.startsWith(":")) {
          names.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    routes.push({ method, re: new RegExp(`^${source}$`), names, handler, opts });
    return api;
  }

  const api = {
    get: (p, h, o) => add("GET", p, h, o),
    post: (p, h, o) => add("POST", p, h, o),
    patch: (p, h, o) => add("PATCH", p, h, o),
    put: (p, h, o) => add("PUT", p, h, o),
    delete: (p, h, o) => add("DELETE", p, h, o),

    /** 匹配：返回 { handler, params } 或 null（含 405 判定） */
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.names.forEach((n, i) => {
          params[n] = decodeURIComponent(m[i + 1]);
        });
        return { handler: r.handler, params, opts: r.opts };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },

    list() {
      return routes.map((r) => `${r.method} ${r.re.source}`);
    }
  };

  return api;
}
