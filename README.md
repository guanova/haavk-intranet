# 哈夫克内网（HAAVK Intranet）

以活动主题世界观为背景的**可运营社区平台**：Node 原生 HTTP 服务 + `node:sqlite` 持久化 + 零第三方依赖前端。

- **不是静态页**：所有用户、帖子、回复、点数流水、入职申请、@ 审核、备案配置均写入 SQLite。
- **零 npm 依赖**：唯一运行时要求是 Node.js ≥ 22.5（内置 `node:sqlite`）。
- **可面向大众上线**：服务端鉴权与 RBAC、事务化扣点、限流与防刷、审计日志、对账脚本。

> 本项目为同人性质的界面复刻与工程实践，与腾讯、《三角洲行动》开发团队无关。
> 游戏专有名词均来自公开资料，逐条标注来源与可信度（见 `docs/02_资料考据与来源.md`）。
> 站内人物立绘、商品图取自萌娘共享「三角洲行动」分类（CC BY-NC-SA 4.0），仅用于非商业演示；
> 首页主视觉与卡片底图由活动截图裁切合成，原始参考截图不随仓库分发。
>
> **线上演示**：http://154.89.149.92/ ｜ **宣传片**：https://www.bilibili.com/video/BV1Uxx16VEVQ

---

## 一、快速开始

```bash
# 需要 Node.js >= 22.5
node -v

# 启动（首次自动建库、迁移、播种出厂数据）
node server/index.js
```

| 入口 | 地址 |
|---|---|
| 站点 | http://127.0.0.1:8137/ |
| 管理面板 | http://127.0.0.1:8137/#/admin |

**Windows 用户**：双击 `start.cmd`（会校验 Node 版本并以默认密码启动）。
也可以 `npm start` / `npm run dev`。

默认出厂账号：

| 账号 | 密码 | 角色 |
|---|---|---|
| `webops_admin` | `Haavk@Admin2026`（可用 `HAAVK_ADMIN_PASSWORD` 覆盖） | 网站管理员 · **不开放注册** |
| `ai_desmoulins`（阿娜伊斯·德穆兰） | `Haavk@Officer2026` | AI 高管 |
| `ai_hudson`（哈德森） | 同上 | AI 高管 |
| `ai_rometheus`（罗米修斯博士） | 同上 | AI 高管 |
| `ai_secretariat`（首席执行秘书办） | 同上 | AI 高管 · @ 审核席 |

**首次使用流程**：注册（账号信息 → 办理入职手续）→ 管理员审批入职 → 领取每日注意力点数 → 发帖 / 回复（可用 `@` 呼叫集团高级管理人员）→ 在个人信息页查看点数流水与岗位变更申请。

**想要有内容可看**（可选，面向首次上线）：

```bash
node server/tools/demo-seed.js     # 15 位演示员工 + 帖子 + AI 高管发言
node server/tools/avatar-seed.js   # 纯 Node 生成并登记头像（走真实上传路径）
```

演示员工统一密码 `Haavk#2026`（示例账号 `claire` / `lina` / `panshi`）。

---

## 二、目录结构

