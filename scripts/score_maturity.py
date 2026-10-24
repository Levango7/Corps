#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""corps 成熟度评分器（可复现版 / machine-scorable maturity scorecard）.

为什么要这个脚本
----------------
`docs/ROADMAP-2026Q4.md` 把验收判据写成「成熟度评分提升」，但仓库里
**从来没有一个可复现的评分器**：09-27 那版八维度分数是人工打的，综合 8.4
那一行后来被自己的复核记录判为「不再作为结论使用」。于是「评分提升」既
没有可信的分母，也没有可重跑的口径 —— 谁都可以说提升了。

这个脚本把「成熟度」从感受题变成计算题。

设计原则
--------
1. **只用机器判据**。每一项检查只有三种来源：
   - `gate`  —— 跑仓库自带的门禁脚本，退出码 0 即 PASS；
   - `metric`—— 数仓库里的文件 / 行 / 匹配，与阈值比；
   - `file`  —— 断言某个产物存在（文档、接线点）。
   没有「我觉得」「大致」「基本完成」。
2. **口径与仓库已提交的承诺对齐**。burn-down 相关项的分值直接读
   `scripts/burndown-plan.txt` 里已经 commit 的 start / target / due /
   grace_days，不另立标准，也不给「调数字变绿灯」留口子。
3. **可复现**。同一 commit 跑两次必须一致；`--json` 可落盘做历史快照。
4. **不掩盖**。跑不起来的检查标 **SKIP 并写明原因**，绝不当默认通过。
   SKIP 不计入分子也不计入分母，所以它不会把分数抬高，只会缩小口径 ——
   这一点在输出里单独列出来，防止「靠 SKIP 刷分」。

评分模型
--------
- 单项：PASS = 1.0，WARN = 0.5，FAIL = 0.0，SKIP 不计入。
- 维度分 = 10 × Σ权重 / 计入项数（满分 10）。
- 综合分 = 8 个维度分的算术平均（等权）。
- 档位：Gold ≥ 9.0 ＞ Silver ≥ 7.5 ＞ Bronze ≥ 6.0 ＞ Red。

用法
----
    python scripts/score_maturity.py                 # 人读表格
    python scripts/score_maturity.py --json          # 机器读（落快照）
    python scripts/score_maturity.py --skip-gates    # 只跑计量项（历史 ref 用）
    python scripts/score_maturity.py --root <dir>    # 指定被测树（如 git archive 解包目录）

退出码：无 FAIL 为 0，有 FAIL 为 1（所以它自己也能当一道门禁）。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

# 走路时永远跳过的目录（node_modules 会让任何全仓扫描卡死）
SKIP_DIRS = {
    "node_modules",
    ".next",
    ".git",
    "dist",
    "build",
    "coverage",
    ".turbo",
    "__pycache__",
    ".venv",
    "venv",
}

WEIGHT = {"PASS": 1.0, "WARN": 0.5, "FAIL": 0.0}


# ────────────────────────────── 基础探测器 ──────────────────────────────


