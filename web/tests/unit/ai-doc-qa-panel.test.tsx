// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * DocQaPanel 契约（components/ai/DocQaPanel.tsx）：
 *  1. 挂载 GET /api/v1/workspaces/{wid}/wiki（apiList），树形页面递归扁平化为文档多选列表
 *  2. DefaultChatTransport({ api: "/api/v1/ai/doc-qa", body, prepareSendMessagesRequest })：
 *     prepareSendMessagesRequest 提取最后一条 user 消息为 question 并透传 docIds
 *  3. useChat 驱动：assistant 回答渲染 Markdown，"## 来源" 段解析为来源 chips；
 *     streaming/submitted → asking 文案（内容区 + 停止按钮）且 stop 按钮调用 stop()
 *  4. 文档范围下拉：未选时 allDocs，勾选后 selectDocs + 计数徽标；checkbox 切换选中集
 *  5. 输入空时 ask disabled；Enter 发送（Shift+Enter 换行不发送）
 *  6. useChat error/status=error → t("error")；空对话 → t("noAnswer")
 *  7. streaming→ready 转换把最近问答（问题/回答/来源）存入历史（最多 5 条），
 *     clearHistory 清空历史并 setMessages([])
 */

const chat = vi.hoisted(() => ({ useChat: vi.fn(), transportCtor: vi.fn() }));
const mocks = vi.hoisted(() => ({ apiList: vi.fn() }));

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
vi.mock("@/lib/api", () => ({ apiList: mocks.apiList }));
vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));

import { DocQaPanel } from "@/components/ai/DocQaPanel";

const WID = "ws-dq-1";

/** 与 UIMessage 同形的轻量消息（运行时鸭子类型即可） */
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

/** 树形 Wiki 数据：两级子节点验证递归扁平化 */
const WIKI_TREE = [
  {
    id: "d1",
    title: "产品入门",
    children: [{ id: "d2", title: "快速上手", children: [{ id: "d4", title: "安装指南" }] }],
  },
  { id: "d3", title: "API 参考" },
];

const ANSWER = "基于 Docker Compose 部署。\n\n详见下文。\n## 来源\n- 部署手册\n- API 指南";
const ANSWER_BODY = "基于 Docker Compose 部署。\n\n详见下文。";

const readyWith = (messages: ChatMsg[]) => chatState({ messages, status: "ready" });

/** transport 选项（含 body 与 prepareSendMessagesRequest 两个可调用字段） */
interface TransportOpts {
  api: string;
  body: () => unknown;
  prepareSendMessagesRequest: (args: { messages: ChatMsg[]; body?: unknown }) => { body: unknown };
}

function transportOpts(): TransportOpts {
  expect(chat.transportCtor).toHaveBeenCalledTimes(1);
  return chat.transportCtor.mock.calls[0]?.[0] as TransportOpts;
}

function openDocSelect() {
  fireEvent.click(screen.getByText("ai.docQa:allDocs").closest("button")!);
}

beforeEach(() => {
  chat.useChat.mockReset();
  chat.transportCtor.mockReset();
  chat.transportCtor.mockReturnValue({});
  chat.useChat.mockReturnValue(chatState());
  mocks.apiList.mockReset();
  mocks.apiList.mockResolvedValue(WIKI_TREE);
});

afterEach(() => cleanup());

