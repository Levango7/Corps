// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach, afterAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Message } from "@/components/im/types";
import { MessageList } from "@/components/im/MessageList";

vi.mock("@/components/im/MessageItem", () => {
  const MessageItem = (props: {
    message: Message;
    isOwn: boolean;
    showAuthor: boolean;
    callEnded?: boolean;
  }) => (
    <div
      data-testid="msg"
      data-id={props.message.id}
      data-own={props.isOwn ? "1" : "0"}
      data-show-author={props.showAuthor ? "1" : "0"}
      data-call-ended={String(props.callEnded)}
    >
      {props.message.body}
    </div>
  );
  return { MessageItem };
});

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
  return { useTranslations, useLocale: () => "zh" };
});

function mkMessage(
  over: Partial<Message> & Pick<Message, "id" | "authorId" | "body" | "createdAt">,
): Message {
  return {
    conversationId: "conv-1",
    author: {
      id: over.authorId ?? "u1",
      name: over.authorId === "u-me" ? "Me" : "Alice",
      email: "a@x.com",
      image: null,
    },
    type: "text",
    editedAt: null,
    revokedAt: null,
    revokedBy: null,
    replyToId: null,
    mentions: [],
    attachments: [],
    ...over,
  };
}

const baseProps = {
  messages: [] as Message[],
  currentUserId: "u-me",
  onEdit: vi.fn(),
  onRevoke: vi.fn(),
};

const scrollSpy = vi.fn();

function scrollContainer(container: HTMLElement): HTMLDivElement {
  return container.querySelector('[class*="overflow-y-auto"]') as HTMLDivElement;
}

/** 给 jsdom 的滚动容器装上可读写的滚动几何（jsdom 默认全为 0 且无 scrollTo） */
function installScrollGeometry(
  el: HTMLDivElement,
  dims: { height: number; client: number; top: number },
) {
  let scrollTop = dims.top;
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: dims.height });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: dims.client });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh", { hour: "2-digit", minute: "2-digit" });
}

