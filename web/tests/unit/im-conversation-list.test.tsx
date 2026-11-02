// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Conversation, ConversationMember } from "@/components/im/types";
import { ConversationList } from "@/components/im/ConversationList";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

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

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "zh", wid: "ws-1" }),
}));

function mkMember(
  userId: string,
  name: string | null,
  email: string | null,
  over: Partial<ConversationMember> = {},
): ConversationMember {
  return {
    id: `m-${userId}`,
    conversationId: "conv-1",
    userId,
    role: "member",
    joinedAt: "2026-06-01T00:00:00Z",
    lastReadAt: null,
    muted: false,
    user: { id: userId, name, email, image: null },
    ...over,
  };
}

function mkConversation(
  over: Partial<Conversation> & Pick<Conversation, "id" | "type" | "members">,
): Conversation {
  return {
    workspaceId: "ws-1",
    title: null,
    avatar: null,
    description: null,
    createdBy: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    lastMessageAt: null,
    ...over,
  };
}

const baseProps = {
  conversations: [] as Conversation[],
  activeId: null as string | null,
  currentUserId: "u-me",
  onSelect: vi.fn(),
  onSearch: vi.fn(),
  onCreate: vi.fn(),
};

function renderList(over: Partial<typeof baseProps> = {}) {
  const props = { ...baseProps, ...over };
  return render(<ConversationList {...props} />);
}

/** 会话项按文档顺序出现的名字顺序（body.textContent 的 indexOf） */
function nameOrder(): string[] {
  const text = document.body.textContent ?? "";
  return ["Bob", "Alice", "Carol", "Group"].filter((n) => text.includes(n));
}

function indexOfName(name: string): number {
  return (document.body.textContent ?? "").indexOf(name);
}

