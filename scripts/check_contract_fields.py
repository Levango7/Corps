#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_contract_fields.py — 字段级契约一致性门禁（需要 PyYAML）

## 它抓的是什么

`api/openapi.yaml` 里每个 200 响应都声明了 `data` 的 `required` 字段。
本门禁做**单向包含**检查：

    openapi 的 data.required  ⊆  实现里 data 字面量对象的 keys

即：契约说必须有的字段，实现里必须真的返回。反过来不检查——实现多返回字段
（向后兼容的加字段）不算缺陷。

为什么需要：已有的契约门禁只覆盖到"形状"层——
- `check_api_contract.py`   管「路由有没有在 openapi 声明」
- `check_openapi_refs.py`   管「$ref 有没有悬空」
- `check_openapi_syntax.py` 管「YAML 解析器读不读得动」
- `check_response_envelope.py` 管「code 是否等于 HTTP 状态码」
全都管不到「声明了 `userIds` 但实现返回 `items`」这类字段漂移。实测存量 5 处
（见 scripts/contract-fields-baseline.txt），其中 im/online 的 `userIds` 与
`items` 是**同一个语义两个名字**，前端按契约取 `userIds` 会拿到 undefined。

## 口径（刻意克制，只判无歧义的一类）

1. 只扫 `web/app/api/**/route.ts`，只认 `code` 字面量**恰好等于 200** 的
   `NextResponse.json(...)`。**不用「没有 status 参数」判断成功**——像
   `code: baRes.status` 这种错误分支会被误当成成功分支（实测多 1 例误报）。
2. **先剔注释再解析**：`//` 行注释与 `/* */` 块注释（字符串/模板串内部除外）。
   `billing/status/route.ts:52` 有注释夹在属性前面，不剔注释会漏读
   `stripeReady` / `portalReady` 造成假红。
3. 支持简写属性（`{ items }`、`{ code: 200, data }`）。括号配对用状态机，
   不用单行正则——实测 175 个成功对象里 55 个跨多行。
4. 只比对 `data` 是**字面量对象**的情况。`data: <标识符>` / `data: null` /
   `data: <调用表达式>` 一律 skip 并计数打印（不判红、也不静默）。
5. openapi 侧只取 `data.required`（不看 properties 的类型），解析路径：
   `path → method → responses['200'] → content['application/json'] → schema →
   (allOf / $ref 递归解引用) → data.required`。
6. 路由未在 openapi 声明，或该 op 的 data 没有 required（通用 `Envelope` 只有
   `nullable: true`，无字段信息）→ skip。「未声明」由 check_api_contract.py 负责，
   本脚本不重复管。

## 覆盖率的诚实交代

本门禁只覆盖**字面量 data**。实测 200 个成功分支里约 42% 是
`data: <变量>` / `data: null`，这些**抓不到**；spread（`...row`）也抓不到。
所有 skip 类别都会打印计数——覆盖率悄悄下滑比红更危险，所以不让它静默。

## 豁免与棘轮

- 实现侧 `...spread`  → skip，计入 skipped_spread
- schema `additionalProperties: true` → skip，计入 skipped_additional_properties
- 同一 handler 多个 200 分支：只要**任一分支**满足 required 即通过（不做
  branch→schema 映射）；都不满足的入基线，不算新增
- 基线只允许收缩：`--emit` 刷新后必须人工核对 diff

红因（与 check_response_envelope.py 同口径）：
- `NEW_FILE`    基线外的路径首次出现字段缺失     -> 红
- `REGRESSION`  已登记路径的同类缺失处数变多     -> 红
- 减少/清零只打印提示、不判红——否则修好一处的人会被自己的门禁卡住

退出码：0 通过；1 有新增/变多；2 自检未按预期，或运行环境缺 PyYAML。

