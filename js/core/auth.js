/* ==========================================================================
   js/core/auth.js — 认证（v2：全部由服务端完成，浏览器只保存会话 Cookie）
   · 密码哈希、强度校验、唯一性判断全在服务端
   · 前端只做即时反馈用的格式/强度提示（不构成安全边界）
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var api = NS.api;
  var store = NS.store;

  var USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

  /** 账号格式校验（服务端会二次校验，这里只为即时提示） */
  function validateUsername(name) {
    var v = (name || "").trim();
    if (!v) return "请输入账号";
    if (!USERNAME_RE.test(v)) return "账号需为 3–16 位字母、数字或下划线";
    return "";
  }

  function validatePassword(pwd) {
    var p = pwd || "";
    if (!p) return "请输入密码";
    if (p.length < 8) return "密码至少 8 位";
    if (p.length > 64) return "密码不超过 64 位";
    var classes = 0;
    if (/[a-z]/.test(p)) classes++;
    if (/[A-Z]/.test(p)) classes++;
    if (/\d/.test(p)) classes++;
    if (/[^A-Za-z0-9]/.test(p)) classes++;
    if (classes < 2) return "密码需包含至少两类字符（小写、大写、数字、符号）";
    return "";
  }

  function validateNickname(nick) {
    var v = (nick || "").trim();
    if (!v) return "请输入昵称";
    if (Array.from(v).length < 2) return "昵称至少 2 个字符";
    if (Array.from(v).length > 16) return "昵称不超过 16 个字符";
    return "";
  }

  function validateConfirm(pwd, confirm) {
    if (!confirm) return "请再次输入密码";
    if (pwd !== confirm) return "两次输入的密码不一致";
    return "";
  }

  function passwordStrength(pwd) {
    var p = pwd || "";
    var classes = 0;
    if (/[a-z]/.test(p)) classes++;
    if (/[A-Z]/.test(p)) classes++;
    if (/\d/.test(p)) classes++;
    if (/[^A-Za-z0-9]/.test(p)) classes++;
    var level = 0;
    if (p.length >= 8) level++;
    if (p.length >= 12) level++;
    if (classes >= 3) level++;
    if (classes >= 2 && p.length >= 8) level++;
    if (level <= 1) return { score: 1, text: "弱", ok: false };
    if (level === 2) return { score: 2, text: "中", ok: true };
    if (level === 3) return { score: 3, text: "强", ok: true };
    return { score: 4, text: "很强", ok: true };
  }

  /* ------------------------------ 动作 ------------------------------ */

  /** 注册：账号信息 + 办理入职（部门 + 岗位）；不再包含员工/干员选择 */
  function register(input) {
    return api
      .post("/api/auth/register", {
        username: input.username,
        display_name: input.nickname,
        password: input.password,
        password_confirm: input.confirm,
        department_id: input.departmentId,
        job_role_id: input.jobRoleId,
        reason: input.reason || ""
      })
      .then(function (res) {
        if (res.ok) {
          store.dispatch({ type: "user/set", payload: res.data.user });
        }
        return res;
      });
  }

  function login(username, password) {
    return api.post("/api/auth/login", { username: username, password: password }).then(function (res) {
      if (res.ok) store.dispatch({ type: "user/set", payload: res.data.user });
      return res;
    });
  }

  function logout() {
    return api.post("/api/auth/logout").then(function (res) {
      store.dispatch({ type: "user/set", payload: null });
      return res;
    });
  }

  function changePassword(currentPassword, newPassword) {
    return api.post("/api/me/password", { current_password: currentPassword, new_password: newPassword });
  }

  NS.auth = {
    validateUsername: validateUsername,
    validatePassword: validatePassword,
    validateNickname: validateNickname,
    validateConfirm: validateConfirm,
    passwordStrength: passwordStrength,
    register: register,
    login: login,
    logout: logout,
    changePassword: changePassword
  };

  // 会话过期：清理本地状态并引导重新登录
  util.bus.on("auth:expired", function () {
    if (store.getState().user) {
      store.dispatch({ type: "user/set", payload: null });
      NS.toast.warn("登录状态已失效，请重新登录");
    }
  });
})(window.HAAVK);
