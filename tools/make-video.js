// tools/make-video.js — 用线上实拍截图 + 本机中文旁白剪成 B 站介绍片
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "video");
mkdirSync(out, { recursive: true });
const font = "C\\:/Windows/Fonts/msyh.ttc";
const bold = "C\\:/Windows/Fonts/msyhbd.ttc";

const scenes = [
  { img: "bili_home.png", voice: 0, tag: "HAAVK // ARCHIVE PROJECT", title: "哈夫克内网，真的能做出来", caption: "《三角洲行动》活动网页 · 粉丝复刻", dark: true },
  { img: "bili_home.png", voice: 1, tag: "01 / 首页还原", title: "不是一张长图，是能逛的网站", caption: "主视觉、员工卡、轮播与导航均按活动截图复刻" },
  { img: "bili_forum.png", voice: 2, tag: "02 / 员工论坛", title: "能注册，也能真正发帖", caption: "发帖回复 · 每日点数 · 入职审核 · 管理后台" },
  { img: "bili_solutions.png", voice: 3, tag: "03 / 解决方案商城", title: "装备轮播与商品陈列", caption: "保留活动原版的页面结构与视觉风格" },
  { img: "bili_collect.png", voice: 4, tag: "04 / 资料征集", title: "有老截图？直接投进来", caption: "免注册上传 · 审核收录 · 进入鸣谢墙" },
  { img: "bili_collect.png", voice: 5, tag: "HAAVK // CALL FOR ARCHIVES", title: "一起补完这段活动档案", caption: "154.89.149.92/#/collect  ·  演示账号 claire / Haavk#2026", dark: true },
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: out, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(cmd + " 失败\n" + (r.stderr || r.stdout || "exit " + r.status));
  return r.stdout;
}
function duration(file) {
  return Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).trim());
}
function escText(s) { return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%"); }

const concat = [];
for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i];
  const img = join(root, "previews", "bili", s.img);
  const voice = join(out, `voice-${s.voice}.wav`);
  const dur = duration(voice) + 0.9;
  const target = join(out, `scene-${i}.mp4`);
  const title = escText(s.title);
  const caption = escText(s.caption);
  const tag = escText(s.tag);
  const base = s.dark
    ? "scale=1408:946,crop=1280:720:x=64:y=90,eq=brightness=-0.38:saturation=0.55"
    : "scale=1408:946,crop=1280:720:x='64+18*sin(t/6)':y='86+10*cos(t/7)'";
  const titleY = s.dark ? 218 : 45;
  const titleSize = s.dark ? 56 : 34;
  const tagY = s.dark ? 172 : 18;
  const capY = s.dark ? 318 : 638;
  const capSize = s.dark ? 27 : 24;
  const filters = [
    base,
    `drawbox=x=0:y=0:w=1280:h=720:color=0x101820@${s.dark ? 0.32 : 0.06}:t=fill`,
    `drawbox=x=72:y=${s.dark ? 150 : 0}:w=6:h=${s.dark ? 205 : 92}:color=0x4782c6:t=fill`,
    `drawtext=fontfile='${font}':text='${tag}':x=96:y=${tagY}:fontsize=20:fontcolor=0x79b6e8`,
    `drawtext=fontfile='${bold}':text='${title}':x=94:y=${titleY}:fontsize=${titleSize}:fontcolor=white:shadowcolor=black@0.35:shadowx=0:shadowy=2`,
    s.dark ? `drawbox=x=0:y=590:w=1280:h=130:color=0x0d1218@0.84:t=fill` : `drawbox=x=0:y=616:w=1280:h=104:color=0x0d1218@0.84:t=fill`,
    `drawtext=fontfile='${font}':text='${caption}':x=72:y=${capY}:fontsize=${capSize}:fontcolor=0xf2f5f8`,
    `drawtext=fontfile='${font}':text='AI 辅助开发 · 非官方粉丝项目':x=72:y=684:fontsize=16:fontcolor=0x9da8b4`,
    `fade=t=in:st=0:d=0.28,fade=t=out:st=${(dur - 0.28).toFixed(3)}:d=0.28`,
    "format=yuv420p",
  ].join(",");
  run("ffmpeg", ["-y", "-loop", "1", "-framerate", "30", "-i", img, "-i", voice,
    "-filter_complex", `[0:v]${filters}[v];[1:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,adelay=350|350,apad[a]`,
    "-map", "[v]", "-map", "[a]", "-t", dur.toFixed(3), "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", target]);
  concat.push(`file 'scene-${i}.mp4'`);
  console.log(`scene ${i} ${dur.toFixed(1)}s`);
}
writeFileSync(join(out, "concat.txt"), concat.join("\n"), "utf8");
run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "-movflags", "+faststart", "haavk-intro.mp4"]);
run("ffmpeg", ["-y", "-ss", "2", "-i", "haavk-intro.mp4", "-frames:v", "1", "-q:v", "2", "haavk-cover.jpg"]);
const final = join(out, "haavk-intro.mp4");
console.log(`DONE ${final} ${duration(final).toFixed(1)}s`);
