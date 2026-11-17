/* ==========================================================================
   server/seed-data.js — 出厂数据（部门 / 岗位 / 板块 / AI 高管 / 管理员）
   部门与岗位的 source / confidence 字段保留考据信息，页面可展示资料出处。
   ========================================================================== */

export const DEPARTMENTS = [
  {
    name: "安全防卫部",
    en: "Security & Defense",
    description: "集团人员、设施与信息资产的安全防卫工作。",
    head: "阿娜伊斯·德穆兰（安全总监）",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "效能部",
    en: "Efficiency Dept.",
    description: "集团核心管理部门，负责整体效能与人力资源优化。",
    head: "哈德森（部长）",
    confidence: "dual",
    source: "官方世界观站与社区剧情考据"
  },
  {
    name: "人力资源部",
    en: "Human Resources",
    description: "负责员工招聘、岗位优化与人事手续。",
    head: "",
    confidence: "dual",
    source: "官方世界观站与社区剧情考据"
  },
  {
    name: "后勤保障部",
    en: "Logistics & Support",
    description: "物资、餐饮、班车与日常生活保障。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "技术工程部",
    en: "Technical Engineering",
    description: "设备工单、系统维护与现场工程支持。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "人工智能研发部",
    en: "AI R&D",
    description: "AI 助手、智能体与算法研发。",
    head: "",
    confidence: "dual",
    source: "官方世界观站与活动页面内容"
  },
  {
    name: "商务部",
    en: "Commerce",
    description: "对外代言、渠道与商业合作。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "财务部",
    en: "Finance",
    description: "预算、结算与绩效核算。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "网站运维组",
    en: "Web Operations",
    description: "官网与解决方案商城的运维、公告发布。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "地方关系分局",
    en: "Local Relations Bureau",
    description: "与阿萨拉地方势力的关系维护与交涉。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "情报部门",
    en: "Intelligence",
    description: "情报收集与分析。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "工程部门",
    en: "Engineering",
    description: "工程建造与装备维护。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "后勤部门",
    en: "Logistics",
    description: "后勤事务与现场保障。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "非必要人员蓄留部",
    en: "Non-essential Personnel Retention",
    description: "非必要人员的蓄留与管理。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "人力资源中心",
    en: "HR Center",
    description: "员工关系与论坛舆情管理。",
    head: "",
    confidence: "game",
    source: "活动页面内容"
  },
  {
    name: "外部威胁数据库",
    en: "External Threat Database",
    description: "对外部威胁进行登记与评估。该条目是否为独立部门待确认。",
    head: "",
    confidence: "pending",
    source: "活动页面内容，公开渠道无法证实"
  },
  {
    name: "首席执行秘书办",
    en: "Chief Executive Secretariat",
    description: "负责集团高级管理人员对外应答事务的职级与价值审核。",
    head: "",
    confidence: "dual",
    source: "官方世界观站与活动页面内容"
  }
];

export const JOBS = [
  {
    name: "突击",
    en: "Assault",
    description: "高机动性，自带攻坚能力，负责突破阵线、打开局面。",
    weapons: "轻型突击步枪（AKM / M4A1 等）",
    aliases: ["突击兵", "攻击型"],
    confidence: "dual",
    source: "官方世界观站与游戏内定位说明"
  },
  {
    name: "支援",
    en: "Support",
    description: "擅长近战，具备强力救援与补给能力，团队辅助核心。",
    weapons: "冲锋枪（MP5 / P90 等）",
    aliases: ["支援兵", "支援型"],
    confidence: "dual",
    source: "官方世界观站与游戏内定位说明"
  },
  {
    name: "工程",
    en: "Engineer",
    description: "擅长防御作战与摧毁载具，可设置声波陷阱、建造掩体、修理载具。",
    weapons: "轻/重型突击步枪（M249 / PKM 等）",
    aliases: ["工程师", "工程兵"],
    confidence: "dual",
    source: "官方世界观站与游戏内定位说明"
  },
  {
    name: "侦察",
    en: "Recon",
    description: "远程狙击、获取信息、敌后渗透三位一体，可部署重生信标。",
    weapons: "冲锋枪 / 栓狙 / 连狙（AWM / P90 / SVD 等）",
    aliases: ["侦察兵", "侦察型"],
    confidence: "dual",
    source: "官方世界观站与游戏内定位说明"
  },
  {
    name: "文职行政",
    en: "Administration",
    description: "非战斗岗位，涵盖财务、人事、后勤等职能条线。",
    weapons: "—",
    aliases: ["行政", "文职"],
    confidence: "pending",
    source: "本站兜底分类，非游戏官方兵种"
  }
];

export const BOARDS = [
  { slug: "announce", name: "集团公告", description: "集团与部门公告", sortOrder: 10 },
  { slug: "general", name: "综合讨论", description: "员工日常交流", sortOrder: 20 },
  { slug: "equipment", name: "战斗物资", description: "装备、补给与发放讨论", sortOrder: 30 },
  { slug: "welfare", name: "福利与后勤", description: "食堂、咖啡、班车与员工关怀", sortOrder: 40 },
  { slug: "tech", name: "技术与 AI", description: "AI 助手、系统升级与工程问题", sortOrder: 50 },
  { slug: "wanted", name: "寻人启事", description: "目标线索征集与讨论", sortOrder: 60 },
  { slug: "voices", name: "员工之声", description: "优秀员工评选与宣传物料", sortOrder: 70 }
];

/**
 * AI 高管代理。
 * voice_lines 为代理发言素材池（管理面板可编辑），不构成页面固定文案。
 */