describe("MessageList", () => {
  beforeAll(() => {
    // jsdom 未实现 Element.prototype.scrollTo（MessageList 的 scrollToBottom 直接调用它）
    Element.prototype.scrollTo = scrollSpy as unknown as typeof Element.prototype.scrollTo;
  });

  afterAll(() => {
    delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
  });

  beforeEach(() => {
    scrollSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    baseProps.onEdit.mockClear();
    baseProps.onRevoke.mockClear();
  });

  it("renders the empty state when there are no messages", () => {
    const { container } = render(<MessageList {...baseProps} />);
    expect(screen.getByText("chat:empty")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="msg"]').length).toBe(0);
  });

  it("renders a spinner while loading with no messages", () => {
    const { container } = render(<MessageList {...baseProps} loading={true} />);
    expect(container.querySelectorAll("svg.lucide-loader-2").length).toBe(1);
    expect(screen.queryByText("chat:empty")).toBeNull();
  });

  it("renders a load-more button when there is more history and not loading", () => {
    const onLoadMore = vi.fn();
    render(<MessageList {...baseProps} hasMore={true} onLoadMore={onLoadMore} />);
    const btn = screen.getByRole("button", { name: "chat:loadMore" });
    fireEvent.click(btn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("replaces the load-more button with a spinner while loading more history", () => {
    const { container } = render(
      <MessageList
        {...baseProps}
        hasMore={true}
        loading={true}
        onLoadMore={vi.fn()}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    // 已有消息时只有 hasMore 指示器一个 spinner
    expect(container.querySelectorAll("svg.lucide-loader-2").length).toBe(1);
    expect(screen.queryByRole("button", { name: "chat:loadMore" })).toBeNull();
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("groups messages by date with localized labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z").getTime());
    try {
      const oldIso = "2026-06-10T05:30:00Z";
      const yesterdayIso = "2026-06-14T10:00:00Z";
      const todayIso = "2026-06-15T09:00:00Z";
      render(
        <MessageList
          {...baseProps}
          messages={[
            mkMessage({ id: "m1", authorId: "u-other", body: "old", createdAt: oldIso }),
            mkMessage({ id: "m2", authorId: "u-me", body: "yesterday", createdAt: yesterdayIso }),
            mkMessage({ id: "m3", authorId: "u-me", body: "today", createdAt: todayIso }),
          ]}
        />,
      );
      const todayLabel = `chat:today:${JSON.stringify({ time: timeOf(todayIso) })}`;
      const yesterdayLabel = `chat:yesterday:${JSON.stringify({ time: timeOf(yesterdayIso) })}`;
      const oldLabel = `${new Date(oldIso).toLocaleDateString("zh", {
        month: "short",
        day: "numeric",
      })} ${timeOf(oldIso)}`;
      expect(screen.getByText(todayLabel)).toBeInTheDocument();
      expect(screen.getByText(yesterdayLabel)).toBeInTheDocument();
      expect(screen.getByText(oldLabel)).toBeInTheDocument();
      // 文档顺序：旧 → 昨天 → 今天
      const text = document.body.textContent ?? "";
      expect(text.indexOf(oldLabel)).toBeLessThan(text.indexOf(yesterdayLabel));
      expect(text.indexOf(yesterdayLabel)).toBeLessThan(text.indexOf(todayLabel));
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts messages from the same day into one date group", () => {
    render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({
            id: "m1",
            authorId: "u-other",
            body: "one",
            createdAt: "2026-06-15T09:00:00Z",
          }),
          mkMessage({
            id: "m2",
            authorId: "u-other",
            body: "two",
            createdAt: "2026-06-15T10:00:00Z",
          }),
        ]}
      />,
    );
    // 同一天只有一个日期标签（今天）
    const labels = document.querySelectorAll("span.rounded-full");
    expect(labels.length).toBe(1);
  });

  it("passes isOwn and showAuthor flags to each MessageItem", () => {
    const { container } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({
            id: "m1",
            authorId: "u-me",
            body: "mine 1",
            createdAt: "2026-06-15T09:00:00Z",
          }),
          mkMessage({
            id: "m2",
            authorId: "u-me",
            body: "mine 2",
            createdAt: "2026-06-15T09:30:00Z",
          }),
          mkMessage({
            id: "m3",
            authorId: "u-other",
            body: "theirs",
            createdAt: "2026-06-15T10:00:00Z",
          }),
        ]}
      />,
    );
    const rows = container.querySelectorAll('[data-testid="msg"]');
    expect(rows.length).toBe(3);
    const flags = Array.from(rows).map((r) => [
      r.getAttribute("data-own"),
      r.getAttribute("data-show-author"),
    ]);
    expect(flags).toEqual([
      ["1", "1"], // 自己，首条显示作者
      ["1", "0"], // 自己，相邻同作者不重复显示
      ["0", "1"], //他人，换作者显示
    ]);
  });

  it("marks earlier call invitations as ended when a later call_ended arrives", () => {
    const { container } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({
            id: "i1",
            authorId: "u-other",
            body: "call 1",
            createdAt: "2026-06-15T09:00:00Z",
            type: "call_invite",
          }),
          mkMessage({
            id: "i2",
            authorId: "u-me",
            body: "call 2",
            createdAt: "2026-06-15T09:05:00Z",
            type: "call_invite",
          }),
          mkMessage({
            id: "e1",
            authorId: "u-other",
            body: "",
            createdAt: "2026-06-15T09:10:00Z",
            type: "call_ended",
          }),
        ]}
      />,
    );
    const endedFor = (id: string) =>
      container.querySelector(`[data-id="${id}"]`)?.getAttribute("data-call-ended");
    expect(endedFor("i1")).toBe("true");
    expect(endedFor("i2")).toBe("true");
    // call_ended 本身不在 callEndedMap 里
    expect(endedFor("e1")).toBe("undefined");
  });

  it("marks earlier call invitations as ended when a later call_rejected arrives", () => {
    const { container } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({
            id: "i1",
            authorId: "u-other",
            body: "call",
            createdAt: "2026-06-15T09:00:00Z",
            type: "call_invite",
          }),
          mkMessage({
            id: "r1",
            authorId: "u-me",
            body: "",
            createdAt: "2026-06-15T09:10:00Z",
            type: "call_rejected",
          }),
        ]}
      />,
    );
    expect(container.querySelector('[data-id="i1"]')?.getAttribute("data-call-ended")).toBe("true");
  });

  it("leaves an invite ongoing when nothing ends it, and scopes ended state per conversation", () => {
    const { container } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({
            id: "iA",
            authorId: "u-other",
            body: "call A",
            createdAt: "2026-06-15T09:00:00Z",
            type: "call_invite",
            conversationId: "conv-A",
          }),
          mkMessage({
            id: "iB",
            authorId: "u-other",
            body: "call B",
            createdAt: "2026-06-15T09:05:00Z",
            type: "call_invite",
            conversationId: "conv-B",
          }),
          mkMessage({
            id: "eB",
            authorId: "u-me",
            body: "",
            createdAt: "2026-06-15T09:10:00Z",
            type: "call_ended",
            conversationId: "conv-B",
          }),
        ]}
      />,
    );
    const endedFor = (id: string) =>
      container.querySelector(`[data-id="${id}"]`)?.getAttribute("data-call-ended");
    expect(endedFor("iA")).toBe("false");
    expect(endedFor("iB")).toBe("true");
  });

  it("scrolls to bottom on first load once messages arrive", () => {
    render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "hi", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("stays quiet (no initial scroll) while still loading", () => {
    const { rerender } = render(<MessageList {...baseProps} loading={true} />);
    expect(scrollSpy).not.toHaveBeenCalled();
    rerender(
      <MessageList
        {...baseProps}
        loading={false}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "hi", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    // 两条路径各滚一次：消息到达且停在底部（smooth）+ 首次加载滚动（auto）
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("does not show the new-messages banner when new messages arrive while at the bottom", () => {
    const { rerender } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    rerender(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
          mkMessage({ id: "m2", authorId: "u-me", body: "two", createdAt: "2026-06-15T09:05:00Z" }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /chat:newMessages/ })).toBeNull();
  });

  it("shows the new-messages banner when messages arrive while scrolled up, and resets on click", () => {
    const { container, rerender } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    const el = scrollContainer(container);
    installScrollGeometry(el, { height: 1000, client: 300, top: 400 });
    fireEvent.scroll(el);
    // 滚到非底部（1000 - 400 - 300 = 300 > 50）
    rerender(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
          mkMessage({ id: "m2", authorId: "u-me", body: "two", createdAt: "2026-06-15T09:05:00Z" }),
        ]}
      />,
    );
    const banner = screen.getByRole("button", { name: 'chat:newMessages:{"n":1}' });
    expect(banner).toBeInTheDocument();
    fireEvent.click(banner);
    // 点击后滚动到底部并隐藏浮窗
    expect(scrollSpy).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(screen.queryByRole("button", { name: /chat:newMessages/ })).toBeNull();
  });

  it("accumulates the new-messages count across batches", () => {
    const { container, rerender } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    const el = scrollContainer(container);
    installScrollGeometry(el, { height: 1000, client: 300, top: 500 });
    fireEvent.scroll(el);
    rerender(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
          mkMessage({ id: "m2", authorId: "u-me", body: "two", createdAt: "2026-06-15T09:05:00Z" }),
        ]}
      />,
    );
    rerender(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
          mkMessage({ id: "m2", authorId: "u-me", body: "two", createdAt: "2026-06-15T09:05:00Z" }),
          mkMessage({
            id: "m3",
            authorId: "u-me",
            body: "three",
            createdAt: "2026-06-15T09:10:00Z",
          }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: 'chat:newMessages:{"n":2}' })).toBeInTheDocument();
  });

  it("clears the banner when the user scrolls back to the bottom", () => {
    const { container, rerender } = render(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    const el = scrollContainer(container);
    installScrollGeometry(el, { height: 1000, client: 300, top: 400 });
    fireEvent.scroll(el);
    rerender(
      <MessageList
        {...baseProps}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
          mkMessage({ id: "m2", authorId: "u-me", body: "two", createdAt: "2026-06-15T09:05:00Z" }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /chat:newMessages/ })).toBeInTheDocument();
    // 滚回底部（scrollTop = 700 → 1000 - 700 - 300 = 0 < 50）
    installScrollGeometry(el, { height: 1000, client: 300, top: 700 });
    fireEvent.scroll(el);
    expect(screen.queryByRole("button", { name: /chat:newMessages/ })).toBeNull();
  });

  it("triggers onLoadMore when scrolled to the top with more history available", () => {
    const onLoadMore = vi.fn();
    const { container, rerender } = render(
      <MessageList
        {...baseProps}
        hasMore={true}
        onLoadMore={onLoadMore}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    const el = scrollContainer(container);
    installScrollGeometry(el, { height: 1000, client: 800, top: 0 });
    fireEvent.scroll(el);
    fireEvent.scroll(el);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
    // 加载中不再重复触发
    rerender(
      <MessageList
        {...baseProps}
        hasMore={true}
        loading={true}
        onLoadMore={onLoadMore}
        messages={[
          mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
        ]}
      />,
    );
    fireEvent.scroll(el);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("preserves the scroll position when the message list shrinks after loading more", () => {
    const onLoadMore = vi.fn();
    const messages = [
      mkMessage({ id: "m1", authorId: "u-me", body: "one", createdAt: "2026-06-15T09:00:00Z" }),
      mkMessage({ id: "m2", authorId: "u-me", body: "two", createdAt: "2026-06-15T09:05:00Z" }),
    ];
    const { container, rerender } = render(
      <MessageList {...baseProps} hasMore={true} onLoadMore={onLoadMore} messages={messages} />,
    );
    const el = scrollContainer(container);
    installScrollGeometry(el, { height: 5000, client: 800, top: 0 });
    fireEvent.scroll(el); // 记录 prevScrollHeight = 5000 并触发 onLoadMore
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    // 模拟「加载更多替换」：消息变少、内容变矮
    installScrollGeometry(el, { height: 2000, client: 800, top: 0 });
    let writtenTop = -1;
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => 0,
      set: (v: number) => {
        writtenTop = v;
      },
    });
    rerender(
      <MessageList
        {...baseProps}
        hasMore={false}
        onLoadMore={onLoadMore}
        messages={[messages[0]!]}
      />,
    );
    // scrollTop = 0 + (2000 - 5000)
    expect(writtenTop).toBe(-3000);
  });
});
