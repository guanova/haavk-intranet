/* ==========================================================================
   views/profile.js — 个人信息（服务端持久化）
   资料编辑 / 头像上传 / 我的发帖 / 点数流水 / 账号安全 / 入职与变更申请入口
   ========================================================================== */
window.HAAVK = window.HAAVK || {};
(function (NS) {
  "use strict";

  var util = NS.util;

  var REASON_LABEL = {
    signup_bonus: "注册礼金",
    daily_claim: "每日领取",
    post: "发帖消耗",
    reply: "回复消耗",
    admin_adjust: "管理员调整"
  };

  function avatarImg(url, cls, size) {
    var dim = size ? ' style="width:' + size + "px;height:" + size + 'px"' : "";
    return (
      '<img class="' +
      cls +
      '" src="' +
      util.attr(NS.db.avatarOf(url)) +
      '"' +
      dim +
      ' alt="头像" onerror="this.onerror=null;this.src=\'' +
      NS.api.defaultAvatar +
      "'\">"
    );
  }

  function render(ctx) {
    var user = NS.store.getState().user;
    if (!user) return NS.stateBlock({ icon: "lock", title: "请先登录" });
    var dept = NS.db.deptById(user.departmentId);
    var job = NS.db.jobById(user.jobRoleId);
    var rules = NS.db.pointsRules();

    return (
      '<div class="shell" style="padding-top:var(--sp-6)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">' +
      '<div class="panel__title">个人信息 <span>PERSONNEL FILE</span></div>' +
      '<div class="mini-note">账号 <span class="u-strong">' +
      util.esc(user.username) +
      "</span> · 注册于 " +
      util.esc(util.date(user.createdAt)) +
      "</div>" +
      "</div>" +
      '<div class="profile-grid">' +

      /* ---------- 左：概览 ---------- */
      '<aside class="profile-card">' +
      '<div id="avatar-card-host">' +
      avatarImg(user.avatarUrl, "profile-card__avatar", 108) +
      "</div>" +
      '<div class="profile-card__name" id="card-name">' +
      util.esc(user.displayName) +
      "</div>" +
      '<div class="profile-card__sig" id="card-sig">' +
      util.esc(user.signature || "（未填写签名）") +
      "</div>" +
      '<div class="profile-card__rows">' +
      row("所属部门", dept ? dept.name : "待审批") +
      row("岗位", job ? job.name : "待审批") +
      row("在职状态", user.status === "active" ? "在职" : user.status === "suspended" ? "已停用" : "待入职审批") +
      row("注意力余额", util.thousands(user.pointsBalance)) +
      row("角色", roleLabel(user.role)) +
      (user.title ? row("头衔", user.title) : "") +
      "</div>" +
      '<div style="margin-top:18px;display:flex;flex-direction:column;gap:10px">' +
      '<a class="btn btn--primary btn--block" href="#/compose">发布新帖</a>' +
      '<a class="btn btn--ghost btn--block" href="#/onboarding">' +
      (user.status === "active" ? "岗位变更申请" : "办理入职手续") +
      "</a>" +
      (user.role === "site_admin" ? '<a class="btn btn--ghost btn--block" href="#/admin">进入管理面板</a>' : "") +
      '<button type="button" class="btn btn--danger btn--block" id="logout-btn">退出登录</button>' +
      "</div>" +
      "</aside>" +

      /* ---------- 右：表单与列表 ---------- */
      "<div>" +
      // 基本资料
      '<form class="panel" id="profile-form" style="padding:24px" onsubmit="return false">' +
      '<div class="panel__title">基本资料 <span>PROFILE</span></div>' +
      '<div class="panel__rule"></div>' +
      '<div style="margin-top:20px">' +
      '<div class="field">' +
      '<label class="field__label">头像</label>' +
      '<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">' +
      '<div id="avatar-preview-host">' +
      avatarImg(user.avatarUrl, "avatar avatar--lg", 96) +
      "</div>" +
      '<div style="flex:1 1 240px;min-width:220px">' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<input id="avatar-input" type="file" accept="image/png,image/jpeg,image/webp" class="u-sr-only">' +
      '<label for="avatar-input" class="btn btn--ghost btn--sm">选择图片</label>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="avatar-remove">移除头像</button>' +
      "</div>" +
      '<div class="mini-note" id="avatar-note" style="margin-top:8px">PNG / JPG / WEBP，不超过 2MB，建议正方形。</div>' +
      "</div>" +
      "</div>" +
      '<div class="field__error" id="err-avatar"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="p-nick">昵称<span class="req">*</span></label>' +
      '<input class="input" id="p-nick" type="text" maxlength="16" value="' + util.attr(user.displayName) + '">' +
      '<div class="field__error" id="err-nick"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label class="field__label" for="p-sig">个性签名</label>' +
      '<input class="input" id="p-sig" type="text" maxlength="40" placeholder="最多 40 字" value="' +
      util.attr(user.signature || "") +
      '">' +
      "</div>" +
      '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<button type="button" class="btn btn--primary" id="save-profile">保存资料</button>' +
      '<span class="mini-note" id="save-hint"></span>' +
      "</div>" +
      "</div>" +
      "</form>" +

      // 我的发帖
      '<section class="panel" style="margin-top:var(--sp-5);padding:24px">' +
      '<div class="panel__title">我的发帖 <span>MY THREADS</span></div>' +
      '<div class="panel__rule"></div>' +
      '<div style="margin-top:14px" id="my-posts-host">' + NS.skeletonRows(2, 56) + "</div>" +
      "</section>" +

      // 点数流水
      '<section class="panel" style="margin-top:var(--sp-5);padding:24px">' +
      '<div class="panel__title">注意力点数 <span>ATTENTION POINTS</span></div>' +
      '<div class="panel__rule"></div>' +
      '<div style="margin-top:14px">' +
      '<div class="mini-note" style="line-height:2">每日可领取 <span class="u-num">' +
      rules.dailyAmount +
      '</span> 点 · 发帖扣除 <span class="u-num">' +
      rules.postCost +
      '</span> 点 · 回复扣除 <span class="u-num">' +
      rules.replyCost +
      "</span> 点</div>" +
      '<div style="display:flex;gap:12px;align-items:center;margin:14px 0;flex-wrap:wrap">' +
      '<button type="button" class="btn btn--primary btn--sm" id="claim-btn">领取今日点数</button>' +
      '<span class="mini-note" id="claim-hint"></span>' +
      "</div>" +
      '<div id="ledger-host">' + NS.skeletonRows(2, 44) + "</div>" +
      "</div>" +
      "</section>" +

      // 账号安全
      '<section class="panel" style="margin-top:var(--sp-5);padding:24px">' +
      '<div class="panel__title">账号安全 <span>SECURITY</span></div>' +
      '<div class="panel__rule"></div>' +
      '<div style="margin-top:18px;max-width:420px">' +
      '<div class="field"><label class="field__label" for="pw-old">当前密码</label><input class="input" id="pw-old" type="password" autocomplete="current-password"><div class="field__error" id="err-pw-old"></div></div>' +
      '<div class="field"><label class="field__label" for="pw-new">新密码</label><input class="input" id="pw-new" type="password" autocomplete="new-password"><div class="field__hint" id="pw-strength">至少 8 位，且包含两类字符</div><div class="field__error" id="err-pw-new"></div></div>' +
      '<div class="field"><label class="field__label" for="pw-confirm">确认新密码</label><input class="input" id="pw-confirm" type="password" autocomplete="new-password"><div class="field__error" id="err-pw-confirm"></div></div>' +
      '<button type="button" class="btn btn--ghost" id="save-password">修改密码</button>' +
      "</div>" +
      "</section>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function row(k, v) {
    return (
      '<div class="profile-row"><span class="profile-row__k">' +
      util.esc(k) +
      '</span><span class="profile-row__v">' +
      util.esc(String(v)) +
      "</span></div>"
    );
  }

  function roleLabel(role) {
    return (
      { employee: "员工", ai_officer: "AI 高管", chief_secretary: "首席执行秘书办", site_admin: "网站管理员" }[role] || role
    );
  }

  function mount(root) {
    /* ---------------- 头像 ---------------- */
    var input = root.querySelector("#avatar-input");
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var errBox = root.querySelector("#err-avatar");
      var note = root.querySelector("#avatar-note");
      errBox.textContent = "";

      if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
        errBox.textContent = "仅支持 PNG / JPG / WEBP 格式";
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        errBox.textContent = "图片不能超过 2MB";
        return;
      }

      note.textContent = "上传中…";
      // 本地即时预览
      var localUrl = URL.createObjectURL(file);
      root.querySelector("#avatar-preview-host").innerHTML = avatarImg(localUrl, "avatar avatar--lg", 96);

      NS.api.uploadAvatar(file).then(function (res) {
        URL.revokeObjectURL(localUrl);
        if (!res.ok) {
          errBox.textContent = res.error.message;
          note.textContent = "上传失败";
          root.querySelector("#avatar-preview-host").innerHTML = avatarImg(NS.store.getState().user.avatarUrl, "avatar avatar--lg", 96);
          NS.toast.error(res.error.message);
          return;
        }
        note.textContent = "头像已更新";
        NS.store.dispatch({ type: "user/set", payload: res.data.user });
        root.querySelector("#avatar-preview-host").innerHTML = avatarImg(res.data.user.avatarUrl, "avatar avatar--lg", 96);
        var card = root.querySelector("#avatar-card-host");
        if (card) card.innerHTML = avatarImg(res.data.user.avatarUrl, "profile-card__avatar", 108);
        NS.toast.success("头像已更新");
      });
    });

    root.querySelector("#avatar-remove").addEventListener("click", function () {
      NS.api.deleteAvatar().then(function (res) {
        if (!res.ok) {
          NS.toast.error(res.error.message);
          return;
        }
        NS.store.dispatch({ type: "user/set", payload: res.data.user });
        root.querySelector("#avatar-preview-host").innerHTML = avatarImg(res.data.user.avatarUrl, "avatar avatar--lg", 96);
        var card = root.querySelector("#avatar-card-host");
        if (card) card.innerHTML = avatarImg(res.data.user.avatarUrl, "profile-card__avatar", 108);
        NS.toast.info("已恢复默认头像");
      });
    });

    /* ---------------- 保存资料 ---------------- */
    root.querySelector("#save-profile").addEventListener("click", function () {
      var nick = root.querySelector("#p-nick");
      var sig = root.querySelector("#p-sig");
      var errNick = root.querySelector("#err-nick");
      errNick.textContent = "";
      var err = NS.auth.validateNickname(nick.value);
      if (err) {
        errNick.textContent = err;
        NS.toast.error(err);
        return;
      }
      var btn = root.querySelector("#save-profile");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 保存中…';
      NS.db.updateProfile({ display_name: nick.value.trim(), signature: sig.value.trim() }).then(function (res) {
        btn.disabled = false;
        btn.textContent = "保存资料";
        if (!res.ok) {
          var fe = NS.api.fieldErrors(res.error);
          if (fe.display_name) errNick.textContent = fe.display_name;
          NS.toast.error(res.error.message);
          return;
        }
        NS.store.dispatch({ type: "user/set", payload: res.data.user });
        root.querySelector("#card-name").textContent = res.data.user.displayName;
        root.querySelector("#card-sig").textContent = res.data.user.signature || "（未填写签名）";
        root.querySelector("#save-hint").textContent = "已保存 " + util.dateTime(Date.now());
        NS.toast.success("资料已保存");
      });
    });

    /* ---------------- 我的发帖 ---------------- */
    function loadMyPosts() {
      var host = root.querySelector("#my-posts-host");
      var user = NS.store.getState().user;
      NS.api.get("/api/posts", { author: user.id, pageSize: 20 }).then(function (res) {
        if (!res.ok) {
          host.innerHTML = NS.stateBlock({ icon: "warn", title: "读取失败", desc: res.error.message });
          return;
        }
        var items = res.data.items || [];
        if (!items.length) {
          host.innerHTML = NS.stateBlock({
            icon: "doc",
            title: "你还没有发布过帖子",
            desc: "发布后会出现在员工论坛，并在此处可管理。",
            actionHtml: '<a class="btn btn--primary" href="#/compose">去发帖</a>'
          });
          return;
        }
        host.innerHTML = items
          .map(function (p) {
            return (
              '<div class="my-post">' +
              '<div style="flex:1 1 auto;min-width:0">' +
              '<a class="my-post__title" href="#/post/' + util.attr(p.id) + '">' + util.esc(p.title) + "</a>" +
              '<div class="my-post__meta">' +
              util.esc(p.boardName || "") +
              " · 回复 " + (p.replyCount || 0) +
              " · " + util.esc(util.dateTime(p.createdAt)) +
              (p.pendingMention ? ' · <span style="color:#8a6d00">呼叫审核中</span>' : "") +
              "</div></div>" +
              '<button type="button" class="link js-del-post" data-id="' + util.attr(p.id) + '" style="background:none;border:none;padding:0">删除</button>' +
              "</div>"
            );
          })
          .join("");
        host.querySelectorAll(".js-del-post").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var id = btn.getAttribute("data-id");
            NS.modal.confirm("删除帖子", "删除后本帖及其全部回复都将被移除，且不可恢复。", function () {
              NS.db.deletePost(id).then(function (r) {
                if (r.ok) {
                  NS.toast.success("帖子已删除");
                  loadMyPosts();
                } else {
                  NS.toast.error(r.error.message);
                }
              });
            }, "删除");
          });
        });
      });
    }
    loadMyPosts();

    /* ---------------- 点数 ---------------- */
    function loadSummary() {
      NS.db.pointsSummary().then(function (res) {
        if (!res.ok) return;
        var hint = root.querySelector("#claim-hint");
        var t = res.data.today;
        if (t.claimed) {
          hint.textContent = "今日已领取 " + t.amount + " 点（" + util.dateTime(t.claimedAt) + "）";
          var btn = root.querySelector("#claim-btn");
          if (btn) btn.disabled = true;
        } else {
          hint.textContent = "今日尚未领取，可领取 " + t.dailyAmount + " 点";
        }
      });
    }
    loadSummary();

    function loadLedger() {
      var host = root.querySelector("#ledger-host");
      NS.db.pointsLedger(1).then(function (res) {
        if (!res.ok) {
          host.innerHTML = NS.stateBlock({ icon: "warn", title: "流水读取失败", desc: res.error.message });
          return;
        }
        var items = res.data.items || [];
        if (!items.length) {
          host.innerHTML = NS.stateBlock({ icon: "doc", title: "暂无点数流水" });
          return;
        }
        host.innerHTML =
          '<div class="forum-table__head" style="grid-template-columns:1fr 100px 100px 150px"><div>事由</div><div>变动</div><div>余额</div><div>时间</div></div>' +
          items
            .map(function (r) {
              var positive = r.delta > 0;
              return (
                '<div class="forum-row" style="grid-template-columns:1fr 100px 100px 150px;min-height:44px">' +
                '<div style="padding:0 14px">' + util.esc(r.memo || REASON_LABEL[r.reason] || r.reason) + "</div>" +
                '<div style="padding:0 14px;color:' + (positive ? "#2fbf71" : "var(--c-danger)") + '">' +
                (positive ? "+" : "") + r.delta + "</div>" +
                '<div style="padding:0 14px">' + util.thousands(r.balanceAfter) + "</div>" +
                '<div style="padding:0 14px" class="mini-note">' + util.esc(util.dateTime(r.createdAt)) + "</div>" +
                "</div>"
              );
            })
            .join("");
      });
    }
    loadLedger();

    root.querySelector("#claim-btn").addEventListener("click", function (e) {
      var btn = e.target;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 领取中…';
      NS.db.claimPoints().then(function (res) {
        btn.innerHTML = "领取今日点数";
        if (!res.ok) {
          if (res.error.code === "CONFLICT") {
            NS.toast.warn("今日的注意力点数已领取");
            root.querySelector("#claim-hint").textContent = "今日已领取";
          } else {
            NS.toast.error(res.error.message);
          }
          return;
        }
        NS.toast.success("已领取 " + res.data.amount + " 点注意力");
        NS.db.refreshUser().then(function () {
          var u = NS.store.getState().user;
          var balanceRow = root.querySelector(".profile-card__rows");
          if (balanceRow && u) {
            var rows = balanceRow.querySelectorAll(".profile-row__v");
            if (rows[3]) rows[3].textContent = util.thousands(u.pointsBalance);
          }
          NS.shell.refreshAttention();
        });
        loadSummary();
        loadLedger();
      });
    });

    /* ---------------- 修改密码 ---------------- */
    var pwNew = root.querySelector("#pw-new");
    pwNew.addEventListener("input", function () {
      var st = NS.auth.passwordStrength(pwNew.value);
      var hint = root.querySelector("#pw-strength");
      if (!pwNew.value) {
        hint.textContent = "至少 8 位，且包含两类字符";
        hint.style.color = "";
        return;
      }
      hint.textContent = "强度：" + st.text + (st.ok ? "" : "（不满足最低要求）");
      hint.style.color = st.score >= 3 ? "#2fbf71" : st.score === 2 ? "#8a6d00" : "var(--c-danger)";
    });

    root.querySelector("#save-password").addEventListener("click", function () {
      var btn = root.querySelector("#save-password");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 提交中…';
      ["err-pw-old", "err-pw-new", "err-pw-confirm"].forEach(function (id) {
        root.querySelector("#" + id).textContent = "";
      });
      NS.auth
        .changePassword(root.querySelector("#pw-old").value, pwNew.value, root.querySelector("#pw-confirm").value)
        .then(function (res) {
          btn.disabled = false;
          btn.textContent = "修改密码";
          if (!res.ok) {
            var map = { current_password: "err-pw-old", new_password: "err-pw-new" };
            var box = root.querySelector("#" + (map[res.error.details && res.error.details.field] || "err-pw-new"));
            if (box) box.textContent = res.error.message;
            NS.toast.error(res.error.message);
            return;
          }
          root.querySelector("#pw-old").value = "";
          pwNew.value = "";
          root.querySelector("#pw-confirm").value = "";
          NS.toast.success("密码已更新");
        });
    });

    /* ---------------- 退出 ---------------- */
    root.querySelector("#logout-btn").addEventListener("click", function () {
      NS.modal.confirm("退出登录", "退出后需要重新登录才能发帖与维护资料。", function () {
        NS.auth.logout().then(function () {
          NS.toast.info("已退出登录");
          NS.router.go("/login");
        });
      }, "退出");
    });
  }

  NS.views = NS.views || {};
  NS.views.profile = { render: render, mount: mount, avatarImg: avatarImg };
})(window.HAAVK);
