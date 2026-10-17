#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_coordination_claims.py — §6 认领协议：活态认领表的读写 + 开工前检查

为什么认领不在仓库文件里（2026-10-15 实测）：
  #96 的 §6 把认领表放在 docs/COORDINATION.md。但那份文件**只在 PR 合并后才进 main**，
  而别人读的是 main 的副本 —— 于是「认领」对自己有效、对别人几乎不可见；单 PR 短任务里
  更退化成仪式（加了又删、净零 churn），并被 §6.4 的规则逼出一个「为了删一行要再开一个
  PR」的循环（见 #96 / #98 的实测记录）。

  修法：认领改放**一条不受保护的分支** refs/heads/coordination-claims 上的单个文件：
    · 直接 push / fetch，**不走 PR + CI** → 认领在合并前就可见；
    · 写入走 commit-tree + push 的 plumbing，**不碰共享工作树的 HEAD / 索引 / 工作区**；
    · 认领与释放不产生任何 PR 改动 → 「删行循环」从根上消失。

  docs/COORDINATION.md §6 只放**规则**（粒度、优先级、强制范围）；**状态在这里**。

存储与格式：
  分支  refs/heads/<COORD_STORE_BRANCH>（默认 coordination-claims）
  文件  <COORD_STORE_FILE>（默认 coordination-claims.txt），每行一条认领，`|` 分隔：

      worktree | 分支 | 路径 glob | agent | since | expires | 意图

断言（三种红因）：
  CLAIM_STORE_MISSING   活态表取不到（分支/文件不存在，或 fetch 失败）——取不到就红
  CLAIM_MALFORMED       列数不对 / 字段为空 / expires<=since / worktree 非绝对路径 / glob 绝对路径
  CLAIM_CONFLICT        两条**未过期**认领落在同一资源（同 worktree + 同路径 glob）

不判红（设计如此，别改成红）：已过期的行视为已释放，只提示可清理 —— 过期判红会让一个忘记
release 的人卡死全仓 PR；重叠但不相等的 glob 也不判红（要 glob 求交，假阳性高）。

口径边界（如实声明）：本判据**抓不到「压根没认领就动手」**，那只能靠 §6.3 的自觉执行；
preflight 把 §6.3 压成一条命令，正是为了降低那道门槛。

用法：
  check                                 校验活态表（CI 用，默认子命令）
  list                                  列出认领（未过期 / 已过期分开）
  preflight --worktree <路径> [--agent <名>] [--paths <glob[,glob]>] [--stale-hours 4]
            除认领表外，还会扫**同机所有 worktree 的在制品**并与 --paths 交叉比对（§6.3 第 4 步）
  claim     --worktree <路径> --paths <glob[,glob]> [--agent <名>] [--hours 4] [--intent "..."]
  release   --agent <名> [--worktree <路径>]
  prune                                 清掉**已过期**的认领行（表里那根「可清理」的尾巴）
  --self-test                           变异自检
环境变量：COORD_NOW / COORD_STORE_BRANCH / COORD_STORE_FILE / COORD_REMOTE
  COORD_REMOTE 同时决定**写**的目标远端；**读**会在 origin → upstream → 其余远端间回退
  （fork PR 里 origin 指向 fork、真表在 upstream，靠这条回退才不会误报 STORE_MISSING）