describe("DocQaPanel", () => {
  it("挂载：GET /wiki URL 精确，树形页面递归扁平化为可选文档列表（含两级子节点）", async () => {
    render(<DocQaPanel wid={WID} />);
    await waitFor(() =>
      expect(mocks.apiList).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/wiki`),
    );

    openDocSelect();
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    expect(screen.getByText("产品入门")).toBeInTheDocument();
    expect(screen.getByText("快速上手")).toBeInTheDocument();
    expect(screen.getByText("安装指南")).toBeInTheDocument();
    expect(screen.getByText("API 参考")).toBeInTheDocument();
  });

  it("DefaultChatTransport：api 路径精确；prepareSendMessagesRequest 提取最后 user 问题并透传 docIds", async () => {
    render(<DocQaPanel wid={WID} />);
    const opts = transportOpts();
    expect(opts.api).toBe("/api/v1/ai/doc-qa");
    // 未选文档时 body() 不带 docIds
    expect(opts.body()).toEqual({ wid: WID });

    const out = opts.prepareSendMessagesRequest({
      messages: [
        userMsg("u1", "第一个问题"),
        assistantMsg("a1", "中间回答"),
        userMsg("u2", "最后的问题"),
      ],
      body: { docIds: ["d2", "d3"] },
    });
    expect(out.body).toEqual({ wid: WID, question: "最后的问题", docIds: ["d2", "d3"] });
    await act(async () => {}); // 让挂载期 wiki 请求的 setState 落进 act
  });

  it("空对话：noAnswer 文案，输入为空时 ask 按钮 disabled", async () => {
    render(<DocQaPanel wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.docQa:noAnswer")).toBeInTheDocument());
    const ask = screen.getByText("ai.docQa:ask").closest("button") as HTMLButtonElement;
    expect(ask).toBeDisabled();
  });

  it("文档范围：勾选后按钮文案 allDocs→selectDocs 并显示计数徽标，取消勾选恢复", async () => {
    render(<DocQaPanel wid={WID} />);
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalled());
    openDocSelect();
    await screen.findAllByRole("checkbox");

    const box = screen.getByText("快速上手").closest("label")!.querySelector("input")!;
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(screen.getByText("ai.docQa:selectDocs")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // 计数徽标

    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByText("ai.docQa:allDocs")).toBeInTheDocument();
    expect(screen.queryByText("1")).toBeFalsy();
  });

  it("回答渲染：Markdown 正文与『## 来源』解析出的来源 chips", async () => {
    chat.useChat.mockReturnValue(
      readyWith([userMsg("u1", "怎么部署？"), assistantMsg("a1", ANSWER)]),
    );
    render(<DocQaPanel wid={WID} />);

    await waitFor(() => expect(screen.getByTestId("md")).toBeInTheDocument());
    expect(screen.getByTestId("md").textContent).toBe(ANSWER_BODY);
    expect(screen.getByText("ai.docQa:sources")).toBeInTheDocument();
    expect(screen.getByText("部署手册")).toBeInTheDocument();
    expect(screen.getByText("API 指南")).toBeInTheDocument();
  });

  it("streaming 态：asking 文案出现两处（内容区 + 停止按钮），stop 按钮点击调用 stop()", async () => {
    const state = chatState({ status: "streaming" });
    chat.useChat.mockReturnValue(state);
    render(<DocQaPanel wid={WID} />);

    expect(screen.getAllByText("ai.docQa:asking")).toHaveLength(2);
    const stopBtn = screen
      .getAllByText("ai.docQa:asking")
      .map((el) => el.closest("button"))
      .find((b): b is HTMLButtonElement => b !== null);
    expect(stopBtn).toBeTruthy();
    expect(screen.getByLabelText("ai.docQa:questionLabel")).toBeDisabled();
    fireEvent.click(stopBtn!);
    expect(state.stop).toHaveBeenCalledTimes(1);
    await act(async () => {}); // 让挂载期 wiki 请求的 setState 落进 act
  });

  it("useChat error 非空 → error 提示", async () => {
    chat.useChat.mockReturnValue(chatState({ error: new Error("stream boom") }));
    render(<DocQaPanel wid={WID} />);
    expect(screen.getByText("ai.docQa:error")).toBeInTheDocument();
    await act(async () => {}); // 让挂载期 wiki 请求的 setState 落进 act
  });

  it("Enter 发送：sendMessage({ text }) 且输入清空", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    render(<DocQaPanel wid={WID} />);
    const ta = screen.getByLabelText("ai.docQa:questionLabel") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "怎么部署？" } });
    fireEvent.keyDown(ta, { key: "Enter" });

    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith({ text: "怎么部署？" }));
    expect(ta.value).toBe("");
  });

  it("Shift+Enter 换行不发送", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    render(<DocQaPanel wid={WID} />);
    const ta = screen.getByLabelText("ai.docQa:questionLabel") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "多行输入" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });

    expect(state.sendMessage).not.toHaveBeenCalled();
    expect(ta.value).toBe("多行输入");
    await act(async () => {}); // 让挂载期 wiki 请求的 setState 落进 act
  });

  it("点击 ask 按钮发送", async () => {
    const state = chatState();
    chat.useChat.mockReturnValue(state);
    render(<DocQaPanel wid={WID} />);
    fireEvent.change(screen.getByLabelText("ai.docQa:questionLabel"), {
      target: { value: "按钮发送" },
    });
    fireEvent.click(screen.getByText("ai.docQa:ask").closest("button")!);
    await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith({ text: "按钮发送" }));
  });

  it("streaming→ready 转换保存历史问答（问题/回答/来源），出现清空历史按钮", async () => {
    const msgs = [userMsg("u1", "怎么部署？"), assistantMsg("a1", ANSWER)];
    chat.useChat
      .mockReturnValueOnce(chatState({ status: "streaming" }))
      .mockReturnValue(readyWith(msgs));
    const { rerender } = render(<DocQaPanel wid={WID} />);
    await act(async () => {
      rerender(<DocQaPanel wid={WID} />);
      await Promise.resolve();
    });

    expect(screen.getByText("ai.docQa:history")).toBeInTheDocument();
    expect(screen.getByText("怎么部署？")).toBeInTheDocument();
    // 当前回答 + 历史回答各渲染一份 Markdown
    expect(screen.getAllByTestId("md")).toHaveLength(2);
    expect(screen.getAllByText("部署手册").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("ai.docQa:clearHistory")).toBeInTheDocument();
  });

  it("清空历史：历史区消失并调用 setMessages([])", async () => {
    const state = readyWith([userMsg("u1", "怎么部署？"), assistantMsg("a1", ANSWER)]);
    chat.useChat.mockReturnValueOnce(chatState({ status: "streaming" })).mockReturnValue(state);
    const { rerender } = render(<DocQaPanel wid={WID} />);
    await act(async () => {
      rerender(<DocQaPanel wid={WID} />);
      await Promise.resolve();
    });
    fireEvent.click(screen.getByLabelText("ai.docQa:clearHistory"));

    expect(screen.queryByText("ai.docQa:history")).toBeFalsy();
    expect(state.setMessages).toHaveBeenCalledWith([]);
  });

  it("wiki 加载失败：下拉显示 noSources", async () => {
    mocks.apiList.mockRejectedValue(new Error("wiki boom"));
    render(<DocQaPanel wid={WID} />);
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalled());
    openDocSelect();
    expect(await screen.findByText("ai.docQa:noSources")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeFalsy();
  });
});
