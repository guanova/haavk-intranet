/* ==========================================================================
   server/lib/smtp.js — 极简 SMTP 客户端（零第三方依赖）
   支持：隐式 TLS（465）、STARTTLS（587）、AUTH LOGIN / PLAIN、UTF-8 主题（RFC 2047）、
        纯文本正文（UTF-8 + Base64 传输编码）。
   只做「发一封信」这件事：不排队、不重试，调用方自己决定策略。
   ========================================================================== */
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import os from "node:os";

const CRLF = "\r\n";

/** 把一行命令包成 promise：读到以「xxx 」开头的完整响应（处理多行 250-...） */
function readReply(sock, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      sock.removeListener("data", onData);
      sock.removeListener("error", onError);
      sock.removeListener("close", onClose);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("SMTP 连接被服务器关闭"));
    };
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      // 多行响应：每行形如 "250-xxx"，最后一行是 "250 xxx"
      const lines = buf.split(CRLF).filter((l) => l.length >= 3);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        cleanup();
        const code = Number.parseInt(last.slice(0, 3), 10);
        resolve({ code, text: buf });
      }
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`SMTP 等待响应超时（${timeoutMs}ms）`));
    }, timeoutMs);
    sock.on("data", onData);
    sock.on("error", onError);
    sock.on("close", onClose);
  });
}

async function command(sock, line, timeoutMs, expect = [250]) {
  sock.write(line + CRLF);
  const res = await readReply(sock, timeoutMs);
  const ok = expect.length ? expect.includes(res.code) : res.code >= 200 && res.code < 400;
  if (!ok) {
    const first = res.text.split(CRLF).filter(Boolean).slice(-1)[0] || "";
    throw new Error(`SMTP 命令失败（${res.code}）：${first}`.slice(0, 300));
  }
  return res;
}

/** RFC 2047 编码（非 ASCII 主题必须） */
function encodeHeader(str) {
  const s = String(str || "");
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
}

function base64Lines(buf) {
  const b64 = buf.toString("base64");
  const out = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.join(CRLF);
}

/** 解析 "名字 <a@b.c>" 形式 */
function parseAddr(input) {
  const raw = String(input || "").trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() };
  return { name: "", email: raw };
}

/**
 * 建立连接（含 TLS / STARTTLS 升级）
 * @param {{host:string,port:number,secure:boolean,user?:string,pass?:string,timeoutMs?:number}} opt
 */
function connect(opt) {
  const timeoutMs = opt.timeoutMs || 20000;
  return new Promise((resolve, reject) => {
    let sock;
    const done = (s) => {
      s.setTimeout(0);
      resolve(s);
    };
    const fail = (err) => {
      try {
        sock && sock.destroy();
      } catch {
        /* ignore */
      }
      reject(err);
    };
    if (opt.secure) {
      sock = tls.connect(
        { host: opt.host, port: opt.port, servername: opt.host, rejectUnauthorized: false },
        () => done(sock)
      );
    } else {
      sock = net.connect({ host: opt.host, port: opt.port }, () => done(sock));
    }
    sock.setTimeout(timeoutMs, () => fail(new Error(`连接 ${opt.host}:${opt.port} 超时`)));
    sock.once("error", fail);
  });
}

/** 用 socket 换一个新的 STARTTLS 加密 socket（先摘掉旧监听，避免抢读） */
function upgrade(sock, opt) {
  return new Promise((resolve, reject) => {
    sock.removeAllListeners("data");
    sock.removeAllListeners("error");
    sock.removeAllListeners("close");
    const secure = tls.connect(
      { socket: sock, servername: opt.host, rejectUnauthorized: false },
      () => {
        secure.removeAllListeners("error");
        resolve(secure);
      }
    );
    secure.once("error", reject);
  });
}

/**
 * 发送一封纯文本邮件。
 * @param {object} cfg  {host,port,secure,user,pass,from,fromName}
 * @param {{to:string|string[],subject:string,text:string}} mail
 * @returns {Promise<{ok:true,accepted:string[]}>}
 */