退出码：check 0/1/2；list 0；preflight 0 可进入 / 1 **停手**；claim、release、prune 0 成功 / 1 失败
"""

from __future__ import annotations

import fnmatch
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

COLUMNS = ("worktree", "分支", "路径 glob", "agent", "since", "expires", "意图")
DEFAULT_STORE_BRANCH = "coordination-claims"
DEFAULT_STORE_FILE = "coordination-claims.txt"
ABS_PATH_RE = re.compile(r"^(?:[A-Za-z]:[\\/]|/)")
DT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$")


def store_branch() -> str:
    return os.environ.get("COORD_STORE_BRANCH") or DEFAULT_STORE_BRANCH


def store_file() -> str:
    return os.environ.get("COORD_STORE_FILE") or DEFAULT_STORE_FILE


def remote() -> str:
    return os.environ.get("COORD_REMOTE") or "origin"


HEADER = (
    "# 认领表（活态）—— 规则见 docs/COORDINATION.md §6，读写用 scripts/check_coordination_claims.py\n"
    "#\n"
    "# 本表放在一条**不受保护的分支**上（默认 refs/heads/coordination-claims），直接 push / fetch、\n"
    "# 不走 PR + CI —— 这样认领在**合并前**就可见。为什么不在仓库文件里：见脚本 docstring。\n"
    "#\n"
    "# 格式：" + " | ".join(COLUMNS) + "\n"
)


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
    return parse_dt(raw) if raw else datetime.now()


def parse_dt(raw: str) -> datetime:
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt)
        except ValueError:
            continue
    raise ValueError(f"不是 YYYY-MM-DD[ HH:MM]：{raw}")


def render_line(c: Claim) -> str:
    return " | ".join(
        [
            c.worktree,
            c.branch,
            c.path_glob,
            c.agent,
            f"{c.since:%Y-%m-%d %H:%M}",
            f"{c.expires:%Y-%m-%d %H:%M}",
            c.intent,
        ]
    )


def parse_claims(text: str | None) -> tuple[list[Claim], list[str]]:
    """把活态表正文解析成认领条目。text 为 None 表示存储取不到（判 CLAIM_STORE_MISSING）。"""
    if text is None:
        return [], [
            "CLAIM_STORE_MISSING 活态认领表取不到"
            f"（{remote()}/{store_branch()}:{store_file()}）—— 取不到就红，不静默放过"
        ]
    claims: list[Claim] = []
    errors: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        cells = [c.strip() for c in line.split("|")]
        if len(cells) != len(COLUMNS):
            errors.append(f"CLAIM_MALFORMED 认领行应有 {len(COLUMNS)} 段，实得 {len(cells)} 段：{line}")
            continue
        wt, branch, glob, agent, since_s, exp_s, intent = cells
        blanks = [
            COLUMNS[j]
            for j, v in enumerate((wt, branch, glob, agent, since_s, exp_s, intent))
            if not v
        ]
        if blanks:
            errors.append(f"CLAIM_MALFORMED 字段为空 {blanks}：{line}")
            continue
        if not ABS_PATH_RE.match(wt):
            errors.append(f"CLAIM_MALFORMED worktree 必须是绝对路径（如 F:/Nexus/corps-wt-x）：{wt}")
            continue
        if ABS_PATH_RE.match(glob):
            errors.append(f"CLAIM_MALFORMED 路径 glob 必须相对仓库根（不带盘符/前导斜杠）：{glob}")
            continue
        bad = False
        for label, value in (("since", since_s), ("expires", exp_s)):
            if not DT_RE.match(value):
                errors.append(f"CLAIM_MALFORMED {label} 不是 YYYY-MM-DD[ HH:MM]：{value}")
                bad = True
                break
        if bad:
            continue
        since, expires = parse_dt(since_s), parse_dt(exp_s)
        if expires <= since:
            errors.append(f"CLAIM_MALFORMED expires({exp_s}) 必须晚于 since({since_s})：{line}")
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


def same_worktree(claimed: str, target: Path) -> bool:
    a = claimed.rstrip("/\\").replace("\\", "/").lower()
    b = str(target).replace("\\", "/").rstrip("/").lower()
    return a == b


def decide(live_here: list[Claim], dirty: bool, agent: str | None) -> str:
    """§6.3 的裁决，按优先级返回四种结果之一。

    优先级是**实测撞出来的**：初版把「脏」排在「自己已认领」之前，结果持有认领的人一处于
    在制品状态就被自己的检查拦住（越守规矩越进不去 = 自锁）。正确语义是**认领优先于脏**：
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


def path_matches(path: str, globs: str) -> bool:
    """路径是否落在逗号分隔的 glob 里。

    用 `fnmatch` —— 它的 `*` **也会跨 `/`**（`docs/**` 匹配 `docs/a/b.md`，`docs/*` 也匹配）。
    这是**故意的**：宁可多报一点重叠（多看一眼），也别因为通配写法差异漏掉真在动的文件。
    """
    return any(fnmatch.fnmatch(path, g.strip()) for g in globs.split(",") if g.strip())


def classify_overlap(age_h: float, fresh_hours: float) -> str:
    """在制品文件的 mtime 距今 age_h 小时 → "stop"（新鲜，像有人正在写）/ "warn"（陈旧，像遗留脏树）。

    为什么用 mtime 分档：`git status` 只能告诉你「脏」，不能告诉你「是不是**此刻**有人在动」——
    共享树上可能躺着几十天前的遗留改动。mtime 是把这两者分开的最便宜信号
    （#94 那次事故我就是靠 mtime 认出对方会话还活着的）。
    读不到 mtime（age_h < 0，例如文件刚被删）→ 当作新鲜，**宁可停手**。
    """
    return "stop" if age_h < 0 or age_h <= fresh_hours else "warn"