用法：
    python scripts/check_contract_fields.py             # 门禁（CI 用这个）
    python scripts/check_contract_fields.py --emit      # 刷新基线（提交前人工核对）
    python scripts/check_contract_fields.py --self-test # 注入式自检（5 个场景）
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "web" / "app" / "api"
OPENAPI = ROOT / "api" / "openapi.yaml"
BASELINE = ROOT / "scripts" / "contract-fields-baseline.txt"

try:
    import yaml
except ImportError:  # 在 main() 里统一处理
    yaml = None  # type: ignore[assignment]

HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
IDENT = r"[A-Za-z_$][\w$]*"
IDENT_RE = re.compile(rf"^{IDENT}$")
KEY_COLON_RE = re.compile(rf"^({IDENT})\s*:")
EXPORT_RE = re.compile(rf"export\s+const\s+({'|'.join(HTTP_METHODS)})\s*=\s*withRed\(\s*({IDENT})\s*\)")
CODE_200_RE = re.compile(rf"(?<![.\w$])code\s*:\s*200(?![0-9])")

HEADER = """\
# 字段级契约基线（棘轮）——openapi data.required 有、实现 data 字面量没有的字段
#
# 由 `python scripts/check_contract_fields.py --emit` 生成/刷新，**提交前必须人工核对 diff**。
# 每行格式（TAB 分隔）：<相对仓库根的路径>\t<HTTP 方法>\t<缺失字段,按字母序>
#
# 判据（红因集合）：
#   NEW_FILE     基线外的路径首次出现字段缺失  -> CI 红
#   REGRESSION   已登记路径的同类缺失处数变多  -> CI 红
#   （减少/清零只打印提示、不判红——否则修好一处的人会被门禁卡住）
#
# 登记 ≠ 认可：这 5 条都是真实缺陷，清偿要改业务代码，不在本门禁的批次里做。
# 只允许收缩：修好后跑 --emit 删掉对应行。
"""


# ─────────────────────────── 源码清洗 ───────────────────────────

_REGEX_PREV = set("=([{,:;!&|?+-*%<>~^")


def _prev_significant(out: list[str]) -> str:
    for chunk in reversed(out):
        stripped = chunk.rstrip()
        if stripped:
            return stripped[-1]
    return ""


def scrub(source: str) -> str:
    """剔注释 + 抹掉字符串内容（保留标识符形态的字符串），保持偏移与换行不变。

    返回的文本长度与原文一致，行号可直接对照；大括号/圆括号配对因此不受
    字符串里的干扰字符影响。
    """
    out: list[str] = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""

        if ch == "/" and nxt == "/":
            j = source.find("\n", i)
            if j == -1:
                j = n
            out.append(" " * (j - i))
            i = j
            continue

        if ch == "/" and nxt == "*":
            j = source.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join("\n" if c == "\n" else " " for c in source[i:j]))
            i = j
            continue

        if ch in ("'", '"', "`"):
            quote = ch
            j = i + 1
            body: list[str] = []
            closed = False
            while j < n:
                c = source[j]
                if c == "\\" and j + 1 < n:
                    body.append(source[j : j + 2])
                    j += 2
                    continue
                if c == quote:
                    closed = True
                    break
                if quote != "`" and c == "\n":
                    break
                body.append(c)
                j += 1
            body_str = "".join(body)
            kept = body_str if IDENT_RE.match(body_str) else " " * len(body_str)
            out.append(quote + kept + (quote if closed else ""))
            i = j + 1 if closed else j
            continue

        if ch == "/" and _prev_significant(out) in _REGEX_PREV | {""}:
            # 轻量正则字面量跳过：只处理 `\` 转义与 `[...]` 字符类
            j = i + 1
            in_class = False
            closed = False
            while j < n:
                c = source[j]
                if c == "\\" and j + 1 < n:
                    j += 2
                    continue
                if c == "[":
                    in_class = True
                elif c == "]":
                    in_class = False
                elif c == "/" and not in_class:
                    closed = True
                    break
                elif c == "\n":
                    break
                j += 1
            if closed:
                out.append(" " * (j - i + 1))
                i = j + 1
                continue

        out.append(ch)
        i += 1
    return "".join(out)


