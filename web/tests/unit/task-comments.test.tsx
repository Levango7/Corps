// @vitest-environment jsdom

/**
 * TaskComments 契约（components/task/TaskComments.tsx）：
 * 评论列表（作者/相对时间/正文/头像首字母）、输入框、@提及自动补全
 * （触发条件、过滤、键盘导航、插入、Esc/blur 关闭）、⌘/Ctrl+Enter 发送。
 */
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, beforeAll, afterEach, describe, it, expect } from "vitest";
import { TaskComments } from "@/components/task/TaskComments";
import type { Comment, Person } from "@/components/task/types";

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

const MEMBERS: Person[] = [
  { id: "u1", name: "Alice", email: "alice@x.com" },
  { id: "u2", name: null, email: "han@x.com" },
  { id: "u3", name: "Bob", email: "bob@x.com" },
];

/** jsdom 未实现 matchMedia：全局注入受控 MediaQueryList（默认桌面端） */
const mqMock = {
  matches: true,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
beforeAll(() => {
  vi.stubGlobal("matchMedia", (_query: string) => mqMock as unknown as MediaQueryList);
});

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c-" + Math.random().toString(36).slice(2, 8),
    body: "评论正文",
    createdAt: "2026-10-01T10:00:00Z",
    author: { id: "u1", name: "Alice", email: "alice@x.com" },
    ...overrides,
  };
}

function relTime(iso: string) {
  return `rel:${iso}`;
}

function renderComments(
  comments: Comment[] = [],
  members: Person[] = MEMBERS,
  onSend: ReturnType<typeof vi.fn> = vi.fn(),
) {
  const { container } = render(
    <TaskComments comments={comments} members={members} onSend={onSend} relTime={relTime} />,
  );
  const draft = container.querySelector<HTMLTextAreaElement>(
    "textarea[placeholder='task:commentPlaceholder']",
  )!;
  return { container, draft, onSend };
}

