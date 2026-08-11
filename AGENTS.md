# 开发约定（AGENTS.md）

本文件是「随心一拍-花知道」项目的开发规范，所有在本仓库的代码改动都必须遵守。

## 注释要求（强制）

- 所有新增或修改的代码必须写**清晰的中文注释**。
- 云函数 `index.js` 顶部必须写明：函数职责、入参、返回结构、依赖的环境变量。
- 页面 / 组件文件顶部写明用途；核心函数注释入参、行为与返回值。
- 每个主要步骤或关键分支（限流、内容安全、入库去重、成就判定等）加简短注释，说明“为什么这么做”，不要复述代码本身。
- 魔法数字必须注释含义（例如每日 20 次识别上限、置信度 0.5 阈值）。
- WXML / WXSS 结构复杂时在区块顶部加 `<!-- 用途 -->` / `/* 用途 */` 注释。
- 注释与代码同步更新，改动逻辑时必须一并修改注释。

## 项目结构与命名

- 前端：`miniprogram/pages/<页面名>/`，每个页面 4 个文件（js / json / wxml / wxss）。
- 云函数：`cloudfunctions/<函数名>/`，每个函数目录含 `index.js`、`package.json`、`config.json`。
- 变量与文件命名统一小驼峰 / 小写中划线；花种 id 使用拼音小写。
- 通用常量集中在 `miniprogram/config.js`；云函数内重复的小配置允许自带一份并注明。

## 接口与数据约定

- 云函数统一返回 `{ ok: true, ... }` 或 `{ ok: false, code, message }`；前端通过 `utils/util.js` 的 `callFunction` 统一处理错误。
- 用户身份一律取自 `cloud.getWXContext().OPENID`，禁止前端传 openid。
- 密钥只放云函数环境变量，禁止硬编码进前端或提交到仓库。
- 数据库集合与字段定义见 `docs/SCHEMA.md`，改动需同步更新文档。

## 提交规范（强制）

- **修复/优化必须留痕**：修改代码（`miniprogram/` 或 `cloudfunctions/`）后，必须在 `docs/修复与优化记录.md` 追加批次记录（问题、改动、验证）；涉及接口/数据结构同步更新 `docs/技术文档.md` 与 `docs/SCHEMA.md`。提交钩子会在代码改动时提醒。
- 提交信息用模板：`git config commit.template .gitmessage`（换机/重新 clone 后需重新配置）；钩子安装：`cp scripts/hooks/prepare-commit-msg .git/hooks/`。
- 提交前跑 `node --check` 校验改动 JS（Python 用 `py_compile`）。
- 提交账号固定：mosifu `<yidao520521@163.com>`（已配置全局，勿改）。
- 生成产物不提交：`ids.json`、`miniprogram/images/species/`（插画）、`__pycache__/` 等（见 `.gitignore`）。

## 其他

- 修改公共逻辑后必须跑一遍语法校验（Node `node --check` / Python `py_compile`）。
- 复用外部代码必须保留许可证与致谢（见 `NOTICE.md`）。