# ─────────────────────────── 括号与对象解析 ───────────────────────────

def match_bracket(text: str, start: int) -> int:
    """返回与 text[start] 配对的闭括号下标；找不到返回 -1。"""
    pairs = {"(": ")", "{": "}", "[": "]"}
    opener = text[start]
    closer = pairs[opener]
    depth = 0
    for k in range(start, len(text)):
        c = text[k]
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return k
    return -1


def split_top_level(body: str) -> list[str]:
    """按顶层逗号切分（忽略嵌套括号内的逗号）。"""
    parts: list[str] = []
    depth = 0
    start = 0
    for k, c in enumerate(body):
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(body[start:k])
            start = k + 1
    parts.append(body[start:])
    return [p.strip() for p in parts if p.strip()]


def object_entries(obj_src: str) -> list[tuple[str, str, str]]:
    """把 `{ ... }` 的 body 拆成 (kind, key, value_src)。

    kind ∈ {"prop", "shorthand", "spread", "unknown"}
    """
    entries: list[tuple[str, str, str]] = []
    for chunk in split_top_level(obj_src):
        if chunk.startswith("..."):
            entries.append(("spread", "", chunk[3:].strip()))
            continue
        m = KEY_COLON_RE.match(chunk)
        if m:
            entries.append(("prop", m.group(1), chunk[m.end() :].strip()))
            continue
        if IDENT_RE.match(chunk):
            entries.append(("shorthand", chunk, chunk))
            continue
        entries.append(("unknown", "", chunk))
    return entries


def body_of_object(text: str, brace_idx: int) -> str:
    end = match_bracket(text, brace_idx)
    return text[brace_idx + 1 : end if end != -1 else len(text)]


# ─────────────────────────── 路由枚举（复用 check_api_contract 口径） ───────────────────────────

def to_openapi_segment(segment: str) -> str | None:
    if segment.startswith("(") and segment.endswith(")"):
        return None
    match = re.fullmatch(r"\[+\.{0,3}(\w+)\]+", segment)
    if match:
        return "{" + match.group(1) + "}"
    return segment


def route_of(route_file: Path, api_dir: Path) -> str:
    rel = route_file.relative_to(api_dir).parent
    converted = []
    for seg in rel.parts:
        if seg == ".":
            continue
        mapped = to_openapi_segment(seg)
        if mapped is not None:
            converted.append(mapped)
    return "/api" + ("/" + "/".join(converted) if converted else "")


# ─────────────────────────── openapi 解析 ───────────────────────────

