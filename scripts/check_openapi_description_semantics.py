#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_openapi_description_semantics.py — openapi 文档层的成功语义防漂移门禁

背景（#284 清偿批的判据盲区，由其收尾报告提出）：
#284 清了 api/openapi.yaml 里 14 处 `description: ... (code=0)` 与注释/文档里的
`legacy envelope` 表述。事后核对发现四道现有门禁（契约差集、$ref、YAML 语法、
envelope 棘轮）都**不读 description 的语义**——只要 YAML 本身合法、$ref 不悬空、
路由对得上，`code=0` 写进 description 就能一路合进 main。而它是与现行约定相反的
成功语义：web/lib/api.ts:114 把响应体 code 读成「code 必须等于 HTTP 状态码」，
code=0 会被消费方当成失败（PushSubscribe.tsx:63 同样消费）。

所以本门禁补这条线：**openapi 文档层出现 `code=0` 或 `legacy envelope` 一律判红**。

## 为什么扫全文而不是只扫 description

#284 清偿时这两种形态恰好只出现在 description/注释里，容易让人以为「窄口径够用」。
但 openapi 是文档层：无论写进 description、example、summary 还是顶层注释，
`code=0` 都是在向读者断言「code=0 表示成功」——这与消费方约定矛盾，没有合法语境。
`legacy envelope` 同理（旧方言名，指回已清偿的双层计量形态）。窄口径反而留洞，
所以全文逐行扫。

## 口径边界（刻意不做的）

- `code: 0`（YAML 键值形式，出现在 example/schema 数据里）不在本门禁口径内：
  那属于 example 数据漂移，实现层由 check_response_envelope.py 的棘轮管；
  文档层若将来发现这种形态，扩口径时在此处登记。
- 不解析 YAML 结构（正则够用）：语法合法性由 check_openapi_syntax.py 管，
  语义漂移是文本层的事。两个门禁职责不重叠。

## 为什么是「必须变红」而不是基线棘轮

main 现状 0/0（#284 清偿后实测）。零存量时上棘轮是浪费——直接硬失败，
违规零容忍；将来若真出现误伤（例如合法语境），再降级为基线棘轮并在 docstring 登记。

## 退出码

- 0：文件干净（无违规模式）
- 1：文件出现 `code=0` 或 `legacy envelope`
- 2：--self-test 未按预期变红回绿，或 api/openapi.yaml 缺失/不可读
  （缺文件判红而非静默跳过——静默跳过 = 一条永远绿的空门禁）

## 自检（--self-test）：门禁自己也要被门禁

在临时目录种 4 棵 mini 文件：
1. 干净描述 → 必须绿
2. `description: Deleted (code=0)`（#178/#284 的真实漂移形态）→ 必须红
3. `Legacy Envelope: 双层计量`（大小写不敏感验证）→ 必须红
4. `code=0` 出现在非 description 行（顶层注释）→ 必须红（全文口径验证）
每一项若未按预期变红/回绿，self-test 以退出码 2 失败。
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPENAPI_CANDIDATES = (
    ROOT / "api" / "openapi.yaml",
    ROOT / "web" / "app" / "api" / "openapi.yaml",
)

# code=0：确切的等号写法（清偿批删的就是这个形态）；
# \b 防误伤 code=01 / code=02 之类（虽然现在不存在，防御性收窄）。
RE_CODE0 = re.compile(r"\bcode=0\b")
# legacy envelope：大小写不敏感（Legacy Envelope / LEGACY ENVELOPE 同判）。
RE_LEGACY = re.compile(r"legacy\s+envelope", re.IGNORECASE)


def find_openapi() -> Path:
    for candidate in OPENAPI_CANDIDATES:
        if candidate.is_file():
            return candidate
    print(f"FAIL: 找不到 openapi.yaml（候选路径: {[str(c) for c in OPENAPI_CANDIDATES]}）")
    raise SystemExit(2)


def scan(text: str) -> list[str]:
    """返回违规行的 '行号: 原文' 列表。"""
    findings: list[str] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        # 跳过本仓库自己的文档性提及（如 API-CONVENTIONS 引用）不在 openapi 内，
        # 但 openapi 内注释行同样判红（注释也是文档层，读者会信）。
        if RE_CODE0.search(stripped) or RE_LEGACY.search(stripped):
            findings.append(f"{lineno}: {line.rstrip()}")
    return findings


def run_gate(path: Path) -> int:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"FAIL: 无法读取 {path}: {exc}")
        return 2
    findings = scan(text)
    if findings:
        print(f"FAIL: {path.name} 出现 {len(findings)} 处成功语义漂移（code=0 / legacy envelope）")
        for item in findings[:20]:
            print(f"  {item}")
        if len(findings) > 20:
            print(f"  … 其余 {len(findings) - 20} 处省略")
        print("  修法：成功语义一律写 `code 等于 HTTP 状态码`；旧方言一律写「双层计量」等中性表述。")
        return 1
    print(f"PASS: {path.name} 无 code=0 / legacy envelope（语义防漂移门禁）")
    return 0


def self_test() -> int:
    """反向测试：违规样本必须变红，干净样本必须回绿。"""
    failures: list[str] = []

    good = "openapi: 3.0.3\ninfo:\n  title: t\n  version: 1\npaths: {}\n"

    cases: list[tuple[str, str, bool]] = [
        ("clean file must PASS", good, False),
        (
            "description with code=0 must FAIL",
            "openapi: 3.0.3\ninfo:\n  title: t\n  version: 1\npaths:\n  /x:\n    get:\n      responses:\n        '200':\n          description: Deleted ({ id, deleted: true }) (code=0)\n",
            True,
        ),
        (
            "Legacy Envelope (case-insensitive) must FAIL",
            "openapi: 3.0.3\ninfo:\n  title: t\n  version: 1\npaths:\n  /x:\n    get:\n      responses:\n        '200':\n          description: Legacy Envelope: 双层计量\n",
            True,
        ),
        (
            "code=0 in a non-description comment line must FAIL (full-text scope)",
            "openapi: 3.0.3\n# 旧约定：成功返回 code=0\ninfo:\n  title: t\n  version: 1\npaths: {}\n",
            True,
        ),
    ]

    for label, content, expect_fail in cases:
        with tempfile.TemporaryDirectory() as tmp:
            probe = Path(tmp) / "openapi.yaml"
            probe.write_text(content, encoding="utf-8")
            findings = scan(content)
            got_fail = bool(findings)
            if got_fail != expect_fail:
                failures.append(
                    f"{label}: expected {'FAIL' if expect_fail else 'PASS'}, got {'FAIL' if got_fail else 'PASS'}"
                )

    if failures:
        print("SELF-TEST FAIL（门禁自身失真，禁止上线）:")
        for item in failures:
            print(f"  - {item}")
        return 2

    print("SELF-TEST PASS: 4/4 变红回绿按预期（干净绿 / code=0 红 / Legacy Envelope 红 / 注释行红）")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    path = find_openapi()
    return run_gate(path)


if __name__ == "__main__":
    raise SystemExit(main())
