import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, inviteMember, TEST_PASSWORD } from "../helpers";

/**
 * 文档版本回滚的**不可逆数据丢失**回归锚点（本批最关键的测试）
 *
 * ## 缺陷链（已核实）
 *  1. `DocumentEditor.tsx:463` `onBlur={() => save()}` —— 保存由 blur 触发；
 *  2. `save()` 防抖（`:200` `if (busy) return`），无参调用 `publish:false`（`:209`）；
 *  3. `documents/[id]/route.ts` 的 PATCH **只覆盖 markdown，不建任何版本行**；
 *  4. 用户点「回滚」→ 触发 blur → PATCH 在路上 → restore 覆盖 markdown
 *     → 用户刚输入的内容被覆盖，且**从未存在于任何版本行**，事后无法补救。
 *
 * ## 本文件证明什么
 *  - AC：回滚前当前内容**仍能通过版本列表 API 取回**（快照真的建了，且存的是回滚前内容）；
 *  - AC：无写权限用户（viewer）调 restore → 401/403，**且文档内容未变**；
 *  - AC：版本不存在 → 404；
 *  - AC：连续两次回滚 → 产生**两条**独立快照（不覆盖上一条快照）。
 *
 * 这四条任意一条红掉都意味着丢数据缺陷复发。
 */

interface VersionRow {
  id: string;
  version: number;
  markdown: string;
  message: string | null;
  source: string;
}

interface Fixture {
  wid: string;
  ownerToken: string;
  docId: string;
  /** 版本 id 索引：版本号 → id */
  v1Id: string;
  v2Id: string;
  v1Markdown: string;
  v2Markdown: string;
  viewerToken: string;
  docTitle: string;
}

let fx: Fixture;

/** 取版本列表（含 markdown），用于验证快照内容而非只看条数 */
async function listVersions(token: string, wid = fx.wid, docId = fx.docId): Promise<VersionRow[]> {
  const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}/versions?limit=100`, {
    headers: authHeader(token),
  });
  expect(res.status, "版本列表应可读").toBe(200);
  const json = (await res.json()) as { data?: { items?: VersionRow[] } };
  return json.data?.items ?? [];
}

/** 读文档当前 markdown（绕过编辑器，直接看服务端状态） */
async function readDoc(token: string, wid = fx.wid, docId = fx.docId): Promise<{ markdown: string }> {
  const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}`, {
    headers: authHeader(token),
  });
  expect(res.status, "文档应可读").toBe(200);
  const json = (await res.json()) as { data?: { markdown?: string } };
  return { markdown: json.data?.markdown ?? "" };
}

/** 用 PATCH 覆盖 markdown（复刻"用户输入 → blur 保存"这条真实路径） */
async function patchMarkdown(token: string, markdown: string): Promise<number> {
  const res = await fetch(`${BASE}/workspaces/${fx.wid}/documents/${fx.docId}`, {
    method: "PATCH",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  return res.status;
}

async function restore(token: string, versionId: string): Promise<Response> {
  return fetch(`${BASE}/workspaces/${fx.wid}/documents/${fx.docId}/versions/${versionId}/restore`, {
    method: "POST",
    headers: authHeader(token),
  });
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "restore-owner", workspaceName: "版本回滚工作区" });
  fx = {
    wid: owner.workspace.id,
    ownerToken: owner.accessToken,
    docId: "",
    v1Id: "",
    v2Id: "",
    v1Markdown: "# v1\n\n第一版内容\n原始行",
    v2Markdown: "# v2\n\n第二版内容\n修改过的行\n新增行",
    viewerToken: "",
    docTitle: "回滚锚点文档",
  };

  // 建文档并落到 v1 内容
  const created = await fetch(`${BASE}/workspaces/${fx.wid}/documents`, {
    method: "POST",
    headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ title: fx.docTitle, markdown: fx.v1Markdown }),
  });
  expect(created.status, "创建文档应成功").toBe(201);
  const createdBody = (await created.json()) as { data?: { id?: string } };
  fx.docId = createdBody.data?.id ?? "";
  expect(fx.docId, "应拿到文档 id").not.toBe("");

  // v1 快照
  const v1res = await fetch(`${BASE}/workspaces/${fx.wid}/documents/${fx.docId}/versions`, {
    method: "POST",
    headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ message: "v1 初始版本" }),
  });
  expect([200, 201]).toContain(v1res.status);
  const v1body = (await v1res.json()) as { data?: { id?: string } };
  fx.v1Id = v1body.data?.id ?? "";
  expect(fx.v1Id).not.toBe("");

  // 改成 v2 内容后再建 v2 快照 → 得到两个可比对的历史版本
  expect(await patchMarkdown(fx.ownerToken, fx.v2Markdown)).toBe(200);
  const v2res = await fetch(`${BASE}/workspaces/${fx.wid}/documents/${fx.docId}/versions`, {
    method: "POST",
    headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ message: "v2 改写版本" }),
  });
  expect([200, 201]).toContain(v2res.status);
  const v2body = (await v2res.json()) as { data?: { id?: string } };
  fx.v2Id = v2body.data?.id ?? "";
  expect(fx.v2Id).not.toBe("");

  // viewer：无写权限用户（documents 矩阵只有 "r"）
  const viewer = await registerUser({ prefix: "restore-viewer" });
  const inv = await inviteMember(fx.ownerToken, fx.wid, viewer.user.email);
  expect(inv.status, "viewer 应被邀请进工作区").toBe(201);
  const setRole = await fetch(`${BASE}/workspaces/${fx.wid}/members/${viewer.user.id}`, {
    method: "PATCH",
    headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(setRole.status, "应能设为 viewer").toBe(200);

  // 刷 wid 绑定的 access token（login 发的 token 不带 wid，会被 wid 守卫拒）
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: viewer.user.email, password: TEST_PASSWORD }),
  });
  const loginCookies = login.headers.getSetCookie?.() ?? [];
  const refresh = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { Cookie: loginCookies.join("; "), "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: fx.wid }),
  });
  const refreshCookies = refresh.headers.getSetCookie?.() ?? [];
  fx.viewerToken =
    refreshCookies
      .find((c) => c.startsWith("access_token="))
      ?.split("=")[1]
      ?.split(";")[0] ?? "";
  expect(fx.viewerToken, "viewer 应拿到 wid token").not.toBe("");
});