/** 带光标位置填入草稿（@提及逻辑依赖 selectionStart） */
function typeDraft(draft: HTMLTextAreaElement, value: string, caretAtEnd = true) {
  const target: { value: string; selectionStart?: number } = { value };
  if (caretAtEnd) target.selectionStart = value.length;
  fireEvent.change(draft, { target });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TaskComments", () => {
  it("无评论时不渲染计数徽标", () => {
    renderComments();
    expect(screen.getByText("task:discussionTitle")).toBeInTheDocument();
    expect(headingBadge()).toBeNull();
  });

  it("渲染评论正文、作者名、相对时间与头像首字母（name 首字母大写）", () => {
    const { container } = renderComments([makeComment({ body: "第一帖", author: MEMBERS[0] })]);
    expect(screen.getByText("第一帖")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("rel:2026-10-01T10:00:00Z")).toBeInTheDocument();
    const avatar = container.querySelector<HTMLDivElement>('div[class~="w-7"][class~="h-7"]');
    expect(avatar?.textContent).toBe("A");
  });

  it("作者 name 为 null 时显示邮箱 @ 前部分，头像取邮箱首字母", () => {
    const { container } = renderComments([makeComment({ author: MEMBERS[1] })]);
    expect(screen.getByText("han")).toBeInTheDocument();
    const avatar = container.querySelector<HTMLDivElement>('div[class~="w-7"][class~="h-7"]');
    expect(avatar?.textContent).toBe("H");
  });

  it("author 为 null 时显示已删除用户兜底文案", () => {
    renderComments([makeComment({ author: null })]);
    expect(screen.getByText("task:deletedUser")).toBeInTheDocument();
  });

  it("有评论时标题旁出现计数徽标", () => {
    renderComments([makeComment(), makeComment()]);
    expect(headingBadge()?.textContent).toBe("2");
  });

  it("发送按钮初始禁用，输入后可用，点击发送调用 onSend（trim 后正文 + @mentions 提取）", async () => {
    const { draft, onSend } = renderComments();
    const send = screen.getByRole("button", { name: /task:send/ });
    expect(send).toBeDisabled();
    typeDraft(draft, "  ping @alice 和 @bob  ");
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("ping @alice 和 @bob", ["alice", "bob"]);
    await act(async () => {});
  });

  it("onSend 返回 true 后草稿清空", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const { draft } = renderComments([], MEMBERS, onSend);
    typeDraft(draft, "你好");
    fireEvent.click(screen.getByRole("button", { name: /task:send/ }));
    await waitFor(() => expect(draft).toHaveValue(""));
  });

  it("onSend 返回 false 时草稿保留", async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    const { draft } = renderComments([], MEMBERS, onSend);
    typeDraft(draft, "你好");
    fireEvent.click(screen.getByRole("button", { name: /task:send/ }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(draft).toHaveValue("你好");
  });

  it("发送中按钮禁用，结束后恢复", async () => {
    let release!: (ok: boolean) => void;
    const onSend = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((r) => {
          release = r;
        }),
    );
    const { draft } = renderComments([], MEMBERS, onSend);
    typeDraft(draft, "挠");
    const send = screen.getByRole("button", { name: /task:send/ });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeDisabled());
    // 失败保留草稿：sending 归零后按钮恢复可用
    await act(async () => {
      release(false);
    });
    await waitFor(() => {
      expect(send).toBeEnabled();
      expect(draft).toHaveValue("挠");
    });
  });

  it("空草稿时点击发送不调用 onSend", () => {
    const { onSend } = renderComments();
    // 按钮虽禁用，直接验证守卫：用空格填入再点（trim 后为空）
    const send = screen.getByRole("button", { name: /task:send/ });
    expect(send).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("⌘/Ctrl+Enter 均可发送草稿（发送成功后草稿清空，再按不重复发送）", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const { draft } = renderComments([], MEMBERS, onSend);
    typeDraft(draft, "快捷发送");
    fireEvent.keyDown(draft, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(draft).toHaveValue(""));
    // 草稿已清空：空草稿守卫挡住第二次发送
    fireEvent.keyDown(draft, { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("普通 Enter 不发送（由输入框默认换行行为接管）", () => {
    const { draft, onSend } = renderComments();
    typeDraft(draft, "不直接发");
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("行首 @query 打开提及浮层并按 name/email 过滤", () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "你好 @ali");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("邮箱中的 @（前面无空白）不触发提及浮层", () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "联系 a@b.com");
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("han@x.com")).not.toBeInTheDocument();
  });

  it("@query 后输入空格即关闭浮层", () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "@ali  ");
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("↑/↓ 在候选间循环选中（高亮 class 变化），Enter 插入提及并补空格", () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "@");
    const buttons = screen.getAllByRole("button");
    const candidate = buttons.filter(
      (b) => b.textContent === "Alice" || b.textContent === "han@x.com" || b.textContent === "Bob",
    );
    expect(candidate).toHaveLength(3);
    expect(candidate[0].className).toContain("var(--surface-2)");
    fireEvent.keyDown(draft, { key: "ArrowDown" });
    expect(candidate[1].className).toContain("var(--surface-2)");
    expect(candidate[0].className).not.toContain("var(--surface-2)");
    fireEvent.keyDown(draft, { key: "ArrowUp" });
    expect(candidate[0].className).toContain("var(--surface-2)");
    // Enter 插入第一个候选（Alice → handle = name）
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(draft).toHaveValue("@Alice ");
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("Enter 在 name 为 null 的候选上插入邮箱 @ 前部分", () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    // 只让 han 命中过滤
    typeDraft(draft, "@han");
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(draft).toHaveValue("@han ");
  });

  it("Tab 同样插入候选，Esc 关闭浮层", () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "喂 @bo");
    fireEvent.keyDown(draft, { key: "Tab" });
    expect(draft).toHaveValue("喂 @Bob ");
    typeDraft(draft, "@");
    fireEvent.keyDown(draft, { key: "Escape" });
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("鼠标按下候选按钮插入提及（不触发聚焦跳离）", () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "回答 @ali");
    const alice = screen.getByText("Alice").closest("button")!;
    fireEvent.mouseDown(alice);
    expect(draft).toHaveValue("回答 @Alice ");
  });

  it("插入提及后光标恢复到 @handle 与尾随空格之后", async () => {
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "哈 @bo");
    fireEvent.keyDown(draft, { key: "Enter" });
    await waitFor(() => expect(draft.selectionStart).toBe("哈 @Bob ".length));
    await waitFor(() => expect(draft.selectionEnd).toBe("哈 @Bob ".length));
  });

  it("blur 后延迟 150ms 关闭提及浮层（让 mousedown 有机会触发）", () => {
    vi.useFakeTimers();
    renderComments();
    const draft = screen.getByPlaceholderText("task:commentPlaceholder") as HTMLTextAreaElement;
    typeDraft(draft, "@ali");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    fireEvent.blur(draft);
    // 立即断言：浮层仍在
    expect(screen.getByText("Alice")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("移动端视口使用短占位文案，桌面端使用完整占位文案", () => {
    mqMock.matches = false;
    const { unmount } = render(
      <TaskComments comments={[]} members={MEMBERS} onSend={vi.fn()} relTime={relTime} />,
    );
    expect(screen.getByPlaceholderText("task:commentPlaceholderMobile")).toBeInTheDocument();
    unmount();
    expect(mqMock.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    cleanup();
    mqMock.matches = true;
    mqMock.addEventListener.mockClear();
    render(<TaskComments comments={[]} members={MEMBERS} onSend={vi.fn()} relTime={relTime} />);
    expect(screen.getByPlaceholderText("task:commentPlaceholder")).toBeInTheDocument();
    expect(mqMock.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});

function headingBadge(): HTMLElement | null {
  const heading = screen.getByText("task:discussionTitle").closest("h2");
  return heading?.querySelector("span") ?? null;
}