def sh(cmd, cwd: Path = ROOT, timeout: int = 900):
    """跑一条命令，永远不抛异常。"""
    try:
        p = subprocess.run(
            cmd,
            cwd=str(cwd),
            shell=isinstance(cmd, str),
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode, p.stdout or "", p.stderr or ""
    except subprocess.TimeoutExpired:
        return 124, "", "TIMEOUT"
    except Exception as exc:  # pragma: no cover - 防御性
        return 127, "", f"{type(exc).__name__}: {exc}"


def walk(root: Path, suffixes: tuple[str, ...] = ()):
    """遍历文件，跳过噪声目录。"""
    if not root.exists():
        return
    for dirpath, dirnames, filenames in os_walk(root):
        for fn in filenames:
            if suffixes and not fn.endswith(suffixes):
                continue
            yield Path(dirpath) / fn


def os_walk(root: Path):
    """os.walk 的包装：原地剪掉 SKIP_DIRS。"""
    import os

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        yield dirpath, dirnames, filenames


def count_files(root: Path, suffixes: tuple[str, ...]) -> int:
    return sum(1 for _ in walk(root, suffixes))


def count_matches(root: Path, pattern: str, suffixes: tuple[str, ...]) -> int:
    rx = re.compile(pattern, re.MULTILINE)
    total = 0
    for path in walk(root, suffixes):
        try:
            total += len(rx.findall(path.read_text(encoding="utf-8", errors="replace")))
        except Exception:
            continue
    return total


def baseline_count(path: Path) -> int | None:
    """数基线文件的非注释非空行 —— burn-down 的「当前值」口径。"""
    if not path.exists():
        return None
    n = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            n += 1
    return n


# ──────────────────────────────burn-down 计划 ──────────────────────────────

BURND_RE = re.compile(r"^BASELINE\s+(\S+)\s+(.*)$")


def load_burndown() -> dict[str, dict]:
    plans: dict[str, dict] = {}
    f = ROOT / "scripts" / "burndown-plan.txt"
    if not f.exists():
        return plans
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = BURND_RE.match(line)
        if not m:
            continue
        key, rest = m.group(1), m.group(2)
        kv = dict(re.findall(r"([a-z_]+)=(\S+)", rest))
        try:
            plans[key] = {
                "start": int(kv["start"]),
                "target": int(kv["target"]),
                "start_date": date.fromisoformat(kv["start_date"]),
                "due": date.fromisoformat(kv["due"]),
                "grace_days": int(kv["grace_days"]),
                "source": kv.get("source", ""),
            }
        except Exception:
            continue
    return plans


def burndown_line(p: dict, today: date):
    """按线性清偿算出「今日应达」与「含宽限的上限」."""
    total = (p["due"] - p["start_date"]).days or 1
    elapsed = min(max((today - p["start_date"]).days, 0), total)
    pace = (p["start"] - p["target"]) / total
    due_today = p["start"] - pace * elapsed
    return due_today, due_today + pace * p["grace_days"]


# ────────────────────────────── 检查项构造 ──────────────────────────────

CHECKS: list[dict] = []


def add(cid, dim, title, status, value="", target="", note="", kind="", num=None):
    CHECKS.append(
        {
            "id": cid,
            "dim": dim,
            "title": title,
            "kind": kind,
            "status": status,
            "value": value,
            "target": target,
            "note": note,
            "num": num,
        }
    )


def gate(cid, dim, title, cmd, note="", cwd: Path = ROOT, skip_markers=(), timeout=900):
    """跑门禁脚本：退出码 0 = PASS；命中 skip_markers = SKIP（环境不具备）。"""
    if ARGS.skip_gates:
        add(cid, dim, title, "SKIP", "-", "-", "--skip-gates 已跳过", "gate")
        return
    rc, out, err = sh(cmd, cwd=cwd, timeout=timeout)
    blob = out + err
    hit = next((m for m in skip_markers if m in blob), None)
    if rc == 0:
        add(cid, dim, title, "PASS", f"exit=0", "exit=0", note, "gate")
    elif hit:
        add(cid, dim, title, "SKIP", f"exit={rc}", "exit=0", f"{note} | 环境不具备：{hit}", "gate")
    else:
        tail = [l for l in blob.strip().splitlines() if l.strip()][-1:] or [""]
        add(cid, dim, title, "FAIL", f"exit={rc}", "exit=0", f"{note} | {tail[0][:120]}", "gate")


def metric(cid, dim, title, value, unit, good, bad, lower_is_better=True, note=""):
    """与阈值比：达标 PASS，接近 WARN，否则 FAIL。value 为 None -> SKIP。"""
    if value is None:
        add(cid, dim, title, "SKIP", "量不出", f"{good}{unit}", note or "产物缺失", "metric")
        return
    if lower_is_better:
        status = "PASS" if value <= good else ("WARN" if value <= bad else "FAIL")
    else:
        status = "PASS" if value >= good else ("WARN" if value >= bad else "FAIL")
    add(cid, dim, title, status, f"{value}{unit}", f"{good}{unit}", note, "metric", num=value)


def exists(cid, dim, title, path: Path, note=""):
    if path.exists():
        add(cid, dim, title, "PASS", path.name, "存在", note, "file")
    else:
        add(cid, dim, title, "FAIL", "缺失", "存在", note or f"期望路径：{path}", "file")


# ────────────────────────────── 八维度检查 ──────────────────────────────


def dim_security():
    d = "security"
    gate(d + "-1", d, "权限矩阵门禁（写 handler 必须过 requirePermission）",
         [sys.executable, "scripts/check_permission_gates.py"])
    gate(d + "-2", d, "写访问登记表门禁（281 个写 handler 全部进墙或登记）",
         [sys.executable, "scripts/check_write_access_registry.py"])
    gate(d + "-3", d, "burn-down 清偿门禁（三项基线的进度与文档不漂移）",
         [sys.executable, "scripts/check_burndown.py"])

    # 未接线的写 handler 存量（burn-down key=permission-gate-t3）
    plans = load_burndown()
    p = plans.get("permission-gate-t3")
    cur = baseline_count(ROOT / "scripts" / "permission-gate-unscoped-baseline.txt")
    if p:
        due_today, limit = burndown_line(p, TODAY)
        metric(d + "-4", d, "未接线写 handler 存量 vs 今日应达", cur, " 个",
               round(limit, 1), round(limit + (p["start"] - p["target"]) * 0.1, 1),
               note=f"start={p['start']} target={p['target']} 今日应达≤{limit:.1f}")

    # 仓库不得跟踪任何 .env*（PR #161 引入 root .env.prod 加载路径后，这条变关键）
    rc, out, _ = sh(["git", "ls-files"], cwd=ROOT)
    # .example 模板本就该入库，不算泄露；只有真身被跟踪才是事故
    tracked_env = [
        l for l in out.splitlines()
        if re.search(r"(^|/)\.env(\.|$)", l) and not l.endswith((".example", ".example.md"))
    ]
    metric(d + "-5", d, "被 git 跟踪的 .env 文件数", len(tracked_env), " 个", 0, 1,
           note=("；".join(tracked_env[:3]) if tracked_env else "无") if rc == 0 else "非 git 树，跳过")

    # .gitignore 必须覆盖 .env*（只写 .env 会漏掉 .env.prod）
    gi = ROOT / ".gitignore"
    txt = gi.read_text(encoding="utf-8", errors="replace") if gi.exists() else ""
    has_star = bool(re.search(r"^\s*\.env\*\s*$", txt, re.MULTILINE))
    has_plain = bool(re.search(r"^\s*\.env\s*$", txt, re.MULTILINE))
    if has_star:
        add(d + "-6", d, ".gitignore 覆盖 .env*（含 .env.prod）", "PASS", ".env*", "覆盖", "", "file")
    elif has_plain:
        add(d + "-6", d, ".gitignore 覆盖 .env*（含 .env.prod）", "WARN", ".env", "覆盖 .env*",
            "仅忽略裸 .env，.env.prod 等后缀变体不在内", "file")
    else:
        add(d + "-6", d, ".gitignore 覆盖 .env*（含 .env.prod）", "FAIL", "缺失", "覆盖 .env*", "", "file")

    # 密钥集中校验
    envts = WEB / "lib" / "env.ts"
    txt = envts.read_text(encoding="utf-8", errors="replace") if envts.exists() else ""
    add(d + "-7", d, "环境变量集中 zod 校验", "PASS" if "z.object" in txt else "FAIL",
        "z.object" if "z.object" in txt else "缺失", "存在",
        "web/lib/env.ts" if envts.exists() else "web/lib/env.ts 不存在", "file")


def dim_data():
    d = "data"
    gate(d + "-1", d, "RLS 覆盖率门禁（全部表 ENABLE + FORCE + 有策略）",
         [sys.executable, "scripts/check_rls_coverage.py"])
    gate(d + "-2", d, "RLS 豁免登记门禁",
         [sys.executable, "scripts/check_rls_exemptions.py"])
    gate(d + "-3", d, "schema / 迁移漂移门禁",
         [sys.executable, "scripts/check_schema_migration_drift.py"])

    # RLS 覆盖的表数量
    sql = ROOT / "db" / "rls-activate.sql"
    n = None
    if sql.exists():
        blob = sql.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"ARRAY\[(.*?)\]", blob, re.DOTALL)
        if m:
            n = len(re.findall(r"'([a-z0-9_]+)'", m.group(1)))
    metric(d + "-4", d, "RLS 激活覆盖表数", n, " 张", 70, 60,
           lower_is_better=False, note="db/rls-activate.sql 的 ARRAY[...] 条目数")

    # schema.sql 快照新鲜度：文件头「对应迁移」必须等于最新迁移目录
    sch = ROOT / "db" / "schema.sql"
    declared = None
    if sch.exists():
        m = re.search(r"对应迁移:\s*([0-9]{14})", sch.read_text(encoding="utf-8", errors="replace"))
        if m:
            declared = m.group(1)
    mig_dir = WEB / "prisma" / "migrations"
    latest = None
    if mig_dir.exists():
        dirs = sorted(
            (d.name for d in mig_dir.iterdir() if d.is_dir() and re.match(r"^\d{14}_", d.name)),
            reverse=True,
        )
        latest = dirs[0][:14] if dirs else None
    if declared and latest:
        ok = declared == latest
        add(d + "-5", d, "db/schema.sql 快照与最新迁移一致",
            "PASS" if ok else "FAIL", declared, latest,
            "" if ok else f"快照落后，缺 {latest} 引入的列（如 workspaces.settings）", "file",
            num=0 if ok else 1)
    else:
        add(d + "-5", d, "db/schema.sql 快照与最新迁移一致", "SKIP",
            declared or "无", latest or "无", "量不出", "file")


