# 云开发数据库与云函数说明

## 一、集合清单

| 集合 | 用途 | 权限建议 |
|---|---|---|
| `species` | 花卉知识库（60 种，由 `initSpecies` 导入） | 仅管理端可读写 |
| `user_cards` | 用户已收集的花卡 | 仅管理端可读写（按 openid 隔离） |
| `rate_limits` | 每日识别次数限制 | 仅管理端可读写 |
| `bd_token` | 百度 Access Token 缓存 | 仅管理端可读写 |
| `photo_hashes` | 图片 MD5 指纹（永久去重） | 仅管理端可读写 |
| `flower_gen_tasks` | 未收录花生成任务（LLM+Seedream） | 仅管理端可读写 |
| `gen_limits` | 每日生成配额计数 | 仅管理端可读写 |

> 注：前端全部通过云函数读写数据，集合统一设「仅管理端可读写」最安全。

## 二、集合字段

### species
```
id: string            # 唯一标识（拼音），作为文档 _id
cnName: string        # 中文名
latinName: string     # 学名
family: string        # 科
genus: string         # 属
rarity: string        # common | rare | epic | legendary
bloomSeasons: []      # 花期，取值 春/夏/秋/冬
colors: []            # 常见花色
description: string   # 科普简介
features: string      # 识别特征
flowerLanguage: string# 花语
careTips: string      # 养护要点
distribution: string  # 分布
funFact: string       # 趣味小知识
synonyms: []          # 别名，用于识别结果匹配
illustrationFileID: string  # 水彩插画（云存储 fileID 或 https URL）
enabled: bool         # 是否启用
```

### user_cards
```
openid: string
speciesId: string     # 关联 species._id
photos: [{
  fileID: string,
  addedAt: number,
  location: string,   # 可选
  note: string        # 可选，单张照片备注
}]
note: string          # 卡片级备注
firstMetAt: number
lastMetAt: number
meetCount: number
createdAt: number
```

### rate_limits
```
_id: "{openid}_{yyyyMMdd}"
openid: string
date: string          # yyyyMMdd
count: number
```

### bd_token
```
_id: "baidu"
token: string
expireAt: number      # 过期时间戳（提前 60s 失效）
```

### photo_hashes（MD5 图片指纹，永久去重）
```
_id: "{openid}_{md5}"  # 幂等键，同一图重复写入覆盖
openid: string
md5: string            # 图片内容 MD5（前端固定参数压缩后字节一致）
speciesId: string      # 识别命中的花种 id；未命中为空串
createdAt: number      # 写入时间，cleanupData 按此清理（保留 90 天）
```

### flower_gen_tasks（未收录花生成任务）
```
_id: "{openid}_{normalizedName}"  # 同名去重：同用户同花名 pending/generating 复用
openid: string
name: string          # 百度识别花名（原样，生成后作为 cnName 保证下次命中）
score: number         # 识别置信度
baikeDesc: string     # 百度百科描述文本（LLM 参考资料）
status: string        # pending → generating → done / failed
speciesId: string     # done 后回填
error: string         # failed 原因
createdAt / updatedAt: number
```

### gen_limits（生成配额计数）
```
_id: "{openid}_{yyyyMMdd}"
openid: string
date: string
count: number         # 当日生成次数，默认上限 3（GEN_DAILY_LIMIT）
```

## 三、云函数

| 函数 | 入参 | 说明 |
|---|---|---|
| `recognizeFlower` | `{ fileID }` | 限流（事务）→ 内容安全 → 百度植物识别 → 知识库匹配；服务端原因失败退款并清理文件 |
| `saveCard` | `{ action, speciesId, ... }` | action: create / addPhoto / updateNote / updateLocation / deletePhoto / deleteCard；create/addPhoto 内容安全检测；删除时清理云存储；输入校验 |
| `getCollection` | `{ speciesId?, season?, status?, sortBy? }` | 图鉴数据 + 收集统计（状态过滤 + 排序，见技术文档） |
| `getAchievements` | 无 | 等级、徽章、统计、今日次数、recentCards（最近收获前 6） |
| `initSpecies` | 无 | 管理员导入知识库（幂等） |
| `deleteAccount` | 无 | 注销：删除该用户全部花卡、照片与图片指纹；**限流计数保留**（防刷次数） |
| `cleanupData` | 无 | 定时触发器（每周日 03:00）清理 30 天前 rate_limits 记录 |
| `requestFlowerGenerate` | `{ name, score, baikeDesc? }` | 未收录花生成请求：同名去重 + 配额扣减 + 建任务 |
| `getFlowerGenerateTask` | `{ taskId }` | 生成任务状态查询（前端轮询，校验归属） |
| `generateFlowerWorker` | 无 | 定时触发器（每 2 分钟）处理 1 个生成任务：DeepSeek 科普 + Seedream 插画 + 安全检测 + 入库 |

## 四、索引建议

| 集合 | 建议索引 | 用途 |
|---|---|---|
| `user_cards` | `openid + speciesId` 联合索引 | 花卡查询/去重（当前数据量小可用默认索引，增长后建议在控制台创建） |
| `rate_limits` | `date` 单字段索引 | `cleanupData` 清理任务的 `where({ date: _.lt(...) })` 扫描 |

## 五、数据保留策略

| 集合 | 保留策略 | 实现 |
|---|---|---|
| `rate_limits` | 保留 30 天；**注销不删除**（防恶意注销刷次数，openid 不随注销改变） | `cleanupData` 定时触发器（每周日 03:00，cron `0 0 3 * * 0 *`） |
| `photo_hashes` | 保留 90 天 | `cleanupData` 按 `createdAt` 清理 |
| `user-photos/` 云存储 | 随卡片生命周期 | 删卡/删照片由 saveCard 清理；识别失败由 recognizeFlower/前端清理；历史孤儿文件需控制台手动或存储生命周期策略兜底 |
| `bd_token` | 单文档覆盖写 | 每次刷新覆盖，无需清理 |

## 六、云函数环境变量

| 变量 | 函数 | 说明 |
|---|---|---|
| `BAIDU_AK` | recognizeFlower | 百度智能云 API Key（必填） |
| `BAIDU_SK` | recognizeFlower | 百度智能云 Secret Key（必填） |
| `ADMIN_OPENIDS` | initSpecies | 允许执行导入的 openid 列表，逗号分隔；不配置则任何人可导入（仅建议开发期） |
| `ENABLE_SEC_CHECK` | recognizeFlower | 默认开启图片内容安全检测；设为 `false` 可跳过（不建议生产环境） |
| `SEC_CHECK_STRICT` | recognizeFlower | 设为 `true` 时，内容安全接口异常将拒绝识别（fail-closed） |
