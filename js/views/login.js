/* ==========================================================================
   views/login.js — 登录
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;

  function render(ctx) {
    return (
      '<div class="shell">' +
      '<div class="auth-page">' +
      '<aside class="auth-page__aside">' +
      "<h2>哈夫克内网</h2>" +
      "<p>集团员工门户</p>" +
      '<ul class="auth-aside-list">' +
      "<li>员工论坛：发帖与回复讨论</li>" +
      "<li>解决方案：集团物资与装备申领</li>" +
      "<li>资料征集：投递活动截图与设定资料</li>" +
      "<li>个人信息：岗位、部门与资料维护</li>" +
      "</ul>" +
      '<p style="margin-top:32px">注意力点数用于论坛行为，每日可在页面右上角领取。</p>' +
      "</aside>" +
      '<div class="auth-page__main">' +
      '<div class="auth-page__title">登录 <span>SIGN IN</span></div>' +
      '<div class="auth-page__rule"></div>' +
      '<form id="login-form" onsubmit="return false">' +
      '<div class="field">' +
      '<label class="field__label" for="l-user">账号</label>' +
      '<input class="input" id="l-user" type="text" autocomplete="username" maxlength="32" placeholder="3–16 位字母、数字或下划线">' +
      '<div class="field__error" id="err-l-user"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="l-pass">密码</label>' +
      '<input class="input" id="l-pass" type="password" autocomplete="current-password" maxlength="64" placeholder="至少 8 位">' +
      '<div class="field__error" id="err-l-pass"></div>' +
      "</div>" +
      '<div class="field__error" id="err-l-global" style="margin-bottom:12px"></div>' +
      '<button type="button" class="btn btn--primary btn--block" id="login-btn">登录</button>' +
      "</form>" +
      '<div class="auth-page__foot">还没有账号？<a href="#/register">立即注册</a> · <a href="#/">返回首页</a></div>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function mount(root, ctx) {
    var redirect = ctx.query.redirect || "";
    var user = root.querySelector("#l-user");
    var pass = root.querySelector("#l-pass");
    var btn = root.querySelector("#login-btn");

    function submit() {
      ["err-l-user", "err-l-pass", "err-l-global"].forEach(function (id) {
        root.querySelector("#" + id).textContent = "";
      });
      user.classList.remove("is-error");
      pass.classList.remove("is-error");

      var errU = NS.auth.validateUsername(user.value);
      if (errU) {
        root.querySelector("#err-l-user").textContent = errU;
        user.classList.add("is-error");
        return;
      }
      if (!pass.value) {
        root.querySelector("#err-l-pass").textContent = "请输入密码";
        pass.classList.add("is-error");
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 登录中…';

      NS.auth.login(user.value, pass.value).then(function (res) {
        btn.disabled = false;
        btn.textContent = "登录";
        if (!res.ok) {
          var fe = NS.api.fieldErrors(res.error);
          if (fe.username) {
            root.querySelector("#err-l-user").textContent = fe.username;
            user.classList.add("is-error");
          }
          root.querySelector("#err-l-pass").textContent = res.error.code === "RATE_LIMITED" ? "" : res.error.message;
          root.querySelector("#err-l-global").textContent = res.error.message;
          return;
        }
        var u = res.data.user;
        NS.toast.success("欢迎回来，" + u.displayName);
        if (redirect) {
          NS.router.go(redirect);
          return;
        }
        if (u.role === "site_admin") NS.router.go("/admin");
        else if (u.status !== "active") NS.router.go("/onboarding");
        else NS.router.go("/forum");
      });
    }

    btn.addEventListener("click", submit);
    root.querySelector("#login-form").addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
    user.focus();
  }

  NS.views = NS.views || {};
  NS.views.login = { render: render, mount: mount };
})(window.HAAVK);
