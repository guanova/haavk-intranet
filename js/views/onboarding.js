/* ==========================================================================
   views/onboarding.js — 办理入职手续 / 岗位变更
   · 待入职员工：查看入职申请状态，未通过可重新提交
   · 在职员工：提交岗位变更或部门变更申请（须经网站管理员审批）
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;

  var TYPE_LABEL = { onboarding: "办理入职", job_change: "岗位变更", dept_change: "部门变更" };
  var STATUS_LABEL = { pending: "审批中", approved: "已通过", rejected: "未通过" };

  function statusTag(status) {
    var cls = status === "approved" ? "tag" : status === "rejected" ? "tag tag--red" : "tag tag--pending";
    return '<span class="' + cls + '">' + util.esc(STATUS_LABEL[status] || status) + "</span>";
  }

  function renderForm(user, mode, latest) {
    var depts = NS.db.departments();
    var jobs = NS.db.jobs();
    var isChange = mode !== "onboarding";

    var deptOptions = depts
      .map(function (d) {
        return (
          '<option value="' +
          util.attr(d.id) +
          '"' +
          (user.departmentId === d.id ? " selected" : "") +
          ">" +
          util.esc(d.name) +
          (d.confidence === "pending" ? "（待确认）" : "") +
          "</option>"
        );
      })
      .join("");

    var jobOptions = jobs
      .map(function (j) {
        return (
          '<option value="' +
          util.attr(j.id) +
          '"' +
          (user.jobRoleId === j.id ? " selected" : "") +
          ">" +
          util.esc(j.name) +
          (j.enName ? " · " + util.esc(j.enName) : "") +
          (j.confidence === "pending" ? "（待确认）" : "") +
          "</option>"
        );
      })
      .join("");

    return (
      '<section class="panel" style="padding:24px">' +
      '<div class="panel__title">' +
      (isChange ? "岗位变更申请" : "入职手续") +
      " <span>" +
      (isChange ? "TRANSFER REQUEST" : "ONBOARDING") +
      "</span></div>" +
      '<div class="panel__rule"></div>' +
      '<div style="margin-top:20px;max-width:520px">' +
      (latest && latest.status === "pending"
        ? '<div class="banner">你已提交一份' +
          util.esc(TYPE_LABEL[latest.type] || latest.type) +
          "申请，正在等待网站管理员审批。审批期间不可重复提交。</div>"
        : "") +
      (latest && latest.status === "rejected"
        ? '<div class="banner">上一份申请未通过' +
          (latest.review_note ? "：" + util.esc(latest.review_note) : "") +
          "。你可以修改后重新提交。</div>"
        : "") +
      '<form id="onboarding-form" onsubmit="return false">' +
      '<input type="hidden" id="ob-type" value="' +
      util.attr(isChange ? "job_change" : "onboarding") +
      '">' +
      '<div class="field">' +
      '<label class="field__label" for="ob-dept">所属部门<span class="req">*</span></label>' +
      '<select class="select" id="ob-dept">' +
      deptOptions +
      "</select>" +
      '<div class="field__error" id="err-ob-dept"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="ob-job">岗位<span class="req">*</span></label>' +
      '<select class="select" id="ob-job">' +
      jobOptions +
      "</select>" +
      '<div class="field__error" id="err-ob-job"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="ob-reason">' +
      (isChange ? "变更理由" : "入职说明（可选）") +
      "</label>" +
      '<textarea class="textarea" id="ob-reason" style="min-height:100px" maxlength="200" placeholder="' +
      (isChange ? "请说明岗位变更的原因，便于管理员审批。" : "可简要说明你的岗位职责或期望。") +
      '"></textarea>' +
      "</div>" +
      '<button type="button" class="btn btn--primary" id="ob-submit"' +
      (latest && latest.status === "pending" ? " disabled" : "") +
      ">" +
      (isChange ? "提交变更申请" : "提交入职申请") +
      "</button>" +
      "</form>" +
      "</div>" +
      "</section>"
    );
  }

  function renderHistory(items) {
    if (!items || !items.length) {
      return NS.stateBlock({ icon: "doc", title: "暂无申请记录", desc: "提交后这里会显示审批进度。" });
    }
    return items
      .map(function (r) {
        return (
          '<div class="forum-row" style="grid-template-columns:1fr 120px 160px">' +
          '<div class="forum-row__main">' +
          '<div style="min-width:0">' +
          '<div class="forum-row__title">' +
          util.esc(TYPE_LABEL[r.type] || r.type) +
          " · " +
          util.esc(r.department_name || "—") +
          " / " +
          util.esc(r.job_role_name || "—") +
          "</div>" +
          '<div class="mini-note">' +
          util.esc(util.dateTime(r.created_at)) +
          (r.reason ? " · " + util.esc(r.reason) : "") +
          (r.review_note ? " · 审批意见：" + util.esc(r.review_note) : "") +
          "</div>" +
          "</div>" +
          "</div>" +
          '<div style="padding:0 12px">' +
          statusTag(r.status) +
          "</div>" +
          '<div class="forum-row__last">' +
          (r.reviewed_at ? util.esc(util.dateTime(r.reviewed_at)) : "--") +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function render(ctx) {
    var user = NS.store.getState().user;
    if (!user) return NS.stateBlock({ icon: "lock", title: "请先登录" });
    var pending = null;
    return (
      '<div class="shell" style="padding-top:var(--sp-6)" id="onboarding-root">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
      '<div class="panel__title">入职与岗位 <span>PERSONNEL ONBOARDING</span></div>' +
      '<div class="mini-note">当前状态：' +
      (user.status === "active" ? "在职" : user.status === "suspended" ? "已停用" : "待入职审批") +
      "</div>" +
      "</div>" +
      '<div id="onboarding-form-host">' +
      NS.loadingBlock("正在读取申请状态…") +
      "</div>" +
      '<section style="margin-top:var(--sp-5)">' +
      '<div class="panel__title" style="margin-bottom:10px">申请记录 <span>REQUEST HISTORY</span></div>' +
      '<div id="onboarding-history">' +
      NS.skeletonRows(2, 64) +
      "</div>" +
      "</section>" +
      "</div>"
    );
  }

  function mount(root, ctx) {
    var formHost = root.querySelector("#onboarding-form-host");
    var historyHost = root.querySelector("#onboarding-history");

    function load() {
      NS.db.myRequests().then(function (res) {
        var user = NS.store.getState().user;
        if (!res.ok) {
          formHost.innerHTML = NS.stateBlock({
            icon: "warn",
            title: "读取申请状态失败",
            desc: res.error.message,
            actionHtml: '<button class="btn btn--ghost" id="ob-retry">重试</button>'
          });
          var retry = root.querySelector("#ob-retry");
          if (retry) retry.addEventListener("click", load);
          return;
        }
        var items = res.data.items || [];
        var pending = res.data.pending || null;
        var mode = user && user.status === "active" ? "change" : "onboarding";
        formHost.innerHTML = renderForm(user, mode, pending);
        historyHost.innerHTML = renderHistory(items);
        bindForm();
      });
    }

    function bindForm() {
      var submit = root.querySelector("#ob-submit");
      if (!submit) return;
      submit.addEventListener("click", function () {
        var type = root.querySelector("#ob-type").value;
        var deptId = Number.parseInt(root.querySelector("#ob-dept").value, 10);
        var jobId = Number.parseInt(root.querySelector("#ob-job").value, 10);
        var reason = root.querySelector("#ob-reason").value.trim();
        root.querySelector("#err-ob-dept").textContent = "";
        root.querySelector("#err-ob-job").textContent = "";

        submit.disabled = true;
        submit.innerHTML = '<span class="spinner"></span> 提交中…';

        NS.db.submitRequest({ type: type, department_id: deptId, job_role_id: jobId, reason: reason }).then(function (res) {
          submit.disabled = false;
          submit.textContent = type === "onboarding" ? "提交入职申请" : "提交变更申请";
          if (!res.ok) {
            var fe = NS.api.fieldErrors(res.error);
            if (fe.department_id) root.querySelector("#err-ob-dept").textContent = fe.department_id;
            if (fe.job_role_id) root.querySelector("#err-ob-job").textContent = fe.job_role_id;
            NS.toast.error(res.error.message);
            return;
          }
          NS.toast.success("申请已提交，等待网站管理员审批");
          NS.db.refreshUser();
          load();
        });
      });
    }

    load();
  }

  NS.views = NS.views || {};
  NS.views.onboarding = { render: render, mount: mount };
})(window.HAAVK);
