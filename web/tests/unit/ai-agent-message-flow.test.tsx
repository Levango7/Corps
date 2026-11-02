// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AgentMessageFlow 契约（components/ai/AgentMessageFlow.tsx，默认导出）：
 *  1. 无 agentId：member1 先 api(agents?wid) → 再逐 agent api(agents/:id/messages?wid&take=50)，
 *     flatMap 后按 createdAt desc 排序、slice(0,100)；member2 api(agents?wid) 用于名称映射
 *  2. 有 agentId：单 api(agents/:id/messages?wid&take=100) + member2 名单
 *  3. agentName：优先 agents 映射，缺失回退 id.slice(0,8)
 *  4. toAgentId=null → Radio + t("broadcast")；否则 ArrowRight 连接 from/to
 *  5. type 过滤按钮（t("type") + 4 类型，点击切换/再点取消）
 *  6. 未知 type → 样式回退 notification
 *  7. 加载失败 → t("loadFailed") + close 按钮清 error
 *  8. 加载态 Loader2 + t("loadFailed")；空态 MessageSquare(32) + t("noMessages")
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import AgentMessageFlow from "@/components/ai/AgentMessageFlow";

const WID = "ws-am-1";
const AGENTS = [
  { id: "agent-001", name: "Agent 甲" },
  { id: "agent-002", name: "Agent 乙" },
];

interface Msg {
  id: string;
  fromAgentId: string;
  toAgentId: string | null;
  content: string;
  type: string;
  metadata: unknown;
  createdAt: string;
}

function msg(overrides: Partial<Msg>): Msg {
  return {
    id: "m-default",
    fromAgentId: "agent-001",
    toAgentId: "agent-002",
    content: "默认内容",
    type: "request",
    metadata: null,
    createdAt: "2026-10-31T08:00:00.000Z",
    ...overrides,
  };
}

/** 无 agentId 场景的 api 队列：member1 名单 → member2 名单 → 逐 agent 消息 */
function queueAggregate(itemsPerAgent: Msg[][]) {
  mocks.api.mockResolvedValueOnce(AGENTS);
  mocks.api.mockResolvedValueOnce(AGENTS);
  itemsPerAgent.forEach((items) =>
    mocks.api.mockResolvedValueOnce({ items, total: items.length, skip: 0, take: 50 }),
  );
}

/** 过滤按钮（header 内；与消息 type 徽章文案同文本，需按 tagName 区分） */
function filterButton(key: string) {
  const matches = screen.getAllByText(`ai.aiAgent:${key}`).filter((el) => el.tagName === "BUTTON");
  return matches[0] as HTMLButtonElement;
}

