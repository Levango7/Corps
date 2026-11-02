// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MessageInput } from "@/components/im/MessageInput";

const { apiMock, mentionProps, aiProps, paramsMock, fetchMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  mentionProps: {} as Record<string, unknown>,
  aiProps: {} as Record<string, unknown>,
  paramsMock: { locale: "zh", wid: "ws-1" as string | undefined },
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("next/navigation", () => ({ useParams: () => paramsMock }));

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

vi.mock("@/components/im/MentionPopover", () => ({
  MentionPopover: (props: Record<string, unknown>) => {
    Object.assign(mentionProps, props);
    return <div data-testid="mention-popover" />;
  },
}));

vi.mock("@/components/ai/ImReplySuggestions", () => ({
  ImReplySuggestions: (props: Record<string, unknown>) => {
    Object.assign(aiProps, props);
    return <div data-testid="ai-suggestions" />;
  },
}));

const baseProps = {
  onSend: vi.fn(),
  placeholder: "" as string | undefined,
  replyTo: undefined as { id: string; authorName: string | null; body: string } | undefined,
  onCancelReply: vi.fn(),
  members: [
    { userId: "u-me", user: { id: "u-me", name: "Me", email: "me@x.com", image: null } },
    {
      userId: "u-alice",
      user: { id: "u-alice", name: "Alice", email: "alice@x.com", image: null },
    },
  ],
};

const createObjectURL = vi.fn(() => "blob:preview");
const revokeObjectURL = vi.fn();

function textarea() {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

/** 拖拽目标挂在组件根 div 上（RTL 的 container 是它的父包装器，事件不会向下冒泡） */
function dropArea(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

function sendButton() {
  return screen.getByLabelText("chat:sendAria");
}

async function settle() {
  await act(async () => {});
}

function okUploadResponse(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      code: 0,
      data: {
        id: "f-1",
        storageKey: "storage-k1",
        thumbnailKey: null,
        fileType: "text/plain",
        ...over,
      },
    }),
  };
}