def local_worktrees() -> list[tuple[str, str]]:
    """所有本地 worktree：[(posix 路径, 分支名)]。读 `git worktree list --porcelain`。"""
    rc, out, _ = git(["worktree", "list", "--porcelain"])
    if rc != 0:
        return []
    items: list[tuple[str, str]] = []
    path, branch = "", ""
    for line in out.splitlines() + [""]:
        if line.startswith("worktree "):
            path, branch = line[len("worktree ") :].strip().replace("\\", "/"), ""
        elif line.startswith("branch "):
            branch = line[len("branch ") :].strip().removeprefix("refs/heads/")
        elif not line.strip() and path:
            items.append((path, branch or "（detached）"))
            path = ""
    return items


def dirty_files(wt: str) -> list[str]:
    """该 worktree 的**在制品**（未提交改动 + 未跟踪文件），返回相对仓库根的 posix 路径。

    只读 `git status`、不写任何东西；**别人的 worktree 也照读** —— 同机事实正是从这里来的。
    """
    rc, out, _ = git(["-C", wt, "status", "--porcelain", "--untracked-files=all"])
    if rc != 0:
        return []
    files: list[str] = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        rest = line[3:].strip()
        if " -> " in rest:  # 重命名：取新路径
            rest = rest.split(" -> ")[-1]
        files.append(rest.strip('"').replace("\\", "/"))
    return files


def scan_live_edits(
    target: Path, globs: str | None, fresh_hours: float, mine: set[str]
) -> tuple[list[str], list[str]]:
    """同机在制品交叉扫描 → (停手项, 警告项)。

    为什么需要它（2026-10-15 复盘）：认领表是**自愿、事前、靠身份**的信号；而事故的真实形态是
    「同一台机器上两个会话同时改同一批文件」—— 那件事本来就有**硬信号**：
    `git worktree list` + 每个 worktree 的 `git status` + 文件 mtime。
    #94 那次信号一直都在（我确实跑了 `worktree list`、也看到它脏），只是**没人把这一步写进检查表**。
    所以这里不再依赖「别人愿不愿意登记」，而是直接读客观事实。

    `mine` = 已由本 agent 认领的 worktree 路径集合：那是自己的在制品，降到警告，别自己拦自己。
    """
    stop: list[str] = []
    warn: list[str] = []
    if not globs:
        return stop, warn
    tgt = str(target).replace("\\", "/").rstrip("/").lower()
    now_ts = datetime.now().timestamp()  # mtime 是真实文件系统事实，不用 COORD_NOW 覆盖
    for wt, branch in local_worktrees():
        if wt.rstrip("/").lower() == tgt:
            continue
        for rel in dirty_files(wt):
            if not path_matches(rel, globs):
                continue
            try:
                age_h = (now_ts - (Path(wt) / rel).stat().st_mtime) / 3600.0
            except OSError:
                age_h = -1.0
            label = "未知" if age_h < 0 else f"{age_h:.1f}h 前改动"
            item = f"{wt}  [{branch}]  {rel}  （{label}）"
            if wt.rstrip("/").lower() in mine:
                warn.append(f"{item}  ← 是你自己的 worktree")
            else:
                (stop if classify_overlap(age_h, fresh_hours) == "stop" else warn).append(item)
    return stop, warn


def mk_tree_input(base_ls_tree: str, new_blob: str, filename: str) -> str:
    """构造 `git mktree` 的输入：保留 base 树里的其它条目，把 filename 指向 new_blob。

    **保留其它条目是有意的**：存储分支按约定只放一个文件，但万一有人往里加了别的东西，
    「原样保留」比「顺手清掉」安全得多 —— 这个脚本不该成为删数据的工具。
    """
    out: list[str] = []
    for line in base_ls_tree.splitlines():
        if not line.strip():
            continue
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) != 3:
            continue
        mode, typ, sha = parts
        if path == filename:
            continue
        out.append(f"{mode} {typ} {sha}\t{path}")
    out.append(f"100644 blob {new_blob}\t{filename}")
    return "\n".join(out) + "\n"


def with_header(text: str) -> str:
    """新建（或空）表时补上表头注释，让人打开就知道这是什么、格式是什么。"""
    return text if text.strip() else HEADER

