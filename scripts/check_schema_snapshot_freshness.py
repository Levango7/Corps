#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""db/schema.sql 快照新鲜度门禁。

为什么需要这道门禁（2026-10-25 实测发现的盲区）
------------------------------------------------
`db/schema.sql` 是给运维排障和 `runWithWorkspace` 守卫测试当权威参考的
schema 快照。实测发现它**落后最新迁移 1 个**：文件头自述「对应迁移
20261019000000_add_user_locale」，而 `web/prisma/migrations/` 下最新的是
`20261022000000_add_workspace_settings`（给 `workspaces` 加了 `settings` 列），
快照里搜不到任何 `settings`。

**而 `scripts/check_schema_migration_drift.py` 跑出来是 PASS 的** ——
它只管 Prisma schema ↔ migrations 的漂移，不覆盖这份快照。于是：
  - CI 全绿
  - 排障的人打开 schema.sql，拿到一张过期的地图
  - 守卫测试若以它为准，比对的是旧结构

这道门禁把那个缺口补上。

判据
----
读 `db/schema.sql` 头部注释里的「对应迁移: <14位时间戳>_<名字>」，
与 `web/prisma/migrations/` 下按字典序最新的目录名比对：

  SNAPSHOT_BEHIND    声明的迁移比最新迁移旧 —— 有新迁移没进快照
  SNAPSHOT_AHEAD     声明的迁移在 migrations 里不存在（快照超前/写错）
  SNAPSHOT_NO_MARKER 文件头找不到「对应迁移」声明 —— 无法判定
  SNAPSHOT_NO_MIGRATIONS  migrations 目录为空

为什么用「文件名比对」而不是「比对列」
  刷新快照的正确姿势是对空库应用全部迁移后 pg_dump，那是重活；
  而「声明滞后」这件事本身可以用一行元数据零成本发现。门禁的职责是
  **让陈旧立刻变红**，不是替人生成快照。

用法：
  python scripts/check_schema_snapshot_freshness.py            # CI 校验
  python scripts/check_schema_snapshot_freshness.py --list     # 只打印两边的迁移
  python scripts/check_schema_snapshot_freshness.py --self-test