```
haavk-intranet/
├─ index.html                     唯一 HTML 入口（按顺序加载前端脚本）
├─ package.json                   零依赖；scripts: start / dev / migrate / seed / smoke / test:e2e
├─ start.cmd                      一键启动（含 Node 版本校验）
├─ run-tests.cmd                  一键运行全部自检
│
├─ server/                        ★ 服务端（Node 原生，无第三方依赖）
│  ├─ index.js                    HTTP 入口：路由分发 / 静态与 SPA 回退 / 启动时迁移与播种
│  ├─ constants.js                角色、状态机枚举、错误码、**@ 三分支固定文案**、配置出厂值
│  ├─ seed-data.js                出厂数据：部门 / 岗位 / 板块 / AI 高管代理
│  ├─ migrations/001_init.js      16 张表的版本化迁移（幂等）
│  ├─ lib/
│  │  ├─ db.js                    SQLite 连接、WAL、withTx（BEGIN IMMEDIATE）事务
│  │  ├─ migrate.js               迁移执行器（schema_migrations 表）
│  │  ├─ auth.js                  会话（token 哈希入库）、角色守卫、注册/登录
│  │  ├─ password.js              scrypt 哈希与强度校验
│  │  ├─ points.js                点数记账、每日领取、对账
│  │  ├─ mentions.js              @ 解析、职级风控、价值评估、<time> 计算、状态机
│  │  ├─ settings.js              站点配置读写（含备案信息、范围保护）
│  │  ├─ http.js                  请求体/JSON/multipart 解析、Cookie、静态文件、图片魔数
│  │  ├─ router.js                极简参数化路由
│  │  ├─ validate.js              字段级入参校验
│  │  ├─ ratelimit.js             固定窗口限流桶
│  │  ├─ strings.js               名称归一化、@ 提取、时区日期
│  │  └─ errors.js                统一 AppError 与错误码
│  ├─ api/
│  │  ├─ auth.js                  注册 / 登录 / 当前用户 / 资料 / 改密 / 入职与变更申请
│  │  ├─ points.js                领取 / 汇总 / 流水
│  │  ├─ forum.js                 板块 / 帖子 / 回复 / @ 回执
│  │  ├─ catalog.js               部门岗位目录 + 站点内容（四大栏目数据源）+ 线索提交
│  │  ├─ admin.js                 管理面板全部接口（概览/审批/配置/用户/@审核/AI高管/审计）
│  │  └─ media.js                 头像上传、删除、媒体服务、默认头像
│  ├─ workers/index.js            后台任务：@ 审核推进、AI 高管自主发声、定期清理
│  └─ tools/                      运维脚本：migrate / seed / reset / reconcile / smoke /
│                                 demo-seed / avatar-seed / fix-filing
│
├─ js/                            ★ 前端（经典脚本 + hash 路由 SPA）
│  ├─ core/
│  │  ├─ api.js                   接口客户端（同源 Cookie、错误归一化、站点配置缓存）
│  │  ├─ store.js                 单向数据流 store（服务端为唯一数据源）
│  │  ├─ auth.js                  认证动作（服务端完成，前端仅即时提示）
│  │  ├─ router.js                hash 路由 + 登录/入职/管理员三级守卫
│  │  ├─ persist.js               **仅** UI 偏好（草稿、筛选），不存业务数据
│  │  └─ util.js                  转义、时间、归一化、事件总线
│  ├─ services/db.js              领域服务（全部经由 HTTP 接口）
│  ├─ components/                 ui（图标/Toast/弹窗/状态块）/ shell（导航/页脚备案）
│  └─ views/                      about / forum / post-detail / compose / profile /
│                                 onboarding / login / register / solutions / wanted /
│                                 admin / not-found
│
├─ styles/                        tokens（设计令牌）/ base / layout / components / views / admin
├─ assets/                        导航 Logo、图标精灵、烘焙主视觉与卡面、人物立绘与商品图（无外链）
├─ docs/                          00 视觉规范 / 01 架构 / 02 资料考据 / 04 数据库与接口契约 /
│                                 05 部署与运维 / 06 需求响应与验收清单
├─ tests/server/e2e.js            端到端验收自检（临时库 + 随机端口）
└─ data/                          运行时生成：haavk.db、uploads/avatars/（需备份）
```

---

## 三、核心业务规则

| 规则 | 值 | 落点 |
|---|---|---|
| 每日可领取注意力点数 | **500**，每人每天仅一次 | `daily_claims` 表 `UNIQUE(user_id, claim_date)` |
| 发帖扣除 | **50** | `points_ledger` + `users.points_balance` 同事务 |
| 回复扣除 | **100** | 同上 |
| 余额不足 | 402 + 差额，**事务回滚不产生内容** | `AppError.insufficient` |
| @ 冷却 | 同一用户对同一高管 **60 秒** | `mentions` 最近记录 |
| @ 每小时上限 | **5 次** | 配置项可调 |
| 单帖呼叫上限 | **3 位**，超出直接驳回 | 配置项可调 |
| @ 受理职级下限 | 职级分 ≥ **2** | 员工基线 3，可随入职时长/发帖量/被采纳呼叫提升 |
| 求职级分标尺 | 1 受限 / 3 新员工 / 4 活跃 / 7 部门负责人 / 9 AI 高管 / 10 管理员 | `authorityOf` |
| `<time>` 计算 | 基准 8 分钟 + 内容长度 + 该高管呼叫热度 + 职级差，夹紧 **5–45 分钟** | `computeAssignedMinutes` |

**点数是服务端唯一可信来源**：前端所有数值均由接口下发，规则集中在 `site_settings`（管理面板可调，出厂值与上表一致）。

---

## 四、@ 呼叫状态机

```
用户发帖 / 回复含 @某高管
        │
        ▼
  服务端同步预检（冷却 / 每小时上限 / 单帖上限 / 最短长度 / 灌水 / 24h 去重 / 职级 / 目标停用）
        │
   ┌────┴──────────────┐
   │ 通过               │ 不通过
   ▼                    ▼
status = pending      status = rejected（终态）
回执：审核中           回执：未通过
        │
        ▼ 后台 worker（2.5s 轮询，通常 3–10s 结案，10 分钟超时兜底）
status = under_review → 价值评估（长度 / 灌水 / 爆发）
        │
   ┌────┴────────────┐
   │ 有价值           │ 无价值
   ▼                  ▼
approved            rejected
回执：通过（含动态 <time>）   回执：未通过
+ 转阅：该高管账号在原帖追加回复
```

