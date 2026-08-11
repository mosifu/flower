# 复用与致谢声明

本项目（随心一拍-花知道）的部分实现复用 / 参考了以下开源项目，特此声明并致谢：

## 1. AI 智能识物（AI-Intelligent-Recognition）

- 作者：草根编程网（www.caozha.com），GitHub：https://github.com/dengcao/AI-Intelligent-Recognition
- 许可证：Apache License 2.0
- 复用内容：
  - 微信图片内容安全检测（`cloud.openapi.security.imgSecCheck`）的调用方式；
  - 拍照 → 压缩 → base64 → 百度 AI 识别的整体链路思路；
  - 识别结果列表的展示交互思路。
- 改造说明：百度识别调用由「客户端直连 + PHP 缓存 Token」改为「云函数服务端调用 + 云数据库缓存 Token」；识别接口由通用图像识别收敛为百度植物识别；密钥改为云函数环境变量。

## 2. 参考但未复制代码的项目（仅作思路参考）

- Insight 微信图像识别小程序（无许可证）：识别结果历史记录、云开发落地思路。
- wiseeye（无许可证）：识别详情页科普信息展示思路。

任何复用均遵守相应许可证要求；本项目整体按 Apache License 2.0 开源，详见 LICENSE。
