#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
V1 守卫残留棘轮 —— 只允许收缩。

背景：2026-10-08 的 authFailure 收口（4f877d1e / 35e56f73）把 115 处
`getWorkspaceContext` 换成判别联合版 `getWorkspaceContextV2`，让「有身份但无权」
不再被说成 401。但改造是分批的，全仓仍有 269 处在用 v1，这个数字此前只存在于
一次性的 Python 脚本里 —— **没人看得见，也没人守得住**，下一批随时可能半途而废，
或者新代码照着旧写法继续产出 v1。

本脚本就是给这个数字装闸门：
  - 基线外的新文件出现 v1 调用  -> NEW_V1
  - 已登记文件的 v1 数量变多    -> V1_REGRESSION
  - 已登记文件已收口却没删行    -> STALE_V1（"豁免腐烂"：不删行，数字就永远不会收紧）
  - 基线里的文件已被改名/删除  -> STALE_GHOST

口径（关键，别改）：
  只扫 **web/app/api 下的 .ts**。刻意不扫 lib/——那里是 v1 的**定义**
  （`export async function getWorkspaceContext(`）而不是调用，扫进去会把定义本身
  记成残留，永远归不了零。
  匹配 `\bgetWorkspaceContext\s*\(`：由于 `getWorkspaceContextV2(` 在名字后接的是
  `V2` 而不是 `(`，V2 调用天然不会被计入。

用法：
  python scripts/check_v1_guard_ratchet.py            # 检查（CI）
  python scripts/check_v1_guard_ratchet.py --emit     # 收紧后刷新基线
  python scripts/check_v1_guard_ratchet.py --self-test
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCAN_REL = "web/app/api"
BASELINE_REL = "scripts/v1-guard-baseline.txt"
HEADER_MARK = "#"

# 见文件头说明：V2 因名字后接 "V2" 而非 "(" 而天然不匹配
CALL_RE = re.compile(r"\bgetWorkspaceContext\s*\(")

DEFAULT_HEADER = """\
# V1 守卫残留基线 —— 只允许收缩
#
# 由 `python scripts/check_v1_guard_ratchet.py --emit` 生成/刷新。
# 每行格式：<相对 web/ 的路径> <该文件仍在调用 getWorkspaceContext 的处数>
#
# 语义：这里每一行都是一个**还在用 v1 守卫**的路由文件。
#   - 基线外的新文件出现 v1 调用 -> CI 失败（NEW_V1，新代码请用 V2 + authFailure）
#   - 已登记文件的 v1 处数变多   -> CI 失败（V1_REGRESSION，只许减少）
#   - 已登记文件已收口却没删行   -> CI 失败（STALE_V1，不删行数字就永远收紧不了）
#   - 基线里的文件已被改名/删除 -> CI 失败（STALE_GHOST）
#
# 为什么不用"总处数"一个数字：文件级清单才能定位到该改哪一行；
# 也只有强制删行（STALE_V1）才能防止豁免额度凭空腐烂。
#
# 只扫 web/app/api：lib/auth.ts 里是 v1 的**定义**而不是调用，扫进去会永远归不了零。
"""


def rel_from_web(abs_path, web_root):
    return str(abs_path.relative_to(web_root)).replace("\\", "/")


def scan(web_root):
    """返回 {相对 web/ 的路径: v1 调用处数}，只含 >0 的文件。"""
    root = Path(web_root) / SCAN_REL.replace("web/", "")
    out = {}
    if not root.exists():
        return out
    for p in sorted(root.rglob("*.ts")):
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        n = len(CALL_RE.findall(text))
        if n:
            out[rel_from_web(p, web_root)] = n
    return out


def _lst(items):
    return ", ".join(items)


def check(current, baseline, web_root=None):
    """返回 [(code, msg)]，空列表代表闭合。"""
    out = []
    for path, cnt in sorted(baseline.items()):
        if web_root is not None and not (Path(web_root) / path).exists():
            out.append((
                "STALE_GHOST",
                "%s 在基线里但文件已不存在（改名/删除后请把那一行删掉）" % path,
            ))
            continue
        now = current.get(path, 0)
        if now == 0:
            out.append((
                "STALE_V1",
                "%s 已收口（v1 残留 0），基线里的那一行请删掉——不删，数字就永远收紧不了" % path,
            ))
        elif now > cnt:
            out.append((
                "V1_REGRESSION",
                "%s v1 残留 %d -> %d（多了 %d 处，只许减少）" % (path, cnt, now, now - cnt),
            ))
    for path, cnt in sorted(current.items()):
        if path not in baseline:
            out.append((
                "NEW_V1",
                "%s 基线外出现 v1 残留 %d 处（新代码请用 getWorkspaceContextV2 + authFailure）"
                % (path, cnt),
            ))
    return out


