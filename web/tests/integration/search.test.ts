import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 搜索功能集成测试
 *
 * 覆盖：
 * 1. q 参数 trim — 前后空格应被裁剪后匹配
 * 2. limit 边界 — 超过 50 被 cap 到 50，默认 20
 * 3. 空查询 — q 缺失或空字符串返回 400
 * 4. 搜索结果正确性 — 命中 task title / description
 * 5. 跨工作区隔离 — A 搜不到 B 的任务
 * 6. 未认证返回 401
 */

let token: string;
let wid: string;
let otherToken: string;
let otherWid: string;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "search-owner", workspaceName: "搜索测试工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "search-other" });
  otherToken = other.accessToken;
  otherWid = other.workspace.id;
});

describe("搜索 q 参数 trim", () => {
  it("q 前后带空格仍能匹配（trim 后查询）", async () => {
    // Arrange - 创建含 "唯一关键词ABC" 的任务
    const uniqueKeyword = `唯一关键词ABC${Date.now()}`;
    await createTask(token, wid, { title: `${uniqueKeyword}任务` });

    // Act - q 带前后空格
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", `  ${uniqueKeyword}  `);
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    const json = await res.json();

    // Assert - trim 后匹配到任务
    expect(res.status).toBe(200);
    expect(json.data.tasks.length).toBeGreaterThan(0);
    expect(json.data.tasks.some((t: { title: string }) => t.title.includes(uniqueKeyword))).toBe(
      true,
    );
  });
});

describe("搜索 limit 边界", () => {
  it("limit 超过 50 被 cap 到 50（不报错）", async () => {
    // Arrange - 创建几个任务
    await createTask(token, wid, { title: "limit边界测试任务" });

    // Act
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", "limit");
    url.searchParams.set("limit", "999");
    const res = await fetch(url.toString(), { headers: authHeader(token) });

    // Assert - 不报错，返回 200（内部 cap 到 50）
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tasks.length).toBeLessThanOrEqual(50);
  });

  it("limit=1 最多返回 1 条任务", async () => {
    // Arrange
    await createTask(token, wid, { title: "limit1测试A" });
    await createTask(token, wid, { title: "limit1测试B" });

    // Act
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", "limit1测试");
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(json.data.tasks.length).toBeLessThanOrEqual(1);
  });
});

describe("搜索空查询", () => {
  it("q 缺失返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/search`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(400);
  });

  it("q 为空字符串返回 400", async () => {
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", "");
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    expect(res.status).toBe(400);
  });

  it("q 超长（>200）返回 400", async () => {
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", "x".repeat(201));
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    expect(res.status).toBe(400);
  });
});

describe("搜索结果正确性", () => {
  it("命中任务 title", async () => {
    // Arrange
    const keyword = `命中Title${Date.now()}`;
    await createTask(token, wid, { title: `${keyword}任务` });

    // Act
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", keyword);
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(json.data.tasks.some((t: { title: string }) => t.title.includes(keyword))).toBe(true);
  });

  it("命中任务 description", async () => {
    // Arrange
    const keyword = `命中Desc${Date.now()}`;
    await createTask(token, wid, {
      title: "描述搜索测试",
      description: `这是一段含${keyword}的描述`,
    });

    // Act
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", keyword);
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    const json = await res.json();

    // Assert - 任务通过 description 命中
    expect(res.status).toBe(200);
    expect(json.data.tasks.length).toBeGreaterThan(0);
  });

  it("无匹配时返回空数组", async () => {
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", `绝对不存在的关键词${Date.now()}XYZ123`);
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.tasks).toEqual([]);
    expect(json.data.decisions).toEqual([]);
  });

  it("返回结果带 kind 字段区分类型", async () => {
    // Arrange
    const keyword = `Kind字段${Date.now()}`;
    await createTask(token, wid, { title: `${keyword}任务` });

    // Act
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", keyword);
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    const json = await res.json();

    // Assert
    expect(res.status).toBe(200);
    for (const t of json.data.tasks) {
      expect(t.kind).toBe("task");
    }
    for (const d of json.data.decisions) {
      expect(d.kind).toBe("decision");
    }
  });
});

describe("搜索跨工作区隔离", () => {
  it("A 工作区搜索不到 B 工作区的任务", async () => {
    // Arrange - 在 B 创建任务
    const bKeyword = `B工作区独有${Date.now()}`;
    await createTask(otherToken, otherWid, { title: `${bKeyword}任务` });

    // Act - A 搜索该关键词
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", bKeyword);
    const res = await fetch(url.toString(), { headers: authHeader(token) });
    const json = await res.json();

    // Assert - A 搜不到 B 的任务
    expect(res.status).toBe(200);
    expect(json.data.tasks).toEqual([]);
  });
});

describe("搜索认证", () => {
  it("未认证返回 401", async () => {
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", "test");
    const res = await fetch(url.toString());
    expect(res.status).toBe(401);
  });

  it("外部用户搜索他人工作区返回 401/403/404", async () => {
    const url = new URL(`${BASE}/workspaces/${wid}/search`);
    url.searchParams.set("q", "test");
    const res = await fetch(url.toString(), { headers: authHeader(otherToken) });
    expect([401, 403, 404]).toContain(res.status);
  });
});
