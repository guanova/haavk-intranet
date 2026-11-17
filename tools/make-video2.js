// tools/make-video2.js — 宣传片（7 镜，60 秒级）：游戏原图 + 线上站实拍截图 + 中文旁白
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "video");
mkdirSync(out, { recursive: true });
const font = "C\\:/Windows/Fonts/msyh.ttc";
const bold = "C\\:/Windows/Fonts/msyhbd.ttc";

const scenes = [
  {
    img: join(root, "references", "01_关于我们_天空属于哈夫克.jpg"),
    voice: 0,
    pad: true,
    dark: true,
    tag: "HAAVK // FAN ARCHIVE PROJECT",
    title: "这个活动页面，我把它做成了网站",
    caption: "《三角洲行动》哈夫克内网 · 粉丝复刻"
  },
  {
    img: join(root, "previews", "bili2", "s1_home.png"),
    voice: 1,
    tag: "01 / 版式还原",
    title: "天空属于哈夫克",
    caption: "主视觉、员工卡、导航与手写签名，按活动截图逐项复刻"
  },
  {
    img: join(root, "previews", "bili2", "s3_register.png"),
    voice: 2,
    tag: "02 / 入职与注意力点数",
    title: "进去先办入职手续",
    caption: "选部门岗位 · 每日 500 点 · 发帖扣 50、回帖扣 20"
  },
  {
    img: join(root, "previews", "bili2", "s6_post.png"),
    voice: 3,
    tag: "03 / 首席执行秘书办",
    title: "艾特高管，要先过审核",
    caption: "职级与价值评估 · 通过才回执 · 自动算出高管分配的时间"
  },
  {
    img: join(root, "previews", "bili2", "s2_forum.png"),
    voice: 4,
    tag: "04 / AI 高管",
    title: "他们会自己发帖、自己回你",
    caption: "德穆兰 · 哈德森 · 罗米修斯博士 · 首席执行秘书办"
  },
  {
    img: join(root, "previews", "bili2", "s4_collect.png"),
    voice: 5,
    tag: "05 / 资料征集",
    title: "缺的档案，等你来补",
    caption: "活动截图 · 设定考据 · 帖子原文 · 免注册可投"
  },
  {
    img: join(root, "previews", "bili2", "s1_home.png"),
    voice: 6,
    dark: true,
    tag: "HAAVK // CALL FOR ARCHIVES",
    title: "一起补完这段活动档案",
    caption: "154.89.149.92  ·  由 AI 构建 · 非官方粉丝项目"
  }
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: out, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(cmd + " 失败\n" + (r.stderr || r.stdout || "exit " + r.status));
  return r.stdout;
}
function duration(file) {
  return Number(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).trim()
  );
}
function escText(s) {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

const concat = [];
for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i];
  if (!existsSync(s.img)) throw new Error("素材缺失：" + s.img);
  const voice = join(out, `pvoice-${s.voice}.wav`);
  if (!existsSync(voice)) throw new Error("旁白缺失：" + voice);
  const dur = duration(voice) + 0.7;
  const target = join(out, `pscene-${i}.mp4`);

  // 背景：原图走 letterbox（保持比例、上下留深色边），站内截图走轻微推移
  let base;
  if (s.pad) {
    base = "scale=1280:576,pad=1280:720:0:72:color=0x101820,eq=brightness=-0.30:saturation=0.62";
  } else if (s.dark) {
    base = "scale=1408:990,crop=1280:720:x=64:y=90,eq=brightness=-0.42:saturation=0.45";
  } else {
    base = "scale=1408:990,crop=1280:720:x='64+16*sin(t/7)':y='92+9*cos(t/8)'";
  }

  const titleSize = s.dark ? 54 : 38;
  const titleY = s.dark ? 232 : 48;
  const tagY = s.dark ? 186 : 20;
  const capY = s.dark ? 330 : 646;
  const capSize = s.dark ? 26 : 23;
  const tagText = escText(s.tag);
  const titleText = escText(s.title);
  const captionText = escText(s.caption);

  const filters = [
    base,
    `drawbox=x=0:y=0:w=1280:h=720:color=0x101820@${s.dark ? 0.34 : 0.05}:t=fill`,
    `drawbox=x=72:y=${s.dark ? 162 : 0}:w=6:h=${s.dark ? 210 : 96}:color=0x4782c6:t=fill`,
    `drawtext=fontfile='${font}':text='${tagText}':x=96:y=${tagY}:fontsize=19:fontcolor=0x79b6e8:shadowcolor=black@0.4:shadowx=0:shadowy=1`,
    `drawtext=fontfile='${bold}':text='${titleText}':x=94:y=${titleY}:fontsize=${titleSize}:fontcolor=white:shadowcolor=black@0.4:shadowx=0:shadowy=2`,
    `drawbox=x=0:y=${s.dark ? 596 : 622}:w=1280:h=124:color=0x0d1218@0.82:t=fill`,
    `drawtext=fontfile='${font}':text='${captionText}':x=72:y=${capY}:fontsize=${capSize}:fontcolor=0xf2f5f8`,
    `drawtext=fontfile='${font}':text='AI 辅助构建 · 非官方粉丝项目':x=72:y=690:fontsize=15:fontcolor=0x9da8b4`,
    `fade=t=in:st=0:d=0.3,fade=t=out:st=${(dur - 0.3).toFixed(3)}:d=0.3`,
    "format=yuv420p"
  ].join(",");

  run("ffmpeg", [
    "-y", "-loop", "1", "-framerate", "30", "-i", s.img, "-i", voice,
    "-filter_complex",
    `[0:v]${filters}[v];[1:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,adelay=400|400,apad[a]`,
    "-map", "[v]", "-map", "[a]", "-t", dur.toFixed(3), "-r", "30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", target
  ]);
  concat.push(`file 'pscene-${i}.mp4'`);
  console.log(`scene ${i} ${dur.toFixed(1)}s  ${s.title}`);
}

writeFileSync(join(out, "concat2.txt"), concat.join("\n"), "utf8");
run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "concat2.txt", "-c", "copy", "-movflags", "+faststart", "haavk-promo.mp4"]);
run("ffmpeg", ["-y", "-ss", "1.2", "-i", "haavk-promo.mp4", "-frames:v", "1", "-q:v", "2", "haavk-promo-cover.jpg"]);

const final = join(out, "haavk-promo.mp4");
console.log(`DONE ${final} ${duration(final).toFixed(1)}s`);