def pointer(doc: dict, ref: str):
    if not ref.startswith("#/"):
        return None
    node = doc
    for token in ref[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(node, dict) and token in node:
            node = node[token]
        else:
            return None
    return node


def flatten_schema(node, doc: dict, depth: int = 0) -> dict:
    """解 $ref / allOf，合并 required（并集）与 properties（后者覆盖前者）。"""
    if depth > 12 or not isinstance(node, dict):
        return {}
    merged: dict = {}

    if "$ref" in node:
        target = pointer(doc, node["$ref"])
        if isinstance(target, dict):
            merged = flatten_schema(target, doc, depth + 1)
        siblings = {k: v for k, v in node.items() if k != "$ref"}
        if siblings:
            merged = _merge(merged, flatten_schema(siblings, doc, depth + 1))

    if "allOf" in node and isinstance(node["allOf"], list):
        base: dict = {}
        for sub in node["allOf"]:
            base = _merge(base, flatten_schema(sub, doc, depth + 1))
        rest = {k: v for k, v in node.items() if k != "allOf"}
        merged = _merge(merged, base)
        if rest:
            merged = _merge(merged, rest)

    if "$ref" not in node and "allOf" not in node:
        return dict(node)
    return merged


def _merge(left: dict, right: dict) -> dict:
    if not right:
        return left
    out = dict(left)
    for key, value in right.items():
        if key == "required":
            existing = list(out.get("required") or [])
            for item in value or []:
                if item not in existing:
                    existing.append(item)
            out["required"] = existing
        elif key == "properties":
            props = dict(out.get("properties") or {})
            props.update(value or {})
            out["properties"] = props
        else:
            out[key] = value
    return out


def response_200(operation: dict):
    responses = operation.get("responses") or {}
    return responses.get("200") or responses.get(200)


def data_schema_of(operation: dict, doc: dict) -> dict | None:
    resp = response_200(operation)
    if not isinstance(resp, dict):
        return None
    content = resp.get("content") or {}
    media = content.get("application/json")
    if not isinstance(media, dict):
        return None
    schema = media.get("schema")
    if not isinstance(schema, dict):
        return None
    envelope = flatten_schema(schema, doc)
    data = (envelope.get("properties") or {}).get("data")
    if not isinstance(data, dict):
        return None
    return flatten_schema(data, doc)


# ─────────────────────────── 实现侧扫描 ───────────────────────────

def method_spans(scrubbed: str) -> list[tuple[str, int, int]]:
    """返回 [(METHOD, body_start, body_end)]；body 为 handler 函数体的字符区间。

    两种导出形态都认：
      - `export const GET = withRed(getFoo)`（全仓 448 处）
      - `export async function GET(...) {}`（实测 1 处，不认会漏掉真端点）
    """
    spans: list[tuple[str, int, int]] = []
    decls: list[tuple[str, int]] = []
    for method, fn in EXPORT_RE.findall(scrubbed):
        decl = re.search(rf"\basync\s+function\s+{re.escape(fn)}\s*\(", scrubbed)
        if decl:
            decls.append((method, decl.start()))
    for m in re.finditer(rf"export\s+async\s+function\s+({'|'.join(HTTP_METHODS)})\s*\(", scrubbed):
        decls.append((m.group(1), m.start()))

    for method, decl_start in decls:
        paren = scrubbed.index("(", decl_start)
        close_paren = match_bracket(scrubbed, paren)
        if close_paren == -1:
            continue
        brace = scrubbed.find("{", close_paren)
        if brace == -1:
            continue
        end = match_bracket(scrubbed, brace)
        if end == -1:
            continue
        spans.append((method, brace, end))
    return spans


def method_at(spans: list[tuple[str, int, int]], pos: int) -> str | None:
    for method, start, end in spans:
        if start < pos < end:
            return method
    return None


class Stats:
    def __init__(self) -> None:
        self.files = 0
        self.calls = 0
        self.compared = 0
        self.skipped_no_code_200 = 0
        self.skipped_not_object = 0
        self.skipped_variable_data = 0
        self.skipped_spread = 0
        self.observed_spread = 0
        self.skipped_undeclared_route = 0
        self.skipped_method_not_declared = 0
        self.skipped_no_required = 0
        self.skipped_additional_properties = 0
        self.skipped_unmapped_method = 0

    def skip_total(self) -> int:
        return (
            self.skipped_no_code_200
            + self.skipped_not_object
            + self.skipped_variable_data
            + self.skipped_spread
            + self.skipped_undeclared_route
            + self.skipped_method_not_declared
            + self.skipped_no_required
            + self.skipped_additional_properties
            + self.skipped_unmapped_method
        )

    def report(self) -> None:
        print("── 扫描统计 ─────────────────────────────────────────")
        print(f"  扫描路由文件：            {self.files}")
        print(f"  NextResponse.json 调用：  {self.calls}")
        print(f"  实际参与比对：            {self.compared}")
        print(f"  skip · code 非 200 字面量：{self.skipped_no_code_200}")
        print(f"  skip · 首参非对象：        {self.skipped_not_object}")
        print(f"  skip · data 非字面量对象： {self.skipped_variable_data}（变量 / null / 调用表达式）")
        print(f"  skip · 对象含 spread：     {self.skipped_spread}（另：成功分支里含 spread 的共 {self.observed_spread} 处）")
        print(f"  skip · 路由未声明：        {self.skipped_undeclared_route}")
        print(f"  skip · 该方法未声明：      {self.skipped_method_not_declared}")
        print(f"  skip · 无 data.required：  {self.skipped_no_required}")
        print(f"  skip · additionalProps：   {self.skipped_additional_properties}")
        print(f"  skip · 无法映射 HTTP 方法：{self.skipped_unmapped_method}")


def scan(api_dir: Path, doc: dict, root: Path | None = None) -> tuple[dict[tuple[str, str, str], int], Stats]:
    """返回 ({(相对路径, 方法, 缺失字段串): 处数}, 统计)。"""
    stats = Stats()
    defects: dict[tuple[str, str, str], int] = {}
    if not api_dir.is_dir():
        return defects, stats

    paths = doc.get("paths") or {}
    for route_file in sorted(api_dir.rglob("route.ts")):
        stats.files += 1
        try:
            source = route_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        scrubbed = scrub(source)
        rel = route_file.relative_to(root or api_dir.parents[2]).as_posix()
        route = route_of(route_file, api_dir)
        declared = paths.get(route)
        spans = method_spans(scrubbed)

        for m in re.finditer(r"NextResponse\.json\s*\(", scrubbed):
            stats.calls += 1
            paren = scrubbed.index("(", m.start())
            close = match_bracket(scrubbed, paren)
            if close == -1:
                continue
            args = scrubbed[paren + 1 : close]
            parts = split_top_level(args)
            if not parts or not parts[0].startswith("{"):
                stats.skipped_not_object += 1
                continue
            first_arg = parts[0]
            entries = object_entries(body_of_object(first_arg, 0))

            code_entry = next((e for e in entries if e[1] == "code"), None)
            if code_entry is None or code_entry[0] != "prop":
                stats.skipped_no_code_200 += 1
                continue
            if not CODE_200_RE.match(f"code: {code_entry[2]}") or code_entry[2].strip() != "200":
                stats.skipped_no_code_200 += 1
                continue

            # 观测口径：不管后面因何 skip，先把"成功分支里含 spread"的全量数出来，
            # 避免 skipped_spread 因为归类顺序而低估豁免面（实测全量 10 处）。
            probe = next((e for e in entries if e[1] == "data"), None)
            if any(e[0] == "spread" for e in entries) or (
                probe is not None
                and probe[0] == "prop"
                and probe[2].startswith("{")
                and any(e[0] == "spread" for e in object_entries(body_of_object(probe[2], 0)))
            ):
                stats.observed_spread += 1

            if not isinstance(declared, dict):
                stats.skipped_undeclared_route += 1
                continue
            method = method_at(spans, m.start())
            if method is None:
                stats.skipped_unmapped_method += 1
                continue
            operation = declared.get(method.lower())
            if not isinstance(operation, dict):
                stats.skipped_method_not_declared += 1
                continue
            data_schema = data_schema_of(operation, doc)
            if not data_schema:
                stats.skipped_no_required += 1
                continue
            required = data_schema.get("required") or []
            if not required:
                stats.skipped_no_required += 1
                continue
            if data_schema.get("additionalProperties") is True:
                stats.skipped_additional_properties += 1
                continue
            if any(e[0] == "spread" for e in entries):
                stats.skipped_spread += 1
                continue

            data_entry = next((e for e in entries if e[1] == "data"), None)
            if data_entry is None:
                # envelope 里根本没有 data：无法判断是漏字段还是别写法，交给 code review
                stats.skipped_variable_data += 1
                continue
            kind, _, value = data_entry
            if kind != "prop" or not value.startswith("{"):
                stats.skipped_variable_data += 1
                continue

            inner = body_of_object(value, 0)
            keys = {e[1] for e in object_entries(inner) if e[0] in ("prop", "shorthand")}
            if any(e[0] == "spread" for e in object_entries(inner)):
                stats.skipped_spread += 1
                continue

            missing = sorted(set(required) - keys)
            stats.compared += 1
            if missing:
                key = (rel, method, ",".join(missing))
                defects[key] = defects.get(key, 0) + 1
    return defects, stats


# ─────────────────────────── 基线比对 ───────────────────────────

def load_baseline(path: Path = BASELINE) -> dict[tuple[str, str, str], int]:
    entries: dict[tuple[str, str, str], int] = {}
    if not path.exists():
        return entries
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t") if "\t" in line else line.split()
        if len(parts) < 3:
            continue
        key = (parts[0], parts[1], parts[2])
        entries[key] = entries.get(key, 0) + 1
    return entries


def compare(current: dict[tuple[str, str, str], int], baseline: dict[tuple[str, str, str], int]):
    reds: list[str] = []
    shrink: list[str] = []
    known_paths = {key[0] for key in baseline}
    for key in sorted(current):
        path, method, fields = key
        n = current[key]
        if key not in baseline:
            kind = "REGRESSION" if path in known_paths else "NEW_FILE"
            reds.append(
                f"{kind:<11} {path} [{method}] missing: {fields}"
                f"{'' if kind == 'NEW_FILE' else ' —— 同一路径的缺失项变多（只许减少）'}"
            )
        elif n > baseline[key]:
            reds.append(f"REGRESSION  {path} [{method}] missing: {fields} —— 处数 {baseline[key]} -> {n}")
    for key in sorted(baseline):
        path, method, fields = key
        n = current.get(key, 0)
        if n < baseline[key]:
            shrink.append(f"已清偿      {path} [{method}] missing: {fields} —— {baseline[key]} -> {n} 处（跑 --emit 收紧基线）")
    return reds, shrink


def emit(defects: dict[tuple[str, str, str], int]) -> int:
    lines = [HEADER.rstrip("\n"), ""]
    for key in sorted(defects):
        path, method, fields = key
        for _ in range(defects[key]):
            lines.append(f"{path}\t{method}\t{fields}")
    lines.append("")
    with open(BASELINE, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    print(f"已写入 {BASELINE.relative_to(ROOT).as_posix()}：{len(defects)} 类 / {sum(defects.values())} 处")
    print("提交前必须人工核对 diff：这份基线是待还债务清单，不是成绩单。")
    return 0


def run() -> int:
    if yaml is None:
        print(
            "ERROR: 缺少 PyYAML，无法解析 api/openapi.yaml。\n"
            "  安装：python -m pip install pyyaml==6.0.3\n"
            "  （刻意不静默跳过——跳过等于一条永远绿的空门禁。）",
            file=sys.stderr,
        )
        return 2
    if not OPENAPI.exists():
        print(f"ERROR: openapi.yaml not found at {OPENAPI}", file=sys.stderr)
        return 1
    if not API_DIR.is_dir():
        print(f"ERROR: API dir not found at {API_DIR}", file=sys.stderr)
        return 1

    doc = yaml.safe_load(OPENAPI.read_text(encoding="utf-8")) or {}
    defects, stats = scan(API_DIR, doc, ROOT)
    stats.report()

    if "--emit" in sys.argv:
        return emit(defects)

    baseline = load_baseline()
    reds, shrink = compare(defects, baseline)
    print(f"── 基线：{len(baseline)} 类 / {sum(baseline.values())} 处（当前 {len(defects)} 类 / {sum(defects.values())} 处）")

    if reds:
        print(f"\nFAIL: {len(reds)} 项新增/变多")
        for line in reds:
            print("  " + line)
        print(
            "\n修复方式（按优先级）：\n"
            "  1. 让实现返回 openapi 声明的字段（改业务代码，推荐）\n"
            "  2. 如果契约写错了，改 api/openapi.yaml 并走契约评审\n"
            f"  3. 确属历史存量且本轮不修，才追加到 {BASELINE.name}（并在 PR 里说明）"
        )
        return 1

    for line in shrink:
        print("  " + line)
    print(f"PASS: 无异于存量的字段缺失（登记 {len(baseline)} 类 / {sum(baseline.values())} 处）")
    return 0


# ─────────────────────────── 自检 ───────────────────────────

def _openapi_fixture() -> dict:
    return {
        "paths": {
            "/api/f/ok": {"get": _op(["items", "total"])},
            "/api/f/missing": {"get": _op(["items", "total"])},
            "/api/f/renamed": {"get": _op(["items", "total"])},
            "/api/f/var": {"get": _op(["items", "total"])},
            "/api/f/mixed": {"get": _op(["items", "total"])},
            "/api/f/noreq": {"get": {"responses": {"200": {"content": {"application/json": {"schema": {
                "type": "object",
                "properties": {"data": {"type": "object", "nullable": True}},
            }}}}}}},
        }
    }


def _op(required: list[str]) -> dict:
    return {
        "responses": {
            "200": {
                "content": {
                    "application/json": {
                        "schema": {
                            "allOf": [{"$ref": "#/components/schemas/Envelope"}],
                            "properties": {
                                "data": {
                                    "type": "object",
                                    "required": required,
                                    "properties": {f: {"type": "object"} for f in required},
                                }
                            },
                        }
                    }
                }
            }
        },
        "components": {},
    }


FIXTURES = {
    # c. 完全一致 -> 绿
    "ok": (
        "export async function GET() {\n"
        "  return NextResponse.json({ code: 200, data: { items: [], total: 0 } });\n"
        "}\n"
        "export const GET_HANDLER = withRed(GET);\n"
    ),
    # a. 字段缺失 -> 红
    "missing": (
        "async function listThings() {\n"
        "  return NextResponse.json({\n"
        "    code: 200,\n"
        "    data: { items: [] },\n"
        "  });\n"
        "}\n"
        "export const GET = withRed(listThings);\n"
    ),
    # b. 字段改名 -> 红
    "renamed": (
        "async function listThings() {\n"
        "  return NextResponse.json({ code: 200, data: { tasks: [], total: 0 } });\n"
        "}\n"
        "export const GET = withRed(listThings);\n"
    ),
    # d. data 是变量 -> skip 且不判红
    "var": (
        "async function listThings() {\n"
        "  const payload = { items: [], total: 0 };\n"
        "  return NextResponse.json({ code: 200, data: payload });\n"
        "}\n"
        "export const GET = withRed(listThings);\n"
    ),
    # e. 注释 + 简写属性 + 跨行对象 -> 绿（钉住最易翻车的误报）
    "mixed": (
        "async function listThings() {\n"
        "  const items = [];\n"
        "  const total = 0;\n"
        "  return NextResponse.json({\n"
        "    code: 200,\n"
        "    data: {\n"
        "      // 注释夹在属性前，不剔注释会漏读下一行\n"
        "      /* 块注释\n"
        "         跨两行 */\n"
        "      items,\n"
        "      total,\n"
        "    },\n"
        "  });\n"
        "}\n"
        "export const GET = withRed(listThings);\n"
    ),
    # 通用 Envelope（data 只有 nullable）-> skip，不判红
    "noreq": (
        "async function getThing() {\n"
        "  return NextResponse.json({ code: 200, data: { anything: 1 } });\n"
        "}\n"
        "export const GET = withRed(getThing);\n"
    ),
}


def self_test() -> int:
    if yaml is None:
        print("SELF-TEST SKIP: 缺 PyYAML，无法构造 openapi 夹具", file=sys.stderr)
        return 2
    doc = _openapi_fixture()
    # 补上 allOf 引用的通用 Envelope
    doc["components"] = {"schemas": {"Envelope": {"type": "object", "properties": {"data": {"nullable": True}}}}}

    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        api = root / "web" / "app" / "api"
        for name, body in FIXTURES.items():
            d = api / "f" / name
            d.mkdir(parents=True)
            (d / "route.ts").write_text(body, encoding="utf-8")

        # 同时钉住误报边界：code: baRes.status 不算成功分支
        d = api / "f" / "noreq"
        (d / "route.ts").write_text(
            "async function getThing() {\n"
            "  return NextResponse.json({ code: baRes.status, data: { anything: 1 } });\n"
            "}\n"
            "export const GET = withRed(getThing);\n",
            encoding="utf-8",
        )

        defects, stats = scan(api, doc, root)
        got = {(p.rsplit("/", 2)[1], m, f) for (p, m, f) in defects}

        expected = {
            ("missing", "GET", "total"),
            ("renamed", "GET", "items"),
        }
        if got != expected:
            failures.append(f"检测集合不符：期望 {sorted(expected)}，实际 {sorted(got)}")
        if stats.skipped_no_code_200 != 1:
            failures.append(f"`code: <变量>` 应被 skip 且计入 skipped_no_code_200，实际 {stats.skipped_no_code_200}")
        if stats.skipped_variable_data < 1:
            failures.append("data 为变量时未计入 skipped_variable_data")

        # 场景 d：单独确认 data 变量既不判红也不静默
        var_defects = {k for k in defects if k[0].split("/")[2] == "var"}
        if var_defects:
            failures.append("data 为标识符时被误判为缺陷")

        # 场景 e：注释 + 简写 + 跨行必须绿
        mixed_defects = {k for k in defects if k[0].split("/")[2] == "mixed"}
        if mixed_defects:
            failures.append(f"注释/简写/跨行对象被误判：{sorted(mixed_defects)}")

    if failures:
        print("SELF-TEST FAIL:")
        for f in failures:
            print("  - " + f)
        return 2

    # 比较器：两种红因 + 减少不判红（否则修好一处的人会被门禁卡住）
    reds, _ = compare({("a/route.ts", "GET", "items"): 1}, {})
    if not any("NEW_FILE" in r and "a/route.ts" in r for r in reds):
        print("SELF-TEST FAIL: 基线外缺陷未被判红（NEW_FILE 失效）")
        return 2

    reds, _ = compare({("b/route.ts", "GET", "items"): 2}, {("b/route.ts", "GET", "items"): 1})
    if not any("REGRESSION" in r and "b/route.ts" in r for r in reds):
        print("SELF-TEST FAIL: 处数变多未被判红（REGRESSION 失效）")
        return 2

    reds, _ = compare({("b/route.ts", "GET", "items,total"): 1}, {("b/route.ts", "GET", "items"): 1})
    if not any("REGRESSION" in r and "total" in r for r in reds):
        print("SELF-TEST FAIL: 已登记路径的缺失项变多未被判红")
        return 2

    reds, shrink = compare({}, {("c/route.ts", "GET", "items"): 1})
    if reds:
        print("SELF-TEST FAIL: 减少/清零被误判成红（会卡住修的人）")
        return 2
    if not shrink:
        print("SELF-TEST FAIL: 减少未产生收紧提示")
        return 2

    print("SELF-TEST PASS: 5/5（缺失判红 / 改名判红 / 一致判绿 / data 变量 skip 不判红 / 注释+简写+跨行判绿）")
    print("            + 比较器：NEW_FILE / REGRESSION（处数、缺失项变多）判红，减少不判红")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    return run()


if __name__ == "__main__":
    sys.exit(main())