export async function sendMail(cfg, mail) {
  const host = String(cfg.host || "").trim();
  if (!host) throw new Error("未配置 SMTP 服务器地址");
  const port = Number.parseInt(cfg.port, 10) || (cfg.secure ? 465 : 587);
  const secure = cfg.secure === true || cfg.secure === "1" || cfg.secure === 1 || port === 465;
  const timeoutMs = Number.parseInt(cfg.timeoutMs, 10) || 20000;
  const opt = { host, port, secure, timeoutMs };

  const from = parseAddr(cfg.from || cfg.user);
  if (!from.email) throw new Error("未配置发件人地址");

  const toList = (Array.isArray(mail.to) ? mail.to : String(mail.to || "").split(/[,;]/))
    .map((s) => parseAddr(s).email)
    .filter(Boolean);
  if (!toList.length) throw new Error("没有有效的收件人地址");

  let sock = await connect(opt);
  try {
    await readReply(sock, timeoutMs); // 220 欢迎语
    let ehlo = await command(sock, `EHLO ${os.hostname() || "haavk.local"}`, timeoutMs);

    // STARTTLS：服务器声明支持且当前不是隐式 TLS 时升级
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await command(sock, "STARTTLS", timeoutMs, [220]);
      sock = await upgrade(sock, opt);
      ehlo = await command(sock, `EHLO ${os.hostname() || "haavk.local"}`, timeoutMs);
    }

    // 认证（服务器声明支持才做）
    const canAuth = /AUTH/i.test(ehlo.text);
    if (cfg.user && cfg.pass) {
      if (!canAuth) throw new Error("服务器未声明支持认证，无法登录");
      if (/AUTH[^\n]*\bPLAIN\b/i.test(ehlo.text)) {
        const token = Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass}`, "utf8").toString("base64");
        await command(sock, `AUTH PLAIN ${token}`, timeoutMs, [235]);
      } else {
        await command(sock, "AUTH LOGIN", timeoutMs, [334]);
        await command(sock, Buffer.from(cfg.user, "utf8").toString("base64"), timeoutMs, [334]);
        await command(sock, Buffer.from(cfg.pass, "utf8").toString("base64"), timeoutMs, [235]);
      }
    }

    await command(sock, `MAIL FROM:<${from.email}>`, timeoutMs);
    for (const to of toList) await command(sock, `RCPT TO:<${to}>`, timeoutMs, [250, 251]);

    await command(sock, "DATA", timeoutMs, [354]);

    const domain = from.email.split("@")[1] || "haavk.local";
    const msgId = `<${crypto.randomBytes(12).toString("hex")}@${domain}>`;
    const date = new Date().toUTCString();
    const fromHeader = from.name ? `${encodeHeader(from.name)} <${from.email}>` : `<${from.email}>`;
    const body = base64Lines(Buffer.from(String(mail.text || ""), "utf8"));

    const head = [
      `From: ${fromHeader}`,
      `To: ${toList.map((t) => `<${t}>`).join(", ")}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${date}`,
      `Message-ID: ${msgId}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "X-Mailer: HaavkIntranet"
    ].join(CRLF);

    // DATA 结束标记必须单独一行 "."，正文里以 "." 开头的行需要转义——base64 不会产生 ".开头"，安全
    sock.write(head + CRLF + CRLF + body + CRLF + "." + CRLF);
    const res = await readReply(sock, timeoutMs);
    if (res.code !== 250) {
      throw new Error(`邮件未被接收（${res.code}）：${res.text.split(CRLF).filter(Boolean).slice(-1)[0] || ""}`);
    }

    try {
      await command(sock, "QUIT", 5000, []);
    } catch {
      /* QUIT 失败不影响已投递结果 */
    }
    return { ok: true, accepted: toList };
  } finally {
    try {
      sock.destroy();
    } catch {
      /* ignore */
    }
  }
}

/** 连通性 + 账号密码自检（不投递邮件） */
export async function verifySmtp(cfg) {
  const host = String(cfg.host || "").trim();
  if (!host) return { ok: false, message: "未填写 SMTP 服务器地址" };
  const port = Number.parseInt(cfg.port, 10) || (cfg.secure ? 465 : 587);
  const secure = cfg.secure === true || cfg.secure === "1" || cfg.secure === 1 || port === 465;
  const timeoutMs = 12000;
  let sock = null;
  try {
    sock = await connect({ host, port, secure, timeoutMs });
    const greet = await readReply(sock, timeoutMs);
    let ehlo = await command(sock, `EHLO ${os.hostname() || "haavk.local"}`, timeoutMs);
    let tlsDone = secure;
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await command(sock, "STARTTLS", timeoutMs, [220]);
      sock = await upgrade(sock, { host });
      ehlo = await command(sock, `EHLO ${os.hostname() || "haavk.local"}`, timeoutMs);
      tlsDone = true;
    }
    let authed = false;
    if (cfg.user && cfg.pass) {
      if (/AUTH[^\n]*\bPLAIN\b/i.test(ehlo.text)) {
        const token = Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass}`, "utf8").toString("base64");
        await command(sock, `AUTH PLAIN ${token}`, timeoutMs, [235]);
      } else {
        await command(sock, "AUTH LOGIN", timeoutMs, [334]);
        await command(sock, Buffer.from(cfg.user, "utf8").toString("base64"), timeoutMs, [334]);
        await command(sock, Buffer.from(cfg.pass, "utf8").toString("base64"), timeoutMs, [235]);
      }
      authed = true;
    }
    try {
      await command(sock, "QUIT", 5000, []);
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      message: `连接正常（${greet.code}）· ${tlsDone ? "已加密" : "明文"} · ${authed ? "认证通过" : "未认证"}`
    };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err).slice(0, 300) };
  } finally {
    try {
      sock && sock.destroy();
    } catch {
      /* ignore */
    }
  }
}
