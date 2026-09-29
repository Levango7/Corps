#!/usr/bin/env python3
"""
check_permission_gates.py — 角色权限矩阵落地缺口门禁（五档，均只允许收缩）

背景：lib/permissions.ts 声明了 owner/admin/member/viewer 的角色矩阵（viewer 全只读），
但写接口只有少数调用 requirePermission，导致"声明"与"执行"脱节。

判定口径是 **handler 级**而非文件级：同一文件里 DELETE 有门禁、PATCH 没有的情形真实存在，
按文件统计会把这类缺口算成"已覆盖"（本仓库真实存在此情形）。

五档划分（关键改动：把"扫描盲区"变成"显式挂账"，不让门禁只对它看得见的那部分负责）：

  T1 MATRIX_NONE     矩阵可判定域内、**完全没有任何角色判断**的写 handler → 真缺口。
  T2 MATRIX_ADHOC    矩阵可判定域内、只有 ad-hoc 角色比较而没走矩阵的写 handler。
                     → 不算已覆盖：宽松匹配同样命中"校验目标对象角色"的写法
                     （会话成员 role、被加入会话者 role 等），这类接口实际可能零门禁。
  T3 UNSCOPED_NONE   矩阵未定义该资源域（databases / approvals / ai / okr …）且**完全无角色判断**
                     的写 handler → 只读成员在这些域上的可写面，未评估、挂账防增长。
  T4 UNSCOPED_ADHOC  矩阵外、但有 ad-hoc 角色判断 → 待产品定义矩阵模块后再收敛到 requirePermission。
  T5 MODULE_UNWIRED  permissions.ts 的 MODULES 里声明了、但生产代码**零 requirePermission 调用点**
                     的模块 → 矩阵对这些模块的约束只是声明。这是本项目反复出现的形态在本脚本里的
                     落点："函数正确 ≠ 函数被调用"，此处为"模块存在 ≠ 模块被接线"。

模块清单的**唯一真源是 web/lib/permissions.ts 的 MODULES**（运行时解析，不复制）；
`MODULE_BY_SEGMENT` 只做"路径段 → 模块名"映射，启动时校验映射目标都存在，否则 exit 2。
理由：同一事实声明两遍、只改一处必烂另一处——2026-09-30 的覆盖率阈值红就是同形问题
（CI 的 coverage job 用 CLI 3.5%，而 vitest.config.ts 里还留着没人同步的 20%）。

口径修正记录：
  2026-09-29  旧版只扫 `v1/workspaces/[wid]`，且把 `role ===` 当唯一门禁信号，于是
    `if (!["owner","admin"].includes(ctx.member.role))` 这类**真实存在的 ad-hoc 门禁**被误判为缺口——
    旧基线 44 条里 11 条属此类（迁 T2），真零判断 33 条（T1）。反向问题更大：矩阵域外的写 handler
    旧版一个都不看。扫描根因此扩到 `web/app/api/**`。
    同日的**首轮计数 9/194 是错的**：资源段索引取 3（应为 2，因 `[wid]` 与路由组不进 static_core），
    深层路由按叶子段误判档位。该错由注入式变异测试抓出，非肉眼复核。
  2026-09-30  MODULES 由 12 扩到 14（新增 databases、databaseRecords）后，本脚本改为读真源；
    多维表格 9 个容器/字段/视图写 handler 由 T4 正确落回 T2（20 → 29，T4 33 → 24）。

T3 排除内部端点（cron 调度、探活、Better Auth 托管、上传代理、兜底路由），口径与
check_api_contract.py 的 INTERNAL_PREFIXES 一致。

语义排除（各档共用）：标记已读类（*/read）与分享解锁类（*/share/verify）——
按矩阵一刀切会把 viewer 的"标已读"也 403 掉，属误伤，故显式跳过并在此说明。

运行方式：
    python scripts/check_permission_gates.py
    python scripts/check_permission_gates.py --write-baselines   # 只重建 T3/T4/T5

退出码：
    0 — 五档集合与各自基线一致或已收缩
    1 — 任一档出现基线之外的新增、基线里有已修复项未删除（豁免腐烂），
        或代码调用了矩阵中不存在的模块名（unknown，必须清零、不配基线）
    2 — 无法从 permissions.ts 解析 MODULES，或 MODULE_BY_SEGMENT 指向不存在的模块
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
BASELINE_T5 = ROOT / "scripts" / "permission-gate-modules-unwired-baseline.txt"

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
    # 多维表格在矩阵里是**两个**模块（容器 vs 记录数据面），按路径段区分：
    # /databases、/databases/{dbid}、/databases/{dbid}/fields|views → databases
    # /databases/{dbid}/records[...]                                       → databaseRecords
    "databases": "databases",
}

# 矩阵里"合法模块名"的唯一真源是 web/lib/permissions.ts 的 MODULES 常量。
# 本脚本**不复制**那份清单——否则又造出一个"同一事实两处声明、改一处烂一处"的债
# （2026-09-30 覆盖率阈值就是这么红的）。这里只做"路径段 → 模块名"的映射，
# 并校验映射结果确实存在于 MODULES，不存在即报错退出。
PERMISSIONS_TS = ROOT / "web" / "lib" / "permissions.ts"


def load_matrix_modules() -> set[str]:
    src = PERMISSIONS_TS.read_text(encoding="utf-8")
    m = re.search(r"export const MODULES = \[(.*?)\]\s*as const", src, re.S)
    if not m:
        print(
            f"ERROR: 无法在 {PERMISSIONS_TS} 中解析 `export const MODULES = [...] as const`；"
            "矩阵模块清单改了写法，本脚本的判定口径需要跟着改（不要静默当作没有模块）。",
            file=sys.stderr,
        )
        sys.exit(2)
    mods = set(re.findall(r"[\"'](\w+)[\"']", m.group(1)))
    if not mods:
        print("ERROR: MODULES 解析结果为空，拒绝继续（空集合会让所有路由都被判为矩阵外）", file=sys.stderr)
        sys.exit(2)
    return mods


def resolve_module(static_core: list[str], in_wid: bool) -> str | None:
    """返回该路由归属的矩阵模块名；不在矩阵里则返回 None。"""
    if not in_wid or len(static_core) < 3:
        return None
    first = static_core[2]
    seg = MODULE_BY_SEGMENT.get(first)
    if seg is None:
        return None
    if first == "databases" and "records" in static_core:
        return "databaseRecords"
    return seg


MATRIX_MODULES = load_matrix_modules()

# 映射表与真源的一致性检查：MODULE_BY_SEGMENT 指到矩阵里没有的模块名，
# 说明 permissions.ts 改了模块而这里没跟上——此时必须报错，不能把该域静默降级为"矩阵外"。
_unknown = sorted({m for m in MODULE_BY_SEGMENT.values()} - MATRIX_MODULES)
if _unknown:
    print(
        f"ERROR: MODULE_BY_SEGMENT 指向矩阵中不存在的模块 {_unknown}；"
        f"请同步 web/lib/permissions.ts 的 MODULES（当前 {len(MATRIX_MODULES)} 个）。",
        file=sys.stderr,
    )
    sys.exit(2)

WRITE_METHODS = ("POST", "PATCH", "PUT", "DELETE")

# 语义排除：静态路径片段命中即跳过（见模块 docstring）
EXCLUDED_TAILS = (("read",), ("share", "verify"))

# 与 check_api_contract.py 的 INTERNAL_PREFIXES 同口径：不是面向前后端契约的业务写接口
INTERNAL_PREFIXES = ("/api/cron/", "/api/health", "/api/auth/", "/api/uploads/")
INTERNAL_EXACT = ("/api/[...path]",)

# T1/T2 分流用的严格信号：确实调用了矩阵
STRICT_RE = re.compile(r"requirePermission\s*\(|checkPermission\s*\(")
# 宽松信号：任何角色字面量比较、角色数组白名单、或 helper 式授权判定。
# 三条补充各对应一次实测漏判（漏判的后果是把已接授权的路记成"零判断"缺口，
# 久而久之没人相信这份清单）：
#   1) 角色白名单元素个数不固定（["owner","admin"] / ["owner","admin","member"] 都有），
#      原先写死两元素的正则对三元素数组失效；
#   2) `.includes(ctx.member.role)` 里 role 在**右操作数**，原先只认 `role ... .includes(` 这一方向；
#   3) 授权判断被抽成 helper（canManageDoc / checkDocumentPermission / hasPermission 等），
#      文件内根本不出现 role 字样。documents/{id}/permissions 与 share-links 全族即属此类。
LOOSE_RE = re.compile(
    r"\brole\s*(?:===|!==|==|!=)\s*[\"']"
    r"|\[[^\]]*\"(?:owner|admin|member|viewer)\"[^\]]*\]\s*\.includes\s*\("
    r"|\.includes\s*\(\s*[\w.]*\.role\b"
    r"|\b(?:canManage|canView|canEdit|checkDocumentPermission|hasPermission|assertRole|ensureRole)\w*\s*\("
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


def find_wired_modules() -> tuple[set[str], list[str]]:
    """扫全仓 requirePermission 调用，返回 (被用到的模块名, 用到但矩阵未声明的模块名)。

    必须剔除注释：注释里写到 `requirePermission("tasks","delete")` 这种说明语，
    会被朴素正则当成真实调用点，从而把动作名 `"delete"` 误读成模块名并误报"未知模块"
    （实测命中：tasks/[id]/route.ts:99 的口径对齐注释）。判定方式是"匹配点之前同一行
    已有 // 就跳过"，同时要求匹配片段本身不跨注释。
    """
    used: set[str] = set()
    call_re = re.compile(r"requirePermission\s*\(\s*[^,]+,\s*[\"'](\w+)[\"']")
    targets = list(API_ALL.rglob("route.ts")) + list((ROOT / "web" / "lib").rglob("*.ts"))
    for p in targets:
        txt = p.read_text(encoding="utf-8", errors="ignore")
        for m in call_re.finditer(txt):
            span = m.group(0)
            if "//" in span:
                continue
            line_start = txt.rfind("\n", 0, m.start()) + 1
            if "//" in txt[line_start : m.start()]:
                continue
            used.add(m.group(1))
    return used, sorted(used - MATRIX_MODULES)


def check_module_wiring() -> tuple[list[str], list[str], list[str]]:
    """矩阵与接线的双向一致性：
      unwired = 矩阵声明了但生产代码 0 调用点 → "viewer 只读"对这些模块只是声明；
      unknown = 代码传了矩阵里没有的模块名 → checkPermission 的
                `DEFAULT_PERMISSIONS[role]?.[module] ?? ""` 恒判无权限，除 owner 外一律 403，
                等于把接口对普通成员永久关死（多为拼写错误/模块改名后调用点没跟上）。
    两者都必须只允许收缩，且 unknown 为空集时才算健康（不配基线：它只可能是缺陷，不可能是债务）。
    """
    used, unknown = find_wired_modules()
    return sorted(MATRIX_MODULES - used), unknown, sorted(used & MATRIX_MODULES)


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
        module = resolve_module(static_core, in_wid)
        in_matrix = module is not None and module in MATRIX_MODULES

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
    "t5": (
        "矩阵声明了但生产代码零调用点的模块（声明未接线）",
        BASELINE_T5,
        "修法：给该模块的写 handler 接上 requirePermission(ctx, <该模块>, <action>, req) 后，从基线删除该行。",
    ),
}


def write_baselines(tiers: dict[str, set[str]]) -> int:
    """只生成 T3/T4/T5。
    T1 与 T2 **禁止机器覆写**：T1 表头记录矩阵判定口径与排除语义，T2 表头记录逐条人工复核结论
    （按轴归类、哪些改动会放宽权限）。机器覆写会把这两份结论静默抹掉——2026-09-30 实测发生过一次，
    `--write-baselines` 把 T2 的复核表头冲成了通用表头。规则：修好一条就手工删一行。"""
    unwired, _, _ = check_module_wiring()
    tiers = dict(tiers)
    tiers["t5"] = {f"MODULE {name}" for name in unwired}
    for key in ("t3", "t4", "t5"):
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
    unwired, unknown, wired = check_module_wiring()
    tiers["t5"] = {f"MODULE {name}" for name in unwired}
    failed = False
    print(f"{'档':<4} {'当前':>5} {'基线':>5} {'新增':>5} {'已修未删':>8}  状态")
    for key in ("t1", "t2", "t3", "t4", "t5"):
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

    print(
        f"\n矩阵模块接线：声明 {len(MATRIX_MODULES)} 个，已接线 {len(wired)} 个，"
        f"零调用点 {len(unwired)} 个 {unwired}"
    )
    if unknown:
        print(
            f"FAIL: 代码调用了矩阵中不存在的模块 {unknown} —— checkPermission 对这些名字恒判无权限，"
            "除 owner 外所有成员都会拿到 403（多为模块改名/拼写后调用点未跟上）。此项不配基线，必须清零。"
        )
        failed = True

    print()
    if failed:
        for key in ("t1", "t2", "t3", "t4", "t5"):
            print(TIER_META[key][2])
        return 1
    print("PASS: 五档权限门禁盲区均未增长。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