function formatExpected(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

describe("AgentMessageFlow", () => {
  beforeEach(() => {
    mocks.api.mockReset();
  });
  afterEach(() => cleanup());

  it("无 agentId：聚合两 agent 消息，按 createdAt desc 排序", async () => {
    queueAggregate([
      [msg({ id: "m-a1", content: "较早的消息", createdAt: "2026-10-31T08:00:00.000Z" })],
      [msg({ id: "m-a2", content: "较晚的消息", createdAt: "2026-10-31T09:00:00.000Z" })],
    ]);
    render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("较早的消息")).toBeTruthy());
    // 接口调用顺序：member1 名单 → member2 名单 → 逐 agent 消息
    expect(mocks.api.mock.calls[0][0]).toBe("/api/v1/ai/agents?wid=ws-am-1");
    expect(mocks.api.mock.calls[1][0]).toBe("/api/v1/ai/agents?wid=ws-am-1");
    expect(mocks.api.mock.calls[2][0]).toBe(
      "/api/v1/ai/agents/agent-001/messages?wid=ws-am-1&take=50",
    );
    expect(mocks.api.mock.calls[3][0]).toBe(
      "/api/v1/ai/agents/agent-002/messages?wid=ws-am-1&take=50",
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("较晚的消息");
    expect(rows[1].textContent).toContain("较早的消息");
  });

  it("agentName 映射：from/to 显示名单名称，ArrowRight 连接", async () => {
    queueAggregate([[msg({ id: "m1" })], []]);
    render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("Agent 甲")).toBeTruthy());
    expect(screen.getByText("Agent 乙")).toBeTruthy();
    expect(document.querySelector("svg.lucide-arrow-right")).toBeTruthy();
  });

  it("toAgentId=null → Radio 图标 + t('broadcast')", async () => {
    queueAggregate([[msg({ id: "m1", toAgentId: null })], []]);
    render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.aiAgent:broadcast")).toBeTruthy());
    expect(document.querySelector("svg.lucide-radio")).toBeTruthy();
  });

  it("未知 agentId 回退 id 前 8 位（含连字符）", async () => {
    queueAggregate([
      [msg({ id: "m1", fromAgentId: "unknown-agent-xyz", toAgentId: "agent-002" })],
      [],
    ]);
    render(<AgentMessageFlow wid={WID} />);
    // id.slice(0,8) = "unknown-"（连字符占第 8 位）
    await waitFor(() => expect(screen.getByText("unknown-")).toBeTruthy());
  });

  it("有 agentId：单消息接口 take=100 + 名单接口", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [msg({ id: "m1", content: "单 agent 消息" }), msg({ id: "m2", content: "第二条" })],
      total: 2,
      skip: 0,
      take: 100,
    });
    mocks.api.mockResolvedValueOnce(AGENTS);
    render(<AgentMessageFlow wid={WID} agentId="agent-007" />);
    await waitFor(() => expect(screen.getByText("单 agent 消息")).toBeTruthy());
    expect(screen.getByText("第二条")).toBeTruthy();
    expect(mocks.api.mock.calls[0][0]).toBe(
      "/api/v1/ai/agents/agent-007/messages?wid=ws-am-1&take=100",
    );
    expect(mocks.api.mock.calls[1][0]).toBe("/api/v1/ai/agents?wid=ws-am-1");
  });

  it("type 过滤：点 request 只剩 request，再点回全部", async () => {
    queueAggregate([
      [msg({ id: "m1", content: "请求内容", type: "request" })],
      [msg({ id: "m2", content: "通知内容", type: "notification" })],
    ]);
    render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("请求内容")).toBeTruthy());
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(filterButton("request"));
    expect(screen.getByText("请求内容")).toBeTruthy();
    expect(screen.queryByText("通知内容")).toBeFalsy();
    // 再点同一过滤键 → 取消
    fireEvent.click(filterButton("request"));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("未知 type → 徽章文案原样透传，样式回退 notification", async () => {
    queueAggregate([[msg({ id: "m1", type: "custom-type" })], []]);
    const { container } = render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.aiAgent:custom-type")).toBeTruthy());
    const badge = container.querySelector("span.inline-flex.items-center.px-1\\.5");
    expect(badge?.className).toContain("bg-[var(--warning-soft)]");
  });

  it("加载失败 → t('loadFailed') + close 按钮清除错误", async () => {
    // member1 名单接口抛错 → Promise.all reject → setError；member2 被 catch 吞掉
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    mocks.api.mockResolvedValueOnce(AGENTS);
    render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.aiAgent:loadFailed")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("close"));
    expect(screen.queryByText("ai.aiAgent:loadFailed")).toBeFalsy();
  });

  it("加载态：Loader2 + t('loadFailed')（加载文案与错误同 key 的怪癖）", async () => {
    mocks.api.mockImplementationOnce(() => new Promise<never>(() => {}));
    mocks.api.mockImplementationOnce(() => new Promise<never>(() => {}));
    const { container } = render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.aiAgent:loadFailed")).toBeTruthy());
    expect(container.querySelector("svg.lucide-loader-circle")).toBeTruthy();
  });

  it("空消息 → MessageSquare(size32) + t('noMessages')", async () => {
    queueAggregate([[], []]);
    const { container } = render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.aiAgent:noMessages")).toBeTruthy());
    const icons = Array.from(container.querySelectorAll("svg.lucide-message-square"));
    expect(icons.some((s) => s.getAttribute("width") === "32")).toBe(true);
  });

  it("上限切片：两 agent 各 60 条（共 120）只渲染前 100 条", async () => {
    const many = (agentId: string) =>
      Array.from({ length: 60 }, (_, i) =>
        msg({
          id: `m-${agentId}-${i}`,
          fromAgentId: agentId,
          toAgentId: null,
          content: `消息-${agentId}-${i}`,
          type: "notification",
          createdAt: new Date(Date.UTC(2026, 9, 31, 0, i)).toISOString(),
        }),
      );
    queueAggregate([many("agent-001"), many("agent-002")]);
    render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
  });

  it("时间格式化：消息头显示 formatTime(createdAt) 而非原始 ISO", async () => {
    const iso = "2026-10-31T08:00:00.000Z";
    queueAggregate([[msg({ id: "m1", createdAt: iso })], []]);
    render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("默认内容")).toBeTruthy());
    const timeSpan = screen.getByText(formatExpected(iso));
    expect(timeSpan).toBeTruthy();
    expect(screen.queryByText(iso)).toBeFalsy();
  });

  it("头部：MessageSquare 图标 + t('messages') + Filter 图标 + 5 个过滤按钮", async () => {
    queueAggregate([[msg({ id: "m1" })], []]);
    const { container } = render(<AgentMessageFlow wid={WID} />);
    await waitFor(() => expect(screen.getByText("默认内容")).toBeTruthy());
    expect(screen.getByText("ai.aiAgent:messages")).toBeTruthy();
    expect(container.querySelector("svg.lucide-message-square")).toBeTruthy();
    expect(container.querySelector("svg.lucide-filter")).toBeTruthy();
    // 全部 + request/response/notification/handoff
    expect(filterButton("type")).toBeTruthy();
    expect(filterButton("request")).toBeTruthy();
    expect(filterButton("response")).toBeTruthy();
    expect(filterButton("notification")).toBeTruthy();
    expect(filterButton("handoff")).toBeTruthy();
  });
});
