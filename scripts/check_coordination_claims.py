#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_coordination_claims.py — §6 认领协议的判据 + 开工前检查

背景：
  docs/COORDINATION.md §6 让会话在动手前「认领」可写资源（worktree / 分支 / 路径），
  但 §6.5 当时如实写着「本约定尚未被强制」——那只是一段文档，没有任何执行点：
  两个人可以同时认领同一资源而无人察觉，表本身也会腐烂（少列、日期写反、路径写错）。

本脚本把 §6.2 那张表接上电，并把 §6.3 的「开工前检查」从三条手工步骤压成一条命令。

断言（三种红因）：
  CLAIM_TABLE_MISSING   §6.2 认领表找不到（表头被删/改名）——找不到就红，不静默跳过
  CLAIM_MALFORMED       认领行解析不了或字段非法：列数不对、字段为空、
                        expires <= since、worktree 不是绝对路径、路径 glob 写成绝对路径
  CLAIM_CONFLICT        两条**未过期**认领落在同一资源（同 worktree + 同路径 glob）

不判红（设计如此，别改成红）：
  已过期的行 = 已释放，只打印「可清理」。依据是 §6.4 的承诺「忘了也没关系，expires 会兜底」
  ——若过期判红，一个忘记删行的人就能把全仓 PR 卡死，恰好违背那条承诺。
  同理，「重叠但不相等的 glob」（如 `src/**` 与 `src/a.ts`）不判红：判定要 glob 求交，
  收益低而假阳性高，这一层交给 §6.3 的人眼。

口径边界（如实声明）：
  本判据**抓不到「压根没认领就动手」**——而那正是 2026-10-15 事故的真实形态。
  表能自证的是「已认领的资源彼此不冲突」与「表没腐烂」；「有没有先认领」只能靠
  §6.3 的自觉执行，而 --worktree 模式把 §6.3 压成一条命令，正是为了降低这道门槛。

用法：
  python scripts/check_coordination_claims.py                   校验 §6.2（CI 用）
  python scripts/check_coordination_claims.py --worktree <路径>  开工前检查（本地用）
  python scripts/check_coordination_claims.py --self-test        变异自检
环境变量：
  COORD_DOC_PATH   覆盖 docs/COORDINATION.md（自检用）
  COORD_NOW        覆盖「现在」（YYYY-MM-DD HH:MM，自检/补跑用；生产不要设）
退出码：
  表校验：      0 通过；1 断言失败；2 自检未如期变红
  --worktree：  0 可进入；1 **停手**（已被认领且未过期，或有未提交改动且无人认领）
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOC = REPO / "docs" / "COORDINATION.md"

# §6.2 的列（顺序即表头顺序；改这里必须同步改 docs/COORDINATION.md）
COLUMNS = ("worktree", "分支", "路径 glob", "agent", "since", "expires", "意图")

# 认领行必须能认出「这条是认领表」：首列是 worktree 且列里有 expires。
# 不写死整行表头（措辞可能被润色），但也不放宽到「任意 7 列表」——§4 领地表就挨着。
ABS_PATH_RE = re.compile(r"^(?:[A-Za-z]:[\\/]|/)")
DT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$")


@dataclass
class Claim:
    worktree: str
    branch: str
    path_glob: str
    agent: str
    since: datetime
    expires: datetime
    intent: str

    @property
    def live_key(self) -> tuple[str, str]:
        """资源的比较键：同 worktree + 同路径 glob 即同一份可写资源。"""
        return (self.worktree.rstrip("/\\").replace("\\", "/").lower(), self.path_glob)


def now_default() -> datetime:
    raw = os.environ.get("COORD_NOW")
    if raw:
        return parse_dt(raw)
    return datetime.now()


def parse_dt(raw: str) -> datetime:
    raw = raw.strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    raise ValueError(f"不是 YYYY-MM-DD[ HH:MM]：{raw}")


def is_table_line(line: str) -> bool:
    return line.lstrip().startswith("|")


