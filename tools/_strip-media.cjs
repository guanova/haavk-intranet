/* 一次性迁移：固定 1280 画布策略下，废除所有 max-width 自适应媒体查询。
   用法：node tools/_strip-media.cjs  */
const fs = require("node:fs");
const path = require("node:path");

const files = ["views.css", "layout.css", "post-detail.css", "admin.css", "components.css"];
let total = 0;

for (const f of files) {
  const p = path.join(__dirname, "..", "styles", f);
  let css = fs.readFileSync(p, "utf8");
  let out = "";
  let i = 0;
  let removed = 0;
  while (i < css.length) {
    const idx = css.indexOf("@media (max-width", i);
    if (idx === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, idx);
    // 找第一个 { 然后平衡匹配到对应 }
    let j = css.indexOf("{", idx);
    if (j === -1) throw new Error(f + ": media block missing {");
    let depth = 0;
    let k = j;
    for (; k < css.length; k++) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(f + ": unbalanced braces near " + idx);
    // 注释标记（保留位置感）
    out += "/* [fixed-canvas] 已废除窄屏媒体查询 @media " + css.slice(idx + 8, css.indexOf(")", idx) + 1) + " */\n";
    removed++;
    i = k + 1;
  }
  if (removed > 0) {
    fs.writeFileSync(p, out);
    console.log(f + ": removed " + removed + " block(s)");
    total += removed;
  } else {
    console.log(f + ": none");
  }
}
console.log("total removed: " + total);
