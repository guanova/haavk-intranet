/* ==========================================================================
   tools/make-video3.js — 宣传片 2 版（更有节奏与动效）
   与 1 版（make-video2.js）的区别：
     · 15 个镜头，推/拉/横移/竖移交替，不再全是缓慢平移
     · 每个镜头内部两层运动：背景推镜 + 文字滑入（exp 落位）
     · 特写镜头裁切到具体 UI 区块（表头、回执卡、商品行）
     · 扫描亮线 / 数字跳数等细节动效
     · 镜头之间用 xfade 多种转场（fade / slideleft / wipeleft / circleopen…）
     · 音频 = 10 段旁白（按镜头起点 adelay）+ 低通棕噪声底
   用法：node tools/make-video3.js
   ========================================================================== */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "video", "promo3");
const IMG = path.join(ROOT, "assets", "img");
const SHOT = path.join(ROOT, "previews", "promo3");
const REF = path.join(ROOT, "references");
const FONT = "C\\:/Windows/Fonts/msyh.ttc";
const FONTB = "C\\:/Windows/Fonts/msyhbd.ttc";
const W = 1280;
const H = 720;
const FPS = 30;
const XF = 0.5; // 转场时长

fs.mkdirSync(OUT, { recursive: true });

const f = (p) => `'${p.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
const crf = 20;

/* 文字滑入：从下方 34px 落到目标 y，0.5s 内完成 */
function text(str, x, y, size, { bold = false, color = "white", delay = 0, alpha = 1 } = {}) {
  const font = bold ? FONTB : FONT;
  return (
    `drawtext=fontfile='${font}':text='${str}':x=${x}` +
    `:y='${y}+34*exp(-max(0,t-${delay})*6)'` +
    `:fontsize=${size}:fontcolor=${color}@${alpha}:shadowcolor=black@0.45:shadowx=0:shadowy=2`
  );
}
/* 底部细进度条：随时间从左到右填充，给每个镜头一个"节拍" */
function progressBar(dur, color = "0x1e9bf0") {
  return (
    `drawbox=x=0:y=${H - 5}:w=${W}:h=5:color=black@0.35:t=fill,` +
    `drawbox=x=0:y=${H - 5}:w='${W}*min(t/${dur},1)':h=5:color=${color}@0.85:t=fill`
  );
}
const scan = (dur) =>
  `drawbox=x='-160+${W + 320}*(t/${dur})':y=0:w=160:h=${H}:color=0xffffff@0.10:t=fill`;
const vignette = "vignette=PI/4.6";

/* zoompan 常用锚点 */
const zoomIn = (dur, to = 1.16) =>
  `zoompan=z='1+${to - 1}*min(time/${dur},1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`;
const zoomOut = (dur, from = 1.22) =>
  `zoompan=z='${from}-${from - 1}*min(time/${dur},1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`;
/* 横移 / 竖移：在放大后的画布上取窗口平移 */
const panX = (dur, zoom = 1.2, dir = 1) =>
  `zoompan=z='${zoom}':x='${dir > 0 ? `(iw-iw/zoom)*min(time/${dur},1)` : `(iw-iw/zoom)*(1-min(time/${dur},1))`}':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`;
const panY = (dur, zoom = 1.2, dir = 1) =>
  `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='${dir > 0 ? `(ih-ih/zoom)*min(time/${dur},1)` : `(ih-ih/zoom)*(1-min(time/${dur},1))`}':d=1:s=${W}x${H}:fps=${FPS}`;