def cells_of(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def is_separator(line: str) -> bool:
    return set(line.replace("|", "").replace(" ", "")) <= set("-:") and "-" in line


def find_table(text: str) -> tuple[int | None, list[str]]:
    """定位 §6.2 认领表：返回 (表头行号, 数据行原文)。找不到返回 (None, [])。"""
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if not is_table_line(ln):
            continue
        cells = cells_of(ln)
        if len(cells) == len(COLUMNS) and cells[0] == "worktree" and "expires" in cells:
            rows: list[str] = []
            for ln2 in lines[i + 1 :]:
                if not is_table_line(ln2):
                    break
                if is_separator(ln2):
                    continue
                rows.append(ln2)
            return i, rows
    return None, []


def parse_claims(text: str) -> tuple[list[Claim], list[str]]:
    """返回 (认领条目, 解析错误)。解析错误非空即 CLAIM_MALFORMED / CLAIM_TABLE_MISSING。"""
    claims: list[Claim] = []
    errors: list[str] = []
    header, rows = find_table(text)
    if header is None:
        errors.append(
            "CLAIM_TABLE_MISSING docs/COORDINATION.md 里找不到 §6.2 认领表"
            f"（表头须为 '| {' | '.join(COLUMNS)} |'）"
        )
        return claims, errors
    for ln in rows:
        cells = cells_of(ln)
        if len(cells) != len(COLUMNS):
            errors.append(
                f"CLAIM_MALFORMED 认领行应有 {len(COLUMNS)} 列，实得 {len(cells)} 列：{ln.strip()}"
            )
            continue
        wt, branch, glob, agent = cells[0].strip("`"), cells[1], cells[2].strip("`"), cells[3].strip("`")
        since_s, exp_s, intent = cells[4].strip("`"), cells[5].strip("`"), cells[6]
        blanks = [
            COLUMNS[j]
            for j, v in enumerate((wt, branch, glob, agent, since_s, exp_s, intent))
            if not v
        ]
        if blanks:
            errors.append(f"CLAIM_MALFORMED 字段为空 {blanks}：{ln.strip()}")
            continue
        if not ABS_PATH_RE.match(wt):
            errors.append(
                f"CLAIM_MALFORMED worktree 必须是绝对路径（如 F:/Nexus/corps-wt-x）：{wt}"
            )
            continue
        if ABS_PATH_RE.match(glob):
            errors.append(f"CLAIM_MALFORMED 路径 glob 必须相对仓库根（不带盘符/前导斜杠）：{glob}")
            continue
        bad = False
        for label, raw in (("since", since_s), ("expires", exp_s)):
            if not DT_RE.match(raw):
                errors.append(f"CLAIM_MALFORMED {label} 不是 YYYY-MM-DD[ HH:MM]：{raw}")
                bad = True
                break
        if bad:
            continue
        since, expires = parse_dt(since_s), parse_dt(exp_s)
        if expires <= since:
            errors.append(f"CLAIM_MALFORMED expires({exp_s}) 必须晚于 since({since_s})：{ln.strip()}")
            continue
        claims.append(Claim(wt, branch, glob, agent, since, expires, intent))
    return claims, errors

def conflicts(claims: list[Claim], now: datetime) -> list[str]:
    """同一资源被两条**未过期**认领占用即冲突（过期行视为已释放，不参与）。"""
    out: list[str] = []
    seen: dict[tuple[str, str], Claim] = {}
    for c in claims:
        if c.expires <= now:
            continue
        prev = seen.get(c.live_key)
        if prev is None:
            seen[c.live_key] = c
            continue
        out.append(
            f"CLAIM_CONFLICT {c.worktree} 的 `{c.path_glob}` 被两条未过期认领占用："
            f"{prev.agent}（到期 {prev.expires:%Y-%m-%d %H:%M}） / "
            f"{c.agent}（到期 {c.expires:%Y-%m-%d %H:%M}）"
        )
    return out


def load(doc_path: Path) -> tuple[list[Claim], list[str]]:
    if not doc_path.exists():
        return [], [f"CLAIM_TABLE_MISSING 协调面文件缺失：{doc_path}"]
    return parse_claims(doc_path.read_text(encoding="utf-8", errors="ignore"))


def check(doc_path: Path, now: datetime) -> int:
    claims, errors = load(doc_path)
    conflicted = conflicts(claims, now)
    expired = [c for c in claims if c.expires <= now]
    live = [c for c in claims if c.expires > now]

    print(f"协调面：{doc_path}")
    print(f"认领行：{len(claims)} 条（未过期 {len(live)} / 已过期 {len(expired)}）")

    if expired:
        # 只提示不判红：§6.4 承诺「忘了也没关系，expires 会兜底」
        print("提示（不判红）：以下认领已过期，视为已释放，可顺手删行 ——")
        for c in expired:
            print(f"    {c.worktree}  `{c.path_glob}`  {c.agent}  到期 {c.expires:%Y-%m-%d %H:%M}")

    problems = errors + conflicted
    if problems:
        print()
        print("FAIL: 认领表存在断言失败")
        for p in problems:
            print(f"  {p}")
        return 1
    print("PASS: 认领表格式合法，且无「同一资源被两条未过期认领占用」")
    return 0


# ─── 开工前检查（§6.3）────────────────────────────────────────────────────────


def git(args: list[str], cwd: Path) -> str:
    try:
        p = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
    except OSError as exc:
        return f"__GIT_ERROR__{exc}"
    return (p.stdout or "").strip() if p.returncode == 0 else f"__GIT_ERROR__{p.stderr.strip()}"


def same_worktree(claimed: str, target: Path) -> bool:
    a = claimed.rstrip("/\\").replace("\\", "/").lower()
    b = str(target).replace("\\", "/").rstrip("/").lower()
    return a == b


def decide(live_here: list[Claim], dirty: bool, agent: str | None) -> str:
    """§6.3 的裁决，按优先级返回四种结果之一。

    优先级是**实测撞出来的**，不是拍脑袋：初版把「脏」排在「自己已认领」之前，
    结果持有认领的人一处在在制品状态就被自己的检查拦住 —— 越守规矩越进不去，
    等于给自己上了把自锁。正确语义是**认领优先于脏**：
    「脏」对**有认领者**是预期状态（那是他的在制品），对**无认领者**才是警报。
    """
    mine = [c for c in live_here if agent and c.agent.lower() == agent.lower()]
    others = [c for c in live_here if not (agent and c.agent.lower() == agent.lower())]
    if others:
        return "blocked_other"
    if mine:
        return "ok_mine"
    if dirty:
        return "blocked_dirty"
    return "ok_free"


def preflight(worktree: Path, doc_path: Path, now: datetime, agent: str | None) -> int:
    claims, errors = load(doc_path)
    print(f"协调面：{doc_path}")
    for e in errors:
        print(f"  {e}")

    wt = worktree.resolve()
    live_here = [c for c in claims if c.expires > now and same_worktree(c.worktree, wt)]

    status = git(["status", "--short"], wt)
    if status.startswith("__GIT_ERROR__"):
        print(f"停手：读不到该目录的 git 状态（{status[len('__GIT_ERROR__'):]}）")
        return 1
    dirty = bool(status.strip())

    print(f"目标 worktree：{wt}")
    print(f"  当前分支：{git(['rev-parse', '--abbrev-ref', 'HEAD'], wt) or '（读不到）'}")
    print(f"  未提交改动：{'有（脏）' if dirty else '无（干净）'}")
    if live_here:
        print("  未过期认领：")
        for c in live_here:
            mine_tag = "（你自己的）" if agent and c.agent.lower() == agent.lower() else ""
            print(f"    {c.agent}{mine_tag}  `{c.path_glob}`  到期 {c.expires:%Y-%m-%d %H:%M}  {c.intent}")
    else:
        print("  未过期认领：无")

    code = decide(live_here, dirty, agent)
    if code == "blocked_other":
        print()
        print("停手：该 worktree 已被他人在有效期内认领（§6.3 步骤 3）。")
        print("      要么等它过期，要么在 §6.2 留言要 handoff；不要自己删别人的行。")
        return 1
    if code == "ok_mine":
        print()
        print("可进入：你已持有该 worktree 的有效认领（脏 = 你自己的在制品），继续。")
        return 0
    if code == "blocked_dirty":
        print()
        print("停手：该 worktree 有未提交改动且无人认领（§6.3 步骤 2：脏 = 可能有人在写）。")
        print("      确认确实无人使用后再动；不要直接改别人的半成品。")
        return 1
    print()
    print("可进入：该 worktree 干净且无人认领。")
    print("        进去后第一件事 —— 在 §6.2 补一行认领（§6.3 步骤 3）。")
    return 0

def _insert_row(text: str, row: str) -> str:
    """把一行插到 §6.2 表尾（自检用；插在表内，才不会变成一段游离的竖线文本）。"""
    lines = text.splitlines()
    header, _ = find_table(text)
    assert header is not None, "self-test：真实文档里找不到 §6.2 表 —— 注入会空转（假绿）"
    last, i = header, header + 1
    while i < len(lines) and is_table_line(lines[i]):
        last = i
        i += 1
    lines.insert(last + 1, row)
    return "\n".join(lines) + "\n"


def _drop_header(text: str) -> str:
    lines = text.splitlines()
    header, _ = find_table(text)
    assert header is not None, "self-test：真实文档里找不到 §6.2 表头"
    return "\n".join(lines[:header] + lines[header + 1 :]) + "\n"


def _problems(text: str, now: datetime) -> list[str]:
    claims, errors = parse_claims(text)
    return errors + conflicts(claims, now)


GOOD_ROW = (
    "| F:/Nexus/corps-wt-selftest | test/selftest | scripts/**,docs/** | cline-selftest "
    "| 2026-01-01 00:00 | 2030-01-01 00:00 | self-test 注入行（活跃） |"
)
ROW_6C = (
    "| F:/Nexus/corps-wt-selftest | test/selftest | scripts/** | cline-selftest "
    "| 2026-01-01 00:00 | 2030-01-01 00:00 |"
)
ROW_REVERSED = (
    "| F:/Nexus/corps-wt-selftest | test/selftest | scripts/** | cline-selftest "
    "| 2030-01-01 00:00 | 2026-01-01 00:00 | 日期反了 |"
)
ROW_RELWT = (
    "| corps-wt-selftest | test/selftest | scripts/** | cline-selftest "
    "| 2026-01-01 00:00 | 2030-01-01 00:00 | worktree 写成相对路径 |"
)
ROW_STEAL = (
    "| F:/Nexus/corps-wt-selftest | test/other | scripts/**,docs/** | cline-other "
    "| 2026-01-01 00:00 | 2030-01-01 00:00 | 抢同一资源 |"
)
ROW_EXPIRED = (
    "| F:/Nexus/corps-wt-selftest | test/other | scripts/**,docs/** | cline-other "
    "| 2026-01-01 00:00 | 2026-06-01 00:00 | 已过期，应视为释放 |"
)


def self_test() -> int:
    """注入已知变异，要求各自「因正确的红因」变红；并有一条必须**不**判红的负例。

    为什么需要负例：本门禁最容易坏掉的方式不是漏报，而是**把「过期」当「冲突」**——
    那会让一个忘记删行的人卡死全仓（正是 §6.4 承诺不会发生的事）。
    """
    if not DOC.exists():
        print(f"self-test FAILED: 协调面文件缺失：{DOC}")
        return 2
    original = DOC.read_text(encoding="utf-8", errors="ignore")
    if find_table(original)[0] is None:
        # 活性断言：真实文档里必须有 §6.2 表，否则下面所有注入都在空转（= 假绿）
        print("self-test FAILED: 真实 docs/COORDINATION.md 里找不到 §6.2 表 —— 注入会空转")
        return 2

    now = datetime(2027, 1, 1, 0, 0)  # 固定「现在」：让注入行的活跃/过期完全可控
    base = _insert_row(original, GOOD_ROW)

    cases: list[tuple[str, str, set[str]]] = [
        ("删掉表头 -> CLAIM_TABLE_MISSING", _drop_header(base), {"CLAIM_TABLE_MISSING"}),
        ("认领行少一列 -> CLAIM_MALFORMED", _insert_row(base, ROW_6C), {"CLAIM_MALFORMED"}),
        ("expires 早于 since -> CLAIM_MALFORMED", _insert_row(base, ROW_REVERSED), {"CLAIM_MALFORMED"}),
        ("worktree 写成相对路径 -> CLAIM_MALFORMED", _insert_row(base, ROW_RELWT), {"CLAIM_MALFORMED"}),
        ("两条未过期认领同一资源 -> CLAIM_CONFLICT", _insert_row(base, ROW_STEAL), {"CLAIM_CONFLICT"}),
        ("一条已过期 + 一条活跃（同资源）-> 不判红", _insert_row(base, ROW_EXPIRED), set()),
    ]

    ok = True
    for name, text, expected in cases:
        got = {p.split()[0] for p in _problems(text, now) if p.split()}
        if expected and not (expected & got):
            print(f"  FAIL {name}：未因 {sorted(expected)} 变红（实得 {sorted(got)}）")
            ok = False
        elif not expected and got:
            print(f"  FAIL {name}：不该判红却红了（实得 {sorted(got)}）")
            ok = False
        else:
            print(f"  OK   {name} -> {sorted(expected & got) if expected else '不判红'}")

    # 纯函数断言（不依赖 git / 真实 worktree）：
    #  · same_worktree 若不归一正反斜杠与大小写，认领匹配会**静默失效**（永远匹配不上）
    #  · decide 的优先级里必须有「自己认领 + 脏 => 可进入」——这条是实测踩出来的自锁，
    #    写进自检才算钉住，否则下次重构顺序会原样复发
    far = datetime(2030, 1, 1)

    def _claim(agent: str) -> Claim:
        return Claim("F:/Nexus/corps-wt-x", "test/x", "docs/**", agent, datetime(2026, 1, 1), far, "注入")

    pure_cases: list[tuple[str, object, object]] = [
        ("same_worktree 归一正/反斜杠", same_worktree("F:/Nexus/corps-wt-x", Path("F:\\Nexus\\corps-wt-x")), True),
        ("same_worktree 不混淆不同路径", same_worktree("F:/Nexus/corps-wt-x", Path("F:/Nexus/corps-wt-y")), False),
        ("他人在认领 -> blocked_other", decide([_claim("other")], True, "me"), "blocked_other"),
        ("自己认领 + 脏 -> ok_mine（防自锁）", decide([_claim("me")], True, "me"), "ok_mine"),
        ("无认领 + 脏 -> blocked_dirty", decide([], True, "me"), "blocked_dirty"),
        ("无认领 + 干净 -> ok_free", decide([], False, "me"), "ok_free"),
    ]
    for name, got, want in pure_cases:
        if got != want:
            print(f"  FAIL {name}：实得 {got!r}，期望 {want!r}")
            ok = False
        else:
            print(f"  OK   {name} -> {got!r}")

    print("self-test PASS" if ok else "self-test FAILED: 判据失效")
    return 0 if ok else 2


if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--self-test" in argv:
        raise SystemExit(self_test())

    doc_path = Path(os.environ.get("COORD_DOC_PATH") or DOC)
    if "--doc" in argv:
        i = argv.index("--doc")
        if i + 1 >= len(argv):
            print("用法：--doc <path>")
            raise SystemExit(2)
        doc_path = Path(argv[i + 1])

    now = now_default()

    if "--worktree" in argv:
        i = argv.index("--worktree")
        if i + 1 >= len(argv):
            print("用法：--worktree <路径> [--agent <会话名>]")
            raise SystemExit(2)
        agent = None
        if "--agent" in argv and argv.index("--agent") + 1 < len(argv):
            agent = argv[argv.index("--agent") + 1]
        raise SystemExit(preflight(Path(argv[i + 1]), doc_path, now, agent))

    raise SystemExit(check(doc_path, now))


