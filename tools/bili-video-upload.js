// tools/bili-video-upload.js — B 站视频上传 + 投稿（Cookie 走插件扫码登录文件）
// 用法：node tools/bili-video-upload.js <video.mp4> <cover.jpg>
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const [videoPath, coverPath] = process.argv.slice(2);
if (!videoPath || !coverPath) throw new Error("参数：video.mp4 cover.jpg");
const jar = JSON.parse(readFileSync("C:\\Users\\22801\\.dsh\\plugins\\dsh-bilibili\\cookie.json", "utf8")).cookies;
const csrf = jar.bili_jct;
if (!csrf || !jar.SESSDATA) throw new Error("cookie.json 缺 bili_jct/SESSDATA");
const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const baseHeaders = { "user-agent": UA, cookie, referer: "https://member.bilibili.com/", origin: "https://member.bilibili.com" };

async function request(url, { method = "GET", params, headers = {}, body } = {}) {
  const u = new URL(url);
  if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u, { method, headers: { ...baseHeaders, ...headers }, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${method} ${u.pathname} HTTP ${res.status}: ${text.slice(0, 400)}`);
  return { json, text };
}
function okJson(r, label) {
  if (!r.json || (r.json.code !== undefined && r.json.code !== 0) || (r.json.OK !== undefined && r.json.OK !== 1)) {
    throw new Error(label + "：" + r.text.slice(0, 600));
  }
  return r.json;
}

async function uploadCover() {
  const data = "data:image/jpeg;base64," + readFileSync(coverPath).toString("base64");
  const body = new URLSearchParams({ csrf, cover: data });
  const r = await request("https://member.bilibili.com/x/vu/web/cover/up", {
    method: "POST", params: { ts: Date.now() },
    headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  const j = okJson(r, "封面上传失败");
  console.log("cover:", j.data.url);
  return j.data.url;
}

async function uploadVideo() {
  const size = statSync(videoPath).size;
  const name = basename(videoPath);
  const pre = okJson(await request("https://member.bilibili.com/preupload", {
    params: {
      name, size, r: "upos", profile: "ugcfx/bup", ssl: 0,
      version: "2.14.0.0", build: 2140000, webVersion: "2.13.0",
      probe_version: 20221109, upcdn: "bda2", zone: "cs",
    },
  }), "预上传失败");
  const uploadUrl = `https:${pre.endpoint}/${pre.upos_uri.replace("upos://", "")}`;
  const authHeaders = { "X-Upos-Auth": pre.auth };
  const meta = okJson(await request(uploadUrl, {
    method: "POST", params: { uploads: "", output: "json", profile: "ugcfx/bup", filesize: size, partsize: pre.chunk_size, biz_id: pre.biz_id },
    headers: authHeaders,
  }), "创建上传任务失败");
  const uploadId = meta.upload_id;
  const chunkSize = Number(pre.chunk_size);
  const chunks = Math.ceil(size / chunkSize);
  const buf = readFileSync(videoPath);
  const parts = [];
  for (let chunk = 0; chunk < chunks; chunk++) {
    const start = chunk * chunkSize;
    const part = buf.subarray(start, Math.min(size, start + chunkSize));
    const r = await request(uploadUrl, {
      method: "PUT", params: {
        partNumber: chunk + 1, uploadId, chunk, chunks, size: part.length,
        start, end: start + part.length, total: size,
      },
      headers: { ...authHeaders, "content-type": "application/octet-stream", "content-length": String(part.length) },
      body: part,
    });
    if (!r.text.includes("MULTIPART_PUT_SUCCESS")) throw new Error(`分片 ${chunk + 1} 上传失败：${r.text.slice(0, 300)}`);
    parts.push({ partNumber: chunk + 1, eTag: "etag" });
    console.log(`chunk ${chunk + 1}/${chunks}`);
  }
  const done = okJson(await request(uploadUrl, {
    method: "POST", params: { output: "json", name, profile: "ugcfx/bup", uploadId, biz_id: pre.biz_id },
    headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify({ parts }),
  }), "合并视频失败");
  const filename = basename(pre.upos_uri).replace(/\.[^.]+$/, "");
  console.log("video:", filename, "cid:", pre.biz_id);
  return { filename, cid: pre.biz_id, title: name.replace(/\.[^.]+$/, ""), desc: "" };
}

async function submit(video, cover) {
  const title = "我把《三角洲行动》哈夫克内网做成了真能发帖的网站";
  const desc = `还记得「骇爪的网上冲浪」吗？我们按活动截图复刻了哈夫克内网，并补上了注册、登录、发帖、回复和资料投稿功能。\n\n演示站：http://154.89.149.92/\n资料征集：http://154.89.149.92/#/collect\n演示账号：claire\n演示密码：Haavk#2026\n\n现在征集活动截图、帖子原文、彩蛋触发方式和设定资料。征集页免注册即可上传，审核收录后进入鸣谢墙。\n\n本视频及网站由 AI 辅助制作/开发，非官方粉丝项目，素材版权归原权利人所有。`;
  const payload = {
    videos: [video], cover, cover43: "", title, copyright: 1, tid: 65,
    tag: "三角洲行动,骇爪的网上冲浪,哈夫克,网页复刻,粉丝创作,AI辅助开发",
    desc_format_id: 9999, desc, recreate: -1,
    dynamic: "把游戏活动里的哈夫克内网，做成了真正能逛、能发帖的网站。也欢迎大家来投稿老截图。",
    interactive: 0, act_reserve_create: 0, no_disturbance: 0, no_reprint: 0,
    subtitle: { open: 0, lan: "" }, dolby: 0, lossless_music: 0,
    up_selection_reply: false, up_close_reply: false, up_close_danmu: false,
    web_os: 3, is_only_self: 0, csrf,
  };
  const r = await request("https://member.bilibili.com/x/vu/web/add/v3", {
    method: "POST", params: { ts: Date.now(), csrf },
    headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(payload),
  });
  const j = okJson(r, "投稿失败");
  console.log("PUBLISHED", JSON.stringify(j.data));
  console.log("url=https://www.bilibili.com/video/" + j.data.bvid);
}

const cover = await uploadCover();
const video = await uploadVideo();
await submit(video, cover);
