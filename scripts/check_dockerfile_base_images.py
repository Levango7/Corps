#!/usr/bin/env python3
"""Dockerfile 基础镜像门禁：FROM 必须全解析、tag 必须明确、镜像必须取得到。

背景（2026-10-21 事故，代价是连续两个版本发不出镜像）：
    `web/Dockerfile` 三个 FROM 写死第三方镜像源 `docker.m.daocloud.io/library/node:22-alpine`
    （理由是"本机/内网 Docker Hub 不可达"）。该镜像源在 2026-10-20 21:41 UTC 最后一次
    成功拉取后失效，此后 GitHub 托管 runner 上解析该域名直接 NXDOMAIN：

        #5 ERROR: failed to do request: Head
           "https://docker.m.daocloud.io/v2/library/node/manifests/22-alpine"
          dial tcp: lookup docker.m.daocloud.io on 168.63.129.16:53: no such host

    后果不是"某个版本没发出来"，而是 **main 上每一次 push 的 Publish image (GHCR) 全部 failure**，
    `:latest` 断了一整天。v0.8.0 与 v0.8.1 因此都没有容器镜像。

    为什么潜伏了这么久：**PR 阶段没有任何一步会碰 Dockerfile**——
      - `Publish image (GHCR)` 的 if 是 `push && (main || tags/v*)`，PR 事件下直接 skipped；
      - `Build` job 跑的是 `pnpm run build`（Next.js 构建），不是 docker build。
    于是"Dockerfile 改坏了"这件事在 PR 上完全不可见，只会在合并之后炸。

判据（四条，各自独立红因）：
    1. UNRESOLVED_ARG — FROM 里的 ${VAR} 没有默认值也没被 --build-arg 提供，构建必然失败
    2. NO_TAG / LATEST_TAG — 镜像没写 tag（隐式 :latest）或显式 :latest，产物不可复现
    3. TAG_DRIFT — 同一仓库的镜像在不同阶段用了不同 tag（历史上出现过
       deps/builder 用 node:20 编译、runner 用 node:22 运行，导致 prisma engines /
       sharp 等原生模块版本错配）
    4. UNREACHABLE / TAG_NOT_FOUND — 该镜像从其 registry 取不到 manifest。
       **直接查 registry v2 API，不依赖 docker 守护进程**——门禁自己不能再引入
       "本地没起 Docker 就跑不了"这种新的脆弱点。

    第 4 条就是本次事故的直接判据：daocloud 在 runner 上会以 DNS 失败呈现，
    报 UNREACHABLE 而不是等到发版才炸。

用法：
    python scripts/check_dockerfile_base_images.py              # 检查，失败退出 1
    python scripts/check_dockerfile_base_images.py --offline    # 跳过联网探测（本机用）
    python scripts/check_dockerfile_base_images.py --list       # 只打印解析结果
    python scripts/check_dockerfile_base_images.py --self-test  # 自测断言

    ⚠️ CI 一律不带 --offline：联网探测正是这道门禁存在的理由。

    --offline 的用途：国内网络下 Docker Hub 本身不可达，本机开发会用
    `--build-arg NODE_IMAGE=<国内镜像源>` 覆盖构建，此时联网探测必然报红，
    但那是本机网络环境问题、不是 Dockerfile 缺陷，故允许跳过。
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DOCKERFILE = ROOT / "web" / "Dockerfile"

FROM_RE = re.compile(r"^\s*FROM\s+(?P<args>.+?)\s*$", re.IGNORECASE)
ARG_RE = re.compile(
    r"^\s*ARG\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)(?:=(?P<default>\S+))?\s*$", re.IGNORECASE
)
# ${VAR} / ${VAR:-default} / $VAR 三种写法
VAR_RE = re.compile(
    r"\$\{(?P<braced>[A-Za-z_][A-Za-z0-9_]*)(?::-(?P<default>[^}]*))?\}"
    r"|\$(?P<bare>[A-Za-z_][A-Za-z0-9_]*)"
)

MANIFEST_ACCEPT = (
    "application/vnd.oci.image.index.v1+json,"
    "application/vnd.docker.distribution.manifest.list.v2+json,"
    "application/vnd.oci.image.manifest.v1+json,"
    "application/vnd.docker.distribution.manifest.v2+json"
)

# 红因代码 — 自测按"集合相等"断言，多一条少一条都算失败
NO_FROM = "NO_FROM"
UNRESOLVED_ARG = "UNRESOLVED_ARG"
NO_TAG = "NO_TAG"
LATEST_TAG = "LATEST_TAG"
TAG_DRIFT = "TAG_DRIFT"
UNREACHABLE = "UNREACHABLE"
TAG_NOT_FOUND = "TAG_NOT_FOUND"
UNVERIFIABLE = "UNVERIFIABLE"


# ────────────────────────────── 解析 ──────────────────────────────


def _substitute(text: str, variables: dict[str, str]) -> tuple[str, list[str]]:
    """替换 $VAR / ${VAR} / ${VAR:-default}，返回 (结果, 未能解析的变量名列表)。"""
    unresolved: list[str] = []

    def repl(m: re.Match[str]) -> str:
        if m.group("bare"):
            name = m.group("bare")
            if name in variables:
                return variables[name]
            unresolved.append(name)
            return m.group(0)
        name = m.group("braced")
        if name in variables:
            return variables[name]
        default = m.group("default")
        if default is not None:
            return default
        unresolved.append(name)
        return m.group(0)

    return VAR_RE.sub(repl, text), unresolved


def parse_dockerfile(text: str) -> tuple[list[dict], list[dict]]:
    """返回 (阶段列表, 解析期发现的问题)。

    阶段元素：{"line": int, "image": str, "raw": str}
    """
    variables: dict[str, str] = {}
    stages: list[dict] = []
    problems: list[dict] = []

    for lineno, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if not stages:
            m = ARG_RE.match(raw_line)
            if m and m.group("default") is not None:
                variables[m.group("name")] = m.group("default")
                continue

        m = FROM_RE.match(raw_line)
        if not m:
            continue

        args = m.group("args").strip()
        # 去掉 --platform=... 之类的 FROM 级参数
        tokens = args.split()
        while tokens and tokens[0].startswith("--"):
            tokens.pop(0)
        if not tokens:
            problems.append(
                {"code": NO_FROM, "line": lineno, "detail": f"FROM 缺少镜像名：{raw_line.strip()}"}
            )
            continue

        resolved, unresolved = _substitute(tokens[0], variables)
        for name in dict.fromkeys(unresolved):
            problems.append(
                {
                    "code": UNRESOLVED_ARG,
                    "line": lineno,
                    "detail": f"变量 ${{{name}}} 无默认值且未经 --build-arg 提供，"
                    f"构建必然失败（FROM {tokens[0]}）",
                }
            )
        # 未能解析的镜像名不再参与 tag/漂移/可达性判定：否则一个根因会被报成
        # 「UNRESOLVED_ARG + 没有 tag + 镜像取不到」三条级联噪音，掩盖真正的错因。
        stages.append(
            {"line": lineno, "image": resolved, "raw": tokens[0], "resolved": not unresolved}
        )

    if not stages and not problems:
        problems.append({"code": NO_FROM, "line": 0, "detail": "Dockerfile 里没有任何 FROM"})

    return stages, problems


def split_image(ref: str) -> tuple[str, str, str | None, str | None]:
    """把镜像引用拆成 (registry_host, repository, tag, digest)。"""
    digest = None
    if "@" in ref:
        ref, digest = ref.split("@", 1)

    tag = None
    last = ref.rsplit("/", 1)[-1]
    if ":" in last:
        ref, tag = ref.rsplit(":", 1)

    parts = ref.split("/")
    if len(parts) > 1 and ("." in parts[0] or ":" in parts[0] or parts[0] == "localhost"):
        host = parts[0]
        repo = "/".join(parts[1:])
    else:
        host = "registry-1.docker.io"
        repo = ref if "/" in ref else f"library/{ref}"

    return host, repo, tag, digest


# ────────────────────────────── 探测 ──────────────────────────────

MANIFEST_OK = "ok"
MANIFEST_NOT_FOUND = "not_found"
MANIFEST_UNREACHABLE = "unreachable"
# 429 / 5xx：registry 侧暂时不可用。这既不是 Dockerfile 的缺陷，也不会是永久的，
# 判红等于让基础设施抖动卡死所有 PR（假红），故单独成一类、只警告不拦。
MANIFEST_TRANSIENT = "transient"


def probe_manifest(ref: str, timeout: int = 20, attempts: int = 3) -> tuple[str, str]:
    """查 registry v2 manifest 是否可取。返回 (状态, 说明)。不依赖 docker 守护进程。"""
    host, repo, tag, digest = split_image(ref)
    reference = digest or tag
    if reference is None:
        return MANIFEST_NOT_FOUND, "镜像未指定 tag/digest"

    url = f"https://{host}/v2/{repo}/manifests/{reference}"
    last_reason = ""
    transient = False

    for attempt in range(1, attempts + 1):
        try:
            status, headers = _head(url, timeout)
            if status in (200, 203):
                return MANIFEST_OK, f"HTTP {status}"
            if status == 404:
                return MANIFEST_NOT_FOUND, "HTTP 404（tag/digest 不存在）"
            if status == 401:
                token = _fetch_token(
                    _header(headers, "www-authenticate"), host, repo, timeout
                )
                if token:
                    code, _ = _head(url, timeout, token=token)
                    if code in (200, 203):
                        return MANIFEST_OK, f"HTTP {code}"
                    if code in (401, 404):
                        # GHCR 等注册表会用 401 掩盖「不存在」（避免泄露私有镜像的存在性），
                        # 所以「拿到 token 后仍被拒」在公开基础镜像场景下等价于不存在。
                        return (
                            MANIFEST_NOT_FOUND,
                            f"HTTP {code}（取得 token 后仍被拒：tag 不存在，或镜像需授权）",
                        )
                    if code == 429 or 500 <= code < 600:
                        transient = True
                        last_reason = f"HTTP {code}（registry 暂时不可用）"
                    else:
                        last_reason = f"HTTP {code}"
                else:
                    # 取不到 token 多半是网络抖动（实测：本机偶发一次后重试即成功）。
                    # 这里**不能直接判 UNREACHABLE**，否则一次抖动就让所有 PR 假红。
                    # 落到循环末尾重试；全部尝试都拿不到才报不可达。
                    last_reason = "HTTP 401 且取不到匿名 token（该 registry 要求鉴权，或网络抖动）"
            elif status == 429 or 500 <= status < 600:
                transient = True
                last_reason = f"HTTP {status}（registry 暂时不可用）"
            else:
                last_reason = f"HTTP {status}"
        except urllib.error.URLError as exc:
            # DNS 失败（daocloud 在 runner 上的形态）会落到这里
            last_reason = f"网络不可达：{exc.reason}"
        except OSError as exc:
            last_reason = f"网络不可达：{exc}"

        if attempt < attempts:
            time.sleep(2 * attempt)

    if transient:
        return MANIFEST_TRANSIENT, last_reason
    return MANIFEST_UNREACHABLE, last_reason


def _header(headers, name: str, default: str = "") -> str:
    """大小写不敏感地取响应头。

    必须这么取：`dict(resp.headers)` 的 key 大小写**不确定**——http.client 对一部分头
    做规范化（如 `docker-distribution-api-version` 变小写），对另一部分保持原样
    （`Content-Type`）。直接 `.get("WWW-Authenticate")` 会静默取不到，
    于是"拿不到 token"被误报成"该 registry 要鉴权"，而不是"我的解析坏了"。
    2026-10-22 在 CI 上就是这么翻车的：解析全对，却把 node:22-alpine 判成不可达。
    """
    if not headers:
        return default
    lower = name.lower()
    for key, value in headers.items():
        if key.lower() == lower:
            return value
    return default


def _head(url: str, timeout: int, token: str | None = None):
    headers = {"Accept": MANIFEST_ACCEPT, "User-Agent": "corps-dockerfile-gate/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method="HEAD", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers or {})


def _token_endpoint(www_authenticate: str, host: str, repo: str) -> tuple[str, str, str]:
    """从 WWW-Authenticate 质询里解出 (realm, service, scope)；缺失时按 registry 约定兜底。

    抽成纯函数是为了能被自测断言 —— 2026-10-22 的 CI 翻车正是发生在这一层：
    token 端点解错导致 node:22-alpine 被判 UNREACHABLE，而当时的自测用桩绕过了
    HTTP，完全覆盖不到。
    """
    realm = service = scope = None
    m = re.search(r'realm="([^"]+)"', www_authenticate or "")
    if m:
        realm = m.group(1)
    m = re.search(r'service="([^"]+)"', www_authenticate or "")
    if m:
        service = m.group(1)
    m = re.search(r'scope="([^"]+)"', www_authenticate or "")
    if m:
        scope = m.group(1)

    if not realm:
        # Docker Hub 的 token 端点在 auth.docker.io，不在 registry-1.docker.io 上——
        # 猜 `https://{host}/token` 对它是错的（对 ghcr.io 恰好对，所以本机测试
        # 曾误判这条兜底可用）。
        if host in ("registry-1.docker.io", "index.docker.io", "docker.io"):
            realm = "https://auth.docker.io/token"
            service = service or "registry.docker.io"
        else:
            realm = f"https://{host}/token"

    if not service:
        service = ""
    if not scope:
        scope = f"repository:{repo}:pull"

    return realm, service, scope


def _fetch_token(www_authenticate: str, host: str, repo: str, timeout: int) -> str | None:
    """按 Bearer 质询取匿名 token。"""
    realm, service, scope = _token_endpoint(www_authenticate, host, repo)

    params = [f"scope={urllib.request.quote(scope)}"]
    if service:
        params.append(f"service={urllib.request.quote(service)}")
    url = f"{realm}?{'&'.join(params)}"

    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return payload.get("token") or payload.get("access_token")
    except (urllib.error.URLError, OSError, ValueError):
        return None


# ────────────────────────────── 判定 ──────────────────────────────


def collect_findings(
    text: str, probe=None
) -> tuple[list[dict], list[dict]]:
    """返回 (阶段列表, 全部发现)。probe 为空则跳过联网判定（自测用桩注入）。"""
    stages, findings = parse_dockerfile(text)

    seen: dict[str, tuple[str, int]] = {}
    for stage in stages:
        if not stage.get("resolved", True):
            continue
        host, repo, tag, digest = split_image(stage["image"])
        key = f"{host}/{repo}"

        if digest is None:
            if tag is None:
                findings.append(
                    {
                        "code": NO_TAG,
                        "line": stage["line"],
                        "detail": f"{stage['image']} 未写 tag（隐式 :latest），产物不可复现",
                    }
                )
            elif tag == "latest":
                findings.append(
                    {
                        "code": LATEST_TAG,
                        "line": stage["line"],
                        "detail": f"{stage['image']} 使用 :latest，产物不可复现",
                    }
                )

            if tag is not None and key in seen:
                prev_tag, prev_line = seen[key]
                if prev_tag != tag:
                    findings.append(
                        {
                            "code": TAG_DRIFT,
                            "line": stage["line"],
                            "detail": f"{key} 在第 {prev_line} 行用 {prev_tag}、"
                            f"第 {stage['line']} 行用 {tag}，跨阶段版本漂移",
                        }
                    )
            if tag is not None:
                seen.setdefault(key, (tag, stage["line"]))

    if probe is not None:
        for image in dict.fromkeys(s["image"] for s in stages if s.get("resolved", True)):
            status, detail = probe(image)
            if status == MANIFEST_NOT_FOUND:
                findings.append(
                    {"code": TAG_NOT_FOUND, "line": 0, "detail": f"{image}：{detail}"}
                )
            elif status == MANIFEST_UNREACHABLE:
                findings.append(
                    {
                        "code": UNREACHABLE,
                        "line": 0,
                        "detail": f"{image}：{detail}"
                        "（该镜像取不到，docker build 会在第一个 FROM 处失败）",
                    }
                )
            elif status == MANIFEST_TRANSIENT:
                findings.append(
                    {
                        "code": UNVERIFIABLE,
                        "line": 0,
                        "detail": f"{image}：{detail}",
                        "severity": "warn",
                    }
                )

    return stages, findings


# ────────────────────────────── 自测 ──────────────────────────────

_CLEAN = """\
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS deps
RUN echo a
FROM ${NODE_IMAGE} AS runner
RUN echo b
"""

_UNRESOLVED = """\
FROM ${NODE_IMAGE} AS deps
RUN echo a
"""

_NO_TAG = """\
FROM node AS deps
RUN echo a
"""

_LATEST = """\
FROM node:latest AS deps
RUN echo a
"""

_DRIFT = """\
FROM node:20-alpine AS deps
RUN echo a
FROM node:22-alpine AS runner
RUN echo b
"""

_NO_FROM = """\
# 只有注释，没有 FROM
RUN echo a
"""


def _ok_probe(_ref: str) -> tuple[str, str]:
    return MANIFEST_OK, "HTTP 200"


def _unreachable_probe(_ref: str) -> tuple[str, str]:
    return MANIFEST_UNREACHABLE, "网络不可达：Name or service not known"


def _notfound_probe(_ref: str) -> tuple[str, str]:
    return MANIFEST_NOT_FOUND, "HTTP 404（tag/digest 不存在）"


def _transient_probe(_ref: str) -> tuple[str, str]:
    return MANIFEST_TRANSIENT, "HTTP 429（registry 暂时不可用）"


def self_test() -> int:
    cases = [
        ("干净的多阶段 Dockerfile", _CLEAN, _ok_probe, set()),
        ("未定义变量", _UNRESOLVED, _ok_probe, {UNRESOLVED_ARG}),
        ("缺 tag", _NO_TAG, _ok_probe, {NO_TAG}),
        ("显式 latest", _LATEST, _ok_probe, {LATEST_TAG}),
        ("跨阶段 tag 漂移", _DRIFT, _ok_probe, {TAG_DRIFT}),
        ("完全没有 FROM", _NO_FROM, _ok_probe, {NO_FROM}),
        ("镜像取不到（daocloud 事故形态）", _CLEAN, _unreachable_probe, {UNREACHABLE}),
        ("tag 不存在", _CLEAN, _notfound_probe, {TAG_NOT_FOUND}),
        ("registry 临时故障不判阻断", _CLEAN, _transient_probe, {UNVERIFIABLE}),
        ("不联网时不做可达性判定", _CLEAN, None, set()),
    ]

    failures: list[str] = []
    for name, text, probe, expected in cases:
        _, findings = collect_findings(text, probe)
        actual = {f["code"] for f in findings}
        if actual != expected:
            failures.append(
                f"  [{name}] 期望红因 {sorted(expected) or '无'}，"
                f"实际 {sorted(actual) or '无'}"
            )
        else:
            print(f"[dockerfile-gate] self-test OK：{name}")

    # 关键断言：UNVERIFIABLE 必须是 warn 级，否则 registry 抖动会变成假红；
    # 其余每个红因都必须是阻断级，否则门禁形同虚设。
    _, findings = collect_findings(_CLEAN, _transient_probe)
    sev = {f["code"]: f.get("severity", "error") for f in findings}
    if sev.get(UNVERIFIABLE) != "warn":
        failures.append(f"  [严重级别] {UNVERIFIABLE} 应为 warn，实际 {sev.get(UNVERIFIABLE)}")
    else:
        print("[dockerfile-gate] self-test OK：UNVERIFIABLE 为 warn 级，不阻断")

    for code, probe in (
        (UNREACHABLE, _unreachable_probe),
        (TAG_NOT_FOUND, _notfound_probe),
    ):
        _, fs = collect_findings(_CLEAN, probe)
        bad = [f for f in fs if f["code"] == code and f.get("severity") == "warn"]
        if bad:
            failures.append(f"  [严重级别] {code} 不得为 warn（会放过真实缺陷）")
    if not any("不得为 warn" in x for x in failures):
        print("[dockerfile-gate] self-test OK：真实缺陷一律为阻断级")

    # 负例：干净文件在联网桩下必须一条发现都没有（防止检测器退化成"永远 PASS"的反面：
    # 永远红）。上面第 1 条已覆盖，这里额外断言解析出的镜像确实是 node:22-alpine。
    stages, _ = collect_findings(_CLEAN, None)
    images = [s["image"] for s in stages]
    if images != ["node:22-alpine", "node:22-alpine"]:
        failures.append(f"  [ARG 默认值替换] 期望两阶段都解析为 node:22-alpine，实际 {images}")
    else:
        print("[dockerfile-gate] self-test OK：ARG 默认值在多阶段 FROM 中正确替换")

    # ── 下面三组是 2026-10-22 CI 翻车后的补钉 ──────────────────────────────
    # 当时自测全绿、CI 却把 node:22-alpine 判成不可达：桩绕过了 HTTP 层，
    # 而 bug 恰好全在那一层。补成纯函数断言后才可能被抓住。

    # 1) 响应头必须大小写不敏感地取。实测 `dict(resp.headers)` 会把一部分头
    #    规范化成小写、另一部分保持原样，`.get("WWW-Authenticate")` 会静默落空。
    for probe_headers in (
        {"Www-Authenticate": 'Bearer realm="https://auth.docker.io/token"'},
        {"WWW-AUTHENTICATE": 'Bearer realm="https://auth.docker.io/token"'},
        {"www-authenticate": 'Bearer realm="https://auth.docker.io/token"'},
    ):
        got = _header(probe_headers, "www-authenticate")
        if "realm=" not in got:
            failures.append(f"  [响应头大小写] {list(probe_headers)} 未取到值，实际 {got!r}")
            break
    else:
        print("[dockerfile-gate] self-test OK：响应头大小写不敏感")

    # 2) token 端点解析：有质询时照用，无质询时 Docker Hub 必须落到 auth.docker.io
    cases_endpoint = [
        (
            "带质询",
            'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",'
            'scope="repository:library/node:pull"',
            "registry-1.docker.io",
            "library/node",
            (
                "https://auth.docker.io/token",
                "registry.docker.io",
                "repository:library/node:pull",
            ),
        ),
        (
            "Docker Hub 无质询兜底",
            "",
            "registry-1.docker.io",
            "library/node",
            ("https://auth.docker.io/token", "registry.docker.io", "repository:library/node:pull"),
        ),
        (
            "GHCR 无质询兜底",
            "",
            "ghcr.io",
            "levango7/corps",
            ("https://ghcr.io/token", "", "repository:levango7/corps:pull"),
        ),
    ]
    for name, chal, host, repo, expected in cases_endpoint:
        got = _token_endpoint(chal, host, repo)
        if got != expected:
            failures.append(f"  [token 端点/{name}] 期望 {expected}，实际 {got}")
        else:
            print(f"[dockerfile-gate] self-test OK：token 端点解析（{name}）")

    # 3) 镜像引用拆分：隐式 Docker Hub 要补 library/ 前缀，显式 registry 不能补
    cases_split = [
        ("node:22-alpine", ("registry-1.docker.io", "library/node", "22-alpine", None)),
        (
            "docker.m.daocloud.io/library/node:22-alpine",
            ("docker.m.daocloud.io", "library/node", "22-alpine", None),
        ),
        (
            "ghcr.io/levango7/corps:0.8.2",
            ("ghcr.io", "levango7/corps", "0.8.2", None),
        ),
        ("nginx", ("registry-1.docker.io", "library/nginx", None, None)),
    ]
    for ref, expected in cases_split:
        got = split_image(ref)
        if got != expected:
            failures.append(f"  [镜像拆分] {ref} 期望 {expected}，实际 {got}")
    if not any("镜像拆分" in x for x in failures):
        print("[dockerfile-gate] self-test OK：镜像引用拆分（隐式 library/ 前缀）")

    if failures:
        print("\n[dockerfile-gate] self-test FAILED：")
        for line in failures:
            print(line)
        return 1

    print(f"\n[dockerfile-gate] self-test 全部通过（{len(cases) + 8} 条）")
    return 0


# ────────────────────────────── 入口 ──────────────────────────────


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    offline = "--offline" in sys.argv
    list_only = "--list" in sys.argv

    dockerfile = DEFAULT_DOCKERFILE
    for i, arg in enumerate(sys.argv):
        if arg == "--dockerfile" and i + 1 < len(sys.argv):
            dockerfile = Path(sys.argv[i + 1])

    if not dockerfile.exists():
        print(f"[dockerfile-gate] 找不到 {dockerfile}", file=sys.stderr)
        return 1

    text = dockerfile.read_text(encoding="utf-8")
    probe = None if offline else probe_manifest

    stages, findings = collect_findings(text, probe)

    print(f"[dockerfile-gate] 目标：{dockerfile.relative_to(ROOT) if dockerfile.is_relative_to(ROOT) else dockerfile}")
    print(f"[dockerfile-gate] 解析出 {len(stages)} 个构建阶段：")
    for stage in stages:
        print(f"  L{stage['line']:<4} {stage['image']}")
    if offline:
        print("[dockerfile-gate] 已跳过联网可达性探测（--offline）")

    if list_only:
        return 0

    blocking = [f for f in findings if f.get("severity") != "warn"]
    warnings = [f for f in findings if f.get("severity") == "warn"]

    for f in warnings:
        loc = f"L{f['line']}" if f["line"] else "--"
        print(f"[dockerfile-gate] [WARN] {loc} [{f['code']}] {f['detail']}")
    if warnings:
        print(
            "[dockerfile-gate] 上面是 registry 侧临时故障，不判红（否则基础设施抖动会卡死所有 PR）；"
            "若持续出现请人工确认该镜像是否仍可拉取。"
        )

    if blocking:
        print("\n[dockerfile-gate] [FAIL] 发现以下问题：")
        for f in blocking:
            loc = f"L{f['line']}" if f["line"] else "--"
            print(f"  - [{f['code']}] {loc} {f['detail']}")
        print(
            "\n修复方向："
            "\n  - UNRESOLVED_ARG：给全局 ARG 补默认值，或在构建时用 --build-arg 提供"
            "\n  - NO_TAG / LATEST_TAG：钉到精确 tag，禁止隐式或显式 :latest"
            "\n  - TAG_DRIFT：同仓库镜像在各阶段用同一 tag（原生模块版本错配的经典成因）"
            "\n  - UNREACHABLE / TAG_NOT_FOUND：换回该 registry 上真实可取到的镜像；"
            "\n    这正是 v0.8.0/v0.8.1 没有镜像的根因——写死只在一侧可用的第三方镜像源，"
            "\n    等于把发布链路押在别人的可用性上。"
        )
        return 1

    print("\n[dockerfile-gate] 通过：FROM 全部解析、tag 明确、同仓库无漂移、镜像均可取到")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
