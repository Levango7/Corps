#!/usr/bin/env python3
"""
check_permission_gates.py — 角色权限矩阵落地缺口门禁（三档，均只允许收缩）

背景：lib/permissions.ts 声明了 owner/admin/member/viewer 的角色矩阵（viewer 全只读），
但写接口只有少数调用 requirePermission，导致"声明"与"执行"脱节。

判定口径是 **handler 级**而非文件级：同一文件里 DELETE 有门禁、PATCH 没有的情形真实存在，
按文件统计会把这类缺口算成"已覆盖"（本仓库真实存在此情形）。

三档划分（关键改动：把"扫描盲区"变成"显式挂账"，不让门禁只对它看得见的那部分负责）：

  T1 MATRIX_NONE     矩阵可判定域内、**完全没有任何角色判断**的写 handler → 真缺口。
  T2 MATRIX_ADHOC    矩阵可判定域内、只有 ad-hoc 角色比较而没走矩阵的写 handler。
                     → 不算已覆盖：宽松匹配同样命中"校验目标对象角色"的写法
                     （会话成员 role、被加入会话者 role 等），这类接口实际可能零门禁。
  T3 UNSCOPED_NONE   矩阵未定义该资源域（databases / approvals / ai / okr …）且**完全无角色判断**
                     的写 handler → 只读成员在这些域上的可写面，未评估、挂账防增长。
  T4 UNSCOPED_ADHOC  矩阵外、但有 ad-hoc 角色判断 → 待产品定义矩阵模块后再收敛到 requirePermission。

口径修正记录（2026-09-29）：旧版只扫 `v1/workspaces/[wid]`，且把 `role ===` 当唯一门禁信号，
于是 `if (!["owner","admin"].includes(ctx.member.role))` 这类**真实存在的 ad-hoc 门禁**
被误判为缺口——旧基线的 44 条里 35 条属此类（T2），真零判断只有 9 条（T1）。
反向问题更严重：矩阵域外的 243 个写 handler 旧版根本不看（T3/T4）。

扫描根：web/app/api/**（此前只扫 v1/workspaces/[wid]，矩阵域外 100+ 个写 handler 完全不可见）。
T3 排除内部端点（cron 调度、探活、Better Auth 托管、上传代理、兜底路由），口径与
check_api_contract.py 的 INTERNAL_PREFIXES 一致。

语义排除（三档共用）：标记已读类（*/read）与分享解锁类（*/share/verify）——
按矩阵一刀切会把 viewer 的"标已读"也 403 掉，属误伤，故显式跳过并在此说明。

运行方式：
    python scripts/check_permission_gates.py
    python scripts/check_permission_gates.py --write-baselines   # 重建三档基线

退出码：
    0 — 三档缺口集合与各自基线一致或已收缩
    1 — 任一档出现基线之外的新增，或基线里有已修复项未删除（豁免腐烂）
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_ALL = ROOT / "web" / "app" / "api"
BASELINE_T1 = ROOT / "scripts" / "permission-gate-baseline.txt"
BASELINE_T2 = ROOT / "scripts" / "permission-gate-adhoc-baseline.txt"
BASELINE_T3 = ROOT / "scripts" / "permission-gate-unscoped-baseline.txt"
BASELINE_T4 = ROOT / "scripts" / "permission-gate-unscoped-adhoc-baseline.txt"

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

# 语义排除：静态路径片段命中即跳过（见模块 docstring）
EXCLUDED_TAILS = (("read",), ("share", "verify"))

# 与 check_api_contract.py 的 INTERNAL_PREFIXES 同口径：不是面向前后端契约的业务写接口
INTERNAL_PREFIXES = ("/api/cron/", "/api/health", "/api/auth/", "/api/uploads/")
INTERNAL_EXACT = ("/api/[...path]",)

# T1/T2 分流用的严格信号：确实调用了矩阵
STRICT_RE = re.compile(r"requirePermission\s*\(|checkPermission\s*\(")
# 宽松信号：任何角色字面量比较或角色数组 includes
LOOSE_RE = re.compile(
    r"\brole\s*(?:===|!==|==|!=)\s*[\"']"
    r"|\[\s*\"owner\"\s*,\s*\"admin\"\s*\]"
    r"|\brole\b[^;\n]{0,60}\.includes\s*\("
)

START_RE = re.compile(r"^\s*export\s+async\s+function\s+(%s)\b" % "|".join(WRITE_METHODS))


def normalize(route: Path) -> tuple[str, list[str], bool]:
    """route.ts → (归一化 URL 路径, 静态片段列表, 是否位于 workspaces/[wid] 之下)。

    路由组 `(group)` 不产生 URL 段；`[id]` / `[...slug]` 统一转 `{id}`（与契约口径一致）。
    """
    parts = list(route.relative_to(API_ALL).parts)[:-1]  # 去掉 route.ts 本身
    in_wid = (
        len(parts) >= 3
        and parts[0] == "v1"
        and parts[1] == "workspaces"
        and parts[2] == "[wid]"
    )
    segs, static_core = [], []
    for p in parts:
        if p.startswith("(") and p.endswith(")"):
            continue
        m = re.fullmatch(r"\[+\.{0,3}(\w+)\]+", p)
        if m:
            segs.append("{%s}" % m.group(1))
        else:
            segs.append(p)
            static_core.append(p)
    return "/api/" + "/".join(segs), static_core, in_wid


def handler_blocks(src: str) -> list[tuple[str, str]]:
    """按 `export async function <METHOD>` 切出每个写 handler 的代码块。"""
    lines = src.split("\n")
    starts = [(m.group(1), i) for i, line in enumerate(lines) if (m := START_RE.match(line))]
    blocks = []
    for idx, (method, start) in enumerate(starts):
        end = starts[idx + 1][1] if idx + 1 < len(starts) else len(lines)
        blocks.append((method, "\n".join(lines[start:end])))
    return blocks


def is_internal(path: str) -> bool:
    return path in INTERNAL_EXACT or any(path.startswith(p) for p in INTERNAL_PREFIXES)


def classify() -> dict[str, set[str]]:
    tiers: dict[str, set[str]] = {"t1": set(), "t2": set(), "t3": set(), "t4": set()}
    if not API_ALL.is_dir():
        print(f"ERROR: 未找到 {API_ALL}", file=sys.stderr)
        sys.exit(1)

    for route in sorted(API_ALL.rglob("route.ts")):
        path, static_core, in_wid = normalize(route)
        if is_internal(path):
            continue
        # 标记已读 / 分享解锁不属于"写租户内容"
        if any(
            len(static_core) >= len(t) and tuple(static_core[-len(t):]) == t
            for t in EXCLUDED_TAILS
        ):
            continue

        # [wid] 是动态段、不进 static_core，因此资源段固定落在索引 2：
        # static_core = ['v1', 'workspaces', '<资源段>', ...]
        # （路由组 (group) 同样被跳过，所以有/无路由组都成立）
        first = static_core[2] if in_wid and len(static_core) >= 3 else ""
        in_matrix = in_wid and first in MODULE_BY_SEGMENT

        src = route.read_text(encoding="utf-8")
        for method, block in handler_blocks(src):
            entry = f"{method} {path}"
            if STRICT_RE.search(block):
                continue  # 已接矩阵
            if LOOSE_RE.search(block):
                tiers["t2" if in_matrix else "t4"].add(entry)
            else:
                tiers["t1" if in_matrix else "t3"].add(entry)
    return tiers


def load_baseline(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        ln.strip()
        for ln in path.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    }


TIER_META = {
    "t1": (
        "矩阵域内完全无角色判断（真缺口）",
        BASELINE_T1,
        "修法：在该 handler 认证之后加 requirePermission(ctx, <module>, <action>, req) 并短路返回。",
    ),
    "t2": (
        "矩阵域内仅有 ad-hoc 角色比较（需人工复核）",
        BASELINE_T2,
        "修法：确认比较的是**调用者**角色（ctx.member.role / 本人的 membership.role）后改为 requirePermission；"
        "若比较的是目标对象角色（被加入会话者、被改角色者），该写接口实际零门禁，按 T1 补。",
    ),
    "t3": (
        "矩阵外资源域、完全无角色判断（只读成员可写面，未评估）",
        BASELINE_T3,
        "修法：先在 lib/permissions.ts 的 MODULES 里定义该资源应有权限并接 requirePermission，"
        "再从基线删除；新增未评估的写接口会直接 CI 失败。",
    ),
    "t4": (
        "矩阵外资源域、有 ad-hoc 角色判断（待收敛到矩阵）",
        BASELINE_T4,
        "修法：该资源域进入矩阵后，把 ad-hoc 比较替换为 requirePermission 并从基线删除。",
    ),
}


def write_baselines(tiers: dict[str, set[str]]) -> int:
    """只生成 T2/T3/T4。T1 基线由人工维护（它的表头记录了矩阵判定口径与排除语义，
    且规则要求"修好一条就删一行"，机器整体覆写会抹掉这些说明并掩盖豁免扩大）。"""
    for key in ("t2", "t3", "t4"):
        entries = tiers[key]
        title, path, hint = TIER_META[key]
        path.write_text(
            "# 由 `python scripts/check_permission_gates.py --write-baselines` 生成（只允许收缩）\n"
            f"# 档位：{title}\n# {hint}\n# 判定口径为 handler 级；重建本文件前请逐条确认语义。\n"
            + "\n".join(sorted(entries))
            + "\n",
            encoding="utf-8",
        )
        print(f"wrote {path.name}: {len(entries)} 条")
    return 0


def main() -> int:
    if "--write-baselines" in sys.argv[1:]:
        return write_baselines(classify())

    tiers = classify()
    failed = False
    print(f"{'档':<4} {'当前':>5} {'基线':>5} {'新增':>5} {'已修未删':>8}  状态")
    for key in ("t1", "t2", "t3", "t4"):
        title, path, _ = TIER_META[key]
        gaps, base = tiers[key], load_baseline(path)
        if not path.exists():
            print(f"{key.upper():<4} 基线缺失 → FAIL（生成：--write-baselines）")
            failed = True
            continue
        grown = sorted(gaps - base)
        stale = sorted(base - gaps)
        status = "PASS" if not grown and not stale else "FAIL"
        print(
            f"{key.upper():<4} {len(gaps):>5} {len(base):>5} {len(grown):>5} {len(stale):>8}  {status}"
        )
        for label, items in (("新增", grown), ("已修复未删除（豁免腐烂）", stale)):
            if items:
                failed = True
                print(f"  {title} — {label} {len(items)} 条：")
                for it in items:
                    print(f"      {it}")

    print()
    if failed:
        for key in ("t1", "t2", "t3", "t4"):
            print(TIER_META[key][2])
        return 1
    print("PASS: 四档权限门禁盲区均未增长。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