def git(args: list[str], cwd: Path | None = None, stdin: str | None = None) -> tuple[int, str, str]:
    """跑 git。返回 (returncode, stdout, stderr)。不碰 HEAD / 索引 / 工作区（除非调用方自己动）。

    **一律走字节，不走 Python 文本模式**：文本模式在 Windows 上会把 stdin 的 `\\n` 翻成 `\\r\\n`，
    而 `git mktree` 的输入是「mode type sha<TAB>path\\n」—— 多出来的 `\\r` 会被当成**文件名的一部分**
    （实测：树里出现 `"coordination-claims.txt\\r"`，于是文件凭空消失、判据报 STORE_MISSING）。
    这类错误只在 Windows 复现、Linux CI 上看不见，所以必须靠字节模式 + 自检钉住。
    """
    try:
        p = subprocess.run(
            ["git", *args],
            cwd=str(cwd or REPO),
            input=None if stdin is None else stdin.encode("utf-8"),
            capture_output=True,
        )
    except OSError as exc:
        return 127, "", str(exc)
    out = p.stdout.decode("utf-8", "ignore") if p.stdout else ""
    err = p.stderr.decode("utf-8", "ignore") if p.stderr else ""
    return p.returncode, out, err


def store_ref() -> str:
    return f"refs/heads/{store_branch()}"


def local_ref() -> str:
    return f"refs/remotes/{remote()}/{store_branch()}"


def candidate_remotes() -> list[str]:
    """**读**的候选远端：COORD_REMOTE 显式指定优先；否则 origin → upstream → 其余远端。

    **为什么要有回退**：fork 提的 PR 里 `origin` 指向 **fork**，真表在 `upstream`；
    只认 origin 会让判据在 fork PR 上误报 `CLAIM_STORE_MISSING`。
    写入仍只走 `remote()` —— 无写权限的 fork 贡献者本来就推不动主仓，
    那属于权限边界、不是代码能修的（见 §6.5）。
    """
    explicit = os.environ.get("COORD_REMOTE")
    if explicit:
        return [explicit]
    rc, out, _ = git(["remote"])
    have = [r.strip() for r in out.splitlines() if r.strip()]
    preferred = [r for r in ("origin", "upstream") if r in have]
    return preferred + [r for r in have if r not in preferred]


def fetch_store() -> tuple[bool, str | None, str]:
    """取回活态表正文。返回 (取到没有, 正文, 命中的远端)。

    分支不存在 / 文件不存在 / 网络失败都算「取不到」；逐个候选远端试。
    """
    for rem in candidate_remotes():
        ref = f"refs/remotes/{rem}/{store_branch()}"
        rc, _, _ = git(["fetch", "--quiet", rem, f"+{store_ref()}:{ref}"])
        if rc != 0:
            continue
        rc, out, _ = git(["show", f"{ref}:{store_file()}"])
        if rc == 0:
            return True, out, rem
    return False, None, ""


def read_store_text() -> str:
    _, text, _ = fetch_store()
    return with_header(text or "")


def publish_store(text: str, message: str) -> bool:
    """把正文写回存储分支。用 commit-tree + push，**不动 HEAD / 索引 / 工作区**（§1 规则 6 的机器人版）。"""
    base = local_ref()
    rc, _, _ = git(["rev-parse", "--verify", "--quiet", base])
    has_base = rc == 0

    rc, blob, err = git(["hash-object", "-w", "--stdin"], stdin=text)
    if rc != 0:
        print(f"失败：写 blob 出错：{err.strip()}")
        return False

    rc, entries, _ = git(["ls-tree", base]) if has_base else (0, "", "")
    rc, tree, err = git(["mktree"], stdin=mk_tree_input(entries, blob.strip(), store_file()))
    if rc != 0:
        print(f"失败：建 tree 出错：{err.strip()}")
        return False

    args = ["commit-tree", tree.strip()]
    if has_base:
        args += ["-p", base]
    args += ["-m", message]
    rc, commit, err = git(args)
    if rc != 0:
        print(f"失败：建 commit 出错：{err.strip()}")
        return False

    rc, _, err = git(["push", "--quiet", remote(), f"{commit.strip()}:{store_ref()}"])
    if rc != 0:
        # 最常见的是非快进（别人同时也在写）——由调用方重取重试
        return False
    return True


def write_with_retry(mutate, message: str, tries: int = 4) -> int:
    """读-改-写存储分支。推送被抢先（非快进）时重取重试，这正是「检测到有人同时在写」的信号。"""
    for _ in range(tries):
        new_text, note = mutate(read_store_text())
        if new_text is None:
            print(note)
            return 0
        if publish_store(new_text, message):
            print(note)
            return 0
    print("失败：存储分支反复被他人抢先（重试耗尽）—— 再跑一次即可，这是并发的正常表现，不是错误")
    return 1