三段回执文案**只在 `server/constants.js` 定义一次**，前端不做任何改写，仅按状态展示。

---

## 五、自检与验收

```bash
run-tests.cmd            # 一键：冒烟 + 端到端 + 对账
# 或分别执行：
node server/tools/smoke.js       # 接口冒烟自检（68 项，临时库）
node tests/server/e2e.js         # 端到端验收（145 项，临时库 + 随机端口）
node server/tools/reconcile.js   # 点数/计数/头像引用对账（必须 0 差异）
```

覆盖范围包括：注册与入职审批闭环、点数领取防重（含 8 路并发）、事务扣点与余额不足回滚、
@ 三分支回执逐字校验与 `<time>` 动态性、转阅落库、头像链路（上传/缓存/魔数/超限/路径穿越/默认兜底）、
备案配置权限边界、注册接口无法产生管理角色、岗位变更审批、改密与会话、越权拦截、输入校验、SQLite 落库与对账一致性。

需求逐条对照见 **[docs/06_需求响应与验收清单.md](docs/06_需求响应与验收清单.md)**。

---

## 六、部署

简要说明见下文，完整版（systemd / Nginx / 备份恢复 / 上线检查清单 / 常见问题）见
**[docs/05_部署与运维说明.md](docs/05_部署与运维说明.md)**。

```bash
export PORT=8137
export HAAVK_ADMIN_PASSWORD='强密码'
export HAAVK_OFFICER_PASSWORD='强密码'
export HAAVK_COOKIE_SECURE=1      # HTTPS 部署
export HAAVK_TRUST_PROXY=1        # 有反向代理时
node server/index.js
```

**上线前必须完成**：

1. 登录管理面板修改 `webops_admin` 初始密码；
2. 在管理面板 → 站点配置 → 备案信息填写**真实**备案号（留空则页脚不渲染该行）；
3. 按需清理演示数据：`node server/tools/reset.js --yes`；
4. 备份 `data/haavk.db` 与 `data/uploads/avatars/`（推荐 `sqlite3 .backup`）。

---

## 七、数据与备份

| 需要备份 | 说明 |
|---|---|
| `data/haavk.db`（含 `-wal` / `-shm`） | 全部业务数据 |
| `data/uploads/avatars/` | 头像文件 |

```bash
sqlite3 data/haavk.db ".backup 'backup/haavk-$(date +%F).db'"
```

> 不要在服务运行时直接 `cp` WAL 模式的库文件，可能得到不一致快照。

---

## 八、常用修改位置

| 想改什么 | 改哪里 |
|---|---|
| 配色 / 字号 / 间距 | `styles/tokens.css` |
| 部门、岗位、板块、AI 高管出厂数据 | `server/seed-data.js` → `npm run seed` |
| 首页 / 商城 / 资料征集（原寻人启事）/ 论坛侧栏文案 | `server/api/catalog.js` 的 `HOME_CONTENT` / `SOLUTION_CONTENT` / `WANTED_CONTENT` / `FORUM_INTRO` |
| 站点名称与备案信息 | 管理面板 → 站点配置（存 `site_settings` 表） |
| 点数与 @ 风控参数 | 管理面板 → 站点配置 |
| 资料征集页分类与说明文案 | `js/views/collect.js` 的 `TYPES` / `INTRO` |
| @ 三支回执文案 | `server/constants.js` 的 `MENTION_COPY`（**唯一副本，改动需同步更新验收清单**） |
| 数据表结构 | `server/migrations/`（**新增迁移文件，不要改已有迁移**） |
| 路由与守卫 | `js/app.js` 的 `NS.router.add(...)` 与 `js/core/router.js` |
| 密码与会话策略 | `server/lib/password.js`、`server/constants.js` 的 `SESSION` |

---

## 九、已知限制

1. **素材为同人演示用途**：人物立绘与商品图取自萌娘共享（CC BY-NC-SA 4.0），主视觉与卡面由活动截图裁切合成。替换只需改 `server/api/catalog.js` 内的图路径，无需改代码。
2. **AI 高管发言为素材池驱动**，非真实大模型推理；接大模型只需替换 `server/workers/index.js` 中 `runAutoPosts` / `runAutoReplies` / `forwardToOfficer` 的取文案逻辑。
3. **单进程架构**：SQLite 适合单实例部署；如需多实例横向扩展，需把 `server/lib/db.js` 换成 Postgres/MySQL 客户端并把缓存与限流外置。
4. **破解/黑入玩法未实现**：这与业务无关，未纳入本平台范围。
5. **演示备案号不是真实备案**：上线必须替换。
