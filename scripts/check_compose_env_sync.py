#!/usr/bin/env python3
"""compose 强制校验变量 ↔ .env.example 同步门禁。

背景（2026-10-04 实测事故）：
    `docker-compose.yml` 用 `${VAR:?...}` 表达"这个变量必填，缺失就拒绝启动"。
    但 `.env.example` 与真实 `.env` 是两份独立维护的文件。当 compose 新增一个
    `:?` 变量、却忘了在 `.env.example` 补条目时，会出现：
      - CI 全绿（CI 不读 .env，用自己的明文测试值）
      - 新人 `cp .env.example .env && docker compose up -d` → **直接报错退出**
    即"文档化的部署路径断裂"，而所有自动化门禁都沉默。

    具体案例：LiveKit 加固时把凭据改成 `:?`，`.env.example` 补了，
    但作者本机 `.env` 没有 → 本机 `docker compose up -d` 直接失败。

判据（单向，只查"compose 要、example 没有"）：
    反方向（example 有、compose 不用）是正常现象——example 是变量总览，
    会包含脚本/文档用到的变量，不构成缺陷。

用法：
    python scripts/check_compose_env_sync.py          # 检查，失败退出 1
    python scripts/check_compose_env_sync.py --list   # 只打印清单
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ROOT / "docker-compose.yml"
ENV_EXAMPLE = ROOT / ".env.example"

# ${VAR:?...} 与 ${VAR?....} 两种必填写法
REQUIRED_RE = re.compile(r"\$\{([A-Z_][A-Z0-9_]*)\s*:\?")
# .env.example 中的键声明（允许注释行、允许 KEY= 空值）
DECLARED_RE = re.compile(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=", re.MULTILINE)


def main() -> int:
    list_only = "--list" in sys.argv

    if not COMPOSE.exists():
        print(f"[env-sync] 找不到 {COMPOSE}", file=sys.stderr)
        return 1
    if not ENV_EXAMPLE.exists():
        print(f"[env-sync] 找不到 {ENV_EXAMPLE}", file=sys.stderr)
        return 1

    compose_text = COMPOSE.read_text(encoding="utf-8")
    example_text = ENV_EXAMPLE.read_text(encoding="utf-8")

    required = sorted(set(REQUIRED_RE.findall(compose_text)))
    declared = set(DECLARED_RE.findall(example_text))

    missing = [v for v in required if v not in declared]

    print(f"[env-sync] compose 强制校验变量（${{VAR:?}}）：{len(required)} 个")
    print(f"[env-sync] .env.example 已声明：{len(declared)} 个")

    if list_only:
        print("\n--- compose 必填清单 ---")
        for v in required:
            mark = "OK " if v in declared else "缺失"
            print(f"  [{mark}] {v}")
        return 0

    if missing:
        print("\n[env-sync] ✗ 以下变量被 compose 强制校验，但 .env.example 未声明：")
        for v in missing:
            print(f"    - {v}")
        print(
            "\n修复：在 .env.example 中补上这些键（含取值说明），"
            "否则新人按文档执行 `docker compose up -d` 会直接失败。"
        )
        return 1

    print("[env-sync] ✓ 通过：compose 所有强制校验变量均在 .env.example 中声明")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