def dim_api():
    d = "api"
    gate(d + "-1", d, "OpenAPI 契约门禁（新增路由不得漏声明）",
         [sys.executable, "scripts/check_api_contract.py"])
    gate(d + "-2", d, "v1 守卫棘轮门禁",
         [sys.executable, "scripts/check_v1_guard_ratchet.py"])

    routes = count_files(WEB / "app", (".ts", ".tsx"))
    route_files = sum(1 for p in walk(WEB / "app", (".ts", ".tsx")) if p.name in ("route.ts", "route.tsx"))
    undeclared = baseline_count(ROOT / "scripts" / "api-contract-baseline.txt")
    openapi = find_openapi()
    declared = count_openapi_paths(openapi) if openapi else None

    add(d + "-3", d, "路由处理器文件数（规模）", "PASS", route_files, "-",
        "仅登记规模，不作达标判据", "metric", num=route_files)
    if declared is not None and undeclared is not None:
        pct = 100.0 * declared / (declared + undeclared)
        metric(d + "-4", d, "OpenAPI 契约覆盖率", round(pct, 1), "%", 60.0, 40.0,
               lower_is_better=False,
               note=f"已声明 {declared} / 未声明 {undeclared}")
    else:
        add(d + "-4", d, "OpenAPI 契约覆盖率", "SKIP", "量不出", "≥60%", "", "metric")

    # openapi.yaml 自述 path 数是否与实测一致（历史上反复漂移）
    self_n = None
    if openapi:
        m = re.search(r"declares\s+(\d+)\s+paths", openapi.read_text(encoding="utf-8", errors="replace"))
        if m:
            self_n = int(m.group(1))
    if self_n is not None and declared is not None:
        drift = abs(self_n - declared)
        status = "PASS" if drift == 0 else ("WARN" if drift <= 2 else "FAIL")
        add(d + "-5", d, "openapi.yaml 自述 path 数与实测一致", status,
            f"自述 {self_n} / 实测 {declared}", "0",
            "" if drift == 0 else f"漂移 {drift}", "metric", num=drift)
    else:
        add(d + "-5", d, "openapi.yaml 自述 path 数与实测一致", "SKIP", "-", "0",
            "未找到自述数字", "metric")


