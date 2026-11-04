// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * KnowledgeQaPanel 契约（components/ai/KnowledgeQaPanel.tsx）：
 *  1. 空对话 → t("hint")；transport api = /api/v1/ai/knowledge-qa
 *  2. 对话列表按钮（aria-label=t("conversations")）展开并触发
 *     GET /api/v1/ai/conversations?wid=；条目点击 GET /{id}?wid= 把 DB 消息转 UIMessage
 *     后 setMessages；删除按钮 stopPropagation + DELETE /{id}?wid=，删当前对话清空消息
 *  3. 新建对话 POST /api/v1/ai/conversations {wid, title: t("newConversation")} →
 *     setMessages([]) 并刷新列表；失败 toast createFailed；列表加载失败 toast loadFailed；
 *     删除失败 toast deleteFailed
 *  4. 发送：无 conversationId 先 POST /api/v1/ai/conversations（title=问题前 50 字）再
 *     sendMessage({ text })；streaming → asking 按钮调用 stop()
 *  5. streaming→ready 转换后 POST /api/v1/ai/follow-up-suggestions {wid, question, answer}，
 *     追问建议按钮点击再次发送
 *  6. useChat error 非空 → t("error")；FeedbackButtons(capability="knowledge-qa")
 */

const chat = vi.hoisted(() => ({ useChat: vi.fn(), transportCtor: vi.fn() }));
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
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
vi.mock("@ai-sdk/react", () => ({ useChat: chat.useChat }));
vi.mock("ai", () => ({ DefaultChatTransport: chat.transportCtor }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));
vi.mock("@/components/ai/FeedbackButtons", () => ({
  FeedbackButtons: (props: {
    capability?: string;
    workspaceId?: string;
    originalOutput?: string;
  }) => (
    <div
      data-testid="fb"
      data-capability={props.capability ?? ""}
      data-wid={props.workspaceId ?? ""}
      data-output={props.originalOutput ?? ""}
    />
  ),
}));

import { KnowledgeQaPanel } from "@/components/ai/KnowledgeQaPanel";

const WID = "ws-kq-1";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

function userMsg(id: string, text: string): ChatMsg {
  return { id, role: "user", parts: [{ type: "text", text }] };
}
function assistantMsg(id: string, text: string): ChatMsg {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function chatState(overrides: { messages?: ChatMsg[]; status?: string; error?: unknown } = {}) {
  return {
    messages: overrides.messages ?? [],
    sendMessage: vi.fn(async () => {}),
    status: overrides.status ?? "ready",
    error: overrides.error ?? null,
    setMessages: vi.fn(),
    stop: vi.fn(),
  };
}

const CONVERSATIONS = [
  {
    id: "conv-1",
    title: "部署问题",
    scopes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    _count: { messages: 4 },
  },
  {
    id: "conv-2",
    title: "排期咨询",
    scopes: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    _count: { messages: 2 },
  },
];

const DB_MESSAGES = [
  { id: "db-1", role: "user", content: "如何部署？", createdAt: "2026-01-01T00:00:00.000Z" },
  {
    id: "db-2",
    role: "assistant",
    content: "使用 docker compose",
    createdAt: "2026-01-01T00:01:00.000Z",
  },
];

interface ApiMap {
  list?: () => unknown;
  create?: () => unknown;
  detail?: () => unknown;
  remove?: () => unknown;
  followUp?: () => unknown;
}

/** 按 URL 与方法路由的 api mock；handler 返回 rejected promise 亦可 */
function installApi(map: ApiMap = {}) {
  mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (path === "/api/v1/ai/follow-up-suggestions" && method === "POST") {
      return Promise.resolve(map.followUp?.() ?? { suggestions: [] });
    }
    if (path === "/api/v1/ai/conversations" && method === "POST") {
      return Promise.resolve(map.create?.() ?? { id: "conv-new" });
    }
    if (path.startsWith("/api/v1/ai/conversations/") && method === "DELETE") {
      return Promise.resolve(map.remove?.() ?? {});
    }
    if (path.startsWith("/api/v1/ai/conversations/")) {
      return Promise.resolve(map.detail?.() ?? { messages: [] });
    }
    if (path === `/api/v1/ai/conversations?wid=${WID}`) {
      return Promise.resolve(map.list?.() ?? []);
    }
    return Promise.reject(new Error(`unexpected api: ${method} ${path}`));
  });
}

const listCalls = () =>
  mocks.api.mock.calls.filter((c) => String(c[0]) === `/api/v1/ai/conversations?wid=${WID}`);

function openList() {
  fireEvent.click(screen.getByLabelText("ai.knowledgeQa:conversations"));
}

/** 等对话列表条目渲染出来（列表 GET 已返回） */
async function listReady() {
  await screen.findByText("部署问题");
}

