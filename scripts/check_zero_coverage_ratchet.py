#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_zero_coverage_ratchet.py — 零行覆盖文件数棘轮（只允许收缩）

存在的理由：本仓库此前用 functions / branches 两个百分比当覆盖率门禁，而它们是
**可以被"什么都不做"满足**的指标。实测（2026-10-01，unit-only 腿）：707 个被统计文件里
646 个（91.4%）行覆盖为 0，这些文件仍各自往 functions / branches 计数器贡献条目，
把全库 functions 抬到 58.73%、branches 抬到 73.92%；而只看那 61 个真有行被跑到的文件，
functions 真值只有 46.86%（164/350）。

本脚本改用"清单"口径：一个源文件要么被测到，要么在基线里占一行并被人看见。

红因（--self-test 会逐条断言红因，不只断言"变红"）：
  NEW_ZERO       出现基线外的 0 行文件 —— 新代码没带测试
  STALE_COVERED  基线文件已被测到 —— 那行该删，否则下轮退化看不出来
  STALE_GHOST    基线文件在磁盘上已不存在 —— 幽灵条目，永远等不到变绿还白占额度
  MISSING_ARTIFACT  找不到 coverage-summary.json —— --coverage 没跑或路径变了

用法：
  python scripts/check_zero_coverage_ratchet.py            # CI 校验
  python scripts/check_zero_coverage_ratchet.py --emit     # 收紧后刷新基线
  python scripts/check_zero_coverage_ratchet.py --self-test

