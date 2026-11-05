// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AiChatPanel 契约（components/editor/AiChatPanel.tsx，default 导出）：
 *  1. 骨架：aside aria-label、标题、textarea placeholder、空输入时发送按钮 disabled
 *  2. 空态文案；消息渲染：user 纯文本右对齐、assistant 走 Markdown 组件
 *  3. 发送：点按钮/Enter 调 sendMessage({text}) 并清空输入；Shift+Enter 不发送；空白不发送
 *  4. streaming 中：textarea disabled、typing indicator、发送/清空禁用
 *  5. error：错误条 + retry → regenerate()
 *  6. clear：有消息时 setMessages([])；无消息时 disabled
 *  7. onClose 存在才渲染关闭按钮；点击回调
 *  8. transport 适配：prepareSendMessagesRequest 产出 {question, documentContent, history}
 *     - history 排除最后一条 user；末尾 assistant 被跳过（regenerate 场景）
 *     - body() 实时读最新 documentContent（ref 方案）
 *  9. 多 text part 的消息拼接
 */

const mocks = vi.hoisted(() => ({
  chat: {
    messages: [] as { id: string; role: string; parts: { type: string; text?: string }[] }[],
    status: "ready" as string,
    error: null as Error | null,
  },
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  regenerate: vi.fn(),
  transportOptions: vi.fn(),
  onClose: vi.fn(),
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
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: mocks.chat.messages,
    sendMessage: mocks.sendMessage,
    status: mocks.chat.status,
    error: mocks.chat.error,
    setMessages: mocks.setMessages,
    regenerate: mocks.regenerate,
  }),
}));
vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(options: unknown) {
      mocks.transportOptions(options);
    }
  },
}));
vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));

import AiChatPanel from "@/components/editor/AiChatPanel";

const userMsg = (id: string, text: string) => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const assistantMsg = (id: string, text: string) => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

function renderPanel(props: { documentContent?: string; withClose?: boolean } = {}) {
  return render(
    <AiChatPanel
      documentContent={props.documentContent ?? "文档正文"}
      onClose={props.withClose ? mocks.onClose : undefined}
    />,
  );
}

const textarea = () => screen.getByLabelText("ai.chat:placeholder") as HTMLTextAreaElement;
const sendBtn = () => screen.getByLabelText("ai.chat:send");

beforeEach(() => {
  mocks.chat.messages = [];
  mocks.chat.status = "ready";
  mocks.chat.error = null;
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue(undefined);
  mocks.setMessages.mockReset();
  mocks.regenerate.mockReset();
  mocks.transportOptions.mockReset();
  mocks.onClose.mockReset();
});
afterEach(() => cleanup());