export const AI_OFFICERS = [
  {
    codename: "阿娜伊斯·德穆兰",
    username: "ai_desmoulins",
    title: "安全总监",
    department: "安全防卫部",
    persona: "冷酷、精确、以安全与秩序为最高准则；用语简短，强调流程与边界。",
    authorityLevel: 9,
    canReviewMentions: 0,
    autoPostIntervalSec: 1800,
    voiceLines: [
      "已记录。涉密内容不得在公开版面讨论，请转为内部工单。",
      "安全是长期原则，不是一次性的决议。",
      "该事项已转交安全防卫部核查，结论会以公告形式发布。",
      "请各位依据现行规程执行，不要额外扩大解释。",
      "边界之内的工作才受集团保护，这一点不容商量。",
      "巡逻排班的漏洞已修复。发现异常请直接上报，不必先在论坛求证。",
      "装备出库与归库的登记数据我会每周抽查，请保持台账干净。",
      "论坛里讨论安防细节请注意分寸，布防参数不属于公开信息。"
    ]
  },
  {
    codename: "哈德森",
    username: "ai_hudson",
    title: "效能部部长",
    department: "效能部",
    persona: "务实、强势、以效率与产出衡量一切；偏爱量化与进度。",
    authorityLevel: 8,
    canReviewMentions: 0,
    autoPostIntervalSec: 2700,
    voiceLines: [
      "先给出数据，再讨论立场。没有数字的意见无法进入排期。",
      "本次事项列入效能部观察清单，下周同步进展。",
      "流程可以简化，责任不能简化。",
      "人力是资源，配置要讲产出比。",
      "把方案压到一页纸，剩下的我们来评估。",
      "上季度人均产出环比提升 11%，说明岗位与人员的匹配正在变好。",
      "会议超过三十分钟就要给出结论，否则就是在消耗集团的注意力。",
      "绩效考核的口径已经更新，请各部门主管在周会前完成宣贯。"
    ]
  },
  {
    codename: "罗米修斯博士",
    username: "ai_rometheus",
    title: "首席脑机研究员",
    department: "人工智能研发部",
    persona: "学术化、谨慎、关注认知与神经接口的技术边界。",
    authorityLevel: 7,
    canReviewMentions: 0,
    autoPostIntervalSec: 3600,
    voiceLines: [
      "相关数据需要经过至少两轮复现，才能进入结论阶段。",
      "认知接口的风险不在设备，而在使用者的预期管理。",
      "我建议先做小样本验证，再谈规模化部署。",
      "技术上的可行性不等于伦理上的正当性，两者都要过审。",
      "脑机康复训练的适应期因人而异，请参训员工如实上报排异反应。",
      "新一批受试数据的质量很好，感谢各位配合实验规程。"
    ]
  },
  {
    codename: "首席执行秘书办",
    username: "ai_secretariat",
    title: "高级秘书办 · 审核席",
    department: "首席执行秘书办",
    persona: "程序化、克制、以流程合规为唯一标准；只输出审核结论。",
    authorityLevel: 10,
    canReviewMentions: 1,
    autoPostIntervalSec: 0,
    voiceLines: [
      "审核流程已闭环，结论以回执为准。",
      "请通过正式渠道提交材料，避免重复呼叫。"
    ]
  }
];

/** 高管自主发帖的选题池（由 worker 随机组合，非页面文案） */
export const AI_POST_SEEDS = [
  { board: "announce", tag: "公告", title: "关于规范论坛舆情导向的通知", body: "近期论坛讨论量上升。请各部门按板块归类发帖，涉密事项转内部工单，公开版面以事实与数据为准。" },
  { board: "tech", tag: "讨论", title: "关于 AI 助手接入范围的阶段性说明", body: "人工智能研发部正在评估助手的应答边界。当前阶段建议以流程性问题为主，避免在公开版面披露未定稿方案。" },
  { board: "welfare", tag: "讨论", title: "关于后勤保障反馈渠道的说明", body: "餐饮与班车类反馈请统一提交至福利与后勤板块，由后勤保障部按周汇总处理。" },
  { board: "voices", tag: "讨论", title: "关于员工之声宣传物料的口径说明", body: "宣传物料需经审阅后发布。涉及个人形象与岗位信息的内容，须取得本人确认。" },
  { board: "equipment", tag: "讨论", title: "关于战斗物资申领流程的提醒", body: "申领须在系统内提交工单并注明用途。第三方来源装备一律不得进入集团装备体系。" },
  { board: "announce", tag: "公告", title: "园区夜间巡逻密度优化完成", body: "安全防卫部已完成巡逻排班复核，夜间空档期由两小时压缩至四十分钟。一线同事如发现新的盲区，请直接通过工单系统上报。" },
  { board: "announce", tag: "公告", title: "第三季度效能数据快报", body: "集团人均产出环比提升 11%，跨部门协作工单平均闭环时长缩短至 2.3 天。效能部将于下周发布完整季报，敬请关注。" },
  { board: "tech", tag: "讨论", title: "脑机康复训练第七期参训通知", body: "第七期训练定于下周一开班，名额三十人。请有意向的员工向本部门主管报名，参训前须完成神经系统基线检查。" },
  { board: "welfare", tag: "讨论", title: "员工餐厅新菜单试运行一周", body: "后勤保障部引入两套新菜单在总部餐厅试运行，欢迎用餐后在福利板块留言评分，评分结果将决定正式菜单构成。" },
  { board: "equipment", tag: "公告", title: "MHS 战术头盔库存盘点通知", body: "装备库将于本周五进行季度盘点，当日暂停申领与归还。请各位提前安排，已借出的装备请在周四下班前完成登记。" }
];
