/* ==========================================================================
   server/tools/agent-token.js — 站点自动化管家令牌（给 AI / 脚本用）
   背景：管理面板只能由人点，脚本或 AI 需要一个可撤销的机器身份。令牌
         明文只在创建时输出一次，库里只存 sha256；权限等同其所有者
         （必须是 site_admin），且不能管理员互相造令牌。
   用法：
     node server/tools/agent-token.js list
     node server/tools/agent-token.js create --name "lead-agent" [--owner webops_admin] [--scope admin]
     node server/tools/agent-token.js revoke --id 3
   校验：
     curl -H "x-agent-token: hk_..." http://127.0.0.1:8137/api/agent/ping
   ========================================================================== */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.HAAVK_DB =
  process.env.HAAVK_DB || path.resolve(__dirname, "../../data/haavk.db");

const { get } = await import("../lib/db.js");
const { createAgentToken, listAgentTokens, revokeAgentToken } = await import(
  "../lib/agent.js"
);
const { findUserByUsername } = await import("../lib/auth.js");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return fallback;
}

const cmd = process.argv[2] || "list";

if (cmd === "list") {
  const rows = listAgentTokens();
  if (!rows.length) {
    console.log("（暂无令牌）");
  } else {
    console.log("id  名称                 所有者            scope   用过   最近使用            状态");
    for (const r of rows) {
      console.log(
        [
          String(r.id).padEnd(3),
          String(r.name).padEnd(20),
          String(r.ownerName || r.ownerId).padEnd(16),
          String(r.scope || "admin").padEnd(7),
          String(r.useCount || 0).padEnd(5),
          r.lastUsedAt ? new Date(r.lastUsedAt).toISOString().slice(0, 19).replace("T", " ") : "-".padEnd(19),
          r.revokedAt ? "已吊销" : "有效"
        ].join(" ")
      );
    }
  }
} else if (cmd === "create") {
  const name = arg("name", "agent");
  const ownerName = arg("owner", "webops_admin");
  const scope = arg("scope", "admin");
  const owner = findUserByUsername(ownerName);
  if (!owner) {
    console.error(`找不到管理员账号：${ownerName}`);
    process.exit(1);
  }
  const out = createAgentToken({ name, ownerId: owner.id, scope });
  console.log("令牌创建成功（只显示这一次，请立即保存）：");
  console.log("");
  console.log("  " + out.token);
  console.log("");
  console.log(`id=${out.id} name=${out.name} owner=${ownerName} scope=${out.scope}`);
  console.log("用法：curl -H \"x-agent-token: <token>\" http://<host>/api/agent/ping");
} else if (cmd === "revoke") {
  const id = Number(arg("id", 0));
  if (!id) {
    console.error("需要 --id <token_id>");
    process.exit(1);
  }
  revokeAgentToken(id);
  console.log(`已吊销令牌 #${id}`);
} else {
  console.log("用法：agent-token.js list | create --name X [--owner Y] | revoke --id N");
}