beforeEach(() => {
  chat.useChat.mockReset();
  chat.transportCtor.mockReset();
  chat.transportCtor.mockReturnValue({});
  chat.useChat.mockReturnValue(chatState());
  mocks.api.mockReset();
  mocks.toast.mockReset();
  installApi();
});

afterEach(() => cleanup());

describe("KnowledgeQaPanel", () => {
  it("空对话：hint 文案；DefaultChatTransport 的 api 路径精确", async () => {
    render(<KnowledgeQaPanel wid={WID} />);
    expect(screen.getByText("ai.knowledgeQa:hint")).toBeInTheDocument();
    expect(document.querySelector('[aria-label="ai.knowledgeQa:title"]')).toBeTruthy();
    await act(async () => {});
    const opts = chat.transportCtor.mock.calls[0]?.[0] as { api: string };
    expect(opts.api).toBe("/api/v1/ai/knowledge-qa");
  });

  it("对话列表按钮展开触发 GET 列表并渲染条目，收起再展开会重新拉取", async () => {
    installApi({ list: () => CONVERSATIONS });
    render(<KnowledgeQaPanel wid={WID} />);
    openList();
    await listReady();
    expect(screen.getByText("排期咨询")).toBeInTheDocument();
    expect(listCalls()).toHaveLength(1);

    openList(); // 收起
    expect(screen.queryByText("部署问题")).toBeFalsy();
    openList(); // 再次展开
    await listReady();
    expect(listCalls()).toHaveLength(2);
  });

  it("新建对话：POST body 精确，setMessages([]) 并刷新对话列表", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    installApi({ list: () => CONVERSATIONS, create: () => ({ id: "conv-new" }) });
    render(<KnowledgeQaPanel wid={WID} />);
    fireEvent.click(screen.getByLabelText("ai.knowledgeQa:newConversation"));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/conversations", {
        method: "POST",
        body: JSON.stringify({ wid: WID, title: "ai.knowledgeQa:newConversation" }),
      }),
    );
    expect(state.setMessages).toHaveBeenCalledWith([]);
    await waitFor(() => expect(listCalls()).toHaveLength(1)); // P2-8 创建后刷新列表
  });

  it("新建对话失败 → toast error createFailed", async () => {
    installApi({ create: () => Promise.reject(new Error("create boom")) });
    render(<KnowledgeQaPanel wid={WID} />);
    fireEvent.click(screen.getByLabelText("ai.knowledgeQa:newConversation"));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("error", "ai.knowledgeQa:createFailed"),
    );
  });

  it("点对话条目：GET /{id}?wid= 精确，DB 消息转换为 UIMessage 后 setMessages", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    installApi({ list: () => CONVERSATIONS, detail: () => ({ messages: DB_MESSAGES }) });
    render(<KnowledgeQaPanel wid={WID} />);
    openList();
    await listReady();
    fireEvent.click(screen.getByText("部署问题"));

    await waitFor(() => expect(state.setMessages).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/ai/conversations/conv-1?wid=${WID}`);
    expect(state.setMessages).toHaveBeenCalledWith([
      { id: "db-1", role: "user", parts: [{ type: "text", text: "如何部署？" }] },
      { id: "db-2", role: "assistant", parts: [{ type: "text", text: "使用 docker compose" }] },
    ]);
  });

  it("删除非当前对话：DELETE URL 精确，不触发条目加载，删除后重新拉取列表", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    installApi({ list: () => CONVERSATIONS });
    render(<KnowledgeQaPanel wid={WID} />);
    openList();
    await listReady();
    fireEvent.click(screen.getAllByLabelText("ai.knowledgeQa:clear")[1]!);

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`/api/v1/ai/conversations/conv-2?wid=${WID}`, {
        method: "DELETE",
      }),
    );
    // stopPropagation 生效：未触发条目详情加载（排除 DELETE 本身）
    expect(
      mocks.api.mock.calls.some(
        (c) =>
          String(c[0]).startsWith("/api/v1/ai/conversations/conv-") &&
          (c[1] as RequestInit | undefined)?.method !== "DELETE",
      ),
    ).toBe(false);
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(state.setMessages).not.toHaveBeenCalled();
  });

  it("删除当前对话：DELETE 后清空消息与建议", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    installApi({ list: () => CONVERSATIONS, detail: () => ({ messages: DB_MESSAGES }) });
    render(<KnowledgeQaPanel wid={WID} />);
    openList();
    await listReady();
    fireEvent.click(screen.getByText("部署问题"));
    await waitFor(() => expect(state.setMessages).toHaveBeenCalled());

    openList(); // 重新展开列表
    await listReady();
    fireEvent.click(screen.getAllByLabelText("ai.knowledgeQa:clear")[0]!);
    await waitFor(() => expect(state.setMessages).toHaveBeenLastCalledWith([]));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/ai/conversations/conv-1?wid=${WID}`, {
      method: "DELETE",
    });
  });

  it("删除失败 → toast error deleteFailed", async () => {
    installApi({ list: () => CONVERSATIONS, remove: () => Promise.reject(new Error("del boom")) });
    render(<KnowledgeQaPanel wid={WID} />);
    openList();
    await listReady();
    fireEvent.click(screen.getAllByLabelText("ai.knowledgeQa:clear")[0]!);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("error", "ai.knowledgeQa:deleteFailed"),
    );
  });

  it("发送时无 conversationId：先创建对话（title=问题前 50 字）再 sendMessage，输入清空", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    installApi({ create: () => ({ id: "conv-9" }) });
    render(<KnowledgeQaPanel wid={WID} />);
    const longQuestion = "问题".repeat(31);
    const ta = screen.getByLabelText("ai.knowledgeQa:placeholder") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: longQuestion } });
    fireEvent.keyDown(ta, { key: "Enter" });

    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith({ text: longQuestion }));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/conversations", {
      method: "POST",
      body: JSON.stringify({ wid: WID, title: longQuestion.slice(0, 50) }),
    });
    expect(ta.value).toBe("");
  });

  it("streaming 态：按钮变为 asking 并调用 stop()，textarea 禁用", async () => {
    const state = chatState({ status: "streaming" });
    chat.useChat.mockReturnValue(state);
    render(<KnowledgeQaPanel wid={WID} />);
    await act(async () => {});

    expect(screen.getByText("ai.knowledgeQa:asking").closest("button")).toBeTruthy();
    expect(screen.getByLabelText("ai.knowledgeQa:placeholder")).toBeDisabled();
    expect(screen.getByLabelText("ai.knowledgeQa:newConversation")).toBeDisabled();
    fireEvent.click(screen.getByText("ai.knowledgeQa:asking").closest("button")!);
    expect(state.stop).toHaveBeenCalledTimes(1);
  });

  it("streaming→ready：POST follow-up-suggestions body 精确，追问建议点击再次发送", async () => {
    const msgs = [userMsg("u1", "如何部署？"), assistantMsg("a1", "使用 docker compose 部署")];
    chat.useChat
      .mockReturnValueOnce(chatState({ status: "streaming" }))
      .mockReturnValue(chatState({ messages: msgs, status: "ready" }));
    installApi({ followUp: () => ({ suggestions: ["如何回滚？", "如何监控？"] }) });
    const { rerender } = render(<KnowledgeQaPanel wid={WID} />);
    await act(async () => {
      rerender(<KnowledgeQaPanel wid={WID} />);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/follow-up-suggestions", {
        method: "POST",
        body: JSON.stringify({
          wid: WID,
          question: "如何部署？",
          answer: "使用 docker compose 部署",
        }),
      }),
    );
    await waitFor(() => expect(screen.getByText("如何回滚？")).toBeInTheDocument());
    expect(screen.getByText("ai.knowledgeQa:followUp")).toBeInTheDocument();

    fireEvent.click(screen.getByText("如何回滚？"));
    await waitFor(() =>
      expect(chat.useChat.mock.results.at(-1)?.value.sendMessage).toHaveBeenCalledWith({
        text: "如何回滚？",
      }),
    );
    // 发送前无 conversationId → 先创建对话
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/conversations", {
      method: "POST",
      body: JSON.stringify({ wid: WID, title: "如何回滚？" }),
    });
  });

  it("useChat error 非空 → error 提示；FeedbackButtons(capability=knowledge-qa) 渲染最后回答", async () => {
    chat.useChat.mockReturnValue(
      chatState({
        error: new Error("chat boom"),
        messages: [userMsg("u1", "如何部署？"), assistantMsg("a1", "使用 docker compose")],
      }),
    );
    render(<KnowledgeQaPanel wid={WID} />);
    expect(screen.getByText("ai.knowledgeQa:error")).toBeInTheDocument();
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("knowledge-qa");
    expect(fb.getAttribute("data-wid")).toBe(WID);
    expect(fb.getAttribute("data-output")).toBe("使用 docker compose");
    await act(async () => {});
  });

  it("对话列表加载失败 → toast error loadFailed，侧栏显示 emptyState", async () => {
    installApi({ list: () => Promise.reject(new Error("list boom")) });
    render(<KnowledgeQaPanel wid={WID} />);
    openList();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("error", "ai.knowledgeQa:loadFailed"),
    );
    expect(screen.getByText("ai.knowledgeQa:emptyState")).toBeInTheDocument();
  });
});