退出码：0 通过；1 失败。
"""

from __future__ import annotations

import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_REL = "db/schema.sql"
MIGRATIONS_REL = "web/prisma/migrations"

# 「对应迁移」后面跟 14 位时间戳 + 下划线 + 迁移名。
# 冒号兼容半角/全角两种写法（本仓库注释习惯用全角）。
DECLARED_RE = re.compile(r"对应迁移\s*[::]\s*(\d{14}_[A-Za-z0-9_]+)")
MIGRATION_DIR_RE = re.compile(r"^\d{14}_[A-Za-z0-9_]+$")


def latest_migration(migrations_dir: Path) -> str | None:
    if not migrations_dir.is_dir():
        return None
    names = sorted(
        p.name for p in migrations_dir.iterdir() if p.is_dir() and MIGRATION_DIR_RE.match(p.name)
    )
    return names[-1] if names else None


def declared_migration(snapshot: Path) -> str | None:
    if not snapshot.is_file():
        return None
    m = DECLARED_RE.search(snapshot.read_text(encoding="utf-8", errors="replace"))
    return m.group(1) if m else None


def check(root: Path) -> tuple[int, list[str]]:
    """返回 (退出码, 输出行)。root 可指向临时夹具树，便于自测。"""
    snapshot = root / SNAPSHOT_REL
    migrations = root / MIGRATIONS_REL
    out: list[str] = []

    latest = latest_migration(migrations)
    declared = declared_migration(snapshot)

    out.append(f"[schema-snap] 快照声明对应迁移：{declared or '（找不到声明）'}")
    out.append(f"[schema-snap] migrations 最新迁移：{latest or '（目录为空或不存在）'}")

    if latest is None:
        out.append("")
        out.append("[schema-snap] ✗ 找不到任何迁移目录，判据失效 —— 这不是通过，是没法判。")
        out.append(f"    期望路径：{MIGRATIONS_REL}/<14位时间戳>_<名字>/")
        return 1, out
    if declared is None:
        out.append("")
        out.append("[schema-snap] ✗ db/schema.sql 头部缺少「对应迁移」声明，无法判定新鲜度。")
        out.append("    修复：在文件头注释里写明 `-- 对应迁移: <最新迁移目录名>`。")
        return 1, out
    if declared == latest:
        out.append("")
        out.append("[schema-snap] ✓ 通过：快照与最新迁移一致")
        return 0, out

    if declared > latest:
        out.append("")
        out.append(f"[schema-snap] ✗ 快照声明的迁移 {declared} 在 migrations 里不存在（超前或写错）。")
        return 1, out

    out.append("")
    out.append(f"[schema-snap] ✗ 快照落后：声明 {declared}，最新 {latest}。")
    out.append("")
    out.append("    影响：db/schema.sql 是排障与守卫测试的权威参考，它陈旧等于给一份过期地图，")
    out.append("    而 check_schema_migration_drift.py 不覆盖它，CI 不会因此变红。")
    out.append("")
    out.append("    修复（推荐，产出才是权威产物）：")
    out.append("      docker exec -i <pg容器> psql -U postgres -c 'CREATE DATABASE tmp_snap'")
    out.append("      docker exec -i <pg容器> psql -U postgres -d tmp_snap -q < db/schema.sql")
    out.append("      # 对该库依次应用 web/prisma/migrations/ 下声明之后的所有迁移")
    out.append("      docker exec <pg容器> pg_dump -U postgres -d tmp_snap --schema-only \\")
    out.append("        --no-owner --no-privileges --no-policies")
    out.append("      # 用 dump 结果替换 schema.sql 的表结构段（RLS 段保持来自 db/rls-activate.sql），")
    out.append("      # 并更新头部的「生成时间」与「对应迁移」")
    out.append("")
    out.append("    注意：pg_dump 重新序列化会改写 CHECK 约束的书写形式（语义不变），")
    out.append("    全量替换会产生大量无关 diff。若只差少数迁移，可只替换受影响的表，")
    out.append("    但必须用 pg_dump 的输出来替换，不要手写 DDL。")
    return 1, out


def self_test() -> int:
    """在临时夹具树上逐条断言，不只断言"会红"。"""
    cases: list[tuple[str, str, str, int, str]] = [
        # (用例名, 快照声明的迁移, migrations 里最新迁移, 期望退出码, 期望输出包含)
        ("一致应通过", "20260101000000_a", "20260101000000_a", 0, "通过"),
        ("落后一个应判红", "20260101000000_a", "20260202000000_b", 1, "快照落后"),
        ("超前/不存在应判红", "20260303000000_c", "20260101000000_a", 1, "超前"),
    ]
    failures: list[str] = []

    for name, declared, latest, want_rc, want_text in cases:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "db").mkdir(parents=True)
            (root / MIGRATIONS_REL).mkdir(parents=True)
            (root / MIGRATIONS_REL / latest).mkdir()
            (root / SNAPSHOT_REL).write_text(
                f"-- 对应迁移: {declared}\nCREATE TABLE t (id int);\n",
                encoding="utf-8",
            )
            rc, out = check(root)
            blob = "\n".join(out)
            if rc != want_rc:
                failures.append(f"{name}：期望退出码 {want_rc}，实得 {rc}")
            elif want_text not in blob:
                failures.append(f"{name}：输出未包含「{want_text}」")
            else:
                print(f"[schema-snap selftest] ✓ {name}")

    # 缺声明
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "db").mkdir(parents=True)
        (root / MIGRATIONS_REL / "20260101000000_a").mkdir(parents=True)
        (root / SNAPSHOT_REL).write_text("CREATE TABLE t (id int);\n", encoding="utf-8")
        rc, out = check(root)
        if rc == 1 and "对应迁移" in "\n".join(out):
            print("[schema-snap selftest] ✓ 缺声明应判红")
        else:
            failures.append("缺声明：期望退出码 1 且提示缺声明")

    # 没有 migrations 目录
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "db").mkdir(parents=True)
        (root / SNAPSHOT_REL).write_text("-- 对应迁移: 20260101000000_a\n", encoding="utf-8")
        rc, out = check(root)
        if rc == 1 and "判据失效" in "\n".join(out):
            print("[schema-snap selftest] ✓ 无迁移目录应判红且说明是判据失效")
        else:
            failures.append("无迁移目录：期望退出码 1 且提示判据失效")

    if failures:
        print("\n[schema-snap selftest] ✗ 自测失败：")
        for f in failures:
            print(f"    - {f}")
        return 1
    print("\n[schema-snap selftest] ✓ 全部通过")
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if "--self-test" in argv:
        return self_test()
    if "--list" in argv:
        print(f"声明：{declared_migration(ROOT / SNAPSHOT_REL)}")
        print(f"最新：{latest_migration(ROOT / MIGRATIONS_REL)}")
        return 0
    rc, out = check(ROOT)
    print("\n".join(out))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
