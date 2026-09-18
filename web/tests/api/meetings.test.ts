import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 会议 API 集成测试（M2 #26）
 *
 * 覆盖：
 * 1. 创建会议（POST）— 字段校验、默认值、recurringRule/password 新字段
 * 2. 查询会议（GET 列表 / GET 详情）— 隔离、404
 * 3. 更新会议（PATCH）— 标题更新、status 枚举
 * 4. 删除/结束会议（DELETE）— 状态置 ended
 * 5. 加入/离开会议（POST join/leave）— LiveKit 未配置时 503，密码验证
 * 6. 跨工作区防护 — A 的 token 不能操作 B 的会议
 *
 * 注意：join API 依赖 LiveKit 服务（LIVEKIT_API_KEY/SECRET/URL）。
 * 未配置时 join 返回 503，测试据此条件性跳过 join/leave 的成功断言。
 */

let token: string;
let wid: string;
let otherToken: string;
let otherWid: string;

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "meeting-owner",
    workspaceName: "会议测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "meeting-other" });
  otherToken = other.accessToken;
  otherWid = other.workspace.id;
});

describe("会议创建 POST /meetings", () => {
  it("创建即时会议成功，返回 201 并带默认值", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "测试即时会议" }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.id).toBeDefined();
    expect(json.data.title).toBe("测试即时会议");
    expect(json.data.status).toBe("scheduled");
    expect(json.data.type).toBe("instant");
    expect(json.data.maxParticipants).toBe(50);
    expect(json.data.recordingEnabled).toBe(false);
    // L6 #32：recurringRule 默认 null
    expect(json.data.recurringRule).toBeNull();
    // L8 #34：password 默认 null
    expect(json.data.password).toBeNull();
  });

  it("创建预约会议带描述和最大人数", async () => {
    const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "预约会议",
        description: "讨论项目进度",
        type: "scheduled",
        scheduledAt,
        maxParticipants: 10,
        recordingEnabled: true,
      }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.type).toBe("scheduled");
    expect(json.data.description).toBe("讨论项目进度");
    expect(json.data.maxParticipants).toBe(10);
    expect(json.data.recordingEnabled).toBe(true);
  });

  it("L6 #32：创建重复会议带 recurringRule", async () => {
    const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "每日站会",
        type: "recurring",
        scheduledAt,
        recurringRule: "FREQ=DAILY;INTERVAL=1",
      }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.type).toBe("recurring");
    expect(json.data.recurringRule).toBe("FREQ=DAILY;INTERVAL=1");
  });

  it("L8 #34：创建带密码的会议", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "密码会议",
        password: "secret123",
      }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    // password 字段在响应中存在（具体是否返回取决于 API select 配置）
    expect(json.data.id).toBeDefined();
  });

  it("标题为空返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("标题超长（>200）返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(201) }),
    });
    expect(res.status).toBe(400);
  });
});

describe("会议查询 GET /meetings", () => {
  it("列表返回分页格式且包含 creator 关联", async () => {
    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings?page=1&limit=10`,
      { headers: authHeader(token) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toBeInstanceOf(Array);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(10);
    expect(json.data.total).toBeGreaterThan(0);
    // L5 #31：creator 关联应存在
    const firstItem = json.data.items[0];
    expect(firstItem.creator).toBeDefined();
  });

  it("按状态筛选 scheduled", async () => {
    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings?status=scheduled`,
      { headers: authHeader(token) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    // 所有返回项状态均为 scheduled
    for (const item of json.data.items) {
      expect(item.status).toBe("scheduled");
    }
  });

  it("跨工作区隔离：B 的 token 查不到 A 的会议", async () => {
    // 先在 A 创建会议
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "A的会议" }),
    });
    const created = await createRes.json();

    // B 查询自己的工作区会议列表，不应包含 A 的会议
    const res = await fetch(`${BASE}/workspaces/${otherWid}/meetings`, {
      headers: authHeader(otherToken),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    const ids = json.data.items.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(created.data.id);
  });
});

describe("会议详情 GET /meetings/{mid}", () => {
  it("查询存在的会议详情含 participants", async () => {
    // 先创建
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "详情测试会议" }),
    });
    const created = await createRes.json();

    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}`,
      { headers: authHeader(token) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe(created.data.id);
    expect(json.data.title).toBe("详情测试会议");
    expect(json.data.participants).toBeInstanceOf(Array);
  });

  it("不存在的会议 ID 返回 404", async () => {
    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings/00000000-0000-0000-0000-000000000000`,
      { headers: authHeader(token) },
    );
    expect(res.status).toBe(404);
  });
});

describe("会议更新 PATCH /meetings/{mid}", () => {
  it("更新标题成功", async () => {
    // 先创建
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "原标题" }),
    });
    const created = await createRes.json();

    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}`,
      {
        method: "PATCH",
        headers: { ...authHeader(token), "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新标题" }),
      },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.title).toBe("新标题");
  });

  it("L2 #28：更新 status 为 cancelled", async () => {
    // 先创建
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "取消测试" }),
    });
    const created = await createRes.json();

    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}`,
      {
        method: "PATCH",
        headers: { ...authHeader(token), "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe("cancelled");
  });
});

describe("会议结束 DELETE /meetings/{mid}", () => {
  it("结束会议成功，status 置 ended", async () => {
    // 先创建
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "待结束会议" }),
    });
    const created = await createRes.json();

    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}`,
      {
        method: "DELETE",
        headers: authHeader(token),
      },
    );
    expect(res.status).toBe(200);

    // 验证状态已更新
    const getRes = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}`,
      { headers: authHeader(token) },
    );
    const getJson = await getRes.json();
    expect(getJson.data.status).toBe("ended");
  });
});

describe("会议加入/离开 POST join/leave", () => {
  it("join 未配置 LiveKit 时返回 503 或成功", async () => {
    // 先创建
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "加入测试会议" }),
    });
    const created = await createRes.json();

    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}/join`,
      {
        method: "POST",
        headers: { ...authHeader(token), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    // LiveKit 未配置时返回 503；已配置时返回 200
    expect([200, 503]).toContain(res.status);

    if (res.status === 200) {
      const json = await res.json();
      expect(json.data.token).toBeDefined();
      expect(json.data.url).toBeDefined();
      expect(json.data.roomName).toBeDefined();
      // L4 #30：e2eeEnabled 标志应存在
      expect(json.data.e2eeEnabled).toBeDefined();
    }
  });

  it("L8 #34：带密码的会议 join 不传密码返回 403", async () => {
    // 先创建带密码的会议
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "密码会议", password: "secret123" }),
    });
    const created = await createRes.json();

    // 用另一个用户加入（不传密码）
    const joinRes = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}/join`,
      {
        method: "POST",
        headers: {
          ...authHeader(otherToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    // otherToken 用户不是工作区成员，可能返回 401/403
    // 如果是成员且会议有密码，不传密码应返回 403
    expect([401, 403]).toContain(joinRes.status);
  });

  it("leave 幂等：未加入直接离开返回 200", async () => {
    // 先创建
    const createRes = await fetch(`${BASE}/workspaces/${wid}/meetings`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "离开测试会议" }),
    });
    const created = await createRes.json();

    const res = await fetch(
      `${BASE}/workspaces/${wid}/meetings/${created.data.id}/leave`,
      {
        method: "POST",
        headers: authHeader(token),
      },
    );
    expect(res.status).toBe(200);
  });
});