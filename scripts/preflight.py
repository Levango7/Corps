#!/usr/bin/env python3
"""部署前置检查：在 `docker compose up -d` 之前跑一遍，把"启动即失败"的问题提前暴露。

为什么需要它：
    compose 的 `${VAR:?}` 在**变量插值阶段**就拒绝启动，报错是 compose 自己的格式，
    对不熟悉的人不友好；而端口不一致这类问题根本不会报错，只会让邀请链接、
    支付回调静默指向错误地址（2026-10-04 实测踩到过）。

    这个脚本把两类问题合并成一次清晰的预检：
      1. 必填变量缺失/为空  → 否则 `docker compose up` 直接退出
      2. 配置自相矛盾        → 否则应用能起来但功能静默损坏

用法：
    python scripts/preflight.py            # 检查项目根目录的 .env
    python scripts/preflight.py path/.env  # 指定文件

与生产版的分工（2026-10-07 澄清）：
    本脚本面向**本机/开发**，检查项目根的 `.env`。
    生产部署请用 `deploy/scripts/preflight.sh`（12 项，检查 `deploy/.env.prod`，
    额外覆盖 prod overlay 渲染、db/app 无宿主机端口（AC-01）、app 无 build 段、
    容器日志上界（AC-05）、密钥长度达标、密钥不得为历史泄漏值等）。

    两者**不是重复实现**：输入文件不同、场景不同，故都保留。
    但"必填变量非空"与"弱密钥"这两类检查在两边都存在——
    若将来要调整这两类的判定标准（例如新增必填变量、更换弱值黑名单），
    **记得两边都改**，否则会出现"本机通过、生产拒绝"或反之的漂移。

退出码：0 全部通过；1 存在阻断项。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ROOT / "docker-compose.yml"

REQUIRED_RE = re.compile(r"\$\{([A-Z_][A-Z0-9_]*)\s*:\?")
KV_RE = re.compile(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$")

# 明显不能用于生产的弱值
WEAK_VALUES = {
    "POSTGRES_PASSWORD": {"postgres", "password", "test", "changeme", "123456"},
    "BETTER_AUTH_SECRET": {"secret", "changeme", "test"},
    "JWT_ACCESS_SECRET": {"secret", "changeme", "test"},
    "JWT_REFRESH_SECRET": {"secret", "changeme", "test"},
    "CRON_SECRET": {"secret", "changeme", "test", "dev"},
}

errors: list[str] = []
warnings: list[str] = []


def strip_quotes(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def parse_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = KV_RE.match(line)
        if m:
            out[m.group(1)] = strip_quotes(m.group(2))
    return out


def main() -> int:
    env_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".env"

    print(f"[preflight] 目标文件：{env_path}")
    if not env_path.exists():
        print(f"[preflight] ✗ 文件不存在。请先 `cp .env.example .env` 并填写。")
        return 1

    env = parse_env(env_path)
    compose_text = COMPOSE.read_text(encoding="utf-8")
    required = sorted(set(REQUIRED_RE.findall(compose_text)))

    # 检查 1：compose 强制校验的变量必须有非空值
    print(f"\n[preflight] 检查 compose 必填变量（{len(required)} 个）")
    for var in required:
        val = env.get(var, "")
        if not val:
            errors.append(f"{var} 未设置或为空（compose 会拒绝启动）")
            print(f"  ✗ {var}")
        else:
            print(f"  ✓ {var}")

    # 检查 2：NEXT_PUBLIC_APP_URL 端口必须与 APP_PORT 一致
    # 不一致的后果：邀请链接、邮件 CTA、支付回调全部指向错误端口，且**不会报错**
    app_url = env.get("NEXT_PUBLIC_APP_URL", "")
    app_port = env.get("APP_PORT", "")
    if app_url and app_port:
        print("\n[preflight] 检查公开 URL 与暴露端口一致性")
        parsed = urlparse(app_url)
        url_port = parsed.port
        # 未显式写端口时，按协议默认端口推断
        if url_port is None:
            url_port = 443 if parsed.scheme == "https" else 80
        try:
            expected = int(app_port)
        except ValueError:
            expected = -1
        if url_port != expected:
            errors.append(
                f"NEXT_PUBLIC_APP_URL 的端口({url_port}) 与 APP_PORT({app_port}) 不一致"
                f" —— 邀请链接/邮件/支付回调会指向错误地址"
            )
            print(f"  ✗ URL 端口 {url_port} ≠ APP_PORT {app_port}")
        else:
            print(f"  ✓ 端口一致（{url_port}）")

    # 检查 3：生产部署必须 HTTPS（会话 cookie 带 Secure，HTTP 下不会回传）
    print("\n[preflight] 检查传输安全")
    if app_url.startswith("http://") and not re.search(r"//(localhost|127\.0\.0\.1)", app_url):
        warnings.append(
            f"NEXT_PUBLIC_APP_URL 为非本机 HTTP 地址（{app_url}）——"
            f"会话 cookie 带 Secure 属性，纯 HTTP 下用户会「登录成功但立刻掉线」，请务必配 HTTPS"
        )
        print("  ! 非本机 HTTP（需 HTTPS）")
    else:
        print("  ✓ 本机或 HTTPS")

    # 检查 4：弱密钥
    print("\n[preflight] 检查密钥强度")
    weak_found = False
    for var, weak in WEAK_VALUES.items():
        val = env.get(var, "")
        if val and val.lower() in weak:
            errors.append(f"{var} 使用了弱值（{val}），生产环境必须改为随机值")
            print(f"  ✗ {var} 为弱值")
            weak_found = True
    if not weak_found:
        print("  ✓ 未发现已知弱值")

    # 汇总
    print("\n" + "=" * 60)
    if warnings:
        print(f"[preflight] {len(warnings)} 项警告：")
        for w in warnings:
            print(f"  ! {w}")
    if errors:
        print(f"\n[preflight] ✗ 存在 {len(errors)} 项阻断问题，请修复后再启动：")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("\n[preflight] ✓ 全部通过，可以执行 `docker compose up -d`")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
