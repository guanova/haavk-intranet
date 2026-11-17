/* ==========================================================================
   tests/server/seed-pending.js — 为「入职审批」写路径测试准备待审数据
   仅用于本地验收：创建一个待入职员工，使其产生一条 onboarding 待审申请。
   用法：node tests/server/seed-pending.js
   ========================================================================== */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// 默认打到线上库；测试脚本自己负责追加后缀防止账号冲突
process.env.HAAVK_DB = process.env.HAAVK_DB || path.resolve(process.cwd(), "data/haavk.db");

const { get, run, getDb } = await import("../../server/lib/db.js");
const { createUser, findUserByUsername } = await import("../../server/lib/auth.js");

const suffix = String(Date.now()).slice(-6);
const username = "pending_" + suffix;

const dept = get("SELECT id, name FROM departments WHERE is_active = 1 ORDER BY sort_order LIMIT 1");
const job = get("SELECT id, name FROM jobs WHERE is_active = 1 ORDER BY sort_order LIMIT 1");
if (!dept || !job) throw new Error("缺少部门或岗位数据，请先执行 seed");

if (findUserByUsername(username)) throw new Error("账号已存在，请重试");

const userId = createUser({
  username,
  displayName: "待审员工" + suffix,
  password: "Pending#2026",
  role: "employee",
  status: "pending_onboarding"
});

run(
  `INSERT INTO requests (user_id, type, payload, status, created_at)
   VALUES (?,?,?,?,?)`,
  userId,
  "onboarding",
  JSON.stringify({ department_id: dept.id, job_role_id: job.id, reason: "写路径验收：待审批" }),
  "pending",
  Date.now()
);

const req = get("SELECT id, status FROM requests WHERE user_id = ? ORDER BY id DESC LIMIT 1", userId);
console.log(
  JSON.stringify({
    username,
    displayName: "待审员工" + suffix,
    userId,
    requestId: req.id,
    status: req.status,
    department: dept.name,
    job: job.name
  })
);

getDb().close();
void fs;
void os;