describe("POST /documents/{id}/versions/{versionId}/restore — 强制快照防丢数据", () => {
  it("回滚后，回滚前的当前内容仍能通过版本列表 API 取回（快照真的建了且内容正确）", async () => {
    // 复刻真实丢数据时序：用户输入了一段**从未进过版本行**的内容
    const typedOnlyInMemory = "# v2\n\n第二版内容\n修改过的行\n新增行\n用户在 blur 前敲的未保存内容";
    expect(await patchMarkdown(fx.ownerToken, typedOnlyInMemory)).toBe(200);

    const before = await listVersions(fx.ownerToken);
    const countBefore = before.length;

    // 回滚到 v1
    const res = await restore(fx.ownerToken, fx.v1Id);
    expect(res.status, "回滚应成功").toBe(200);

    // 关键断言：回滚前的当前内容成了一个新的版本行，且内容一字不差
    const after = await listVersions(fx.ownerToken);
    expect(after.length, "回滚必须新增一个快照版本行").toBe(countBefore + 1);

    const snapshot = after.find((v) => v.markdown === typedOnlyInMemory);
    expect(
      snapshot,
      `回滚前的内容必须能被版本列表取回。实际快照列表：${JSON.stringify(
        after.map((v) => ({ version: v.version, message: v.message, source: v.source })),
      )}`,
    ).toBeTruthy();
    expect(snapshot?.source, "强制快照的 source 必须是 auto").toBe("auto");
    expect(snapshot?.message, "强制快照须带可识别的说明").toBe("回滚前自动快照");

    // 同时确认 markdown 确实被覆盖成目标版本内容
    const doc = await readDoc(fx.ownerToken);
    expect(doc.markdown, "文档 markdown 应已被回滚为 v1 内容").toBe(fx.v1Markdown);
  });

  it("无写权限用户（viewer）调 restore 返回 401/403 且文档内容未变", async () => {
    const before = await readDoc(fx.ownerToken);
    const versionsBefore = await listVersions(fx.ownerToken);

    const res = await restore(fx.viewerToken, fx.v2Id);
    expect([401, 403], `viewer 必须被拒，实际 ${res.status}`).toContain(res.status);
    // 绝不能 2xx —— 显式再断言一次，避免 [401,403] 断言被误放宽
    expect(res.status).toBeLessThan(500);
    expect(res.ok, "无写权限时绝不能返回 2xx").toBe(false);

    const after = await readDoc(fx.ownerToken);
    expect(after.markdown, "被拒回滚不得改动文档内容").toBe(before.markdown);
    const versionsAfter = await listVersions(fx.ownerToken);
    expect(
      versionsAfter.length,
      "被拒回滚不得留下任何快照（否则会污染版本历史）",
    ).toBe(versionsBefore.length);
  });

  it("版本不存在返回 404，且文档内容未变", async () => {
    const before = await readDoc(fx.ownerToken);
    const versionsBefore = await listVersions(fx.ownerToken);

    const res = await restore(
      fx.ownerToken,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(res.status, "不存在的版本必须 404").toBe(404);

    const after = await readDoc(fx.ownerToken);
    expect(after.markdown, "404 不得改动文档内容").toBe(before.markdown);
    const versionsAfter = await listVersions(fx.ownerToken);
    expect(versionsAfter.length, "404 不得留下快照").toBe(versionsBefore.length);
  });

  it("连续两次回滚产生两条独立快照（不覆盖上一条快照）", async () => {
    const typedA = "# 回滚演练A\n内容A";
    const typedB = "# 回滚演练B\n内容B";

    // 第一次：写入 A，回滚到 v1
    expect(await patchMarkdown(fx.ownerToken, typedA)).toBe(200);
    const beforeFirst = await listVersions(fx.ownerToken);
    const r1 = await restore(fx.ownerToken, fx.v1Id);
    expect(r1.status).toBe(200);
    const afterFirst = await listVersions(fx.ownerToken);
    expect(afterFirst.length).toBe(beforeFirst.length + 1);

    // 第二次：写入 B，再回滚到 v1
    expect(await patchMarkdown(fx.ownerToken, typedB)).toBe(200);
    const beforeSecond = await listVersions(fx.ownerToken);
    const r2 = await restore(fx.ownerToken, fx.v1Id);
    expect(r2.status).toBe(200);
    const afterSecond = await listVersions(fx.ownerToken);
    expect(afterSecond.length, "第二次回滚也必须独立新增一条快照").toBe(
      beforeSecond.length + 1,
    );

    // 两条快照都还在，且各自内容不同 —— 若被覆盖，只会剩一条且内容相同
    const aSnapshot = afterSecond.find((v) => v.markdown === typedA);
    const bSnapshot = afterSecond.find((v) => v.markdown === typedB);
    expect(aSnapshot, "第一次回滚前的快照必须仍在（未被覆盖）").toBeTruthy();
    expect(bSnapshot, "第二次回滚前的快照必须存在").toBeTruthy();
    expect(aSnapshot?.id, "两条快照必须是不同的版本行").not.toBe(bSnapshot?.id);
    expect(aSnapshot?.version).not.toBe(bSnapshot?.version);

    // 版本号必须单调递增且唯一（否则 uq_doc_versions_doc_version 冲突或序号复用）
    const versions = afterSecond.map((v) => v.version);
    expect(new Set(versions).size, "版本号不得重复").toBe(versions.length);
  });

  it("快照步骤不可被请求参数跳过（source/message 恒为服务端强制值）", async () => {
    const typed = "# 参数注入尝试\n内容";
    expect(await patchMarkdown(fx.ownerToken, typed)).toBe(200);
    const before = await listVersions(fx.ownerToken);

    // 试图用 body 关闭快照 / 伪造 source
    const res = await fetch(
      `${BASE}/workspaces/${fx.wid}/documents/${fx.docId}/versions/${fx.v1Id}/restore`,
      {
        method: "POST",
        headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: false, createSnapshot: false, source: "collaborative" }),
      },
    );
    expect(res.status).toBe(200);

    const after = await listVersions(fx.ownerToken);
    expect(after.length, "带任何 body 也必须建快照").toBe(before.length + 1);
    const snap = after.find((v) => v.markdown === typed);
    expect(snap?.source, "source 必须恒为 auto，客户端无法改写").toBe("auto");
    expect(after.some((v) => v.source === "collaborative"), "客户端指定的 source 不得生效").toBe(
      false,
    );
  });
});