/* ------------------------------ 镜头表 ------------------------------ */
const shots = [
  {
    name: "01-official",
    img: path.join(REF, "01_关于我们_天空属于哈夫克.jpg"),
    dur: 5.8,
    pre: `scale=2560:1152,pad=2560:1440:0:144:color=0x0d1720`,
    motion: zoomIn(5.8, 1.14),
    overlay: [text("非官方复刻", 96, 470, 22, { color: "0x79b6e8", delay: 1.2 }), text("这不是官方的", 92, 512, 62, { bold: true, delay: 1.4 }), text("但界面是活动里的原样", 96, 596, 26, { color: "0xdbe6f2", delay: 1.9 })],
    tone: "eq=brightness=-0.06:saturation=0.95"
  },
  {
    name: "02-home",
    img: path.join(SHOT, "home.png"),
    dur: 5.2,
    pre: "scale=2560:1800",
    motion: panY(5.2, 1.18, -1),
    overlay: [text("照着截图", 96, 96, 26, { color: "0x79b6e8" }), text("一像素一像素对", 92, 140, 54, { bold: true, delay: 0.3 })],
    tone: "eq=brightness=-0.10:saturation=0.92"
  },
  {
    name: "03-forum",
    img: path.join(SHOT, "forum.png"),
    dur: 6.0,
    pre: "scale=2560:1800",
    motion: zoomOut(6.0, 1.24),
    overlay: [text("员工论坛", 96, 92, 30, { color: "0x79b6e8" }), text("真的能发帖", 92, 136, 56, { bold: true, delay: 0.3 }), text("回复、置顶、未读，都是活的", 96, 214, 24, { color: "0xdbe6f2", delay: 0.8 })],
    extra: [progressBar(6.0)]
  },
  {
    name: "04-forum-close",
    img: path.join(SHOT, "forum.png"),
    dur: 4.8,
    pre: "crop=1024:576:300:150,scale=2560:1440",
    motion: zoomIn(4.8, 1.22),
    overlay: [text("发帖扣 50　回帖扣 100", 96, 640, 30, { bold: true, delay: 0.4 })],
    extra: [scan(4.8)]
  },
  {
    name: "05-points",
    img: path.join(SHOT, "home.png"),
    dur: 4.4,
    pre: "crop=620:349:900:40,scale=2560:1440",
    motion: zoomIn(4.4, 1.16),
    overlay: [
      `drawtext=fontfile='${FONTB}':text='%{eif\\:min(t*520\\,2019)\\:d}':x=96:y=250:fontsize=88:fontcolor=white:shadowcolor=black@0.4:shadowx=0:shadowy=3`,
      text("每天补满 500 点", 96, 370, 30, { delay: 0.5 }),
      text("注意力额度 · 用完等明天", 96, 420, 22, { color: "0xdbe6f2", delay: 1.0 })
    ]
  },
  {
    name: "06-post",
    img: path.join(SHOT, "post.png"),
    dur: 6.4,
    pre: "scale=2560:1800",
    motion: panX(6.4, 1.2, 1),
    overlay: [text("＠高管，要过审", 96, 96, 56, { bold: true }), text("不是直接叫得动的", 96, 176, 24, { color: "0xdbe6f2", delay: 0.6 })],
    extra: [progressBar(6.4, "0xf0b429")]
  },
  {
    name: "07-receipt",
    img: path.join(SHOT, "post.png"),
    dur: 5.2,
    pre: "crop=1024:576:280:250,scale=2560:1440",
    motion: zoomIn(5.2, 1.26),
    overlay: [text("回执会告诉你审核到哪一步", 96, 646, 30, { bold: true, delay: 0.5 })],
    extra: [scan(5.2)]
  },
  {
    name: "08-solutions",
    img: path.join(SHOT, "solutions.png"),
    dur: 5.2,
    pre: "scale=2560:1800",
    motion: panX(5.2, 1.22, -1),
    overlay: [text("商城 · 悬赏 · 征集", 96, 96, 54, { bold: true }), text("三个页面都在跑", 96, 172, 24, { color: "0xdbe6f2", delay: 0.6 })],
    extra: [progressBar(5.2)]
  },
  {
    name: "09-collect",
    img: path.join(SHOT, "collect.png"),
    dur: 5.4,
    pre: "scale=2560:1800",
    motion: zoomIn(5.4, 1.2),
    overlay: [text("缺资料？", 96, 96, 54, { bold: true }), text("匿名投，收录了给你上墙", 96, 172, 26, { color: "0xdbe6f2", delay: 0.5 })],
    extra: [progressBar(5.4)]
  },
  {
    name: "10-aiofficers",
    img: path.join(SHOT, "forum.png"),
    dur: 5.4,
    pre: "crop=1024:576:280:420,scale=2560:1440",
    motion: panY(5.4, 1.3, 1),
    overlay: [text("16 位 AI 高管在岗", 96, 120, 44, { bold: true }), text("会自己发帖、自己回帖", 96, 186, 24, { color: "0xdbe6f2", delay: 0.5 })],
    extra: [progressBar(5.4, "0x2ecc71")]
  },
  {
    name: "11-register",
    img: path.join(SHOT, "register.png"),
    dur: 4.4,
    pre: "scale=2560:1800",
    motion: zoomIn(4.4, 1.14),
    overlay: [text("两分钟", 96, 92, 26, { color: "0x79b6e8" }), text("办完入职手续", 92, 134, 52, { bold: true, delay: 0.3 })],
    extra: [progressBar(4.4)]
  },
  {
    name: "12-mobile",
    img: path.join(SHOT, "mobile.png"),
    dur: 4.6,
    pre: `scale=-2:700,pad=1280:720:x='(1280-iw)/2':y='(720-ih)/2':color=0x101820`,
    motion: `zoompan=z='1+0.06*min(time/4.6,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`,
    overlay: [text("手机整页缩放", 96, 646, 28, { bold: true, delay: 0.4 })],
    extra: [vignette]
  },
  {
    name: "13-items",
    img: path.join(SHOT, "solutions.png"),
    dur: 4.0,
    pre: "crop=1024:576:200:560,scale=2560:1440",
    motion: panX(4.0, 1.22, 1),
    overlay: [text("七件装备，全部售罄", 96, 640, 30, { bold: true, delay: 0.4 })],
    extra: [scan(4.0)]
  },
  {
    name: "14-outro",
    img: path.join(IMG, "hero-full-1.jpg"),
    dur: 6.4,
    pre: `scale=2560:1440,eq=brightness=-0.55:saturation=0.35,boxblur=6:2`,
    motion: zoomOut(6.4, 1.1),
    overlay: [
      text("哈夫克集团 · 员工内网", 96, 210, 26, { color: "0x79b6e8", delay: 0.4 }),
      text("一起来补完这段档案", 92, 254, 58, { bold: true, delay: 0.7 }),
      `drawtext=fontfile='${FONTB}':text='154.89.149.92':x=96:y='380+34*exp(-max(0,t-1.4)*6)':fontsize=44:fontcolor=0x7fd0ff:shadowcolor=black@0.4:shadowx=0:shadowy=2`,
      text("AI 辅助构建 · 非官方粉丝项目", 96, 560, 22, { color: "0xc8d4e0", delay: 1.9 }),
      text("github.com/guanova/haavk-intranet", 96, 596, 20, { color: "0x9da8b4", delay: 2.2 })
    ],
    tone: ""
  }
];