describe("ConversationList", () => {
  beforeAll(() => {
    // jsdom 未实现 Element.prototype.scrollIntoView，会话项渲染不依赖它，但防御性补齐
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    baseProps.onSelect.mockClear();
    baseProps.onSearch.mockClear();
    baseProps.onCreate.mockClear();
  });

  it("renders the toolbar with search, filter and create buttons", () => {
    renderList();
    expect(screen.getByLabelText("chat:search")).toBeInTheDocument();
    expect(screen.getByLabelText("chat:newConversation")).toBeInTheDocument();
    expect(screen.getByLabelText("chat:filterConversations")).toBeInTheDocument();
    // 筛选模式切换
    expect(screen.getByText("chat:all")).toBeInTheDocument();
    expect(screen.getByText("chat:unread")).toBeInTheDocument();
  });

  it("calls onSearch and onCreate from the toolbar buttons", () => {
    renderList();
    fireEvent.click(screen.getByLabelText("chat:search"));
    fireEvent.click(screen.getByLabelText("chat:newConversation"));
    expect(baseProps.onSearch).toHaveBeenCalledTimes(1);
    expect(baseProps.onCreate).toHaveBeenCalledTimes(1);
  });

  it("sorts conversations by lastMessageAt descending with nulls last", () => {
    renderList({
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
          lastMessageAt: "2026-06-15T10:00:00Z",
        }),
        mkConversation({
          id: "conv-2",
          type: "direct",
          members: [
            mkMember("u-me", "Me", "me@x.com"),
            mkMember("u-alice", "Alice", "alice@x.com"),
          ],
          lastMessageAt: "2026-06-14T10:00:00Z",
        }),
        mkConversation({
          id: "conv-3",
          type: "direct",
          members: [
            mkMember("u-me", "Me", "me@x.com"),
            mkMember("u-carol", "Carol", "carol@x.com"),
          ],
          lastMessageAt: null,
        }),
      ],
    });
    expect(indexOfName("Bob")).toBeLessThan(indexOfName("Alice"));
    expect(indexOfName("Alice")).toBeLessThan(indexOfName("Carol"));
    expect(nameOrder()).toEqual(["Bob", "Alice", "Carol"]);
  });

  it("filters conversations by direct-chat name case-insensitively", () => {
    renderList({
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
        mkConversation({
          id: "conv-2",
          type: "direct",
          members: [
            mkMember("u-me", "Me", "me@x.com"),
            mkMember("u-alice", "Alice", "alice@x.com"),
          ],
        }),
      ],
    });
    fireEvent.change(screen.getByLabelText("chat:filterConversations"), {
      target: { value: "AL" },
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).toBeNull();
  });

  it("filters group conversations by title", () => {
    renderList({
      conversations: [
        mkConversation({
          id: "conv-g",
          type: "group",
          title: "Project Alpha",
          members: [mkMember("u-me", "Me", "me@x.com")],
        }),
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
      ],
    });
    fireEvent.change(screen.getByLabelText("chat:filterConversations"), {
      target: { value: "proj" },
    });
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).toBeNull();
  });

  it("shows only unread conversations in unread filter mode", () => {
    renderList({
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
          unreadCount: 3,
        }),
        mkConversation({
          id: "conv-2",
          type: "direct",
          members: [
            mkMember("u-me", "Me", "me@x.com"),
            mkMember("u-alice", "Alice", "alice@x.com"),
          ],
          unreadCount: 0,
        }),
      ],
    });
    fireEvent.click(screen.getByText("chat:unread"));
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).toBeNull();
    // 切回全部
    fireEvent.click(screen.getByText("chat:all"));
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows the empty state when there are no conversations", () => {
    renderList();
    expect(screen.getByText("chat:empty")).toBeInTheDocument();
  });

  it("shows the no-results state when the filter matches nothing", () => {
    renderList({
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
      ],
    });
    fireEvent.change(screen.getByLabelText("chat:filterConversations"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("chat:noResults")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).toBeNull();
  });

  it("marks the active conversation with aria-current", () => {
    renderList({
      activeId: "conv-1",
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
      ],
    });
    const item = screen.getByText("Bob").closest("button");
    expect(item).toHaveAttribute("aria-current", "true");
  });

  it("fires onSelect with the conversation id when an item is clicked", () => {
    renderList({
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
      ],
    });
    fireEvent.click(screen.getByText("Bob").closest("button")!);
    expect(baseProps.onSelect).toHaveBeenCalledWith("conv-1");
  });

  it("polls the online API immediately, every 30 seconds, and stops on unmount", async () => {
    apiMock.mockResolvedValue({ items: [], total: 0 });
    vi.useFakeTimers();
    try {
      const { unmount } = renderList({
        conversations: [
          mkConversation({
            id: "conv-1",
            type: "direct",
            members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
          }),
        ],
      });
      // 初始加载调用一次
      expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/im/online");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(apiMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(apiMock).toHaveBeenCalledTimes(3);
      unmount();
      await vi.advanceTimersByTimeAsync(90_000);
      expect(apiMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks direct-chat partners as online from the online poll", async () => {
    apiMock.mockResolvedValue({
      items: [{ userId: "u-bob", lastSeen: "2026-06-15T10:00:00Z" }],
      total: 1,
    });
    renderList({
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
      ],
    });
    expect(await screen.findByLabelText("chat:online")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/im/online");
  });

  it("never marks group conversations as online", async () => {
    apiMock.mockResolvedValue({
      items: [{ userId: "u-bob", lastSeen: "2026-06-15T10:00:00Z" }],
      total: 1,
    });
    renderList({
      conversations: [
        mkConversation({
          id: "conv-g",
          type: "group",
          title: "Group",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
      ],
    });
    await screen.findByText("Group");
    expect(screen.queryByLabelText("chat:online")).toBeNull();
  });

  it("keeps working when the online poll fails", async () => {
    apiMock.mockRejectedValue(new Error("boom"));
    renderList({
      conversations: [
        mkConversation({
          id: "conv-1",
          type: "direct",
          members: [mkMember("u-me", "Me", "me@x.com"), mkMember("u-bob", "Bob", "bob@x.com")],
        }),
      ],
    });
    await screen.findByText("Bob");
    expect(screen.queryByLabelText("chat:online")).toBeNull();
  });
});
