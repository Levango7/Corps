#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_openapi_syntax.py — api/openapi.yaml 的 YAML 语法门禁（需要 PyYAML）

为什么需要它：仓库里已有的两条契约门禁都是**纯标准库 + 正则**：
- `check_api_contract.py` 只比对「实际路由 vs path 声明」的差集
- `check_openapi_refs.py` 只查 `#/components/...` 内部引用是否悬空

两者都**不读 YAML 语法**。实测代价：#178 往 openapi.yaml 写进
`description: Deleted ({ id, deleted: true })`——未加引号的值里含 `: `，
PyYAML 直接报 "mapping values are not allowed here"，而当时两道正则门禁全绿，
非法 YAML 一路合进了 main。客户端 codegen / Swagger UI 拿到这种文件会直接崩。

本脚本补这条线，且刻意**不重复**上面两位的职责：只判「解析器读不读得动」，
不判路径声明是否齐全、不判 $ref 是否悬空。

## 为什么这里破了「仅标准库」的惯例

`check_openapi_refs.py` 的 docstring 明写「仅标准库」——那是**因为它查的东西正则够用**。
YAML 语法解析没有标准库等价物：缩进、块标量、流式集合、锚点别名的组合规则靠正则穷举
必然漏判，而漏判的门禁比没有门禁更危险（它给人"有保护"的错觉）。
所以这里引入 PyYAML（纯 Python、无传递依赖），并在 CI 步骤里显式安装。

## 为什么"缺 PyYAML"判红而不是跳过

静默跳过 = 一条永远绿的空门禁——正是本仓库反复反对的东西
（a11y 门禁就刻意不写成"缺基线 = 零违规"）。环境不具备时**必须吵出来**，
让人去装，而不是假装文件没问题。

## 重复键检测（DUPLICATE_KEY）

`yaml.safe_load` 对重复键的默认行为是**后者静默覆盖前者**。手写 openapi 时若
同一个 path 写两遍，前一条端点会从产物里凭空消失，而正则门禁按行扫描看不出来。
这里用自定义 Loader 把它变成硬错误。

口径：
- 语法错误：报出 行:列 + 解析器给出的原因 + 原文那一行
- 顶层必须是非空映射；若存在 `paths`，它必须是映射
- 重复键：报出键名与两处行号（只报前 20 条，避免刷屏）
- **不校验**「是否符合 OpenAPI 规范」——那是 schema 校验器的活，不在本文件职责内

自检（--self-test）：把文件复制到临时目录，注入一处必然非法的 YAML
（复刻 #178 的形态：未加引号且值里含 `: `）→ 必须变红；原件 → 必须回绿。
门禁自己也要被门禁。

退出码：0 通过；1 文件有语法/结构/重复键错误；2 自检未按预期变红回绿，或运行
环境不具备（缺 PyYAML）。
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPENAPI_CANDIDATES = (
    ROOT / "api" / "openapi.yaml",
    ROOT / "web" / "app" / "api" / "openapi.yaml",
    ROOT / "docs" / "api" / "openapi.yaml",
)
MAX_REPORTED_DUPES = 20

try:
    import yaml
except ImportError:  # 在 main() 里统一处理，这里只做标记
    yaml = None  # type: ignore[assignment]


class _DupKeyLoader(yaml.SafeLoader if yaml is not None else object):  # type: ignore[misc]
    """SafeLoader + 重复键检测。仅在 yaml 可用时定义。"""