def cmd_check(now: datetime) -> int:
    found, text, rem = fetch_store()
    claims, errors = parse_claims(text)
    conflict_list = conflicts(claims, now)
    expired = [c for c in claims if c.expires <= now]
    live = [c for c in claims if c.expires > now]

    where = rem or "/".join(candidate_remotes()) or remote()
    print(f"活态表：{where}/{store_branch()}:{store_file()}{'' if found else '（没找到）'}")
    print(f"认领：{len(claims)} 条（未过期 {len(live)} / 已过期 {len(expired)}）")

    if expired:
        # 只提示不判红：过期即已释放；判红会让一个忘记 release 的人卡死全仓 PR
        print("提示（不判红）：以下认领已过期，视为已释放 —— 跑 `prune` 可一次清掉：")
        for c in expired:
            print(f"    {c.worktree}  `{c.path_glob}`  {c.agent}  到期 {c.expires:%Y-%m-%d %H:%M}")

    problems = errors + conflict_list
    if problems:
        print()
        print("FAIL: 活态认领表存在断言失败")
        for p in problems:
            print(f"  {p}")
        return 1
    print("PASS: 活态表格式合法，且无「同一资源被两条未过期认领占用」")
    return 0


def cmd_list(now: datetime) -> int:
    _, text, _ = fetch_store()
    claims, errors = parse_claims(text)
    if text is None:
        for e in errors:
            print(e)
        return 0
    live = [c for c in claims if c.expires > now]
    expired = [c for c in claims if c.expires <= now]
    print(f"未过期（{len(live)}）—— 这些资源现在别碰：")
    for c in live:
        print(
            f"  {c.worktree}  [{c.branch}]  `{c.path_glob}`  {c.agent}"
            f"  {c.since:%m-%d %H:%M}→{c.expires:%m-%d %H:%M}  {c.intent}"
        )
    if expired:
        print(f"已过期（{len(expired)}，视为已释放）：")
        for c in expired:
            print(f"  {c.worktree}  `{c.path_glob}`  {c.agent}  到期 {c.expires:%m-%d %H:%M}")
    return 0

def split_expired(text: str, now: datetime) -> tuple[list[str], list[str]]:
    """把正文分成 (保留行, 已过期行)。

    **只把「确定过期」的算进第二类**：解析不了的行、注释、空行一律保留。
    prune 是扫帚不是垃圾桶 —— 删错一行等于**悄悄放掉别人的认领**，
    比多留一行危险得多，所以这里宁可少删。
    """
    kept: list[str] = []
    expired_lines: list[str] = []
    for raw in text.splitlines():
        s = raw.strip()
        if s and not s.startswith("#"):
            cells = [x.strip() for x in s.split("|")]
            if len(cells) == len(COLUMNS) and DT_RE.match(cells[5]) and parse_dt(cells[5]) <= now:
                expired_lines.append(raw)
                continue
        kept.append(raw)
    return kept, expired_lines


def cmd_prune(now: datetime) -> int:
    """清掉**已过期**的认领行（表里那根「可清理」的尾巴）。判定见 split_expired。"""

    def mutate(text: str) -> tuple[str | None, str]:
        kept, expired_lines = split_expired(text, now)
        if not expired_lines:
            return None, "无需清理：没有已过期的认领行"
        body = "\n".join(kept).rstrip("\n")
        return (body + "\n" if body else HEADER), f"已清理 {len(expired_lines)} 条过期认领"

    return write_with_retry(mutate, "prune: expired claims")


