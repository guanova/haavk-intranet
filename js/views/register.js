/* ==========================================================================
   views/register.js — 注册（2 步）
   step1 账号信息 → step2 办理入职手续（选择部门 + 岗位，提交入职申请）
   ⚠️ v2 已移除「指定员工 / 干员」选项
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;
  var api = NS.api;

  var draft = { step: 1, username: "", nickname: "", password: "", confirm: "", departmentId: 0, jobRoleId: 0, reason: "" };

  function stepsHtml(step) {
    var labels = ["账号信息", "办理入职手续"];
    return (
      '<div class="steps">' +
      labels
        .map(function (label, i) {
          var n = i + 1;
          var cls = n === step ? "is-active" : n < step ? "is-done" : "";
          return (
            '<div class="step ' +
            cls +
            '"><span class="step__num">' +
            (n < step ? "✓" : n) +
            "</span><span>" +
            util.esc(label) +
            "</span></div>" +
            (n < labels.length ? '<span class="step__sep"></span>' : "")
          );
        })
        .join("") +
      "</div>"
    );
  }

  /* ------------------------------ step 1 ------------------------------ */

  function stepAccount() {
    return (
      '<form id="reg-step1" onsubmit="return false">' +
      '<div class="field">' +
      '<label class="field__label" for="r-user">账号<span class="req">*</span></label>' +
      '<input class="input" id="r-user" type="text" autocomplete="username" maxlength="16" placeholder="3–16 位字母、数字或下划线" value="' +
      util.attr(draft.username) +
      '">' +
      '<div class="field__hint">登录时使用，注册后不可修改</div>' +
      '<div class="field__error" id="err-r-user"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="r-nick">昵称<span class="req">*</span></label>' +
      '<input class="input" id="r-nick" type="text" maxlength="16" placeholder="2–16 字，将显示在发帖人处" value="' +
      util.attr(draft.nickname) +
      '">' +
      '<div class="field__error" id="err-r-nick"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="r-pass">密码<span class="req">*</span></label>' +
      '<input class="input" id="r-pass" type="password" autocomplete="new-password" maxlength="64" placeholder="至少 8 位">' +
      '<div class="field__hint" id="r-strength">至少 8 位，且包含两类字符（小写、大写、数字、符号）</div>' +
      '<div class="field__error" id="err-r-pass"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="r-confirm">确认密码<span class="req">*</span></label>' +
      '<input class="input" id="r-confirm" type="password" autocomplete="new-password" maxlength="64" placeholder="再次输入密码">' +
      '<div class="field__error" id="err-r-confirm"></div>' +
      "</div>" +
      '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<button type="button" class="btn btn--primary" id="to-step2">下一步：办理入职手续</button>' +
      '<a class="link" href="#/login">已有账号，去登录</a>' +
      "</div>" +
      "</form>"
    );
  }

  /* ------------------------------ step 2 ------------------------------ */

  function stepOnboarding() {
    var depts = NS.db.departments();
    var jobs = NS.db.jobs();
    var dept = NS.db.deptById(draft.departmentId);
    var job = NS.db.jobById(draft.jobRoleId);

    var deptItems = depts.length
      ? depts
          .map(function (d) {
            return (
              '<button type="button" class="pick-card' +
              (d.id === draft.departmentId ? " is-active" : "") +
              '" data-id="' +
              util.attr(d.id) +
              '" data-name="' +
              util.attr(d.name) +
              '">' +
              '<div class="pick-card__name">' +
              util.esc(d.name) +
              (d.enName ? '<span class="mini-note">' + util.esc(d.enName) + "</span>" : "") +
              (d.confidence === "pending" ? NS.sourceBadge({ confidence: "pending" }) : "") +
              "</div>" +
              (d.description ? '<div class="pick-card__desc">' + util.esc(d.description) + "</div>" : "") +
              "</button>"
            );
          })
          .join("")
      : NS.stateBlock({ icon: "info", title: "暂无可选部门", desc: "请稍后重试或联系网站管理员。" });

    var jobItems = jobs.length
      ? jobs
          .map(function (j) {
            return (
              '<button type="button" class="choice' +
              (j.id === draft.jobRoleId ? " is-checked" : "") +
              '" data-job="' +
              util.attr(j.id) +
              '" title="' +
              util.attr(j.description || "") +
              '">' +
              util.esc(j.name) +
              (j.enName ? " · " + util.esc(j.enName) : "") +
              "</button>"
            );
          })
          .join("")
      : NS.stateBlock({ icon: "info", title: "暂无可选岗位" });

    return (
      '<div id="reg-step2">' +
      '<p class="panel__text" style="margin-bottom:16px">请填写入职手续。入职申请将由网站管理员审批，审批通过后即可在员工论坛发帖与回复，并可按集团规定变更岗位。</p>' +
      '<div class="field">' +
      '<label class="field__label">所属部门<span class="req">*</span></label>' +
      '<div class="pick-toolbar"><input class="input js-dept-search" type="text" placeholder="搜索部门…" aria-label="搜索部门"></div>' +
      '<div class="pick-grid" id="pick-dept">' +
      deptItems +
      "</div>" +
      '<div class="field__error" id="err-dept"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label">岗位<span class="req">*</span></label>' +
      '<div class="chip-row" id="pick-job">' +
      jobItems +
      "</div>" +
      '<div class="field__error" id="err-job"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="r-reason">入职说明（可选）</label>' +
      '<textarea class="textarea" id="r-reason" style="min-height:80px" maxlength="200" placeholder="可简要说明你的岗位职责或期望">' +
      util.esc(draft.reason) +
      "</textarea>" +
      "</div>" +
      '<div class="panel" style="padding:14px 16px;margin-bottom:18px">' +
      '<div class="mini-note" style="line-height:1.9">入职信息确认：部门 <span class="u-strong">' +
      util.esc(dept ? dept.name : "未选择") +
      '</span> · 岗位 <span class="u-strong">' +
      util.esc(job ? job.name : "未选择") +
      "</span></div>" +
      "</div>" +
      '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<button type="button" class="btn btn--ghost" id="to-step1">上一步</button>' +
      '<button type="button" class="btn btn--primary" id="finish-reg">提交注册并办理入职</button>' +
      "</div>" +
      "</div>"
    );
  }

  /* ------------------------------ render ------------------------------ */

  function render(ctx) {
    draft.step = 1;
    return (
      '<div class="shell">' +
      '<div class="auth-page" style="grid-template-columns:0.85fr 1.15fr">' +
      '<aside class="auth-page__aside">' +
      "<h2>加入哈夫克</h2>" +
      "<p>新员工须先完成账号注册，再办理入职手续。</p>" +
      '<ul class="auth-aside-list">' +
      "<li>入职手续：所属部门与岗位</li>" +
      "<li>审批通过后方可在员工论坛发帖与回复</li>" +
      "<li>岗位变更须向网站管理员提交申请</li>" +
      "</ul>" +
      "</aside>" +
      '<div class="auth-page__main">' +
      '<div class="auth-page__title">注册 <span>SIGN UP</span></div>' +
      '<div class="auth-page__rule"></div>' +
      '<div id="reg-host">' +
      stepsHtml(1) +
      stepAccount() +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  /* ------------------------------ mount ------------------------------ */

  function mount(root) {
    var host = root.querySelector("#reg-host");

    function goStep(n) {
      draft.step = n;
      host.innerHTML = n === 1 ? stepsHtml(1) + stepAccount() : stepsHtml(2) + stepOnboarding();
      if (n === 1) bindStep1();
      else bindStep2();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function bindStep1() {
      var user = host.querySelector("#r-user");
      var nick = host.querySelector("#r-nick");
      var pass = host.querySelector("#r-pass");
      var confirm = host.querySelector("#r-confirm");
      user.focus();

      pass.addEventListener("input", function () {
        var hint = host.querySelector("#r-strength");
        var st = NS.auth.passwordStrength(pass.value);
        if (!pass.value) {
          hint.textContent = "至少 8 位，且包含两类字符（小写、大写、数字、符号）";
          hint.style.color = "";
          return;
        }
        hint.textContent = "强度：" + st.text;
        hint.style.color = st.score >= 3 ? "#2fbf71" : st.score === 2 ? "#8a6d00" : "var(--c-danger)";
      });

      host.querySelector("#to-step2").addEventListener("click", function () {
        var errs = {
          "err-r-user": NS.auth.validateUsername(user.value),
          "err-r-nick": NS.auth.validateNickname(nick.value),
          "err-r-pass": NS.auth.validatePassword(pass.value),
          "err-r-confirm": NS.auth.validateConfirm(pass.value, confirm.value)
        };
        var bad = false;
        Object.keys(errs).forEach(function (id) {
          host.querySelector("#" + id).textContent = errs[id] || "";
          if (errs[id]) bad = true;
        });
        if (bad) {
          NS.toast.error("请先修正账号信息中的错误");
          return;
        }
        draft.username = user.value.trim();
        draft.nickname = nick.value.trim();
        draft.password = pass.value;
        draft.confirm = confirm.value;
        goStep(2);
      });
    }

    function bindStep2() {
      var deptWrap = host.querySelector("#pick-dept");
      var search = host.querySelector(".js-dept-search");

      if (search) {
        search.addEventListener(
          "input",
          util.debounce(function () {
            var kw = util.normName ? util.normName(search.value) : search.value.trim().toLowerCase();
            deptWrap.querySelectorAll(".pick-card[data-id]").forEach(function (card) {
              var name = (card.getAttribute("data-name") || "").toLowerCase();
              card.style.display = !kw || name.indexOf(kw) >= 0 ? "" : "none";
            });
          }, 140)
        );
      }

      deptWrap.addEventListener("click", function (e) {
        var card = e.target.closest(".pick-card[data-id]");
        if (!card) return;
        deptWrap.querySelectorAll(".pick-card").forEach(function (c) {
          c.classList.remove("is-active");
        });
        card.classList.add("is-active");
        draft.departmentId = Number.parseInt(card.getAttribute("data-id"), 10);
        host.querySelector("#err-dept").textContent = "";
      });

      host.querySelector("#pick-job").addEventListener("click", function (e) {
        var btn = e.target.closest(".choice[data-job]");
        if (!btn) return;
        host.querySelectorAll("#pick-job .choice").forEach(function (b) {
          b.classList.remove("is-checked");
        });
        btn.classList.add("is-checked");
        draft.jobRoleId = Number.parseInt(btn.getAttribute("data-job"), 10);
        host.querySelector("#err-job").textContent = "";
      });

      host.querySelector("#to-step1").addEventListener("click", function () {
        goStep(1);
      });

      host.querySelector("#finish-reg").addEventListener("click", function () {
        var errDept = host.querySelector("#err-dept");
        var errJob = host.querySelector("#err-job");
        errDept.textContent = "";
        errJob.textContent = "";
        if (!draft.departmentId) {
          errDept.textContent = "请选择所属部门";
          NS.toast.error("请选择所属部门");
          return;
        }
        if (!draft.jobRoleId) {
          errJob.textContent = "请选择岗位";
          NS.toast.error("请选择岗位");
          return;
        }
        draft.reason = host.querySelector("#r-reason").value.trim();

        var btn = host.querySelector("#finish-reg");
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 正在提交…';

        NS.auth.register(draft).then(function (res) {
          btn.disabled = false;
          btn.textContent = "提交注册并办理入职";
          if (!res.ok) {
            var fe = api.fieldErrors(res.error);
            if (fe.username) {
              draft.step = 1;
              goStep(1);
              host.querySelector("#err-r-user").textContent = fe.username;
            } else if (fe.password) {
              draft.step = 1;
              goStep(1);
              host.querySelector("#err-r-pass").textContent = fe.password;
            } else if (fe.department_id) {
              errDept.textContent = fe.department_id;
            } else if (fe.job_role_id) {
              errJob.textContent = fe.job_role_id;
            }
            NS.toast.error(res.error.message);
            return;
          }
          NS.toast.success("注册成功，入职申请已提交");
          NS.router.go("/onboarding");
        });
      });
    }

    bindStep1();
  }

  NS.views = NS.views || {};
  NS.views.register = { render: render, mount: mount };
})(window.HAAVK);