describe("AiChatPanel", () => {
  it("骨架：aside aria-label/标题/placeholder，空输入发送 disabled", () => {
    renderPanel();
    expect(screen.getByLabelText("ai.chat:title")).toBeInTheDocument();
    expect(screen.getByText("ai.chat:title")).toBeInTheDocument();
    expect(textarea()).toHaveAttribute("placeholder", "ai.chat:placeholder");
    expect(sendBtn()).toBeDisabled();
  });

  it("空态：无消息时显示 emptyState", () => {
    renderPanel();
    expect(screen.getByText("ai.chat:emptyState")).toBeInTheDocument();
  });

  it("输入后发送按钮可用；点发送 → sendMessage({text}) 且清空输入", async () => {
    renderPanel();
    fireEvent.change(textarea(), { target: { value: "  什么是 OKR？  " } });
    expect(sendBtn()).not.toBeDisabled();

    fireEvent.click(sendBtn());
    expect(mocks.sendMessage).toHaveBeenCalledWith({ text: "什么是 OKR？" });
    await waitFor(() => expect(textarea()).toHaveValue(""));
  });

  it("Enter 发送；Shift+Enter 不发送", () => {
    renderPanel();
    fireEvent.change(textarea(), { target: { value: "问题一" } });
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(mocks.sendMessage).toHaveBeenCalledWith({ text: "问题一" });
  });

  it("纯空白输入不发送（按钮 disabled）", () => {
    renderPanel();
    fireEvent.change(textarea(), { target: { value: "   " } });
    expect(sendBtn()).toBeDisabled();
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("消息渲染：user 纯文本、assistant 走 Markdown", () => {
    mocks.chat.messages = [userMsg("m1", "用户问题"), assistantMsg("m2", "**回答**")];
    renderPanel();

    expect(screen.getByText("用户问题")).toBeInTheDocument();
    const md = screen.getByTestId("md");
    expect(md).toHaveTextContent("**回答**");
    expect(screen.queryByText("ai.chat:emptyState")).toBeFalsy();
  });

  it("多 text part 的消息拼接后渲染", () => {
    mocks.chat.messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "text", text: "前半" },
          { type: "text", text: "后半" },
        ],
      },
    ];
    renderPanel();
    expect(screen.getByTestId("md")).toHaveTextContent("前半后半");
  });

  it("streaming 中：textarea disabled、typing indicator、发送与清空禁用", () => {
    mocks.chat.status = "streaming";
    mocks.chat.messages = [userMsg("m1", "在吗")];
    renderPanel();

    expect(textarea()).toBeDisabled();
    expect(sendBtn()).toBeDisabled();
    expect(screen.getByLabelText("ai.chat:clear")).toBeDisabled();
    // typing indicator：三个动画点
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("submitted 也视为流式中", () => {
    mocks.chat.status = "submitted";
    renderPanel();
    expect(textarea()).toBeDisabled();
  });

  it("error 状态且已有消息：错误条 + retry → regenerate()", () => {
    mocks.chat.status = "error";
    mocks.chat.error = new Error("boom");
    mocks.chat.messages = [userMsg("m1", "问题")];
    renderPanel();

    expect(screen.getByText("ai.chat:error")).toBeInTheDocument();
    fireEvent.click(screen.getByText("button:retry").closest("button")!);
    expect(mocks.regenerate).toHaveBeenCalledTimes(1);
  });

  it("error 状态但无消息：不渲染错误条（源码边界：error 块嵌在消息分支内）", () => {
    mocks.chat.status = "error";
    mocks.chat.error = new Error("boom");
    renderPanel();

    expect(screen.queryByText("ai.chat:error")).toBeFalsy();
    expect(screen.getByText("ai.chat:emptyState")).toBeInTheDocument();
  });

  it("clear：有消息才可用；点击 setMessages([])", () => {
    const first = renderPanel();
    expect(screen.getByLabelText("ai.chat:clear")).toBeDisabled();
    first.unmount();

    mocks.chat.messages = [userMsg("m1", "消息")];
    renderPanel();
    const clear = screen.getByLabelText("ai.chat:clear");
    expect(clear).not.toBeDisabled();
    fireEvent.click(clear);
    expect(mocks.setMessages).toHaveBeenCalledWith([]);
  });

  it("onClose 存在才渲染关闭按钮；点击回调", () => {
    const first = renderPanel();
    expect(screen.queryByLabelText("button:close")).toBeFalsy();
    first.unmount();

    renderPanel({ withClose: true });
    fireEvent.click(screen.getByLabelText("button:close"));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("transport：prepareSendMessagesRequest 产出 {question, documentContent, history}", () => {
    renderPanel({ documentContent: "文档上下文" });
    const options = mocks.transportOptions.mock.calls[0][0] as {
      api: string;
      body: () => { documentContent: string };
      prepareSendMessagesRequest: (args: {
        messages: unknown[];
        body?: { documentContent?: string };
      }) => { body: unknown };
    };
    expect(options.api).toBe("/api/v1/ai/chat");
    expect(options.body()).toEqual({ documentContent: "文档上下文" });

    const req = options.prepareSendMessagesRequest({
      messages: [userMsg("1", "Q1"), assistantMsg("2", "A1"), userMsg("3", "Q2")],
      body: { documentContent: "文档上下文" },
    });
    expect(req.body).toEqual({
      question: "Q2",
      documentContent: "文档上下文",
      history: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
      ],
    });
  });

  it("transport：末尾 assistant 被跳过（regenerate 场景）", () => {
    renderPanel({ documentContent: "DOC" });
    const options = mocks.transportOptions.mock.calls[0][0] as {
      prepareSendMessagesRequest: (args: { messages: unknown[]; body?: unknown }) => {
        body: unknown;
      };
    };
    const req = options.prepareSendMessagesRequest({
      messages: [userMsg("1", "Q1"), assistantMsg("2", "A1")],
      body: { documentContent: "DOC" },
    });
    expect(req.body).toEqual({ question: "Q1", documentContent: "DOC", history: [] });
  });

  it("transport：消息全为 assistant / 空文本时 question 为空", () => {
    renderPanel();
    const options = mocks.transportOptions.mock.calls[0][0] as {
      prepareSendMessagesRequest: (args: { messages: unknown[]; body?: unknown }) => {
        body: unknown;
      };
    };
    const req = options.prepareSendMessagesRequest({
      messages: [assistantMsg("1", "只有回答")],
      body: { documentContent: "文档正文" },
    });
    expect(req.body).toEqual({ question: "", documentContent: "文档正文", history: [] });
  });

  it("documentContent 变化 → body() 实时读最新值（transport 不重建）", () => {
    const { rerender } = renderPanel({ documentContent: "旧内容" });
    expect(mocks.transportOptions).toHaveBeenCalledTimes(1);

    rerender(<AiChatPanel documentContent="新内容" />);
    // transport 只创建一次（useMemo []）
    expect(mocks.transportOptions).toHaveBeenCalledTimes(1);
    const options = mocks.transportOptions.mock.calls[0][0] as {
      body: () => { documentContent: string };
    };
    expect(options.body()).toEqual({ documentContent: "新内容" });
  });
});