/* ------------------------------ 逐镜渲染 ------------------------------ */
const clips = [];
for (let i = 0; i < shots.length; i++) {
  const s = shots[i];
  if (!fs.existsSync(s.img)) throw new Error("缺素材：" + s.img);
  const frames = Math.round(s.dur * FPS);
  const vf = [
    s.pre,
    s.motion,
    s.tone || "",
    ...(s.extra || []),
    ...s.overlay,
    `fps=${FPS}`,
    `format=yuv420p`
  ]
    .filter(Boolean)
    .join(",");
  const target = path.join(OUT, `c-${String(i).padStart(2, "0")}.mp4`);
  if (fs.existsSync(target) && fs.statSync(target).size > 1000) {
    clips.push(target);
    console.log(`  ↺ ${s.name} ${s.dur}s（复用）`);
    continue;
  }
  const args = [
    "-y", "-loop", "1", "-framerate", String(FPS), "-t", String(s.dur), "-i", s.img,
    "-vf", vf, "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-an", target
  ];
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`[shot ${i}] ffmpeg 失败\n${(r.stderr || "").slice(-900)}`);
    process.exit(1);
  }
  clips.push(target);
  console.log(`  ✓ ${s.name} ${s.dur}s`);
}

/* ------------------------------ 真实时长 ------------------------------ */
function probeDur(f) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" });
  return Number.parseFloat((r.stdout || "0").trim()) || 0;
}
const clipDur = clips.map(probeDur);
if (clipDur.some((d) => !d)) throw new Error("镜头时长探测失败");