def cmd_preflight(
    worktree: Path,
    agent: str | None,
    now: datetime,
    paths: str | None = None,
    fresh_hours: float = 4.0,
) -> int:
    """§6.3 开工前检查。退出码 0 可进入 / 1 停手。"""
    _, text, rem = fetch_store()
    claims, errors = parse_claims(text)
    for e in errors:
        print(f"  {e}")

    wt = worktree.resolve()
    live_here = [c for c in claims if c.expires > now and same_worktree(c.worktree, wt)]
    mine_wts = {
        c.worktree.rstrip("/\\").replace("\\", "/").lower()
        for c in claims
        if c.expires > now and agent and c.agent.lower() == agent.lower()
    }

    rc, status, err = git(["status", "--short"], cwd=wt)
    if rc != 0:
        print(f"停手：读不到该目录的 git 状态（{err.strip()}）")
        return 1
    rc, branch_out, _ = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=wt)
    dirty = bool(status.strip())

    print(f"活态表：{rem or '/'.join(candidate_remotes()) or remote()}/{store_branch()}:{store_file()}")
    print(f"目标 worktree：{wt}")
    print(f"  当前分支：{branch_out.strip() or '（读不到）'}")
    print(f"  未提交改动：{'有（脏）' if dirty else '无（干净）'}")
    if live_here:
        print("  未过期认领：")
        for c in live_here:
            mine_tag = "（你自己的）" if agent and c.agent.lower() == agent.lower() else ""
            print(
                f"    {c.agent}{mine_tag}  `{c.path_glob}`  到期 {c.expires:%Y-%m-%d %H:%M}  {c.intent}"
            )
    else:
        print("  未过期认领：无")

    # ── 同机在制品交叉检查（§6.3 第 4 步）：读客观事实，不依赖别人登记 ──
    stop, warn = scan_live_edits(wt, paths, fresh_hours, mine_wts)
    if not paths:
        rows = [(w, br, len(dirty_files(w))) for w, br in local_worktrees()]
        rows = [(w, br, n) for w, br, n in rows if n]
        print("  同机在制品交叉检查：未给 --paths，跳过（给了才判得了重叠）。当前同机在制品：")
        for w, br, n in rows:
            print(f"    {w}  [{br}]  {n} 个")
        if not rows:
            print("    （无）")
    elif stop or warn:
        print(
            f"  同机在制品交叉检查：{len(stop)} 处新鲜重叠 / {len(warn)} 处陈旧重叠"
            f"（新鲜阈值 {fresh_hours:g}h）"
        )
        for x in stop:
            print(f"    [重叠·新鲜] {x}")
        for x in warn:
            print(f"    [重叠·陈旧·不拦] {x}")
    else:
        print("  同机在制品交叉检查：无重叠")

    if stop:
        print()
        print("停手：同机**别的 worktree 的在制品**与你打算写的路径重叠，且改动很新 ——")
        for x in stop:
            print(f"    {x}")
        print("      这不是推测：那些文件在另一个工作区里**此刻就是脏的**（§6.3 第 4 步）。")
        print("      先与对方确认或要 handoff；不要硬上。")
        return 1

    code = decide(live_here, dirty, agent)
    if code == "blocked_other":
        print()
        print("停手：该 worktree 已被他人在有效期内认领（§6.3 步骤 3）。")
        print("      要么等它过期，要么找对方要 handoff；不要自己释放别人的认领。")
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
    print("        进去后第一件事 —— 补一条认领（§6.3 步骤 3），可直接粘这条：")
    globs_hint = paths or "<glob[,glob]>"
    print(
        "          python scripts/check_coordination_claims.py claim"
        f' --worktree "{str(wt).replace(chr(92), "/")}" --paths "{globs_hint}"'
        f' --agent {agent or "<你的会话名>"} --intent "<一句话意图>"'
    )
    return 0


def cmd_claim(
    worktree: Path, paths: str, agent: str | None, hours: float, intent: str, now: datetime
) -> int:
    wt = worktree.resolve()
    rc, branch_out, _ = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=wt)
    if rc != 0:
        print(f"失败：读不到 {wt} 的当前分支")
        return 1
    claim = Claim(
        str(wt).replace("\\", "/"),
        branch_out.strip() or "?",
        paths,
        agent or "?",
        now,
        now + timedelta(hours=hours),
        intent,
    )
    line = render_line(claim)

    def mutate(text: str) -> tuple[str | None, str]:
        existing, _ = parse_claims(text)
        if any(render_line(c) == line for c in existing):
            return None, "无需重复认领：一模一样的一行已经在表里了"
        return text.rstrip("\n") + "\n" + line + "\n", f"已认领：{line}"

    return write_with_retry(mutate, f"claim: {claim.agent} {paths}")


def cmd_release(agent: str | None, worktree: Path | None) -> int:
    def mutate(text: str) -> tuple[str | None, str]:
        kept: list[str] = []
        dropped = 0
        for raw in text.splitlines():
            s = raw.strip()
            if s and not s.startswith("#"):
                cells = [x.strip() for x in s.split("|")]
                if (
                    len(cells) == len(COLUMNS)
                    and cells[3].lower() == (agent or "").lower()
                    and (worktree is None or same_worktree(cells[0], worktree))
                ):
                    dropped += 1
                    continue
            kept.append(raw)
        if dropped == 0:
            return None, "无需释放：没有匹配的认领行"
        body = "\n".join(kept).rstrip("\n")
        return (body + "\n" if body else HEADER), f"已释放 {dropped} 条（agent={agent}）"

    return write_with_retry(mutate, f"release: {agent}")