def load_baseline(path):
    """读基线，返回 {path: count}；表头（# 开头）与空行跳过。"""
    out = {}
    if not Path(path).exists():
        return out
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith(HEADER_MARK):
            continue
        parts = line.split()
        if len(parts) != 2:
            raise SystemExit("基线行格式应为 '<相对 web 的路径> <残留数>'，实际: %r" % raw)
        out[parts[0]] = int(parts[1])
    return out


def self_test():
    """注入式自检。

    沿用本仓库既有约定：**断言红因集合相等**，不是"变红了"，也不是"包含某个红因"
    ——后者会让一条变异顶着另一条的原因冒充通过（教训见 check_zero_coverage_ratchet.py
    与 db-retry 的等价变异体事件）。
    """
    import tempfile
    from pathlib import Path as _P

    tmp = _P(tempfile.mkdtemp())
    (tmp / "a.ts").write_text("getWorkspaceContext(req, wid);", encoding="utf-8")
    (tmp / "b.ts").write_text("x", encoding="utf-8")
    # ghost.ts 故意不创建：代表"文件已改名/删除，基线却还留着一行"

    base = {"a.ts": 2, "b.ts": 1}
    base_ghost = {"a.ts": 2, "ghost.ts": 1}

    cases = [
        ("闭合（实测 == 基线）", base, {"a.ts": 2, "b.ts": 1}, set()),
        ("基线外新文件用 v1", base, {"a.ts": 2, "b.ts": 1, "d.ts": 1}, {"NEW_V1"}),
        ("已登记文件 v1 变多", base, {"a.ts": 5, "b.ts": 1}, {"V1_REGRESSION"}),
        ("已收口却没删基线行", base, {"a.ts": 2}, {"STALE_V1"}),
        ("基线幽灵条目（文件不存在）", base_ghost, {"a.ts": 2}, {"STALE_GHOST"}),
        ("三种问题并存", base, {"a.ts": 9, "d.ts": 1},
         {"NEW_V1", "V1_REGRESSION", "STALE_V1"}),
        ("全部收编", {"a.ts": 2, "b.ts": 1}, {}, {"STALE_V1"}),
    ]

    bad = 0
    for label, baseline, current, want in cases:
        codes = set(c for c, _ in check(current, baseline, tmp))
        ok = codes == want
        bad += 0 if ok else 1
        note = "" if ok else "   <-- 实际红因 " + _lst(sorted(codes))
        print("  [" + ("OK " if ok else "BAD") + "] " + label + ": 期望 "
              + (_lst(sorted(want)) if want else "通过") + note)
    print("自检结果: " + ("全部符合预期" if bad == 0 else "%d 项失效" % bad))
    return 0 if bad == 0 else 1


def main():
    argv = sys.argv[1:]
    if "--self-test" in argv:
        print("== 注入式自检（合成残留集合 + 临时目录当真 web_root）==")
        return self_test()

    web_root = ROOT / "web"
    baseline_p = ROOT / BASELINE_REL
    current = scan(web_root)

    if "--emit" in argv:
        header = []
        if baseline_p.exists():
            for l in baseline_p.read_text(encoding="utf-8").splitlines():
                if l.startswith(HEADER_MARK):
                    header.append(l.rstrip())
                else:
                    break
        if not header:
            header = DEFAULT_HEADER.splitlines()
        body = ["%s %d" % (p, n) for p, n in sorted(current.items())]
        baseline_p.write_text("\n".join(header + body) + "\n", encoding="utf-8")
        total = sum(current.values())
        print("已重写基线：%d 个文件 / %d 处残留（表头 %d 行）"
              % (len(body), total, len(header)))
        return 0

    baseline = load_baseline(baseline_p)
    if not baseline:
        print("基线为空或不存在：%s（先跑 --emit 生成）" % BASELINE_REL)
        return 1

    print("实测：%d 个文件仍有 v1 残留，合计 %d 处" % (len(current), sum(current.values())))
    print("基线：%d 个文件，合计 %d 处" % (len(baseline), sum(baseline.values())))

    failures = check(current, baseline, web_root)
    if failures:
        print("")
        print("FAIL: v1 守卫残留棘轮不闭合")
        for code, msg in failures:
            print("  - [" + code + "] " + msg)
        print("")
        print("收紧后刷新基线：python scripts/check_v1_guard_ratchet.py --emit")
        return 1
    print("PASS: v1 残留与基线一致，且没有出现新的 v1 调用。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