/* ------------------------------ xfade 串接 ------------------------------ */
const xfadeTypes = ["fade", "slideleft", "wipeleft", "circleopen", "fadeblack", "slideup", "hlslice", "smoothleft", "wipeup", "dissolve", "radial", "squeezeh", "circleclose", "fadegrays"];

const total = clipDur.reduce((a, d, i) => a + d - (i > 0 ? XF : 0), 0);
let filter = "";
let label = "[0:v]";
let acc = clipDur[0];
for (let i = 1; i < clips.length; i++) {
  const out = i === clips.length - 1 ? "[vout]" : `[v${i}]`;
  const type = xfadeTypes[(i - 1) % xfadeTypes.length];
  const offset = acc - XF;
  filter += `${label}[${i}:v]xfade=transition=${type}:duration=${XF}:offset=${offset.toFixed(3)}${out};`;
  label = out;
  acc = offset + clipDur[i];
}

/* ------------------------------ 音频 ------------------------------ */
const narrDir = path.join(ROOT, "video", "pv3");
/* 旁白挂到哪些镜头（序号）：0,1,2,3,4,5,7,8,10,14 —— 其余镜头留白制造节奏 */
const narrMap = [0, 1, 2, 3, 4, 5, 7, 8, 10, 13];
const starts = [];
let t = 0;
for (let i = 0; i < shots.length; i++) {
  starts.push(t);
  t = t + clipDur[i] - (i > 0 ? XF : 0);
}
const audioInputs = [];
const delayChain = [];
let inputIdx = clips.length;
for (let k = 0; k < narrMap.length; k++) {
  const wav = path.join(narrDir, `pv3-${k}.wav`);
  if (!fs.existsSync(wav)) throw new Error("缺旁白：" + wav);
  audioInputs.push("-i", wav);
  const base = Number.isFinite(starts[narrMap[k]]) ? starts[narrMap[k]] : 0;
  const at = Math.max(0, Math.round((base + 0.55) * 1000));
  delayChain.push(`[${inputIdx}:a]adelay=${at}|${at},volume=1.0[n${k}]`);
  inputIdx++;
}
/* 底噪：低通棕噪声，音量极低，只为"有呼吸感" */
audioInputs.push("-f", "lavfi", "-t", String(total.toFixed(2)), "-i", "anoisesrc=color=brown:amplitude=0.30");
const bgmIdx = inputIdx;
delayChain.push(`[${bgmIdx}:a]lowpass=f=200,volume=0.055,afade=t=in:st=0:d=2.2,afade=t=out:st=${(total - 2.6).toFixed(2)}:d=2.4[bgm]`);
const mixInputs = narrMap.map((_, k) => `[n${k}]`).join("") + "[bgm]";
const audioFilter = delayChain.join(";") + ";" + `${mixInputs}amix=inputs=${narrMap.length + 1}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;

const final = path.join(ROOT, "video", "haavk-promo2.mp4");
const fullFilter = filter + audioFilter;
const args = ["-y"];
for (const c of clips) args.push("-i", c);
args.push(...audioInputs, "-filter_complex", fullFilter, "-map", "[vout]", "-map", "[aout]");
args.push("-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(FPS));
args.push("-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final);
console.log(`\n[xfade] ${clips.length} 镜 · ${total.toFixed(1)}s · 转场 ${XF}s\n`);
const r2 = spawnSync("ffmpeg", args, { encoding: "utf8" });
if (r2.status !== 0) {
  console.error("[final] ffmpeg 失败\n" + (r2.stderr || "").slice(-1600));
  process.exit(1);
}

/* 封面：从第 3 秒（首页全景）抽一帧 */
const cover = path.join(ROOT, "video", "haavk-promo2-cover.jpg");
spawnSync("ffmpeg", ["-y", "-ss", "3.2", "-i", final, "-frames:v", "1", "-q:v", "3", cover], { encoding: "utf8" });

const size = fs.statSync(final).size;
console.log(`\n完成 ${final}\n  ${total.toFixed(1)}s · ${W}x${H} · ${(size / 1024 / 1024).toFixed(2)} MB\n  封面 ${cover}\n`);