def self_test() -> int:
    """注入已知变异，要求各自「因正确的红因」变红；并有一条必须**不**判红的负例。

    为什么必须有负例：本门禁最容易坏的方式不是漏报，而是**把「过期」当「冲突」**——
    那会让一个忘记 release 的人卡死全仓 PR（正是 §6.4 承诺不会发生的事）。
    """
    now = datetime(2027, 1, 1, 0, 0)  # 固定「现在」，让注入行的活跃/过期完全可控
    wt = "F:/Nexus/corps-wt-selftest"
    good = render_line(
        Claim(wt, "test/x", "docs/**", "cline-selftest", datetime(2026, 1, 1), datetime(2030, 1, 1), "注入行（活跃）")
    )
    six = f"{wt} | test/x | docs/** | cline-selftest | 2026-01-01 00:00 | 2030-01-01 00:00"
    empty_intent = f"{wt} | test/x | docs/** | cline-selftest | 2026-01-01 00:00 | 2030-01-01 00:00 | "
    reversed_ = f"{wt} | test/x | docs/** | cline-selftest | 2030-01-01 00:00 | 2026-01-01 00:00 | 日期反了"
    relwt = f"corps-wt-selftest | test/x | docs/** | cline-selftest | 2026-01-01 00:00 | 2030-01-01 00:00 | 相对路径"
    steal = f"{wt} | test/other | docs/** | cline-other | 2026-01-01 00:00 | 2030-01-01 00:00 | 抢同一资源"
    expired = f"{wt} | test/other | docs/** | cline-other | 2026-01-01 00:00 | 2026-06-01 00:00 | 已过期"

    def reasons(text: str | None) -> set[str]:
        claims, errors = parse_claims(text)
        return {p.split()[0] for p in (errors + conflicts(claims, now)) if p.split()}

    ok = True
    cases: list[tuple[str, str | None, set[str]]] = [
        ("存储取不到 -> CLAIM_STORE_MISSING", None, {"CLAIM_STORE_MISSING"}),
        ("认领行少一段 -> CLAIM_MALFORMED", six, {"CLAIM_MALFORMED"}),
        ("段数够但意图为空 -> CLAIM_MALFORMED", empty_intent, {"CLAIM_MALFORMED"}),
        ("expires 早于 since -> CLAIM_MALFORMED", reversed_, {"CLAIM_MALFORMED"}),
        ("worktree 写成相对路径 -> CLAIM_MALFORMED", relwt, {"CLAIM_MALFORMED"}),
        ("两条未过期认领同一资源 -> CLAIM_CONFLICT", f"{good}\n{steal}\n", {"CLAIM_CONFLICT"}),
        ("一条已过期 + 一条活跃（同资源）-> 不判红", f"{good}\n{expired}\n", set()),
    ]
    for name, text, expected in cases:
        got = reasons(text)
        if expected and not (expected & got):
            print(f"  FAIL {name}：未因 {sorted(expected)} 变红（实得 {sorted(got)}）")
            ok = False
        elif not expected and got:
            print(f"  FAIL {name}：不该判红却红了（实得 {sorted(got)}）")
            ok = False
        else:
            print(f"  OK   {name} -> {sorted(expected & got) if expected else '不判红'}")

    # 纯函数断言（不联网、不碰 git）：
    #  · render ↔ parse 必须往返一致 —— 否则「claim 写进去的行」自己都读不回来
    #  · same_worktree 不归一正/反斜杠与大小写，认领匹配会**静默失效**
    #  · decide 优先级里必须有「自己认领 + 脏 ⇒ 放行」——实测踩过的自锁，不钉住会复发
    #  · mk_tree_input 必须**保留**存储分支上的其它条目（脚本不该成为删数据的工具）
    parsed, perr = parse_claims(good + "\n")
    base_entries = "100644 blob aaa\tcoordination-claims.txt\n100644 blob bbb\tnotes.md\n"
    far = datetime(2030, 1, 1)

    def _claim(agent: str) -> Claim:
        return Claim("F:/Nexus/corps-wt-x", "test/x", "docs/**", agent, datetime(2026, 1, 1), far, "注入")

    pure_cases: list[tuple[str, object, object]] = [
        ("render↔parse 往返一致", (not perr and len(parsed) == 1 and render_line(parsed[0]) == good), True),
        ("same_worktree 归一正/反斜杠", same_worktree("F:/Nexus/corps-wt-x", Path("F:\\Nexus\\corps-wt-x")), True),
        ("same_worktree 不混淆不同路径", same_worktree("F:/Nexus/corps-wt-x", Path("F:/Nexus/corps-wt-y")), False),
        ("他人在认领 -> blocked_other", decide([_claim("other")], True, "me"), "blocked_other"),
        ("自己认领 + 脏 -> ok_mine（防自锁）", decide([_claim("me")], True, "me"), "ok_mine"),
        ("无认领 + 脏 -> blocked_dirty", decide([], True, "me"), "blocked_dirty"),
        ("无认领 + 干净 -> ok_free", decide([], False, "me"), "ok_free"),
        (
            "mk_tree_input 替换目标文件且保留其它条目",
            mk_tree_input(base_entries, "ccc", "coordination-claims.txt"),
            "100644 blob bbb\tnotes.md\n100644 blob ccc\tcoordination-claims.txt\n",
        ),
        (
            "prune 只清确定过期的行（活跃行 / 坏行 / 注释都留下）",
            split_expired(f"# 注释\n{good}\n{expired}\n{six}\n", now),
            (["# 注释", good, six], [expired]),
        ),
        ("path_matches 命中 docs/**", path_matches("docs/a/b.md", "docs/**"), True),
        ("path_matches 不误命中", path_matches("web/x.ts", "docs/**"), False),
        ("path_matches 逗号分隔多个 glob", path_matches("scripts/x.py", "docs/**,scripts/*.py"), True),
        ("classify_overlap 新鲜 -> stop", classify_overlap(0.5, 4), "stop"),
        ("classify_overlap 读不到 mtime -> stop（宁可停手）", classify_overlap(-1.0, 4), "stop"),
        ("classify_overlap 陈旧 -> warn（遗留脏树不拦人）", classify_overlap(50.0, 4), "warn"),
    ]
    for name, got, want in pure_cases:
        if got != want:
            print(f"  FAIL {name}：实得 {got!r}，期望 {want!r}")
            ok = False
        else:
            print(f"  OK   {name} -> {got!r}")

    print("self-test PASS" if ok else "self-test FAILED: 判据失效")
    return 0 if ok else 2