def find_openapi() -> Path | None:
    for cand in (
        WEB / "app" / "api" / "openapi.yaml",
        ROOT / "api" / "openapi.yaml",
        ROOT / "docs" / "api" / "openapi.yaml",
    ):
        if cand.exists():
            return cand
    for p in walk(ROOT, (".yaml", ".yml")):
        if p.name == "openapi.yaml":
            return p
    return None


def count_openapi_paths(path: Path) -> int:
    rx = re.compile(r"^\s{2}/[^\s:]+:\s*$", re.MULTILINE)
    return len(rx.findall(path.read_text(encoding="utf-8", errors="replace")))


def dim_quality():
    d = "quality"
    gate(d + "-1", d, "P0 内容规约门禁（emoji 图标 / 渐变 / 硬编码色 / 文案模板）",
         [sys.executable, "scripts/check_p0_content.py"])
    gate(d + "-2", d, "ADR-015 登记表门禁（未接线组件不得当死代码删）",
         [sys.executable, "scripts/check_adr015_manifest.py"])

    suffixes = (".ts", ".tsx", ".js", ".jsx")
    # 本脚本自己的标题/message 里就写着 "TODO / FIXME / HACK"，
    # 不排除的话它会自己污染自己量出的数（实测虚高 6 处）
    self_path = Path(__file__).resolve()
    rx_todo, rx_fixme, rx_hack = r"\bTODO\b", r"\bFIXME\b", r"\bHACK\b"
    todo = fixme = hack = 0
    for base, sfx in ((WEB, suffixes), (ROOT / "scripts", (".py",))):
        for p in walk(base, sfx):
            if p.resolve() == self_path:
                continue
            try:
                t = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            todo += len(re.findall(rx_todo, t))
            fixme += len(re.findall(rx_fixme, t))
            hack += len(re.findall(rx_hack, t))
    metric(d + "-3", d, "TODO / FIXME / HACK 存量", todo + fixme + hack, " 处", 5, 20,
           note=f"TODO={todo} FIXME={fixme} HACK={hack}")

    as_any = count_matches(WEB, r"\bas\s+any\b", suffixes)
    metric(d + "-4", d, "`as any` 存量", as_any, " 处", 2, 8)