describe("POST /documents/{id}/versions/compare — 版本比对", () => {
  it("返回两个版本的行级差异与统计", async () => {
    const res = await fetch(`${BASE}/workspaces/${fx.wid}/documents/${fx.docId}/versions/compare`, {
      method: "POST",
      headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ fromId: fx.v1Id, toId: fx.v2Id }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: {
        from?: { version?: number };
        to?: { version?: number };
        diff?: { added?: string[]; removed?: string[]; modified?: unknown[] };
        stats?: { additions?: number; deletions?: number };
      };
    };
    expect(json.data?.from?.version).toBe(1);
    expect(json.data?.to?.version).toBe(2);
    // v1 与 v2 内容确实不同，差异不得为空
    expect(
      (json.data?.diff?.added?.length ?? 0) +
        (json.data?.diff?.removed?.length ?? 0) +
        (json.data?.diff?.modified?.length ?? 0),
      "v1 与 v2 必须有可见差异",
    ).toBeGreaterThan(0);
    expect(typeof json.data?.stats?.additions).toBe("number");
  });

  it("任一版本不存在返回 404", async () => {
    const missing = await fetch(
      `${BASE}/workspaces/${fx.wid}/documents/${fx.docId}/versions/compare`,
      {
        method: "POST",
        headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: fx.v1Id, toId: "00000000-0000-4000-8000-000000000000" }),
      },
    );
    expect(missing.status).toBe(404);

    const noArgs = await fetch(
      `${BASE}/workspaces/${fx.wid}/documents/${fx.docId}/versions/compare`,
      { method: "POST", headers: { ...authHeader(fx.ownerToken), "Content-Type": "application/json" }, body: "{}" },
    );
    expect(noArgs.status, "缺参数应 400 而不是 200").toBe(400);
  });
});
