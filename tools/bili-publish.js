// tools/bili-publish.js —— 独立 B 站动态发布（绕过插件发布链路的 csrf 缺失 bug）
// 用法: node tools/bili-publish.js <文案文件> <图1> [图2] ...
// 凭据：优先 surfcore 的 credentials.json，回退 dsh-bilibili 的 cookie.json
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";

const CRED_CANDIDATES = [
  { path: "C:\\Users\\22801\\.dsh\\surfcore\\bili\\credentials.json", wrap: false },
  { path: "C:\\Users\\22801\\.dsh\\plugins\\dsh-bilibili\\cookie.json", wrap: true },
];
const found = CRED_CANDIDATES.find((c) => existsSync(c.path));
if (!found) throw new Error("找不到 B 站凭据文件，请先登录");
const raw = JSON.parse(readFileSync(found.path, "utf8"));
const jar = found.wrap ? raw.cookies : raw;
const sessdata = jar.SESSDATA || jar.sessdata;
const biliJct = jar.bili_jct;
if (!biliJct || !sessdata) throw new Error("凭据缺 sessdata/bili_jct");
const csrf = biliJct;
const cookieHeader = [
  `SESSDATA=${sessdata}`,
  `bili_jct=${biliJct}`,
  `buvid3=${jar.buvid3 || ""}`,
  `DedeUserID=${jar.mid || jar.DedeUserID || ""}`,
].join("; ");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const API = "https://api.bilibili.com";
const WBI_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

const baseHeaders = {
  "user-agent": UA,
  referer: "https://www.bilibili.com/",
  origin: "https://www.bilibili.com",
  accept: "application/json, text/plain, */*",
  cookie: cookieHeader,
};
const metaHeaders = {
  "x-bili-device-req-json": JSON.stringify({ platform: "web", device: "pc", spmid: "333.1387", mobi_app: "web" }),
  "x-bili-locale-json": JSON.stringify({ c_locale: { language: "zh" } }),
};

async function api(path, { method = "GET", params, data, form } = {}) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const init = { method, headers: { ...baseHeaders } };
  if (data !== undefined) {
    init.headers["content-type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(data);
  }
  if (form) init.body = form;
  const res = await fetch(API + path + qs, init);
  const j = await res.json().catch(() => null);
  if (!j) throw new Error(path + " 返回非 JSON HTTP " + res.status);
  return j;
}

async function uploadImage(path) {
  const buf = readFileSync(path);
  const ext = (basename(path).split(".").pop() || "jpg").toLowerCase();
  const type = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
  const form = new FormData();
  form.append("file_up", new Blob([buf], { type }), basename(path));
  form.append("biz", "dyn");
  form.append("category", "daily");
  form.append("csrf", csrf); // 插件缺的字段：B 站图床强制校验
  const j = await api("/x/dynamic/feed/draw/upload_bfs", { method: "POST", form });
  if (j.code !== 0 || !j.data) throw new Error("上传失败：" + (j.message || j.code));
  console.log("uploaded:", j.data.image_url);
  return {
    img_src: String(j.data.image_url),
    img_width: Number(j.data.image_width || 0),
    img_height: Number(j.data.image_height || 0),
    img_size: Math.round((buf.length / 1024) * 10) / 10,
  };
}

function mixinKey(imgKey, subKey) {
  const full = String(imgKey) + String(subKey);
  let out = "";
  for (const i of WBI_TAB) { const ch = full.charAt(i); if (ch) out += ch; }
  return out.slice(0, 32);
}
function wbiSign(params, keys) {
  const mixin = mixinKey(keys.imgKey, keys.subKey);
  const wts = Math.round(Date.now() / 1000);
  const all = { ...params, wts };
  const parts = Object.keys(all).sort().map((k) => {
    let v = all[k];
    if (typeof v === "string") v = v.replace(/[!'()*]/g, "");
    else if (typeof v === "object") v = JSON.stringify(v);
    else v = String(v);
    return encodeURIComponent(k) + "=" + encodeURIComponent(v);
  });
  const w_rid = createHash("md5").update(parts.join("&") + mixin, "utf8").digest("hex");
  return { ...params, w_rid, wts: String(wts) };
}

async function wbiKeys() {
  const j = await api("/x/web-interface/nav");
  const img = j && j.data && j.data.wbi_img;
  if (!img) throw new Error("拿不到 wbi keys：" + JSON.stringify(j).slice(0, 200));
  return {
    imgKey: basename(String(img.img_url)).split(".")[0],
    subKey: basename(String(img.sub_url)).split(".")[0],
  };
}

async function main() {
  const [textFile, ...images] = process.argv.slice(2);
  const text = readFileSync(textFile, "utf8").trim();
  const pics = [];
  for (const p of images) pics.push(await uploadImage(p));

  const mid = String(jar.mid || jar.DedeUserID || "0");
  const uploadId = `${mid}_${Math.floor(Date.now() / 1000)}_${Math.floor(10000 * Math.random())}`;
  const contents = [{ raw_text: text, type: 1, biz_id: "" }];
  const dynReq = {
    content: { contents },
    pics: pics.length ? pics : undefined,
    scene: 2,
    upload_id: uploadId,
    meta: { app_meta: { from: "create.dynamic.web", mobi_app: "web" } },
    option: { aigc: 2 },
  };
  if (pics.length) dynReq.option.pic_mode = 0;

  const check = {
    content: dynReq.content,
    pics: dynReq.pics,
    scene: dynReq.scene,
    create_option: dynReq.option,
  };
  const checked = await api("/x/dynamic/feed/create/submit_check", {
    method: "POST",
    params: { platform: "web", csrf }, // 插件缺的 csrf
    data: check,
  });
  if (checked.code !== 0) throw new Error("submit_check 失败：" + checked.code + " " + (checked.message || ""));
  console.log("submit_check ok");

  const keys = await wbiKeys();
  const signed = wbiSign({
    platform: "web",
    csrf, // 插件缺的 csrf（参与签名）
    "w_dyn_req.upload_id": uploadId,
    "w_dyn_req.meta": JSON.stringify(dynReq.meta),
  }, keys);
  const res = await api("/x/dynamic/feed/create/dyn", {
    method: "POST",
    params: signed,
    data: { dyn_req: dynReq },
  });
  if (res.code !== 0) throw new Error("create/dyn 失败：" + res.code + " " + (res.message || ""));
  const dynId = res.data && res.data.dyn_id_str ? String(res.data.dyn_id_str) : "";
  console.log("PUBLISHED dyn_id=" + dynId);
  console.log("url=https://t.bilibili.com/" + dynId);
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
