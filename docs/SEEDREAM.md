# 火山引擎·即梦 Seedream 生图接入说明

## 一、开通与获取 API Key（一次性）

1. 注册并实名认证[火山引擎](https://console.volcengine.com)（个人实名即可）。
2. 进入[火山方舟控制台](https://console.volcengine.com/ark) → 左侧「开通管理」→ 视觉大模型 → 找到 **Doubao-Seedream-4.0** → 点击「开通服务」。新用户含 **200 张免费额度**，超出后约 0.2 元/张。
3. 左侧「API Key 管理」→「创建 API Key」，复制保存（只显示一次，勿发到聊天）。
4. 本机设置环境变量（PowerShell）：
   ```powershell
   setx ARK_API_KEY "你的key"
   ```
5. **重启 Codex 桌面应用**（否则新环境变量不可见）。

## 二、生成脚本

`scripts/seedream_generate.py`，纯 Python 标准库实现，无需安装依赖。

单张生成：
```powershell
python scripts/seedream_generate.py --prompt "你的提示词" --out miniprogram/images/avatar-ai.png
```

批量生成（任务文件为 JSON 数组，见 `scripts/species_prompts.json`）：
```powershell
python scripts/seedream_generate.py --batch scripts/species_prompts.json --out-dir miniprogram/images/species
```

可选参数：`--size`（默认 1920x1920，Seedream 5.0 最低要求 1920×1920）、`--model`、`--base`、`--wait`（批量请求间隔秒数）。

## 三、说明与注意

- 模型默认 `doubao-seedream-4-0-250828`；如需更新版本，改环境变量 `ARK_MODEL`。
- 接口地址默认中国大陆区 `https://ark.cn-beijing.volces.com/api/v3`。
- 脚本默认请求不带水印；若接口拒绝该参数会自动去掉重试。
- 已存在的输出文件会自动跳过，可安全断点续跑。
- 免费额度按成功生成张数扣减，批量 60 张在免费额度内。
