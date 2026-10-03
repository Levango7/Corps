#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_burndown.py — 质量基线「承诺变好」门禁（burn-down）

背景（与其余 scripts/check_*.py 的分工）：
  仓库现有的门禁全是**棘轮**：新增即红、已修未删即红。它们能挡住恶化，
  却对「什么都不做」永远绿灯 —— 一个季度过去，643 个零覆盖文件还是 643 个，
  CI 全绿。docs/ROADMAP-2026Q4.md §2 写了一张 90 天 burn-down 表承诺变好，
  但那是**文档承诺**，没有执行点，逾期与否无人知晓。

本脚本把那张表接上电：scripts/burndown-plan.txt 声明每条基线的
起止值 / 起止日期 / 宽限天数 / 量法，本脚本按日期线性插值算出「今天应该到哪」，
实测值落后超过宽限额度即红。

断言（五种红因）：
  BURND_MALFORMED       计划行解析不了，或数值/日期自相矛盾（target >= start、due <= start_date）
  BURND_MEASURE_BROKEN  source 量不出当前值（文件被挪走/改名）——量不出就红，不静默跳过
  BURND_REGRESSED       当前值 > start（棘轮门禁本应挡住，这里是二次确认：基线回退了）
  BURND_BEHIND          当前值 > 今日应达 + 宽限额度（承诺没兑现）
  BURND_DOC_DRIFT       路线图 §2 表里写的「当前」与实测不符（文档承诺不得与事实漂移）

为什么直接数基线文件而不是重跑统计：每条基线都配了棘轮门禁强制「基线 == 实测集合」
（check_zero_coverage_ratchet.py / check_permission_gates.py / check_api_contract.py），
基线行数即实测值；且不依赖 vitest --coverage 产物，判据恒定可复现、跑得动。

用法：
  python scripts/check_burndown.py                  按今天校验（默认计划 scripts/burndown-plan.txt）
  python scripts/check_burndown.py --plan <path>    指定计划文件（自检用）
  python scripts/check_burndown.py --self-test      跑变异自检
环境变量：
  BURND_DOC_PATH        覆盖路线图路径（默认 docs/ROADMAP-2026Q4.md，自检用）
  BURND_TODAY           覆盖今天（YYYY-MM-DD，自检/补跑用；生产不要设）