describe("MessageInput", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    fetchMock.mockReset();
    baseProps.onSend.mockClear();
    baseProps.onCancelReply.mockClear();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    for (const props of [mentionProps, aiProps]) {
      for (const key of Object.keys(props)) delete props[key];
    }
    paramsMock.wid = "ws-1";
  });

  it("renders with the chat placeholder and a disabled send button while empty", () => {
    render(<MessageInput onSend={baseProps.onSend} />);
    expect(textarea()).toHaveAttribute("placeholder", "chat:placeholder");
    expect(sendButton()).toBeDisabled();
  });

  it("sends the trimmed body on button click and clears the input", async () => {
    render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.change(textarea(), { target: { value: "  hello  " } });
    await settle();
    expect(sendButton()).toBeEnabled();
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(baseProps.onSend).toHaveBeenCalledWith("hello", {});
    expect(textarea()).toHaveValue("");
    expect(sendButton()).toBeDisabled();
  });

  it("sends on Enter and Ctrl/Cmd+Enter but not Shift+Enter", async () => {
    render(<MessageInput onSend={baseProps.onSend} />);
    const el = textarea();
    fireEvent.change(el, { target: { value: "hello" } });
    await settle();
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(baseProps.onSend).toHaveBeenCalledTimes(1);
    // Shift+Enter 只换行
    fireEvent.change(el, { target: { value: "hi" } });
    await settle();
    fireEvent.keyDown(el, { key: "Enter", shiftKey: true });
    expect(baseProps.onSend).toHaveBeenCalledTimes(1);
    // Ctrl+Enter 发送
    fireEvent.change(el, { target: { value: "yo" } });
    await settle();
    await act(async () => {
      fireEvent.keyDown(el, { key: "Enter", ctrlKey: true });
    });
    expect(baseProps.onSend).toHaveBeenCalledTimes(2);
  });

  it("disables the textarea, attach and send buttons when disabled prop is set", () => {
    render(<MessageInput onSend={baseProps.onSend} disabled />);
    expect(textarea()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByLabelText("chat:attachFile")).toBeDisabled();
  });

  it("shows a cancelable reply preview", async () => {
    render(
      <MessageInput
        onSend={baseProps.onSend}
        replyTo={{ id: "m1", authorName: "Alice", body: "hi there" }}
        onCancelReply={baseProps.onCancelReply}
      />,
    );
    expect(screen.getByText('chat:replyTo:{"name":"Alice"}')).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("chat:cancel"));
    expect(baseProps.onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("shows the character counter only past 8000 characters", () => {
    render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.change(textarea(), { target: { value: "a".repeat(8000) } });
    expect(screen.queryByText(/8000 \/ 10000/)).toBeNull();
    fireEvent.change(textarea(), { target: { value: "a".repeat(8001) } });
    expect(screen.getByText("8001 / 10000")).toBeInTheDocument();
    // 未超限仍可发送
    expect(sendButton()).toBeEnabled();
  });

  it("uses the custom placeholder when provided", () => {
    render(<MessageInput onSend={baseProps.onSend} placeholder="chat:custom" />);
    expect(textarea()).toHaveAttribute("placeholder", "chat:custom");
  });

  it("opens the mention popover when typing @query and inserts the mention", async () => {
    render(<MessageInput onSend={baseProps.onSend} members={baseProps.members} />);
    const el = textarea();
    fireEvent.change(el, { target: { value: "hi @Ali", selectionStart: 7 } });
    await settle();
    expect(screen.getByTestId("mention-popover")).toBeInTheDocument();
    expect(mentionProps.query).toBe("Ali");
    expect(Array.isArray(mentionProps.members)).toBe(true);
    await act(async () => {
      (mentionProps.onSelect as (id: string, name: string) => void)("u-alice", "Alice");
    });
    expect(el).toHaveValue("hi @Alice ");
    // 关闭浮层
    await act(async () => {
      (mentionProps.onClose as () => void)();
    });
    expect(screen.queryByTestId("mention-popover")).toBeNull();
  });

  it("does not trigger mentions inside emails-like text", async () => {
    render(<MessageInput onSend={baseProps.onSend} members={baseProps.members} />);
    fireEvent.change(textarea(), { target: { value: "mail me at a@b.com", selectionStart: 17 } });
    await settle();
    expect(screen.queryByTestId("mention-popover")).toBeNull();
  });

  it("sends collected mention ids together with the body", async () => {
    render(<MessageInput onSend={baseProps.onSend} members={baseProps.members} />);
    const el = textarea();
    fireEvent.change(el, { target: { value: "hi @Ali", selectionStart: 7 } });
    await settle();
    await act(async () => {
      (mentionProps.onSelect as (id: string, name: string) => void)("u-alice", "Alice");
    });
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(baseProps.onSend).toHaveBeenCalledWith("hi @Alice", { mentions: ["u-alice"] });
  });

  it("uploads a dropped file and attaches the uploaded file", async () => {
    fetchMock.mockResolvedValue(okUploadResponse());
    const { container } = render(<MessageInput onSend={baseProps.onSend} />);
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(dropArea(container), { dataTransfer: { files: [file] } });
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/files/upload",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    const body = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(body.body).toBeInstanceOf(FormData);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    // 上传完成后不再显示 spinner，且出现移除按钮
    expect(screen.getByLabelText("chat:removeAttachment")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-loader-2")).toBeNull();
    // 发送时携带附件
    await act(async () => {
      fireEvent.click(sendButton());
    });
    // send 需要 body 非空：无正文不会发
    expect(baseProps.onSend).not.toHaveBeenCalled();
    fireEvent.change(textarea(), { target: { value: "see file" } });
    await settle();
    await act(async () => {
      fireEvent.click(sendButton());
    });
    const sent = baseProps.onSend.mock.calls[0]![1] as { attachments: unknown[] };
    expect(sent.attachments).toEqual([
      {
        id: expect.any(String),
        fileName: "notes.txt",
        url: "/uploads/storage-k1",
        fileType: "text/plain",
        fileSize: file.size,
        thumbnailUrl: null,
      },
    ]);
  });

  it("uploads an image with a blob preview then swaps in the remote thumbnail", async () => {
    fetchMock.mockResolvedValue(okUploadResponse({ thumbnailKey: "thumb-1" }));
    const { container } = render(<MessageInput onSend={baseProps.onSend} />);
    const file = new File(["img"], "shot.png", { type: "image/png" });
    fireEvent.drop(dropArea(container), { dataTransfer: { files: [file] } });
    await settle();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText("shot.png")).toBeInTheDocument();
    fireEvent.change(textarea(), { target: { value: "see shot" } });
    await settle();
    await act(async () => {
      fireEvent.click(sendButton());
    });
    const sent = baseProps.onSend.mock.calls[0]![1] as {
      attachments: Array<Record<string, unknown>>;
    };
    expect(sent.attachments[0]).toMatchObject({
      url: "/uploads/storage-k1",
      thumbnailUrl: "/uploads/thumb-1",
    });
    // 拿到远端缩略图后释放 blob
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector("svg.lucide-loader-2")).toBeNull();
  });

  it("rejects files larger than 10MB without uploading", async () => {
    const { container } = render(<MessageInput onSend={baseProps.onSend} />);
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.bin", { type: "text/plain" });
    fireEvent.drop(dropArea(container), { dataTransfer: { files: [big] } });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("chat:fileTooLarge")).toBeInTheDocument();
    expect(screen.queryByText("big.bin")).toBeNull();
  });

  it("removes the attachment and reports uploadFailed when the upload fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { container } = render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.drop(dropArea(container), {
      dataTransfer: { files: [new File(["x"], "bad.txt", { type: "text/plain" })] },
    });
    await settle();
    expect(screen.getByText("chat:uploadFailed")).toBeInTheDocument();
    expect(screen.queryByText("bad.txt")).toBeNull();
  });

  it("auto-clears the upload error after three seconds", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const { container } = render(<MessageInput onSend={baseProps.onSend} />);
      fireEvent.drop(dropArea(container), {
        dataTransfer: { files: [new File(["x"], "bad.txt", { type: "text/plain" })] },
      });
      await settle();
      expect(screen.getByText("chat:uploadFailed")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.queryByText("chat:uploadFailed")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks sending while an upload is in flight", async () => {
    fetchMock.mockReturnValue(new Promise<typeof okUploadResponse>(() => {}));
    const { container } = render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.drop(dropArea(container), {
      dataTransfer: { files: [new File(["x"], "slow.txt", { type: "text/plain" })] },
    });
    await settle();
    fireEvent.change(textarea(), { target: { value: "typing" } });
    await settle();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("slow.txt")).toBeInTheDocument();
  });

  it("shows and hides the drag overlay", async () => {
    const { container } = render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.dragOver(dropArea(container), { dataTransfer: { files: [] } });
    await settle();
    expect(screen.getByText("chat:dropFileHint")).toBeInTheDocument();
    fireEvent.dragLeave(dropArea(container));
    await settle();
    expect(screen.queryByText("chat:dropFileHint")).toBeNull();
  });

  it("opens the file picker from the attach button", () => {
    const { container } = render(<MessageInput onSend={baseProps.onSend} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("aria-hidden", "true");
    // 点击附件按钮会触发隐藏 input 的 click
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByLabelText("chat:attachFile"));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the task picker, lists tasks and inserts the selected task", async () => {
    apiMock.mockResolvedValue({
      items: [{ id: "t-1", title: "Write docs", status: "todo" }],
    });
    render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.click(screen.getByLabelText("chat:shareTask"));
    await settle();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "chat:shareTask");
    fireEvent.click(screen.getByText("Write docs"));
    await settle();
    expect(textarea()).toHaveValue("[task:t-1:Write docs]");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows task picker loading and error states and closes via the overlay", async () => {
    // 加载中
    apiMock.mockReturnValue(new Promise<{ items: unknown[] }>(() => {}));
    const { rerender } = render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.click(screen.getByLabelText("chat:shareTask"));
    await settle();
    expect(screen.getByText("chat:taskPickerLoading")).toBeInTheDocument();
    // 关闭弹层
    fireEvent.click(screen.getByLabelText("chat:cancel"));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    // 加载失败
    apiMock.mockRejectedValue(new Error("down"));
    rerender(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.click(screen.getByLabelText("chat:shareTask"));
    await settle();
    expect(screen.getByText("chat:taskPickerLoadFailed")).toBeInTheDocument();
  });

  it("shows the empty state when there are no tasks", async () => {
    apiMock.mockResolvedValue({ items: [] });
    render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.click(screen.getByLabelText("chat:shareTask"));
    await settle();
    expect(screen.getByText("chat:taskPickerEmpty")).toBeInTheDocument();
  });

  it("reports unavailable task picker when there is no workspace in route params", async () => {
    paramsMock.wid = undefined;
    render(<MessageInput onSend={baseProps.onSend} />);
    fireEvent.click(screen.getByLabelText("chat:shareTask"));
    await settle();
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText("chat:taskPickerUnavailable")).toBeInTheDocument();
  });

  it("renders and toggles the AI reply panel, filling the body on select", async () => {
    const { container } = render(
      <MessageInput onSend={baseProps.onSend} conversationId="conv-1" />,
    );
    const aiButton = screen.getByLabelText("chat:aiReply");
    expect(aiButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(aiButton);
    await settle();
    expect(screen.getByTestId("ai-suggestions")).toBeInTheDocument();
    expect(aiProps.wid).toBe("ws-1");
    expect(aiProps.conversationId).toBe("conv-1");
    await act(async () => {
      (aiProps.onSelect as (text: string) => void)("Glad to help!");
    });
    expect(textarea()).toHaveValue("Glad to help!");
    expect(container.querySelector("svg.lucide-sparkles")).toBeInTheDocument();
  });

  it("disables the AI reply button when aiEnabled is false", () => {
    render(<MessageInput onSend={baseProps.onSend} conversationId="conv-1" aiEnabled={false} />);
    const aiButton = screen.getByLabelText("chat:aiReply");
    expect(aiButton).toBeDisabled();
    expect(aiButton).toHaveAttribute("title", "chat:aiReplyUnavailable");
  });

  it("hides the AI reply button without a conversation", () => {
    render(<MessageInput onSend={baseProps.onSend} />);
    expect(screen.queryByLabelText("chat:aiReply")).toBeNull();
  });
});