if yaml is not None:

    def _no_duplicates(loader, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if key in seen:
                mark = key_node.start_mark
                raise yaml.constructor.ConstructorError(
                    "while constructing a mapping",
                    node.start_mark,
                    f"发现重复键 {key!r}（safe_load 会静默保留后者、丢掉前者）",
                    mark,
                )
            seen.add(key)
        return yaml.constructor.SafeConstructor.construct_mapping(loader, node, deep)

    _DupKeyLoader.add_constructor(  # type: ignore[attr-defined]
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicates
    )


def find_openapi() -> Path | None:
    for cand in OPENAPI_CANDIDATES:
        if cand.exists():
            return cand
    return None


def check_text(text: str) -> list[str]:
    """对给定文本跑校验，返回错误列表（空 = 通过）。"""
    errors: list[str] = []
    try:
        doc = yaml.load(text, Loader=_DupKeyLoader)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        if mark is not None:
            line_no = mark.line + 1
            col = mark.column + 1
            src = text.splitlines()[mark.line] if mark.line < len(text.splitlines()) else ""
            errors.append(
                f"YAML_SYNTAX {line_no}:{col} —— {getattr(exc, 'problem', exc)}"
                f"\n      原文: {src.strip()[:160]}"
            )
        else:
            errors.append(f"YAML_SYNTAX —— {exc}")
        return errors
    except Exception as exc:  # 门禁不该抛未捕获异常；任何解析期异常都当错误处理
        errors.append(f"YAML_PARSE {type(exc).__name__} —— {exc}")
        return errors

    if doc is None:
        return ["OPENAPI_STRUCTURE 文件解析结果为空（只有注释或空文件）"]
    if not isinstance(doc, dict):
        return [f"OPENAPI_STRUCTURE 顶层应为映射，实际为 {type(doc).__name__}"]
    paths = doc.get("paths")
    if paths is not None and not isinstance(paths, dict):
        return [f"OPENAPI_STRUCTURE paths 段应为映射，实际为 {type(paths).__name__}"]
    return errors


def run(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    errors = check_text(text)
    if errors:
        print(f"FAIL: {len(errors)} 处问题 —— {path}")
        for e in errors:
            print("  " + e)
        return 1
    print(f"PASS: YAML 语法可解析、无重复键（{path}）")
    return 0


def self_test(path: Path) -> int:
    original = path.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as td:
        mutated = Path(td) / "openapi.yaml"
        # 复刻 #178 的真实形态：未加引号、值里含 ": " —— 正则门禁看不见，解析器必报错
        mutated.write_text(
            original.rstrip("\n")
            + "\nx-self-test-syntax:\n  description: Deleted ({ id, deleted: true })\n",
            encoding="utf-8",
        )
        red = check_text(mutated.read_text(encoding="utf-8"))
        if not any("YAML_SYNTAX" in e for e in red):
            print("SELF-TEST FAIL: 注入的非法 YAML 未被捕获（门禁没在工作）")
            for e in red:
                print("  " + e)
            return 2
        # 再验一条：重复键也必须变红，否则这段检测是死代码
        dup = Path(td) / "dup.yaml"
        dup.write_text(
            original.rstrip("\n") + "\nx-self-test-dup: 1\nx-self-test-dup: 2\n",
            encoding="utf-8",
        )
        dup_errors = check_text(dup.read_text(encoding="utf-8"))
        if not any("x-self-test-dup" in e for e in dup_errors):
            print("SELF-TEST FAIL: 注入的重复键未被捕获（重复键检测是死代码）")
            for e in dup_errors:
                print("  " + e)
            return 2
        green = check_text(original)
        if green:
            print("SELF-TEST FAIL: 原件本应通过，却报错：")
            for e in green:
                print("  " + e)
            return 2
    print("SELF-TEST PASS: 非法 YAML 变红 / 重复键变红 / 原件回绿")
    return 0


def main() -> int:
    if yaml is None:
        print("FAIL: 缺少 PyYAML，无法执行 YAML 语法校验（本门禁不能静默跳过）")
        print("      修复：pip install pyyaml==6.0.3")
        print("      理由：语法解析没有标准库等价物，见本文件 docstring。")
        return 2
    path = find_openapi()
    if path is None:
        print("FAIL: 找不到 api/openapi.yaml")
        return 1
    if "--self-test" in sys.argv:
        return self_test(path)
    return run(path)


if __name__ == "__main__":
    sys.exit(main())