退出码：0 通过；1 失败。
"""

import json
import sys
from pathlib import Path

BASELINE_REL = "scripts/zero-coverage-baseline.txt"
SUMMARY_REL = "web/coverage/coverage-summary.json"
HEADER_MARK = "#"
SHOW = 15


def rel_from_web(abs_path):
    """coverage-summary 的键是绝对路径（Windows 用反斜杠）→ 统一成相对 web/ 的正斜杠路径。"""
    q = abs_path.replace("\\", "/")
    i = q.find("/web/")
    return q[i + 5:] if i >= 0 else q


def zero_files(summary_obj):
    out = set()
    for key, val in summary_obj.items():
        if key == "total":
            continue
        if val.get("lines", {}).get("pct", 0) == 0:
            out.add(rel_from_web(key))
    return out


def load_baseline(path):
    rows = set()
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s and not s.startswith(HEADER_MARK):
            rows.add(s)
    return rows


def _lst(items):
    nl = chr(10) + " " * 6
    joined = nl.join(items[:SHOW])
    more = nl + "…" if len(items) > SHOW else ""
    return nl + joined + more


def check(zero, baseline, web_root=None):
    """纯比较，返回 [(code, msg)]。带红因码，自检才能验"因何而红"。

    web_root 给定时把 STALE 拆两种：从基线掉出去的名字，既可能是"终于被测到了"
    （好事，删行收紧），也可能是"文件被改名/删除"（幽灵条目，永远等不到变绿，
    还白占豁免额度）。两者处置不同，不能混成一句话。
    """
    failures = []
    new_zero = sorted(zero - baseline)
    stale = sorted(baseline - zero)

    if new_zero:
        failures.append(("NEW_ZERO", "%d 个文件 0 行覆盖且不在基线"
                         "（新代码要么带测试，要么显式加进基线并说明理由）：%s"
                         % (len(new_zero), _lst(new_zero))))
    if stale:
        if web_root is None:
            failures.append(("STALE", "%d 个基线文件已不在零覆盖集合，请删掉对应行：%s"
                             % (len(stale), _lst(stale))))
        else:
            covered = [f for f in stale if (web_root / f).exists()]
            ghost = [f for f in stale if not (web_root / f).exists()]
            if covered:
                failures.append(("STALE_COVERED", "%d 个基线文件已被测到，请删掉对应行让基线收紧"
                                 "（留着会让下一轮的退化看不出来）：%s"
                                 % (len(covered), _lst(covered))))
            if ghost:
                failures.append(("STALE_GHOST", "%d 个基线文件在磁盘上已不存在（改名或删除），"
                                 "这些行永远等不到变绿、还白占豁免额度，请删掉：%s"
                                 % (len(ghost), _lst(ghost))))
    return failures


def inflation(summary_obj):
    """全库口径 vs 只看有覆盖文件的口径 —— 让"百分比为何不可信"留在 CI 日志里。"""
    keys = [k for k in summary_obj if k != "total"]
    nz = [k for k in keys if summary_obj[k]["lines"]["pct"] > 0]
    cf = sum(summary_obj[k]["functions"]["total"] or 0 for k in nz)
    cc = sum(summary_obj[k]["functions"]["covered"] or 0 for k in nz)
    tot = summary_obj["total"]
    return {
        "files": len(keys), "zero": len(keys) - len(nz),
        "pct_zero": (100.0 * (len(keys) - len(nz)) / len(keys)) if keys else 0.0,
        "reported_functions": tot["functions"]["pct"],
        "real_functions": (100.0 * cc / cf) if cf else 0.0,
        "real_frac": "%d/%d" % (cc, cf),
        "universe_covered_files": len(nz),
    }


def self_test():
    """注入式自检。教训来自上一道门禁：fixture 把 @@map 写成 @map，四条变异全因同一个
    原因变红，看着 5/5 实则一条没测到。所以这里断言的是**红因集合相等**，不是"红了"，
    也不是"包含某个红因"——后者会让一条变异顶着另一条的原因冒充通过。"""
    import tempfile
    from pathlib import Path as _P

    tmp = _P(tempfile.mkdtemp())
    (tmp / "a.ts").write_text("x")
    (tmp / "b.ts").write_text("x")
    # c.ts 故意不创建：它在基线里代表"文件被改名/删除后留下的幽灵条目"
    base = frozenset({"a.ts", "b.ts", "c.ts"})

    cases = [
        ("闭合（零集合 == 基线）", {"a.ts", "b.ts", "c.ts"}, set()),
        ("新增零覆盖文件", {"a.ts", "b.ts", "c.ts", "d.ts"}, {"NEW_ZERO"}),
        ("基线条目已被测到", {"b.ts", "c.ts"}, {"STALE_COVERED"}),
        ("基线幽灵条目(文件不存在)", {"a.ts", "b.ts"}, {"STALE_GHOST"}),
        ("新增与已测并存", {"a.ts", "d.ts"}, {"NEW_ZERO", "STALE_COVERED", "STALE_GHOST"}),
        ("全部收编", set(), {"STALE_COVERED", "STALE_GHOST"}),
    ]
    bad = 0
    for label, zero, want in cases:
        codes = set(c for c, _ in check(zero, base, tmp))
        ok = codes == want
        bad += 0 if ok else 1
        note = "" if ok else "   <-- 实际红因 " + str(sorted(codes))
        print("  [" + ("OK " if ok else "BAD") + "] " + label + ": 期望 "
              + (str(sorted(want)) if want else "通过") + note)
    print("自检结果: " + ("全部符合预期" if bad == 0 else str(bad) + " 项失效"))
    return 0 if bad == 0 else 1


def main():
    argv = sys.argv[1:]
    if "--self-test" in argv:
        print("== 注入式自检（合成零集合 + 临时目录当真 web_root）==")
        return self_test()

    root = Path(__file__).resolve().parent.parent
    summary_p = root / SUMMARY_REL
    baseline_p = root / BASELINE_REL

    if not summary_p.exists():
        print("FAIL [MISSING_ARTIFACT] 找不到 " + SUMMARY_REL)
        print("  这一档必须排在 `npx vitest run tests/unit --coverage` 之后（CI 的 coverage job 已按此顺序）。")
        return 1

    obj = json.loads(summary_p.read_text(encoding="utf-8"))
    zero = zero_files(obj)

    if "--emit" in argv:
        lines = []
        if baseline_p.exists():
            for l in baseline_p.read_text(encoding="utf-8").splitlines():
                if l.startswith(HEADER_MARK):
                    lines.append(l.rstrip())
                else:
                    break
        body = sorted(zero)
        baseline_p.write_text("\n".join(lines + body) + "\n", encoding="utf-8")
        print("已重写基线：%d 行（表头 %d 行）" % (len(body), len(lines)))
        return 0

    baseline = load_baseline(baseline_p)
    inf = inflation(obj)
    print("被统计文件 %d，其中 0 行覆盖 %d（%.1f%%）" % (inf["files"], inf["zero"], inf["pct_zero"]))
    print("口径对比：全库 functions 报 %.2f%%，只看有行被跑到的 %d 个文件实为 %.2f%%（%s）"
          % (inf["reported_functions"], inf["universe_covered_files"],
             inf["real_functions"], inf["real_frac"]))
    print("基线登记 %d 行" % len(baseline))

    failures = check(zero, baseline, root / "web")
    if failures:
        print("")
        print("FAIL: 零行覆盖棘轮不闭合")
        for code, msg in failures:
            print("  - [" + code + "] " + msg)
        print("")
        print("收紧后刷新基线：python scripts/check_zero_coverage_ratchet.py --emit")
        return 1
    print("PASS: 零行覆盖集合与基线完全一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
