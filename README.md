# 随心一拍-花知道 · 识花收集微信小程序

![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg) ![Platform](https://img.shields.io/badge/Platform-WeChat%20Mini%20Program-brightgreen.svg)

拍一朵花 → 识别它 → 收进你的水彩花田。以「拍照识花 + 科普 + 图鉴收集 + 成就系统」为主线的小程序，基于微信云开发 + 百度 AI 植物识别。

**技术栈**：微信小程序原生框架（JS/WXML/WXSS）· 微信云开发（云函数/云数据库/云存储）· 百度 AI 植物识别 · 即梦 Seedream 插画生成

## 功能一览

- 📷 拍照 / 相册选图识别，百度植物识别返回 Top 3 候选
- 🔍 识别结果可手动搜索知识库纠正花种，确认后才正式入库
- 🗂 60 种常见花科普知识库（科属、学名、花期、花语、识别特征、小知识）
- 🎴 水彩绘本风花卡：四档稀有度（常见 / 少见 / 珍稀 / 传说），未收集显示剪影卡背
- 🏅 成就徽章（33 枚）、花匠等级（5 级头衔）、收集率统计
- 🕐 识花时间线：首页按小时回顾每一次识花记录（精确到分钟 + 实拍照片预览）
- 📷 批量识别：相册多选 ≤5 张逐张串行识别，统一清单逐张确认入库（失败跳过 + 未收录花批量生成）
- 📋 识别任务后台化：确认入库转云端后台执行（最多 3 条并发），首页「识别任务」模块查看进度与结果
- 💬 意见反馈：「我的」页提交体验建议 / Bug（类型 + 文字 + 截图，每日 5 条），可查看历史反馈
- 🖼 每张花卡可追加/删除照片、写备注、记录第 N 次遇见
- 🛡 每日限流（20 次/人/天）+ 微信图片内容安全检测

## 目录结构

```
flower/
├── miniprogram/                 # 小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── config.js                # 全局配置（云环境 ID、玩法参数）
│   ├── utils/util.js            # 压缩上传、云函数调用等工具
│   ├── components/flower-card/  # 花卡组件
│   └── pages/
│       ├── index/               # 首页（识花入口 + 进度速览）
│       ├── recognize/           # 识别结果页（候选确认 / 手动纠正）
│       ├── album/               # 图鉴（状态/花期筛选）
│       ├── detail/              # 花卡详情（照片 + 科普 + 管理）
│       ├── achievements/        # 成就与等级
│       └── profile/             # 我的（说明 + 隐私政策）
├── cloudfunctions/
│   ├── recognizeFlower/         # 识花：限流 → 内容安全 → 百度植物识别 → 匹配
│   ├── saveCard/                # 花卡入库与维护（create/addPhoto/deleteCard 等）
│   ├── getCollection/           # 图鉴数据 + 收集统计
│   ├── getAchievements/         # 等级、徽章、统计、今日剩余次数、最近收获
│   ├── initSpecies/             # 导入 60 种知识库（幂等，需管理员）
│   ├── deleteAccount/           # 注销：删除该用户全部数据与照片
│   ├── cleanupData/             # 定时清理过期数据（rate_limits 保留 30 天）
│   ├── requestFlowerGenerate/   # 未收录花生成请求（配额+去重+建任务）
│   ├── getFlowerGenerateTask/   # 生成任务状态查询（前端轮询）
│   └── generateFlowerWorker/    # 定时 worker：DeepSeek 科普 + Seedream 插画 + 入库
├── docs/SCHEMA.md               # 数据库集合与云函数说明
├── docs/技术文档.md              # 系统架构与接口技术文档
├── docs/需求方案.md              # 产品需求与玩法规则方案
├── docs/评审与改进建议.md         # 代码评审：问题分级与改进清单
├── docs/修复与优化记录.md         # 修复/优化留痕（每次改动必须记录）
├── docs/部署与验证手册.md          # 上线/换环境/重部署操作手册
├── NOTICE.md                    # 开源复用声明
└── LICENSE                      # Apache License 2.0
```

## 快速开始

### 1. 注册小程序并导入项目

- 在微信公众平台注册小程序（个人主体选择「工具-图片/摄影」等类目，以平台实际选项为准）。
- 获取 AppID，微信开发者工具导入本项目根目录，将 `project.config.json` 中的 `appid` 替换为你的 AppID。

### 2. 开通云开发

- 开发者工具中点击「云开发」开通环境（有免费额度）。
- 在云开发控制台创建 7 个集合：`species`、`user_cards`、`rate_limits`、`bd_token`、`photo_hashes`、`flower_gen_tasks`、`gen_limits`。
- 把 `miniprogram/config.js` 中的 `CLOUD_ENV` 改为你的云环境 ID（本仓库提交的是作者的环境 ID，直接使用会指向作者环境）。

### 3. 部署云函数

- 在 `cloudfunctions` 下对 10 个函数目录分别右键 →「上传并部署：云端安装依赖」。
- `cleanupData`、`generateFlowerWorker` 首次部署时选择「上传触发器」（分别是每周日 03:00 清理、每 2 分钟生成 worker）。
- `generateFlowerWorker` 需配置环境变量 `DEEPSEEK_API_KEY`、`ARK_API_KEY`（未收录花自动生成功能，见 [docs/部署与验证手册.md](docs/部署与验证手册.md) 第五节）。

### 4. 配置百度 AI

- 百度智能云 → 图像识别 → 「植物识别」，实名开通（个人有免费测试额度）。
- 创建应用获得 API Key（AK）与 Secret Key（SK）。
- 在云开发控制台 → 云函数 → `recognizeFlower` → 配置环境变量：
  - `BAIDU_AK` = 你的 API Key
  - `BAIDU_SK` = 你的 Secret Key
- 可选：`ENABLE_SEC_CHECK=false` 可跳过图片安全检测（不推荐生产）；`SEC_CHECK_STRICT=true` 时安全接口异常会拒绝识别。

### 5. 导入知识库

- 先在云开发控制台配置 `initSpecies` 的环境变量 `ADMIN_OPENIDS` 为你自己的 openid（可在开发者工具 Console 中通过 `wx.cloud.callFunction({name:'getAchievements'})` 的反编译日志或云开发控制台用户列表查看）。
- 在开发者工具中调用一次：`wx.cloud.callFunction({ name: 'initSpecies' })`，返回 `已导入 60 种花` 即成功。重复调用幂等。

### 6. 体验

- 编译运行，首页点「拍照识花」或「从相册选择」即可走通完整流程。

## 玩法规则

| 规则 | 说明 |
|---|---|
| 稀有度 | 常见（绿）→ 少见（蓝）→ 珍稀（紫）→ 传说（金），由知识库人工标注 |
| 花匠等级 | 1–5 爱花萌新 / 6–15 拾花者 / 16–30 赏花人 / 31–45 花语师 / 46+ 花神 |
| 成就徽章 | 33 枚：基础收集 9 + 新收录花 6（收集 AI 新花 / 发起收录 / 首发见证）+ 花期 18（季节收集量 / 四季进阶 / 应季花信 / 四时象征花）；设计见 [成就系统扩展方案](docs/成就系统扩展方案.md) |
| 去重 | 同种重复识别不重复计数，追加照片并更新「第 N 次遇见」 |
| 删除 | 删除花卡后图鉴与成就实时重算 |
| 限流 | 每用户每日识别 20 次 |

## 配置速查

| 环境变量 | 所在云函数 | 说明 |
|---|---|---|
| `BAIDU_AK` / `BAIDU_SK` | recognizeFlower | 百度智能云密钥，必填 |
| `ADMIN_OPENIDS` | initSpecies | 知识库导入白名单，逗号分隔 |
| `ENABLE_SEC_CHECK` | recognizeFlower | 默认 `true`，`false` 跳过内容安全检测 |
| `SEC_CHECK_STRICT` | recognizeFlower | 默认 `false`；`true` 时安全接口异常即拒绝识别 |
| `DEEPSEEK_API_KEY` | generateFlowerWorker | DeepSeek 密钥，未收录花生成必填 |
| `ARK_API_KEY` / `ARK_MODEL` | generateFlowerWorker | 火山方舟密钥与生图模型（默认 doubao-seedream-5.0-lite） |
| `GEN_DAILY_LIMIT` | requestFlowerGenerate | 每用户每日生成上限，默认 3 |

客户端 `miniprogram/config.js`：

- `CLOUD_ENV`：多环境时填环境 ID；留空使用默认环境。

## 数据与合规

- 用户照片存云存储私有目录，仅本人可见；无公开社区/评论/分享墙，规避个人主体 UGC 风险。
- 上传图片先经微信内容安全检测，违规直接拒绝；**识别入库与追加照片均会检测**。
- 删除花卡/照片时同步清理云存储原图；`我的` 页提供「注销账号」入口，可一键删除全部个人数据。
- 云存储权限必须设置为「仅创建者可读写」（默认是「所有用户可读」，部署必改）。
- 上线前需在公众平台配置《隐私保护指引》与用户协议（`我的` 页已有文案，需按主体信息落稿）。
- 百度密钥只存云函数环境变量，绝不进前端代码。

## 花卡插画（已生成 60 张）

60 种花的统一水彩绘本风插画已生成到 `miniprogram/images/species/`（每张约 350KB，总计约 21.5MB），并附带上传清单 `scripts/species_images_manifest.json`。

接入线上展示的流程：

1. **人工审核**：逐一确认画风统一、花种正确，不满意的用 `scripts/seedream_generate.py` 单独重生成。
2. **上传云存储**：云开发控制台 → 存储 → 新建目录 `assets/species`，按清单把 60 张图上传（建议保留文件名 `{id}.jpg`）。
3. **回填 fileID**：复制任意一张图的 fileID（如 `cloud://.../assets/species/yueji.jpg`），去掉末尾文件名得到目录前缀，用脚本**自动生成** `ids.json`（无需手动整理 60 条）：
   ```powershell
   node scripts/gen_ids.js "cloud://你的环境ID.存储ID/assets/species"
   node scripts/fill_illustration_ids.js ids.json
   ```
   第二个脚本自动把 `illustrationFileID` 写回 `cloudfunctions/initSpecies/species-data.js`。
4. **重新导入**：重新部署 `initSpecies` 云函数并调用一次，图鉴卡片即显示插画。

## 开源声明

- 本项目基于 Apache License 2.0 开源，识别链路与图片安全检测方式参考并改造自 [dengcao/AI-Intelligent-Recognition](https://github.com/dengcao/AI-Intelligent-Recognition)（Apache-2.0），详见 [NOTICE.md](NOTICE.md)。
- 无许可证项目（Insight、wiseeye 等）仅作思路参考，未复制代码。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/技术文档.md](docs/技术文档.md) | 系统架构、数据库设计、云函数接口、安全设计、部署运维 |
| [docs/需求方案.md](docs/需求方案.md) | 产品定位、功能需求、玩法规则、Roadmap |
| [docs/SCHEMA.md](docs/SCHEMA.md) | 数据库集合与云函数速查 |
| [docs/部署与验证手册.md](docs/部署与验证手册.md) | 部署、权限、索引、真机验证清单 |
| [docs/修复与优化记录.md](docs/修复与优化记录.md) | 修复/优化留痕记录 |
| [docs/评审与改进建议.md](docs/评审与改进建议.md) | 代码评审与改进清单 |
| [docs/未收录花自动生成方案.md](docs/未收录花自动生成方案.md) | 未收录花自动生成插画与科普（LLM + Seedream）设计 |
| [docs/成就系统扩展方案.md](docs/成就系统扩展方案.md) | 成就系统扩展（新收录花 + 花期成就）设计 |
| [docs/识花时间线方案.md](docs/识花时间线方案.md) | 识花时间线（首页最近收获升级）设计 |
| [docs/意见反馈方案.md](docs/意见反馈方案.md) | 意见反馈功能（我的页 · 用户反馈收集）设计 |
| [docs/批量识别方案.md](docs/批量识别方案.md) | 相册多选批量识别（≤5 张逐张串行 + 清单确认 + 新物种）设计 |
| [docs/开发难点记录.md](docs/开发难点记录.md) | 设计开发难点专档（技术实现→目标→方案与原因→结果） |
| [docs/识别任务后台化方案.md](docs/识别任务后台化方案.md) | 批量确认入库转云端后台执行 + 首页识别任务模块 设计 |

## 常见问题

- **识别报「未配置 BAIDU_AK / BAIDU_SK」**：环境变量未配置，或云函数未重新部署。
- **识别报「图片内容不合规」**：安全检测拦截；开发期可临时设 `ENABLE_SEC_CHECK=false`。
- **识别结果不准**：百度植物识别受照片清晰度/角度影响，建议拍花朵正面、避免强逆光；结果以用户确认为准。
- **图鉴没有卡片插画**：`illustrationFileID` 为空，按上文「内容生产」补齐即可。
- **个人主体审核**：若平台要求「图像处理」类目资质，可降级方案——照片仅保存到系统相册（云端不存图），或转企业主体（年认证费约 300 元）。

## Roadmap（v2）

分享水彩海报、地域图鉴、未收录花的“神秘花卡”暂存、花种扩充至 200+、图片近似去重（感知哈希）、好友卡片互赠（需评估主体限制）。

## 贡献

- 欢迎提交 Issue 反馈问题与建议；修复请遵循 [AGENTS.md](AGENTS.md) 开发规范，并在 [docs/修复与优化记录.md](docs/修复与优化记录.md) 留痕。
- 知识库扩充：60 种 → 200+ 的内容生产流水线见 [docs/部署与验证手册.md](docs/部署与验证手册.md) 与 `scripts/`。