退出码：0 通过；1 断言失败；2 自检未如期变红。
"""

from __future__ import annotations

import math
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLAN = Path(__file__).resolve().parent / "burndown-plan.txt"
ROADMAP = REPO / "docs" / "ROADMAP-2026Q4.md"

# BASELINE <key> start=643 target=550 start_date=2026-10-03 due=2026-12-31 grace_days=14 source=file:... doc_row=...
LINE_RE = re.compile(r"^BASELINE\s+(\S+)\s+(.*)$")
FIELD_RE = re.compile(r"(\w+)=(\S+)")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass
class Plan:
    key: str
    start: int
    target: int
    start_date: date
    due: date
    grace_days: int
    source: str
    doc_row: str | None = None


def body_lines(path: Path) -> list[str]:
    return [
        ln.strip()
        for ln in path.read_text(encoding="utf-8", errors="ignore").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]


def load_plan(path: Path) -> tuple[list[Plan], list[str]]:
    """返回 (计划条目, 解析错误)。解析错误非空即 BURND_MALFORMED。"""
    plans: list[Plan] = []
    errors: list[str] = []
    if not path.exists():
        return plans, [f"BURND_MALFORMED 计划文件缺失：{path}"]
    for ln in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        m = LINE_RE.match(s)
        if not m:
            errors.append(f"BURND_MALFORMED 计划行无法解析（须以 'BASELINE <key> k=v ...' 开头）：{s}")
            continue
        key, rest = m.group(1), m.group(2)
        fields = dict(FIELD_RE.findall(rest))
        missing = [k for k in ("start", "target", "start_date", "due", "grace_days", "source") if k not in fields]
        if missing:
            errors.append(f"BURND_MALFORMED {key} 缺少字段 {sorted(missing)}：{s}")
            continue
        try:
            start = int(fields["start"])
            target = int(fields["target"])
            grace = int(fields["grace_days"])
        except ValueError:
            errors.append(f"BURND_MALFORMED {key} 的 start/target/grace_days 必须是整数：{s}")
            continue
        for k in ("start_date", "due"):
            if not DATE_RE.match(fields[k]):
                errors.append(f"BURND_MALFORMED {key} 的 {k} 不是 YYYY-MM-DD：{fields[k]}")
                break
        else:
            try:
                sd = date.fromisoformat(fields["start_date"])
                due = date.fromisoformat(fields["due"])
            except ValueError:
                errors.append(f"BURND_MALFORMED {key} 的日期非法：{s}")
                continue
            if target >= start:
                errors.append(
                    f"BURND_MALFORMED {key} target={target} 必须小于 start={start}（burn-down 是清偿，不是放宽）"
                )
                continue
            if due <= sd:
                errors.append(f"BURND_MALFORMED {key} due={due} 必须晚于 start_date={sd}")
                continue
            if grace < 0:
                errors.append(f"BURND_MALFORMED {key} grace_days 不能为负：{grace}")
                continue
            if (due - sd).days < grace:
                # 宽限额度按「每天清偿量 × 宽限天数」算，窗口比宽限还短时额度会淹没整段承诺
                errors.append(
                    f"BURND_MALFORMED {key} 窗口仅 {(due - sd).days} 天，短于宽限 {grace} 天"
                    f"（等于没有承诺：把 due 拉长或调小 grace_days）"
                )
                continue
            plans.append(
                Plan(
                    key=key,
                    start=start,
                    target=target,
                    start_date=sd,
                    due=due,
                    grace_days=grace,
                    source=fields["source"],
                    doc_row=fields.get("doc_row"),
                )
            )
    return plans, errors


def measure(source: str) -> tuple[int | None, str | None]:
    """量出当前值。量不出就返回 (None, 原因) —— 绝不静默当成 0。"""
    if source.startswith("file:"):
        p = REPO / source[len("file:") :]
        if not p.exists():
            return None, f"基线文件不存在：{source}（改名/挪走后请同步更新 burndown-plan.txt）"
        return len(body_lines(p)), None
    return None, f"未知 source 口径：{source}（当前只支持 file:<相对仓库根路径>）"


def schedule(plan: Plan, today: date) -> tuple[float, float, int]:
    """返回 (今日应达, 宽限后上限, 距截止天数)。"""
    total = (plan.due - plan.start_date).days
    elapsed = min(max((today - plan.start_date).days, 0), total)
    rate = (plan.start - plan.target) / total
    expected = plan.start - rate * elapsed
    limit = expected + rate * plan.grace_days
    remaining = max((plan.due - today).days, 0)
    return expected, limit, remaining


def doc_declared(doc_path: Path, doc_row: str) -> int | None:
    """从路线图 §2 表里读出该基线登记的「当前」值；读不到返回 None（不声明就不校验）。"""
    if not doc_path.exists():
        return None
    for ln in doc_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not ln.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) < 3 or doc_row not in cells[0]:
            continue
        m = re.search(r"\d+", cells[1].replace("*", ""))
        if m:
            return int(m.group())
    return None


def check_raw(plan_path: Path = PLAN, today: date | None = None) -> tuple[list[str], list[dict]]:
    """返回 (错误列表, 逐条明细)。错误为空即通过。"""
    if today is None:
        env_today = os.environ.get("BURND_TODAY")
        today = date.fromisoformat(env_today) if env_today else date.today()
    doc_path = Path(os.environ["BURND_DOC_PATH"]) if os.environ.get("BURND_DOC_PATH") else ROADMAP

    plans, errors = load_plan(plan_path)
    rows: list[dict] = []
    for plan in plans:
        row = {
            "key": plan.key,
            "start": plan.start,
            "target": plan.target,
            "current": None,
            "expected": None,
            "limit": None,
            "remaining": None,
            "status": "?",
        }
        rows.append(row)
        current, why = measure(plan.source)
        if current is None:
            row["status"] = "BROKEN"
            errors.append(f"BURND_MEASURE_BROKEN {plan.key} 量不出当前值：{why}")
            continue
        row["current"] = current
        expected, limit, remaining = schedule(plan, today)
        row["expected"] = expected
        row["limit"] = limit
        row["remaining"] = remaining

        if current > plan.start:
            row["status"] = "REGRESSED"
            errors.append(
                f"BURND_REGRESSED {plan.key} 当前 {current} 已超过起点 {plan.start}"
                f"（基线回退 —— 配套的棘轮门禁本应先红，请一并查明）"
            )
            continue
        if current > math.ceil(limit):
            row["status"] = "BEHIND"
            errors.append(
                f"BURND_BEHIND {plan.key} 当前 {current}，今日应达 ≤ {limit:.1f}"
                f"（{plan.start_date} → {plan.due} 从 {plan.start} 清到 {plan.target}，"
                f"宽限 {plan.grace_days} 天；距截止 {remaining} 天）"
            )
            continue
        row["status"] = "OK"

        if plan.doc_row:
            declared = doc_declared(doc_path, plan.doc_row)
            if declared is not None and declared != current:
                row["status"] = "DOC_DRIFT"
                errors.append(
                    f"BURND_DOC_DRIFT {plan.key} 路线图写 {declared}，实测 {current}"
                    f"（把 {doc_path.name} §2 的「当前」列改成实测值）"
                )
    return errors, rows


def fmt(v, spec="") -> str:
    return "-" if v is None else (format(v, spec) if spec else str(v))


def check(plan_path: Path = PLAN) -> int:
    errors, rows = check_raw(plan_path)
    print(f"{'基线':<22}{'当前':>6}{'目标':>6}{'今日应达':>10}{'宽限上限':>10}{'距截止':>8}  状态")
    for r in rows:
        print(
            f"{r['key']:<22}{fmt(r['current']):>6}{r['target']:>6}"
            f"{fmt(r['expected'], '.1f'):>10}{fmt(r['limit'], '.1f'):>10}{fmt(r['remaining']):>8}  {r['status']}"
        )
    if errors:
        print()
        print("\n".join("  " + e for e in errors))
        print(f"FAIL: {len(errors)} 项 burn-down 承诺未兑现（{sorted({e.split()[0] for e in errors})}）")
        return 1
    print("PASS: 各基线均在清偿节奏内（或已达标），且路线图承诺与实测一致。")
    return 0


def mutate_first_baseline(text: str, pattern: str, repl: str) -> str:
    """只改第一条 BASELINE 行 —— 注释头里有同名字段占位（source=file:<...>），
    盲替换会打在注释上，变异看起来「没生效」，自检就假绿。"""
    out: list[str] = []
    done = False
    for ln in text.splitlines():
        if not done and ln.startswith("BASELINE "):
            new = re.sub(pattern, repl, ln, count=1)
            done = new != ln
            out.append(new)
        else:
            out.append(ln)
    return "\n".join(out) + "\n"


def self_test() -> int:
    """五种变异必须各自因正确的红因变红；判据失效时自检自己红。"""
    original = PLAN.read_text(encoding="utf-8") if PLAN.exists() else ""
    if not original:
        print("SKIP: burndown-plan.txt 为空，无法构造变异")
        return 0
    today = date.today()
    tmp = Path(tempfile.mkdtemp(prefix="burndown-selftest-"))
    ok = True
    cases: list[tuple[str, str, str | None, set[str]]] = []

    # 1. target >= start -> BURND_MALFORMED
    cases.append(
        (
            "target 大于 start -> BURND_MALFORMED",
            mutate_first_baseline(original, r"target=\d+", "target=9999"),
            None,
            {"BURND_MALFORMED"},
        )
    )

    # 2. source 指向不存在的文件 -> BURND_MEASURE_BROKEN
    cases.append(
        (
            "基线文件不存在 -> BURND_MEASURE_BROKEN",
            mutate_first_baseline(original, r"source=file:\S+", "source=file:scripts/definitely-not-here.txt"),
            None,
            {"BURND_MEASURE_BROKEN"},
        )
    )

    # 3. start 低于实测 -> BURND_REGRESSED
    low = mutate_first_baseline(original, r"start=\d+", "start=1")
    low = mutate_first_baseline(low, r"target=\d+", "target=0")
    cases.append(("当前值超过起点 -> BURND_REGRESSED", low, None, {"BURND_REGRESSED"}))

    # 4. 窗口已跑完却没清偿 -> BURND_BEHIND
    #    （不能直接把 due 挪到今天：窗口压缩后「每天清偿量」暴涨，宽限额度会淹没整段承诺，
    #     那是门禁自身的漏洞，已用 MALFORMED 规则堵住；这里用「窗口早已开始并结束」仿真逾期）
    overdue = mutate_first_baseline(original, r"start_date=\d{4}-\d{2}-\d{2}", "start_date=2020-01-01")
    cases.append(("窗口跑完仍未达标 -> BURND_BEHIND", overdue, None, {"BURND_BEHIND"}))

    # 5. 路线图数字与实测不符 -> BURND_DOC_DRIFT
    doc = tmp / "roadmap.md"
    src_doc = ROADMAP.read_text(encoding="utf-8", errors="ignore") if ROADMAP.exists() else ""
    doc.write_text(src_doc.replace("| 643 |", "| 999 |"), encoding="utf-8")
    cases.append(("路线图数字漂移 -> BURND_DOC_DRIFT", original, str(doc), {"BURND_DOC_DRIFT"}))

    for name, plan_text, doc_override, expected in cases:
        plan_file = tmp / "plan.txt"
        plan_file.write_text(plan_text, encoding="utf-8")
        saved = os.environ.get("BURND_DOC_PATH")
        try:
            if doc_override:
                os.environ["BURND_DOC_PATH"] = doc_override
            elif saved is not None:
                os.environ.pop("BURND_DOC_PATH")
            errors, _ = check_raw(plan_file, today)
            got = {e.split()[0] for e in errors if e.split()}
            if not (expected & got):
                print(f"  FAIL {name}：未因 {sorted(expected)} 变红（实得 {sorted(got)}）")
                ok = False
            else:
                print(f"  OK   {name} -> {sorted(expected & got)}")
        finally:
            os.environ.pop("BURND_DOC_PATH", None)
            if saved is not None:
                os.environ["BURND_DOC_PATH"] = saved

    print("self-test PASS" if ok else "self-test FAILED: 判据失效")
    return 0 if ok else 2


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--self-test" in args:
        raise SystemExit(self_test())
    plan_path = PLAN
    if "--plan" in args:
        i = args.index("--plan")
        if i + 1 >= len(args):
            print("用法：--plan <path>")
            raise SystemExit(2)
        plan_path = Path(args[i + 1])
    raise SystemExit(check(plan_path))
