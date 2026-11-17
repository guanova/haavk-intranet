/* ==========================================================================
   server/api/catalog.js — 世界观目录与站点内容（四大栏目数据源）
   所有面向页面的内容都在服务端，前端只负责渲染；页面代码中不出现任何引导型文案。
   ========================================================================== */
import { all, get, run } from "../lib/db.js";
import { sendOk } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { assertSameOrigin, readJsonBody } from "../lib/http.js";
import { requireAuth } from "../lib/auth.js";
import { publicSettings } from "../lib/settings.js";
import { MENTION_COPY } from "../constants.js";

/* ------------------------------ 部门 / 岗位 / 高管 ------------------------------ */

function serializeCatalogItem(r) {
  return {
    id: r.id,
    name: r.name,
    enName: r.en_name || "",
    description: r.description || "",
    headName: r.head_name || "",
    source: r.source || "",
    confidence: r.confidence,
    isCustom: !!r.is_custom,
    sortOrder: r.sort_order,
    aliases: safeArray(r.aliases),
    weapons: r.weapons || ""
  };
}

function safeArray(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function getCatalog(ctx) {
  const departments = all(
    "SELECT * FROM departments WHERE is_active = 1 ORDER BY sort_order ASC, id ASC"
  ).map(serializeCatalogItem);
  const jobs = all("SELECT * FROM jobs WHERE is_active = 1 ORDER BY sort_order ASC, id ASC").map(serializeCatalogItem);
  const aiOfficers = all(
    `SELECT o.id, o.codename, o.title, o.authority_level, o.department_id,
            d.name AS department_name
       FROM ai_officers o LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.enabled = 1 ORDER BY o.authority_level DESC, o.id ASC`
  ).map((o) => ({
    id: o.id,
    codename: o.codename,
    title: o.title,
    authorityLevel: o.authority_level,
    departmentId: o.department_id,
    departmentName: o.department_name || "",
    mentionToken: `@${o.codename}`
  }));
  return sendOk(ctx.res, { departments, jobs, aiOfficers });
}

/* ------------------------------ 站点内容（四大栏目） ------------------------------ */

export function getSite(ctx) {
  const settings = publicSettings();
  return sendOk(ctx.res, {
    settings,
    filing: settings.filing,
    brand: settings.brand,
    home: HOME_CONTENT,
    solutions: SOLUTION_CONTENT,
    wanted: WANTED_CONTENT,
    forumIntro: FORUM_INTRO,
    mentionCopy: {
      underReview: MENTION_COPY.UNDER_REVIEW
    }
  });
}

/** 关于我们：主视觉、优秀员工、员工之声 */
const HOME_CONTENT = {
  heroSlides: [
    { id: "s1", title: "天空属于哈夫克", subtitle: "执掌天穹，让人的文明在庇护之下繁荣昌盛。", signature: true, hero: "assets/img/hero-full-1.jpg" },
    { id: "s2", title: "无声之力，成就至效", subtitle: "优化效率，在无声中支撑极星的力量。", signature: true, hero: "assets/img/hero-full-2.jpg" },
    { id: "s3", title: "进步，始于认知", subtitle: "连接神经，重塑认知，个体之智汇成文明之智。", signature: false, hero: "assets/img/hero-full-3.jpg" }
  ],
  profile: [
    { label: "业务范围", value: "计算、物流与人工智能开发" },
    { label: "总部", value: "阿萨拉 · 巴克什" },
    { label: "地标", value: "哈夫克尖塔" },
    { label: "对外关系", value: "与阿萨拉卫队维持权宜合作" }
  ],
  excellent: [
    { id: "emp_claire", name: "克莱尔", subtitle: "坚守本心", motto: ["知道我是谁", "才知为何而战"], asset: "assets/img/excellent-full-1.jpg" },
    { id: "emp_lina", name: "莉娜", subtitle: "科技装备", motto: ["个人表现灵感", "集团栽培进步"], asset: "assets/img/excellent-full-2.jpg" }
  ],
  voices: [
    { id: "emp_panshi", name: "磐石", department: "工程部门", motto: ["不同职位大小", "奉献总有回报"], asset: "assets/img/voice-full-1.jpg" },
    { id: "emp_yexiao", name: "夜枭", department: "情报部门", motto: ["先理解后执行", "理解框架执行越好"], asset: "assets/img/voice-full-2.jpg" },
    { id: "emp_leiting", name: "雷霆", department: "安全防卫部", motto: ["你们已经安全了", "剩下的交给我们"], asset: "assets/img/voice-full-3.jpg" },
    { id: "emp_daozhang", name: "道长", department: "后勤部门", motto: ["敬畏未知的力量", "守护大家的平静"], asset: "assets/img/voice-full-4.jpg" }
  ]
};

/** 解决方案：轮播广告与商品 */
const SOLUTION_CONTENT = {
  promos: [
    {
      id: "promo_mhs",
      title: "MHS战术头盔",
      slogan: "长官的指令就戴在您头上",
      features: [
        { name: "冲击缓释", description: "保护头部安全" },
        { name: "主动听觉", description: "强化关键声源" },
        { name: "强制通信", description: "确保收到命令" }
      ],
      image: "assets/img/promo-full-1.jpg"
    },
    {
      id: "promo_turing",
      title: "图灵砖",
      slogan: "究极的智能造物只为进步",
      features: [
        { name: "全域联通", description: "覆盖一切需要进步的区域" },
        { name: "随机算法", description: "概率带来未知惊喜" },
        { name: "在线换代", description: "集团定期更新服务内容" }
      ],
      image: "assets/img/promo-full-2.jpg"
    },
    {
      id: "promo_hvk2",
      title: "HVK-2防弹护甲",
      slogan: "优秀员工最好的勋章",
      features: [
        { name: "精英特权", description: "业绩全优者有机会申领" },
        { name: "极限负重", description: "全面激发员工身心毅力" },
        { name: "安全无虞", description: "搭配人身保险组合销售" }
      ],
      image: "assets/img/promo-full-3.jpg"
    }
  ],
  sideIntro: [
    "所有员工严禁使用来自第三方的不可靠装备。",
    "集团致力于持续研发优质产品，为复杂的战场提供丰富的解决方案。"
  ],
  sidePoints: [
    { icon: "tank", iconImg: "assets/img/icon-tank.png", title: "军工品质", description: "哈夫克制品质总能经受战火的考验" },
    { icon: "hex", iconImg: "assets/img/icon-circle.png", title: "物美价廉", description: "部分物品价格下调，想必是集团最新的惠民举措" },
    { icon: "speaker", iconImg: "assets/img/icon-arrows.png", title: "精益求精", description: "部分物品价格上涨，更体现了集团精益求精的精神" }
  ],
  products: [
    { id: "item_turing", name: "图灵砖", limitText: "限购：5/5", description: "搭载先进智能技术的先锋平台，随机算法蕴藏惊喜。", price: 300000, soldOut: true, image: "assets/img/item-turing.png" },
    { id: "item_h09", name: "H09防爆头盔", limitText: "限购：1/1", description: "机枪巡逻队制式装备，非机枪组员工购买前建议先咨询主管意见。", price: 1, soldOut: true, image: "assets/img/item-h09.png" },
    { id: "item_mhs", name: "MHS战术头盔", limitText: "限购：2/2", description: "强制听力辅助装置确保您再也不会错过上级的命令。", price: 1, soldOut: true, image: "assets/img/item-mhs.jpg" },
    { id: "item_hls2", name: "HLS2重型背包", limitText: "限购：1/1", description: "合理的空间设计巧妙杜绝了您出勤时违规私藏战利品的风险——敬业爱岗，两袖清风。", price: 1, soldOut: true, image: "assets/img/item-hls2.png" },
    { id: "item_hmp", name: "HMP特勤防弹衣", limitText: "限购：2/2", description: "轻薄耐用，工伤补贴和装备成本的绝佳平衡。", price: 1, soldOut: true, image: "assets/img/item-hmp.png" },
    { id: "item_hvk2", name: "HVK2防弹衣", limitText: "限购：1/1", description: "此护甲的生命周期往往高于我集团员工平均任职时长，请务必珍惜。", price: 1, soldOut: true, image: "assets/img/item-warrior.png" },
    { id: "item_assault_vest", name: "突击手防弹背心", limitText: "限购：2/2", description: "防御面积升级，推荐执行高危安保任务员工选购本品。", price: 1, soldOut: true, image: "assets/img/item-assault.png" }
  ]
};

/** 寻人启事 */
const WANTED_CONTENT = {
  intro: [
    "为保障集团员工与阿萨拉地区居民安全，哈夫克集团对部分失联人员持续加以特别关注。",
    "集团员工或社会人士如能提供这些失联人士的有效信息，集团会发放合理的奖励。",
    "我们相信，每一位失联人员都有回家的权利。让我们一起献出爱心，伸出援手，帮他们早日回家。",
    "哈夫克集团保留对“回家”的全部解释权。"
  ],
  points: [
    { icon: "shield", title: "集团关怀", description: "为失联员工提供康复与安置通道" },
    { icon: "doc", title: "合规上报", description: "线索须经安全防卫部核验后方可发放奖励" },
    { icon: "hex", title: "奖励透明", description: "奖励标准公开，按线索价值分级发放" }
  ],
  targets: [
    {
      id: "wanted_h42",
      code: "H42",
      name: "",
      uncertain: false,
      tags: ["不善言语", "神出鬼没"],
      task: "需返回集团接受脑机康复训练",
      rewardLabel: "悬赏哈夫币总额",
      rewardKind: "number",
      rewardValue: 999999999,
      submitted: true,
      image: "assets/img/wanted-h42.jpg"
    },
    {
      id: "wanted_felar",
      code: "?卫 · 费莱尔",
      name: "卫 · 费莱尔",
      uncertain: true,
      uncertainNote: "该目标名称首字符在公开画面中被边缘裁切，无法确认，故标注待确认。",
      tags: ["纵火惯犯", "驯养鳄鱼"],
      task: "需返回集团监狱参加工程建设",
      rewardLabel: "举报奖励",
      rewardKind: "text",
      rewardValue: "园区鳄鱼喂养体验",
      submitted: true,
      image: "assets/img/wanted-felar.jpg"
    }
  ]
};

/** 员工论坛侧栏：守则与舆情摘要 */
const FORUM_INTRO = {
  noticeTop: "注意力点数不足者禁止继续使用论坛，违者按无故旷工交效能部严办。",
  notice:
    "请注意维护符合集团价值的舆论导向，曼德尔砖智能系统将自动检测当前舆情的主要特点并总结如下：",
  sentiments: [
    { icon: "haavk-mark", title: "人效调和", description: "在人本关切与执行效率之间，我们正努力寻找平衡。" },
    { icon: "haavk-mark", title: "有限接触", description: "与阿萨拉的合作是权宜手段，对阿萨拉的警惕是长期原则。" },
    { icon: "doc", title: "议论沸腾", description: "论坛讨论已经在全集团沸腾，表达意见成了新的业务。" }
  ],
  rules: [
    "论坛仅限已完成入职手续的员工发帖与回复。",
    "发帖与回复将按集团规定消耗注意力点数。",
    "呼叫集团高级管理人员须经首席执行秘书办审核。"
  ]
};

/**
 * POST /api/wanted/:id/clue —— 提交线索
 * 记录到 audit_logs（可追溯、可审计），并把该目标标记为已提交。
 * 目标清单来自站点内容常量，提交状态在服务端汇总。
 */
export async function submitClue(ctx) {
  assertSameOrigin(ctx.req);
  const user = requireAuth(ctx);
  const body = await readJsonBody(ctx.req);
  const target = WANTED_CONTENT.targets.filter(function (t) {
    return t.id === ctx.params.id;
  })[0];
  if (!target) throw AppError.notFound("目标不存在");

  const detail = String(body.detail || "").slice(0, 500);
  run(
    "INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
    user.id,
    "wanted.clue_submit",
    "wanted",
    String(target.id),
    JSON.stringify({ code: target.code, detail }),
    ctx.ip,
    Date.now()
  );

  return sendOk(ctx.res, {
    targetId: target.id,
    submitted: true,
    submittedAt: Date.now(),
    receipt: "线索已受理，将由安全防卫部核验后按标准发放奖励。"
  });
}

export { HOME_CONTENT, SOLUTION_CONTENT, WANTED_CONTENT, FORUM_INTRO };