def _flag(argv: list[str], name: str) -> str | None:
    if name in argv and argv.index(name) + 1 < len(argv):
        return argv[argv.index(name) + 1]
    return None


if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--self-test" in argv:
        raise SystemExit(self_test())

    cmd = "check"
    if argv and not argv[0].startswith("-"):
        cmd, argv = argv[0], argv[1:]

    now = now_default()
    wt_flag = _flag(argv, "--worktree")
    agent = _flag(argv, "--agent")

    if cmd == "check":
        raise SystemExit(cmd_check(now))
    if cmd == "list":
        raise SystemExit(cmd_list(now))
    if cmd == "preflight":
        if not wt_flag:
            print(
                "用法：preflight --worktree <路径> [--agent <名>] "
                "[--paths <glob[,glob]>] [--stale-hours 4]"
            )
            raise SystemExit(2)
        raw_hours = _flag(argv, "--stale-hours")
        try:
            fresh = float(raw_hours) if raw_hours else 4.0
        except ValueError:
            print(f"用法：--stale-hours 必须是数字，实得 {raw_hours}")
            raise SystemExit(2)
        raise SystemExit(cmd_preflight(Path(wt_flag), agent, now, _flag(argv, "--paths"), fresh))
    if cmd == "claim":
        paths = _flag(argv, "--paths")
        if not wt_flag or not paths:
            print("用法：claim --worktree <路径> --paths <glob[,glob]> [--agent <名>] [--hours 4] [--intent '...']")
            raise SystemExit(2)
        hours_raw = _flag(argv, "--hours")
        try:
            hours = float(hours_raw) if hours_raw else 4.0
        except ValueError:
            print(f"用法：--hours 必须是数字，实得 {hours_raw}")
            raise SystemExit(2)
        intent = (_flag(argv, "--intent") or "").strip()
        # 写侧必须自己校验读侧会判的东西：`parse_claims` 把空意图判 CLAIM_MALFORMED，
        # 而这里原先 `or ""` 直接落盘并回显「已认领」——坏行要等到 CI 的 Lint job 才暴露，
        # 而 Lint 门住 Build/E2E/发布。实测 2026-10-17：漏传 --intent 的认领让 PR #113 变红。
        if not intent:
            print("用法：claim 必须带 --intent \"<一句话意图>\"（该字段是活态表的必填列）")
            raise SystemExit(2)
        raise SystemExit(cmd_claim(Path(wt_flag), paths, agent, hours, intent, now))
    if cmd == "release":
        if not agent:
            print("用法：release --agent <名> [--worktree <路径>]")
            raise SystemExit(2)
        raise SystemExit(cmd_release(agent, Path(wt_flag) if wt_flag else None))
    if cmd == "prune":
        raise SystemExit(cmd_prune(now))

    print(f"未知子命令：{cmd}")
    print("可用：check / list / preflight / claim / release / prune / --self-test")
    raise SystemExit(2)