def dim_testing():
    d = "testing"
    gate(d + "-1", d, "零覆盖棘轮门禁（新零覆盖文件即红，已修未删即红）",
         [sys.executable, "scripts/check_zero_coverage_ratchet.py"],
         skip_markers=("MISSING_ARTIFACT",),
         note="需先跑 `npx vitest run tests/unit --coverage` 产出 coverage-summary.json")

    plans = load_burndown()
    cur = baseline_count(ROOT / "scripts" / "zero-coverage-baseline.txt")
    p = plans.get("zero-coverage")
    if p:
        due_today, limit = burndown_line(p, TODAY)
        metric(d + "-2", d, "零行覆盖文件数 vs 今日应达", cur, " 个",
               round(limit, 1), round(limit + (p["start"] - p["target"]) * 0.1, 1),
               note=f"start={p['start']} target={p['target']} 今日应达≤{limit:.1f}")

    tf = sum(1 for p in walk(ROOT, (".ts", ".tsx")) if ".test." in p.name or ".spec." in p.name)
    metric(d + "-3", d, "测试文件数", tf, " 个", 100, 60, lower_is_better=False)

    cases = count_matches(ROOT, r"^\s*(?:it|test)\s*\(", (".ts", ".tsx"))
    metric(d + "-4", d, "测试用例数", cases, " 例", 1000, 700, lower_is_better=False)

    api_tests = sum(1 for p in walk(WEB / "tests" / "api", (".ts",)) if ".test." in p.name) \
        if (WEB / "tests" / "api").exists() else 0
    metric(d + "-5", d, "tests/api 路由级测试文件数", api_tests, " 个", 20, 5,
           lower_is_better=False, note="API 层最大短板：292 个路由对 少量路由级测试")


