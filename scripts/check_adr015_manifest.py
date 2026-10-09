#!/usr/bin/env python3
r"""ADR-015 登记表门禁：未接线的云盘 / 预览组件不得被当作死代码删除。

背景：`web/components/files/**` 与 `web/components/im/FilePreview.tsx` 共 20 个文件，
在当前代码里**静态零引用**——下一个以"清理死代码"为名动手的人，没有任何东西会拦住他。
ADR-015 用文档写了约束（§5），而文档拦不住：**隐性状态要变成机器可判的契约。**

判据（红因集合）：
    ADR015_FILE_MISSING   登记表里的文件不见了   -> 有人删了却未按 ADR-015 §5 更新 ADR
    ADR015_UNREGISTERED   扫描范围内出现表外文件 -> 新增/移动了却未登记
    ADR015_MANIFEST_DIRTY 登记表自身有条目重复   -> 表已经不是一份可信清单

只钉 ADR-015 §5 字面禁止的那件事——**删除**。
刻意不做"抬头标记校验"：那需要往 20 个源文件里注入注释，而同一份信息已经在
登记表的抬头集中写清楚了；无谓地改这 20 个文件反而会和并行会话的改动打架。

本闸门的诚实边界：登记表本身是可编辑的，所以"删文件 + 顺手删表里那一行"可以绕过它。
这与仓库里既有的棘轮闸门（如 check_v1_guard_ratchet.py 的基线）是同一信任级别：
把默认动作变成红灯，让改表成为一个**显式的、可被 review 的动作**，而不是顺手为之。
FAIL 文案明确禁止那种改法。

用法：
    python scripts/check_adr015_manifest.py
    python scripts/check_adr015_manifest.py --self-test
"""
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_REL = "scripts/adr015-manifest.txt"

# 扫描范围：目录（递归全部文件）与单文件，路径均相对仓库根
SCAN_DIRS = ["web/components/files"]
SCAN_FILES = ["web/components/im/FilePreview.tsx"]

ADR_REF = "docs/decisions/ADR-015-未接线的云盘与预览组件登记.md §5"


def parse_manifest(text):
    """返回 [路径]；# 与空行跳过。重复项保留（由 check 判脏）。"""
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line)
    return out


def scoped_files(root):
    """扫描范围内实际存在的全部文件（相对 root 的 posix 路径）。"""
    found = set()
    for d in SCAN_DIRS:
        base = root / d
        if base.is_dir():
            for p in base.rglob("*"):
                if p.is_file():
                    found.add(p.relative_to(root).as_posix())
    for f in SCAN_FILES:
        if (root / f).is_file():
            found.add(f)
    return found


def check(root, manifest):
    """返回 [(code, msg)]，去重并按 code 稳定排序。"""
    failures = []
    seen = {}
    for rel in manifest:
        seen[rel] = seen.get(rel, 0) + 1
    for rel, n in sorted(seen.items()):
        if n > 1:
            failures.append((
                "ADR015_MANIFEST_DIRTY",
                "登记表条目重复 %d 次：%s" % (n, rel),
            ))

    listed = set(manifest)
    for rel in sorted(listed):
        if not (root / rel).is_file():
            failures.append((
                "ADR015_FILE_MISSING",
                "%s 已不存在——若确实要删/接线，请先改 ADR-015 状态并同提交更新登记表" % rel,
            ))

    for rel in sorted(scoped_files(root) - listed):
        failures.append((
            "ADR015_UNREGISTERED",
            "%s 在 ADR-015 扫描范围内却未登记（新增请补登记表，或把它移出该目录）" % rel,
        ))
    return sorted(set(failures))


def _lst(items):
    return ", ".join(items) if items else "无"


def self_test():
    """注入式自检。沿用本仓库约定：**断言红因集合相等**，不是"变红了"。"""
    tmp = Path(tempfile.mkdtemp())
    try:
        def write(rel):
            p = tmp / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("export default 1;\n", encoding="utf-8")

        good = [
            "web/components/files/FileBrowser.tsx",
            "web/components/files/previews/CodePreview.tsx",
            "web/components/im/FilePreview.tsx",
        ]
        for rel in good:
            write(rel)

        cases = [
            ("闭合（表 == 实际）", good, set()),
            # 有人删了文件却没更新 ADR / 登记表
            ("登记文件被删除",
             good + ["web/components/files/FileUploader.tsx"],
             {"ADR015_FILE_MISSING"}),
            # 新增文件却未登记
            ("目录下出现未登记新文件",
             good[:-1],
             {"ADR015_UNREGISTERED"}),
            # 条目重复
            ("登记表条目重复",
             good + ["web/components/files/FileBrowser.tsx"],
             {"ADR015_MANIFEST_DIRTY"}),
            # 多因并存
            ("删除 + 未登记 并存",
             ["web/components/files/previews/CodePreview.tsx",
              "web/components/files/Ghost.tsx"],
             {"ADR015_FILE_MISSING", "ADR015_UNREGISTERED"}),
            # 文件被"搬家"而不是删除：旧路径缺失 + 新路径未登记
            ("文件被移动到扫描范围内的新路径",
             ["web/components/files/_archive/FileBrowser.tsx",
              "web/components/files/previews/CodePreview.tsx",
              "web/components/im/FilePreview.tsx"],
             {"ADR015_FILE_MISSING", "ADR015_UNREGISTERED"}),
            # 三因并存
            ("删除 + 未登记 + 重复 并存",
             good[:-1] + ["web/components/files/Ghost.tsx",
                          "web/components/files/FileBrowser.tsx"],
             {"ADR015_FILE_MISSING", "ADR015_UNREGISTERED", "ADR015_MANIFEST_DIRTY"}),
            # 空表但目录里有文件：整批未登记，必须全红
            ("空表（全部未登记）",
             [],
             {"ADR015_UNREGISTERED"}),
        ]

        bad = 0
        for label, manifest, want in cases:
            codes = set(c for c, _ in check(tmp, manifest))
            ok = codes == want
            bad += 0 if ok else 1
            note = "" if ok else "   <-- 实际红因 " + _lst(sorted(codes))
            print("  [" + ("OK " if ok else "BAD") + "] " + label + ": 期望 "
                  + (_lst(sorted(want)) if want else "通过") + note)
        print("自检结果: " + ("全部符合预期" if bad == 0 else "%d 项失效" % bad))
        return 0 if bad == 0 else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    if "--self-test" in sys.argv[1:]:
        print("== 注入式自检（临时目录当真 root）==")
        return self_test()

    manifest_p = ROOT / MANIFEST_REL
    if not manifest_p.exists():
        print("登记表不存在：%s" % MANIFEST_REL)
        return 1
    manifest = parse_manifest(manifest_p.read_text(encoding="utf-8"))

    files = scoped_files(ROOT)
    print("ADR-015 扫描范围内实际文件：%d 个；登记表条目：%d 条（去重后 %d）"
          % (len(files), len(manifest), len(set(manifest))))

    failures = check(ROOT, manifest)
    if failures:
        print("")
        print("FAIL: ADR-015 登记表不闭合")
        for code, msg in failures:
            print("  - [" + code + "] " + msg)
        print("")
        print("这 20 个文件是「后端已上线、UI 没挂载」的半成品，不是死代码。")
        print("要动它们，先读 %s。" % ADR_REF)
        print("不许只改登记表、不改 ADR。")
        return 1

    print("PASS: 登记表与实际一致（%d 个文件全部在册）。" % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
