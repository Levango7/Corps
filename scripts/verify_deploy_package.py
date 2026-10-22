#!/usr/bin/env python3
"""部署包真跑验证：把「文件在」变成「能跑」，且可复跑。

## 这个脚本存在的理由

`deploy/` 有 15 个文件、`bash -n` 全过、README 写得极详细，但在 2026-10-23 之前
**没有任何记录表明它被真跑过一次**。README §12 自己也招了：「TLS 签发、真实 GHCR
拉取、RTC 媒体连通性均未在真实 VPS 上跑过」。

语法自检只能证明"能被 bash 解析"，不能证明"门禁会拦、链路能跑"。本脚本补的正是
这一层：**用真实的配置与真实的故障去跑**。

## 它验什么

1. **正向**：从 `.env.prod.example` 造一份合法 `.env.prod`，`preflight.sh` 必须
   全绿（28 项断言）。造不绿 = 模板本身有洞。
2. **反向（更重要）**：逐个注入已知故障，`preflight.sh` 必须**因为正确的红因**判红。
   一道只会放行的门禁和没有门禁等价 —— 这个仓库在 Dockerfile 门禁上已经栽过一次
   （首轮 13/13 自检全绿，因为自测用的是桩注入，绕开了真正出错的 HTTP 层）。
3. **边界**：备份目录三种形态（空 / 仅现行格式 / 仅 legacy）下的提示口径。

## 用法

    python scripts/verify_deploy_package.py [--worktree <路径>] [--keep-env]

`--keep-env` 保留生成的 `.env.prod` 便于人工复查（默认跑完即删）。

## 退出码

    0 = 全部用例通过
    1 = 有用例失败（明细见输出）
    2 = 环境不满足（docker / bash / 目标目录缺失）

## 安全边界

- 只写**临时** `.env.prod`（gitignore 已覆盖 `deploy/.env.prod*`）与临时 BACKUP_DIR。
- 不启动任何容器、不 pull 镜像、不碰数据库。
- 不修改仓库内任何受版本控制的文件。
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# ── 合法配置：与 preflight.sh 第 7/8/11 组的口径对齐 ──────────────────────────
# 密钥一律运行时随机生成，绝不硬编码（第 8 组会拒绝已知坏值）。
REQUIRED_ENV: dict[str, str] = {
    "CORPS_IMAGE_TAG": "0.8.2",
    # 备案期合法形态：显式 http:// 前缀 → Caddy 不申请证书（README §5）
    "CORPS_SITE_ADDRESS": "http://127.0.0.1",
    "NEXT_PUBLIC_APP_URL": "http://127.0.0.1",
    "ACME_EMAIL": "drill@example.invalid",
    # BACKUP_DIR 由脚本填（必须是宿主机真实可写目录）
}

SECRET_SPECS: list[tuple[str, int]] = [
    ("POSTGRES_PASSWORD", 16),
    ("CORPS_APP_PASSWORD", 16),
    ("BETTER_AUTH_SECRET", 32),
    ("JWT_ACCESS_SECRET", 32),
    ("JWT_REFRESH_SECRET", 32),
    ("CRON_SECRET", 32),
    ("CALENDAR_CRYPTO_KEY", 32),
]

# ── 故障注入表 ────────────────────────────────────────────────────────────────
# 每项：(名称, 要改写 KEY=值, 期望在输出里出现的红因关键词, 期望退出码非零)
FAULT_CASES: list[tuple[str, dict[str, str], str]] = [
    (
        "BETTER_AUTH_SECRET 过短（<32）",
        {"BETTER_AUTH_SECRET": "tooshort"},
        "BETTER_AUTH_SECRET 长度",
    ),
    (
        "CRON_SECRET 含历史泄漏值 change-me",
        {"CRON_SECRET": "change-me-change-me-change-me-change-me"},
        "已知坏值",
    ),
    (
        "NEXT_PUBLIC_APP_URL 与站点地址跨域",
        {"NEXT_PUBLIC_APP_URL": "https://other.example.invalid"},
        "域名不一致",
    ),
    (
        "CORPS_IMAGE_TAG=latest",
        {"CORPS_IMAGE_TAG": "latest"},
        "latest",
    ),
    (
        "BACKUP_DIR 不存在",
        {"BACKUP_DIR": "{missing_dir}"},
        "备份目录",
    ),
    (
        "CORPS_SITE_ADDRESS 留空",
        {"CORPS_SITE_ADDRESS": ""},
        "CORPS_SITE_ADDRESS",
    ),
    (
        "ACME_EMAIL 留空",
        {"ACME_EMAIL": ""},
        "ACME_EMAIL",
    ),
]


def find_bash() -> str | None:
    """找一个**非 WSL** 的 bash。

    不能直接用 `shutil.which("bash")`：Windows 的 PATH 里
    `C:\\Windows\\System32\\bash.exe`（WSL 启动器）常排在 Git 前面，
    而本机安全策略把 wsl.exe 拉黑了 —— 于是 subprocess 起不来 bash，
    表现为"所有用例输出为空、全部 FAIL"，而真正的原因在日志尾部才出现。
    这里显式跳过 System32 / wsl，并逐个候选用 `--version` 试跑。
    """
    candidates: list[str] = []
    for env_var in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
        base = os.environ.get(env_var)
        if not base:
            continue
        candidates += [
            str(Path(base) / "Git" / "bin" / "bash.exe"),
            str(Path(base) / "Git" / "usr" / "bin" / "bash.exe"),
        ]
    w = shutil.which("bash")
    if w:
        candidates.append(w)
    candidates.append(r"C:\Users\winge\.workbuddy\binaries\PortableGit\versions\1.3.0\bin\bash")

    seen: set[str] = set()
    for cand in candidates:
        low = cand.lower()
        if "system32" in low or "wsl" in low:
            continue
        real = str(Path(cand).resolve()) if Path(cand).exists() else cand
        if real in seen or not Path(cand).exists():
            continue
        seen.add(real)
        try:
            r = subprocess.run([cand, "--version"], capture_output=True, timeout=30)
            if r.returncode == 0:
                return cand
        except Exception:
            continue
    return None


def run(cmd: list[str], cwd: Path, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True,
        errors="replace", timeout=timeout,
    )


def gen_secret(nbytes: int) -> str:
    """运行时随机生成，不落盘、不入库。"""
    import secrets as _s

    return _s.token_hex(nbytes)


def build_env(example: Path, target: Path, backup_dir: Path) -> None:
    """从 .example 造一份合法 .env.prod：保留注释与顺序，只填值。"""
    values = dict(REQUIRED_ENV)
    values["BACKUP_DIR"] = str(backup_dir)
    for key, nbytes in SECRET_SPECS:
        values[key] = gen_secret(nbytes)

    out: list[str] = []
    seen: set[str] = set()
    for line in example.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0]
            if key in values:
                out.append(f"{key}={values[key]}")
                seen.add(key)
                continue
        out.append(line)

    missing = sorted(set(values) - seen)
    if missing:
        out.append("")
        out.append("# ---- verify_deploy_package 补齐（勿入库）----")
        out.extend(f"{k}={values[k]}" for k in missing)
    target.write_text("\n".join(out) + "\n", encoding="utf-8")


def set_env_kv(env_file: Path, kv: dict[str, str]) -> None:
    """就地改写 .env.prod 里的键值；键不存在则追加。"""
    lines = env_file.read_text(encoding="utf-8").splitlines()
    keys = set(kv)
    out: list[str] = []
    for line in lines:
        s = line.strip()
        if s and not s.startswith("#") and "=" in s:
            k = s.split("=", 1)[0]
            if k in keys:
                out.append(f"{k}={kv[k]}")
                keys.discard(k)
                continue
        out.append(line)
    out.extend(f"{k}={kv[k]}" for k in sorted(keys))
    env_file.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="部署包真跑验证")
    ap.add_argument("--worktree", default=".", help="仓库检出路径（默认当前目录）")
    ap.add_argument("--keep-env", action="store_true", help="保留生成的 .env.prod")
    args = ap.parse_args()

    wt = Path(args.worktree).resolve()
    deploy = wt / "deploy"
    preflight = deploy / "scripts" / "preflight.sh"
    example = deploy / ".env.prod.example"

    # ── 环境自检 ──────────────────────────────────────────────────────────────
    BASH = find_bash()
    if BASH is None:
        print("[ENV] 找不到可用的 bash（已跳过 WSL 的 System32\\bash.exe）", file=sys.stderr)
        return 2
    if shutil.which("docker") is None:
        print("[ENV] 缺少 docker（preflight 第 3 组要渲染 overlay）", file=sys.stderr)
        return 2
    if not preflight.is_file() or not example.is_file():
        print(f"[ENV] {deploy} 下找不到 preflight.sh / .env.prod.example", file=sys.stderr)
        return 2
    print(f"[ENV] bash = {BASH}")

    tmp = Path(tempfile.mkdtemp(prefix="corps-deployverify-"))
    backup_dir = tmp / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    env_file = deploy / ".env.prod"
    env_backup = tmp / "env.prod.good"

    results: list[tuple[str, bool, str]] = []
    try:
        # ── 阶段 1：正向 ──────────────────────────────────────────────────────
        print("\n=== 阶段 1：正向 —— 合法配置必须全绿 ===")
        build_env(example, env_file, backup_dir)
        shutil.copy2(env_file, env_backup)
        r = run([BASH, "deploy/scripts/preflight.sh"], wt)
        ok = r.returncode == 0 and "preflight 通过" in (r.stdout + r.stderr)
        detail = (r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout + r.stderr).strip() else ""
        results.append(("preflight 正向（28 项全绿）", ok, detail))
        print(f"  [{'PASS' if ok else 'FAIL'}] preflight EXIT={r.returncode} :: {detail}")

        # ── 阶段 2：反向故障注入 ──────────────────────────────────────────────
        print("\n=== 阶段 2：反向 —— 每个故障必须因正确红因判红 ===")
        for name, patch, kw in FAULT_CASES:
            shutil.copy2(env_backup, env_file)
            resolved = {k: v.replace("{missing_dir}", str(tmp / "no-such-dir")) for k, v in patch.items()}
            set_env_kv(env_file, resolved)
            r = run([BASH, "deploy/scripts/preflight.sh"], wt)
            blob = r.stdout + r.stderr
            caught = r.returncode != 0 and kw in blob
            first = next(
                (ln.strip() for ln in blob.splitlines() if "[fail]" in ln or ln.strip().startswith(("1)", "2)"))),
                "",
            )
            results.append((f"注入：{name}", caught, first))
            print(f"  [{'PASS' if caught else 'FAIL'}] {name} :: EXIT={r.returncode} :: {first[:90]}")

        # ── 阶段 3：备份目录三种形态 ──────────────────────────────────────────
        print("\n=== 阶段 3：备份目录口径（现行格式 vs legacy）===")
        shutil.copy2(env_backup, env_file)

        def step12_blob() -> str:
            r = run([BASH, "deploy/scripts/preflight.sh"], wt)
            blob = r.stdout + r.stderr
            i = blob.find("12/12")
            return blob[i:] if i >= 0 else blob

        # 3a 空目录
        blob = step12_blob()
        ok = "没有任何 corps*.dump" in blob and "现行格式 0 份" in blob
        results.append(("备份口径：空目录提示现行格式", ok, blob.splitlines()[1] if len(blob.splitlines()) > 1 else ""))
        print(f"  [{'PASS' if ok else 'FAIL'}] 空目录 :: {blob.splitlines()[1][:80] if len(blob.splitlines())>1 else ''}")

        # 3b 仅现行格式
        (backup_dir / "corps-20260101-000000.dump").write_bytes(b"")
        blob = step12_blob()
        ok = "现行格式 1 份" in blob and "[warn]" not in blob.split("12/12")[-1]
        results.append(("备份口径：现行格式被正确计数", ok, blob.splitlines()[1] if len(blob.splitlines()) > 1 else ""))
        print(f"  [{'PASS' if ok else 'FAIL'}] 现行格式 1 份 :: {blob.splitlines()[1][:80] if len(blob.splitlines())>1 else ''}")

        # 3c 仅 legacy
        (backup_dir / "corps-20260101-000000.dump").unlink()
        (backup_dir / "corps_20260101_000000.sql.gz").write_bytes(b"")
        blob = step12_blob()
        ok = "legacy" in blob and "不支持恢复" in blob
        results.append(("备份口径：仅 legacy 时告警且说明不可恢复", ok, blob.splitlines()[1] if len(blob.splitlines()) > 1 else ""))
        print(f"  [{'PASS' if ok else 'FAIL'}] 仅 legacy :: {blob.splitlines()[1][:80] if len(blob.splitlines())>1 else ''}")

    finally:
        shutil.copy2(env_backup, env_file) if env_backup.exists() else None
        if not args.keep_env and env_file.exists():
            env_file.unlink()
        shutil.rmtree(tmp, ignore_errors=True)

    # ── 汇总 ──────────────────────────────────────────────────────────────────
    n_pass = sum(1 for _, ok, _ in results if ok)
    n_fail = len(results) - n_pass
    print(f"\n=== 汇总：PASS={n_pass} FAIL={n_fail} ===")
    for name, ok, detail in results:
        if not ok:
            print(f"  [FAIL] {name} :: {detail[:160]}")
    print("\n结论：" + ("部署包门禁可依赖——正向放行、反向拦截、边界口径正确。"
                       if n_fail == 0 else "存在失败用例，上面的明细即失败原因。"))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
