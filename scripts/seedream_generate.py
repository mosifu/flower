#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
火山引擎·即梦 Seedream 文生图工具（基于火山方舟 Ark API，纯标准库实现）。

用法：
  单张生成：
    python scripts/seedream_generate.py \
      --prompt "水彩绘本风花朵插画" \
      --out miniprogram/images/avatar-ai.png

  批量生成（读取 JSON 数组：[{"id": "...", "prompt": "...", "size": "1024x1024"}]）：
    python scripts/seedream_generate.py \
      --batch scripts/species_prompts.json \
      --out-dir miniprogram/images/species

环境变量：
  ARK_API_KEY   必填，火山方舟 API Key
  ARK_BASE_URL  可选，默认 https://ark.cn-beijing.volces.com/api/v3
  ARK_MODEL     可选，默认 doubao-seedream-4-0-250828
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "doubao-seedream-4-0-250828"
DEFAULT_BASE = "https://ark.cn-beijing.volces.com/api/v3"


def get_key():
    """获取火山方舟 API Key。

    返回:
        str: API Key。

    异常:
        SystemExit: 未配置 ARK_API_KEY 时退出并提示配置方法。
    """
    key = os.environ.get("ARK_API_KEY", "").strip()
    if not key:
        print(
            "错误：未设置 ARK_API_KEY 环境变量。\n"
            "请先在火山方舟控制台创建 API Key，然后执行：\n"
            "  setx ARK_API_KEY \"你的key\"\n"
            "并重启 Codex 应用。"
        )
        sys.exit(1)
    return key


def call_api(prompt, model, size, base, key, watermark):
    """调用 Seedream 文生图接口。

    参数:
        prompt (str): 生成提示词。
        model (str): 模型 ID。
        size (str): 图片尺寸，如 "1920x1920"。
        base (str): API 基础地址。
        key (str): API Key。
        watermark (bool|None): 是否带水印，None 表示不传该参数。

    返回:
        dict: 接口返回的 JSON（含 data 列表）。
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "response_format": "url",
    }
    if watermark is not None:
        payload["watermark"] = watermark

    req = urllib.request.Request(
        base.rstrip("/") + "/images/generations",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_bytes(url):
    """下载图片二进制内容。

    参数:
        url (str): 图片直链。

    返回:
        bytes: 图片二进制数据。
    """
    req = urllib.request.Request(url, headers={"User-Agent": "huazhidao-script"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def detect_ext(data):
    """根据文件魔数判断图片格式。

    参数:
        data (bytes): 图片二进制。

    返回:
        str: jpg / png / webp，未知格式回退 png。
    """
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "png"


def save_image(result, out_path):
    """把接口响应中的图片保存到本地（按真实格式纠正扩展名）。

    参数:
        result (dict): 接口响应，含 data[0].url 或 data[0].b64_json。
        out_path (str): 期望输出路径（扩展名可能被纠正）。

    返回:
        Path: 实际保存的文件路径。
    """
    items = result.get("data") or []
    if not items:
        raise RuntimeError("响应中没有图片数据: " + json.dumps(result, ensure_ascii=False)[:300])
    item = items[0]
    if item.get("url"):
        data = download_bytes(item["url"])
    elif item.get("b64_json"):
        data = base64.b64decode(item["b64_json"])
    else:
        raise RuntimeError("未知的图片响应格式")
    ext = detect_ext(data)
    out = Path(out_path)
    if out.suffix.lower() != "." + ext:
        out = out.with_suffix("." + ext)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return out


def generate_one(prompt, out_path, model, size, base, key):
    """生成单张图片：优先关闭水印，400 报错则去掉水印参数重试一次。

    参数:
        prompt (str): 提示词。
        out_path (str): 输出路径。
        model (str): 模型 ID。
        size (str): 图片尺寸。
        base (str): API 基础地址。
        key (str): API Key。

    异常:
        RuntimeError: 生成失败时抛出错误详情。
    """
    last_err = None
    # 优先尝试关闭水印；若接口不接受该参数则去掉重试一次
    for watermark in (False, None):
        try:
            result = call_api(prompt, model, size, base, key, watermark)
            saved = save_image(result, out_path)
            print("已生成:", saved)
            return
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            last_err = f"HTTP {e.code}: {body[:300]}"
            if e.code != 400:
                break
        except Exception as e:
            last_err = str(e)
            break
    raise RuntimeError(last_err or "生成失败")


def main():
    """命令行入口：解析参数，分发单张 / 批量生成。

    批量模式支持 --limit / --offset 分批执行，已存在的文件自动跳过。
    """
    parser = argparse.ArgumentParser(description="Seedream 文生图")
    parser.add_argument("--prompt", help="生成提示词")
    parser.add_argument("--out", help="单张输出路径")
    parser.add_argument("--batch", help="批量任务 JSON 文件")
    parser.add_argument("--out-dir", help="批量输出目录")
    parser.add_argument("--limit", type=int, default=0, help="批量最多处理 N 个（0 表示全部）")
    parser.add_argument("--offset", type=int, default=0, help="批量从第 N 个开始（0 起）")
    parser.add_argument("--size", default="1920x1920", help="图片尺寸，默认 1920x1920（Seedream 5.0 最低要求）")
    parser.add_argument("--model", default=os.environ.get("ARK_MODEL", DEFAULT_MODEL))
    parser.add_argument("--base", default=os.environ.get("ARK_BASE_URL", DEFAULT_BASE))
    parser.add_argument("--wait", type=float, default=1.0, help="批量请求间隔秒数")
    args = parser.parse_args()

    if not args.prompt and not args.batch:
        parser.error("请提供 --prompt 或 --batch")
    if args.prompt and not args.out:
        parser.error("单张生成需要 --out")
    if args.batch and not args.out_dir:
        parser.error("批量生成需要 --out-dir")

    key = get_key()

    if args.prompt:
        generate_one(args.prompt, args.out, args.model, args.size, args.base, key)
        return

    all_tasks = json.loads(Path(args.batch).read_text("utf-8"))
    tasks = all_tasks[args.offset:]
    if args.limit > 0:
        tasks = tasks[: args.limit]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ok = 0
    for i, task in enumerate(tasks, 1):
        name = task.get("id") or f"image_{i}"
        out = out_dir / f"{name}.png"
        size = task.get("size") or args.size
        prompt = task.get("prompt", "").strip()
        if not prompt:
            print(f"[{i}/{len(tasks)}] 跳过空提示词: {name}")
            continue
        if out.exists():
            print(f"[{i}/{len(tasks)}] 已存在，跳过: {out}")
            ok += 1
            continue
        print(f"[{i}/{len(tasks)}] 正在生成: {name}")
        try:
            generate_one(prompt, str(out), args.model, size, args.base, key)
            ok += 1
        except Exception as e:
            print(f"[{i}/{len(tasks)}] 失败: {name}: {e}")
        if i < len(tasks):
            time.sleep(args.wait)

    print(f"完成：成功 {ok}/{len(tasks)}")
    if ok < len(tasks):
        sys.exit(2)


if __name__ == "__main__":
    main()
