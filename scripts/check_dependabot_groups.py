#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_dependabot_groups.py — .github/dependabot.yml 的家族分组自检

背景（2026-11-04）：#257 是单个 `minor-and-patch` 组把 26 个跨 5 个家族的依赖挤进一个 PR——
没法按家族审、没法按家族回滚，而且 pnpm lockfileVersion 9 把 peer 版本嵌进依赖键
（`next@16.4.2(...)(@types/node@26.6.5)(...)`），于是 peer 键改写和真实升级混在同一次 diff 里。
改成按家族分组后，这份检查负责守住分组的三条不变式。

判据：
  1. 互斥：任何一个已声明依赖最多落进一个组。落进两个组不是「都算」，而是行为未定义——
     机器人自己也要二选一，配置读起来像覆盖全了、实际漏在别处。
  2. 每组必须锁 `update-types: [minor, patch]`。漏锁的那一组会把 major 并进家族 PR，
     正是 #257 那类「一批里混着一个大版本」的成因（major 一律人工立项，见 ADR-014）。
  3. 无空组：patterns 打不到任何已声明依赖的组是死配置。
  4. 未分组清单与在册期望一致（防「新加了依赖、忘了配组」静默滑过去）。

口径边界（如实声明）：只看 `web/package.json` 的**已声明**依赖，不看传递依赖；
`@typescript-eslint/*` 这类只出现在锁文件里的模式不会在这里被算成命中，别把它的
「未命中」误读成死模式。glob 语义按 dependabot 文档：`*` 是整名通配，
`@types/node` 不匹配 `@types/nodemailer`。

**未接入 CI**（与 `verify_deploy_package.py` 同状态，属手动核对工具）：
把它塞进 Lint 腿等于新增一道门禁，得自带射程证据并改 ci.yml，那是另一笔决定。

用法：
  python scripts/check_dependabot_groups.py            核对在册配置
  python scripts/check_dependabot_groups.py --self-test 注入两个变异，要求本门判红
退出码：0 通过 / 1 有问题（含 self-test 打不红 = 门无射程）
"""
from __future__ import annotations

import copy
import fnmatch
import json
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, ".github", "dependabot.yml")
PKG = os.path.join(ROOT, "web", "package.json")

# 在册期望：这些依赖故意不分组，各走单依赖 PR（要么家族只有一员，
# 要么它的锁键不与别人互相改写）。新增依赖时若落进这里，先想该不该配组。
EXPECTED_UNGROUPED = [
    "@axe-core/playwright",
    "@testing-library/jest-dom",
    "@testing-library/react",
    "@types/bcryptjs",
    "@types/jsonwebtoken",
    "@types/pg",
    "@types/qrcode",
    "@types/web-push",
    "bcryptjs",
    "ioredis",
    "json-logic-js",
    "jsonwebtoken",
    "mermaid",
    "next-intl",
    "pg",
    "prettier",
    "qrcode",
    "stripe",
    "tsx",
    "typescript",
    "web-push",
    "zod",
]


def load():
    with open(CFG, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    with open(PKG, encoding="utf-8") as f:
        pkg = json.load(f)
    declared = sorted(set(pkg["dependencies"]) | set(pkg["devDependencies"]))
    npm = [u for u in cfg["updates"] if u["package-ecosystem"] == "npm"]
    if len(npm) != 1:
        raise SystemExit(f"FAIL npm ecosystem 条数 = {len(npm)}，本判据假设只有一条")
    return npm[0].get("groups") or {}, declared


def classify(groups, declared):
    hits: dict[str, list[str]] = {g: [] for g in groups}
    owner: dict[str, list[str]] = {}
    for dep in declared:
        for g, spec in groups.items():
            for pat in spec.get("patterns", []):
                if fnmatch.fnmatch(dep, pat):
                    hits[g].append(dep)
                    owner.setdefault(dep, []).append(g)
                    break
    overlap = {d: gs for d, gs in owner.items() if len(gs) > 1}
    ungrouped = [d for d in declared if d not in owner]
    empty = [g for g in hits if not hits[g]]
    loose = [g for g, s in groups.items()
             if sorted(s.get("update-types", [])) != ["minor", "patch"]]
    return hits, overlap, ungrouped, empty, loose


def verdict(overlap, empty, loose, ungrouped, *, show=True):
    bad = []
    if overlap:
        bad.append(f"分组模式重叠 {overlap}")
    if loose:
        bad.append(f"未锁 minor+patch 的组 {loose}")
    if empty:
        bad.append(f"打不到任何已声明依赖的空组 {empty}")
    if sorted(ungrouped) != sorted(EXPECTED_UNGROUPED):
        drift = sorted(set(ungrouped) ^ set(EXPECTED_UNGROUPED))
        bad.append(f"未分组清单与在册期望不符，差异 {drift}")
    if show:
        print("  " + ("PASS 分组互斥、每把刀都锁了 minor+patch、无空组、未分组清单未漂移"
                      if not bad else "FAIL " + "；".join(bad)))
    return bad


def main() -> int:
    groups, declared = load()
    print(f"已声明依赖 {len(declared)} 个，分组 {len(groups)} 个")

    if "--self-test" in sys.argv:
        m1 = copy.deepcopy(groups)
        m1["node-types"]["patterns"].append("@types/*")
        _, ov, ug, em, lo = classify(m1, declared)
        b1 = verdict(ov, em, lo, ug, show=False)
        m2 = copy.deepcopy(groups)
        m2["eslint"].pop("update-types")
        _, ov, ug, em, lo = classify(m2, declared)
        b2 = verdict(ov, em, lo, ug, show=False)
        print(f"变异1（往 node-types 加 @types/* 造成重叠）: 判红? {bool(b1)}")
        print(f"变异2（抹掉 eslint 的 update-types）: 判红? {bool(b2)}")
        if b1 and b2:
            print("SELF-TEST PASS 门有射程")
            return 0
        print("SELF-TEST FAIL 门对自己的射程是盲的，比没有门更糟")
        return 1

    hits, overlap, ungrouped, empty, loose = classify(groups, declared)
    for g in sorted(groups):
        print(f"  {g:<14} {hits[g]}")
    print(f"  未分组 {len(ungrouped)} 个: {ungrouped}")
    bad = verdict(overlap, empty, loose, ungrouped)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
