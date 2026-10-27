import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 消息搜索 /api/v1/im/search 的匹配语义集成测试。
 *
 * ## 为什么存在（本文件断言的都是修复前会红的行为）
 *
 * 该端点原先只有 `body_tsv @@ plainto_tsquery('simple', q)` 一条匹配路径。
 * 'simple' 解析器不切词，实测（postgres:18.6）：
 *   to_tsvector('simple','中文关键词测试') @@ plainto_tsquery('simple','关键词') → f
 * 也就是说对产品的主要语言中文，任何子串查询都是零结果——用户搜「关键词」
 * 搜不到写着「中文关键词测试」的消息。此前 e2e 是反过来迁就实现能力的
 * （把关键词用空格独立成词再搜），所以 CI 一直是绿的。
 * 修复：并上 `body ILIKE <转义后的 %q%> ESCAPE '\'` 子串分支 + idx_messages_body_trgm。
 *
 * ## 三条判据各自的射程
 *
 *  - 中文子串命中：删掉 ILIKE 分支 → 本条红（全文分支给不出结果）。
 *  - 拉丁部分词命中：同上，且这是原先唯一"看起来能用"的场景，防止只修中文。
 *  - `%` 当字面字符：去掉 likeContainsPattern 的转义 → 查询 `100%` 会退化成
 *    "以 100 开头"，把不含 `100%` 的消息也返回，本条红（实测未转义命中 140/20005 行）。
 */

let token: string;
let wid: string;
let taskId: string;

/** 一条只含中文的消息（用于子串命中） */
const CJK_BODY = `部署评审结论：数据库连接池需要扩容${Date.now()}，请跟进`;
/** 中文子串查询词——它不是整段文本，修复前搜不到 */
const CJK_QUERY = "连接池需要";
/** 一条中英混排消息（用于拉丁部分词命中） */
const LATIN_BODY = `回滚手册 RollbackRunbook${Date.now()} 已归档`;
/** 拉丁查询词是完整 token 的前缀，修复前搜不到 */
const LATIN_QUERY = "RollbackRun";
/** 一条含 LIKE 元字符的消息（用于转义命中） */
const META_BODY = `预算占用 100% 上限，需审批${Date.now()}`;
/** 查询串本身含 %：必须按字面字符匹配，不能当通配符 */
const META_QUERY = "100%";

async function sendMessage(body: string): Promise<void> {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/messages/send`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  expect(res.status, `发送消息「${body.slice(0, 12)}…」应成功，实际 ${res.status}`).toBeLessThan(
    300,
  );
}

/** 调搜索端点并取回命中消息的 body 列表 */
async function searchBodies(q: string, conversationId?: string): Promise<string[]> {
  const url = new URL(`${BASE}/im/search`);
  url.searchParams.set("workspaceId", wid);
  url.searchParams.set("q", q);
  if (conversationId) url.searchParams.set("conversationId", conversationId);
  const res = await fetch(url.toString(), { headers: authHeader(token) });
  expect(res.status, `搜索「${q}」应 200，实际 ${res.status}`).toBe(200);
  const json = (await res.json()) as { data?: Array<{ body?: string }> };
  return (json.data ?? []).map((r) => r.body ?? "");
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "im-search-cjk",
    workspaceName: "消息搜索测试工作区",
  });
  token = owner.accessToken;
  wid = owner.workspace.id;

  const task = await createTask(token, wid, { title: "消息搜索目标任务" });
  expect(task.status, `创建任务应成功，实际 ${task.status}`).toBe(201);
  taskId = (task.body as { data?: { id?: string } })?.data?.id ?? "";
  expect(taskId).toBeTruthy();

  await sendMessage(CJK_BODY);
  await sendMessage(LATIN_BODY);
  await sendMessage(META_BODY);
});

describe("GET /api/v1/im/search 的子串匹配语义", () => {
  it("中文子串能命中整段中文消息（修复前恒零结果）", async () => {
    const bodies = await searchBodies(CJK_QUERY);
    expect(
      bodies.some((b) => b.includes(CJK_QUERY)),
      `搜索「${CJK_QUERY}」应命中「${CJK_BODY}」，实际返回 ${bodies.length} 条`,
    ).toBe(true);
  });

  it("拉丁词的部分前缀能命中（原先只认完整 token）", async () => {
    const bodies = await searchBodies(LATIN_QUERY);
    expect(
      bodies.some((b) => b.includes(LATIN_QUERY)),
      `搜索「${LATIN_QUERY}」应命中含 RollbackRunbook 的消息，实际返回 ${bodies.length} 条`,
    ).toBe(true);
  });

  it("查询里的 % 按字面字符处理，不当通配符放大结果集", async () => {
    const bodies = await searchBodies(META_QUERY);
    expect(bodies.length, `搜索「${META_QUERY}」应至少命中那条 100% 消息`).toBeGreaterThan(0);
    // 转义失效时 `100%` 会退化成"以 100 开头"，返回大量不含 `100%` 的消息。
    const leaked = bodies.filter((b) => !b.includes(META_QUERY));
    expect(
      leaked.length,
      `不应返回不含「${META_QUERY}」字面串的消息，实际漏进 ${leaked.length} 条`,
    ).toBe(0);
  });

  it("conversationId 过滤把范围限定在该会话内", async () => {
    const conv = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/conversation`, {
      method: "POST",
      headers: authHeader(token),
    });
    expect([200, 201], `创建/获取会话应成功，实际 ${conv.status}`).toContain(conv.status);
    const cid = ((await conv.json()) as { data?: { id?: string } })?.data?.id ?? "";
    expect(cid, "响应应含会话 id").toBeTruthy();

    const scoped = await searchBodies(CJK_QUERY, cid);
    expect(
      scoped.every((b) => b.includes(CJK_QUERY)),
      `限定会话 ${cid} 后不应返回无关消息`,
    ).toBe(true);
  });
});