def dim_cicd():
    d = "cicd"
    wf = sorted((ROOT / ".github" / "workflows").glob("*.yml")) if (ROOT / ".github" / "workflows").exists() else []
    metric(d + "-1", d, "CI 工作流文件数", len(wf), " 个", 6, 4, lower_is_better=False)

    jobs = 0
    for f in wf:
        try:
            lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            continue
        try:
            i = next(k for k, l in enumerate(lines) if l.rstrip() == "jobs:")
        except StopIteration:
            continue
        # jobs: 之后的 direct children（两空格缩进）即 job id；
        # 缩进回 0 或出现新的顶层键就停 —— 别把 workflow 级键算成 job
        for l in lines[i + 1:]:
            if l.strip() and not l.startswith(" "):
                break
            if re.match(r"^  [A-Za-z0-9_-]+:\s*$", l):
                jobs += 1
    metric(d + "-2", d, "CI job 总数", jobs, " 个", 10, 6, lower_is_better=False)

    exists(d + "-3", d, "shell 脚本静态检查工作流", ROOT / ".github" / "workflows" / "shellcheck.yml")
    gate(d + "-8", d, "基础镜像供应链门禁（Dockerfile FROM 可解析 / tag 明确 / 取得到）",
         [sys.executable, "scripts/check_dockerfile_base_images.py"],
         skip_markers=("UNREACHABLE",),
         note="本机隧道 502 取不到 Docker Hub 时判 SKIP，CI 侧有网照常判定")
    exists(d + "-4", d, "部署包真跑验证脚本", ROOT / "scripts" / "verify_deploy_package.py")
    exists(d + "-5", d, "部署一键脚本", ROOT / "deploy" / "scripts" / "deploy.sh")
    exists(d + "-6", d, "回滚脚本", ROOT / "deploy" / "scripts" / "rollback.sh")

    # 分支保护 / 最近一次 main 运行结论：依赖 gh + 网络，取不到就 SKIP
    rc, out, _ = sh(["gh", "run", "list", "--branch", "main", "--limit", "1",
                     "--json", "conclusion", "-q", ".[] | .conclusion"])
    if rc == 0 and out.strip():
        ok = out.strip().lower() == "success"
        add(d + "-7", d, "main 分支最近一次 CI 结论", "PASS" if ok else "FAIL",
            out.strip(), "success", "gh run list", "metric")
    else:
        add(d + "-7", d, "main 分支最近一次 CI 结论", "SKIP", "gh 不可用", "success",
            "本机无 gh 或网络不可达；CI 侧判定不受影响", "metric")


def dim_observability():
    d = "observability"
    instr = WEB / "instrumentation.ts"
    exists(d + "-1", d, "Sentry 服务端/运行时初始化接线", instr)

    gerr = WEB / "app" / "global-error.tsx"
    exists(d + "-2", d, "全局错误边界捕获接线", gerr)

    metrics = WEB / "app" / "api" / "metrics" / "route.ts"
    exists(d + "-3", d, "/api/metrics 指标端点", metrics)

    # RED 指标：按路由维度的请求数 / 错误数 / 耗时
    red = 0
    for p in walk(WEB, (".ts", ".tsx")):
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if re.search(r"http_requests_total|http_request_duration|requestDurationHistogram|routeLabel", t):
            red += 1
    metric(d + "-4", d, "RED 指标（按路由的请求/错误/耗时）接线文件数", red, " 个", 1, 0,
           lower_is_better=False, note="当前仅进程级 gauge，无按路由 RED")

    slo = [p for p in walk(ROOT / "docs", (".md",))
           if re.search(r"SLO|SLI|可观测", p.name)]
    metric(d + "-5", d, "SLO/SLI 文档数", len(slo), " 份", 1, 0, lower_is_better=False,
           note="路线图 §1.5 承诺产出，尚未落地")

    exists(d + "-6", d, "监控运维 runbook", ROOT / "docs" / "runbook-monitoring.md")


def dim_docs():
    d = "docs"
    adr = sorted((ROOT / "docs" / "decisions").glob("ADR-*.md")) if (ROOT / "docs" / "decisions").exists() else []
    metric(d + "-1", d, "ADR 数量", len(adr), " 份", 12, 8, lower_is_better=False)

    exists(d + "-2", d, "协作协议（认领留言板规则）", ROOT / "docs" / "COORDINATION.md")
    exists(d + "-3", d, "路线图", ROOT / "docs" / "ROADMAP-2026Q4.md")
    exists(d + "-4", d, "部署 runbook", ROOT / "docs" / "runbook-deploy.md")

    audits = sorted((ROOT / "docs" / "audit").glob("*.md")) if (ROOT / "docs" / "audit").exists() else []
    metric(d + "-5", d, "审计报告归档数", len(audits), " 份", 10, 5, lower_is_better=False)

    pent = [p for p in walk(ROOT / "docs" / "security", (".md",)) if "PENTEST" in p.name]
    metric(d + "-6", d, "渗透测试文档数", len(pent), " 份", 3, 1, lower_is_better=False,
           note="三件套停留在 2026-08-27，未覆盖本轮四项交付的暴露面")


DIM_META = [
    ("security", "安全"),
    ("data", "数据层"),
    ("api", "API 层"),
    ("quality", "代码质量"),
    ("testing", "测试"),
    ("cicd", "CI/CD"),
    ("observability", "可观测性"),
    ("docs", "文档"),
]


