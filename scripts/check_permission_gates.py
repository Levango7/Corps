#!/usr/bin/env python3
"""
check_permission_gates.py — 角色权限矩阵落地缺口门禁（只允许收缩）

背景：lib/permissions.ts 声明了 owner/admin/member/viewer 的角色矩阵（viewer 全只读），
但写接口只有少数调用 requirePermission，导致"声明"与"执行"脱节。

判定口径是 **handler 级**而非文件级：同一文件里 DELETE 有门禁、PATCH 没有，
按文件统计会把这种缺口算成"已覆盖"（本仓库真实存在此情形）。

只判定首段能映射到权限矩阵模块的路由（tasks/documents/... 共 12 个模块）；
其余资源不在矩阵内，本轮不臆断其应有权限。

排除项（语义上不是"写租户内容"）：
  - 标记已读类（*/read 的 POST/PATCH）
  - 分享解锁类（*/share/verify 的 POST）
这两类若按矩阵一刀切，viewer 连"标已读"都会被 403，属误伤，故显式跳过并在此说明。

运行方式：
    python scripts/check_permission_gates.py

退出码：
    0 — 缺口集合与基线一致或已收缩
    1 — 出现基线之外的新缺口，或基线里有已修复项未删除
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_ROOT = ROOT / "web" / "app" / "api" / "v1" / "workspaces" / "[wid]"
BASELINE = ROOT / "scripts" / "permission-gate-baseline.txt"

MODULE_BY_SEGMENT = {
    "tasks": "tasks",
    "decisions": "decisions",
    "documents": "documents",
    "conversations": "messages",
    "messages": "messages",
    "im": "messages",
    "members": "members",
    "billing": "billing",
    "analytics": "analytics",
    "settings": "settings",
    "whiteboards": "whiteboards",
    "timetrack": "timetrack",
    "time-entries": "timetrack",
    "announcements": "announcements",
    "contacts": "contacts",
    "labels": "tasks",
    "milestones": "tasks",
}

WRITE_METHODS = ("POST", "PATCH", "PUT", "DELETE")
METHOD_TO_ACTION = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}

# 语义排除：路径片段命中即跳过（见模块 docstring）
EXCLUDED_TAILS = (("read",), ("share", "verify"))

ROLE_GATE_RE = re.compile(
    r"requirePermission\s*\(|checkPermission\s*\(|\brole\s*(?:===|!==|==|!=)\s*[\"']"
)


def handler_spans(src: str) -> list[tuple[str, int, int]]:
    """返回 [(method, start_line_idx, end_line_idx)]，按 export async function <METHOD> 切块。"""
    lines = src.split("\n")
    starts = []
    for i, line in enumerate(lines):
        m = re.match(r"^\s*export\s+async\s+function\s+(%s)\b"
                     % "|".join(WRITE_METHODS), line)
        if m:
            starts.append((m.group(1), i))
    spans = []
    for idx, (method, start) in enumerate(starts):
        end = starts[idx + 1][1] if idx + 1 < len(starts) else len(lines)
        spans.append((method, start, end))
    return spans


def find_gaps() -> set[str]:
    gaps: set[str] = set()
    if not API_ROOT.is_dir():
        print(f"ERROR: 未找到 {API_ROOT}", file=sys.stderr)
        sys.exit(1)
    for route in sorted(API_ROOT.rglob("route.ts")):
        rel_parts = list(route.relative_to(API_ROOT).parts)
        first = rel_parts[0] if len(rel_parts) > 1 else ""
        module = MODULE_BY_SEGMENT.get(first)
        if not module:
            continue

        body_parts = rel_parts[:-1]  # 去掉 route.ts 本身
        core = [p for p in body_parts if not (p.startswith("[") and p.endswith("]"))]

        # 语义排除：标记已读 / 分享解锁不属于"写租户内容"
        if any(len(core) >= len(t) and tuple(core[-len(t):]) == t for t in EXCLUDED_TAILS):
            continue

        src = route.read_text(encoding="utf-8")
        all_lines = src.split("\n")
        for method, start, end in handler_spans(src):
            block = "\n".join(all_lines[start:end])
            if ROLE_GATE_RE.search(block):
                continue
            # 把 [x] 段归一化为 {x}，与 openapi/契约口径保持一致
            norm = "/api/v1/workspaces/{wid}/" + "/".join(
                ("{" + p[1:-1] + "}" if p.startswith("[") else p) for p in body_parts
            )
            gaps.add(f"{method} {norm}")
    return gaps


def load_baseline() -> set[str]:
    if not BASELINE.exists():
        return set()
    return {
        ln.strip()
        for ln in BASELINE.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    }


def main() -> int:
    gaps = find_gaps()
    base = load_baseline()

    print(f"未落地角色门禁的写 handler（矩阵可判定范围内）: {len(gaps)}")

    if not BASELINE.exists():
        print("\n基线不存在。生成用：")
        for g in sorted(gaps):
            print(g)
        print("\nFAIL: 需要 scripts/permission-gate-baseline.txt 才能防回归")
        return 1

    grown = sorted(gaps - base)
    stale = sorted(base - gaps)

    if grown:
        print(f"\nFAIL: 新增 {len(grown)} 个无角色门禁的写 handler：")
        for g in grown:
            print(f"  + {g}")
        print("\n修法：在该 handler 的认证之后加 "
              "requirePermission(ctx, <module>, <action>, req) 并短路返回。")
        return 1

    if stale:
        print(f"\nFAIL: 基线里有 {len(stale)} 条已修复项未删除（豁免腐烂）：")
        for s in stale:
            print(f"  - {s}")
        return 1

    print("PASS: 权限落地缺口未增长。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