def band(score: float) -> str:
    if score >= 9.0:
        return "Gold"
    if score >= 7.5:
        return "Silver"
    if score >= 6.0:
        return "Bronze"
    return "Red"


def main() -> int:
    global ARGS, TODAY, ROOT, WEB

    ap = argparse.ArgumentParser(description="corps 成熟度评分器（可复现版）")
    ap.add_argument("--root", default=str(ROOT), help="被测仓库树根目录（默认：本脚本上一级）")
    ap.add_argument("--json", action="store_true", help="输出 JSON（便于落历史快照）")
    ap.add_argument("--skip-gates", action="store_true", help="只跑计量项，不跑门禁脚本")
    ap.add_argument("--today", default=None, help="覆盖「今天」（YYYY-MM-DD），用于复现历史快照")
    ap.add_argument("--label", default=None, help="快照标签，如 before / after")
    ARGS = ap.parse_args()

    ROOT = Path(ARGS.root).resolve()
    WEB = ROOT / "web"
    TODAY = date.fromisoformat(ARGS.today) if ARGS.today else date.today()

    dim_security()
    dim_data()
    dim_api()
    dim_quality()
    dim_testing()
    dim_cicd()
    dim_observability()
    dim_docs()

    rc, head, _ = sh(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT)
    commit = head.strip() if rc == 0 else "unknown"

    dims = []
    for key, name in DIM_META:
        rows = [c for c in CHECKS if c["dim"] == key]
        counted = [c for c in rows if c["status"] != "SKIP"]
        score = 10.0 * sum(WEIGHT[c["status"]] for c in counted) / len(counted) if counted else 0.0
        dims.append(
            {
                "key": key,
                "name": name,
                "score": round(score, 2),
                "band": band(score),
                "checks": rows,
                "counted": len(counted),
                "skipped": len(rows) - len(counted),
            }
        )

    composite = round(sum(d["score"] for d in dims) / len(dims), 2)
    # 原始指标块：跨 commit 可直接做差，不掺阈值判断
    metrics = {
        c["id"]: {
            "title": c["title"],
            "value": c["num"],
            "display": c["value"],
            "target": c["target"],
            "status": c["status"],
        }
        for c in CHECKS
        if c["num"] is not None
    }
    payload = {
        "schema": 1,
        "label": ARGS.label,
        "commit": commit,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "today": TODAY.isoformat(),
        "composite": composite,
        "band": band(composite),
        "dimensions": dims,
        "metrics": metrics,
    }

    if ARGS.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        render(payload)

    return 0 if not any(c["status"] == "FAIL" for c in CHECKS) else 1


def render(payload: dict) -> None:
    print(f"corps 成熟度评分 · {payload['label'] or 'snapshot'}")
    print(f"commit={payload['commit']}  today={payload['today']}  "
          f"generated={payload['generated_at']}")
    print()
    print(f"{'维度':<10}{'分数':>7}  {'档位':<8}{'计入':>5}{'跳过':>5}")
    print("-" * 44)
    for d in payload["dimensions"]:
        print(f"{d['name']:<10}{d['score']:>7.2f}  {d['band']:<8}{d['counted']:>5}{d['skipped']:>5}")
    print("-" * 44)
    print(f"{'综合':<10}{payload['composite']:>7.2f}  {payload['band']:<8}")
    print()
    print("未达标 / 需关注项：")
    if ARGS.skip_gates:
        # 显式 --skip-gates 时门禁一律 SKIP，列出来只是噪声
        bad = [c for c in CHECKS if c["status"] in ("FAIL", "WARN", "SKIP") and c["kind"] != "gate"]
    else:
        bad = [c for c in CHECKS if c["status"] in ("FAIL", "WARN", "SKIP")]
    if not bad:
        print("  （无）")
    for c in bad:
        mark = {"FAIL": "✗", "WARN": "!", "SKIP": "-"}[c["status"]]
        print(f"  {mark} [{c['id']}] {c['title']}：当前 {c['value']} / 目标 {c['target']}"
              + (f" —— {c['note']}" if c["note"] else ""))


if __name__ == "__main__":
    sys.exit(main())
