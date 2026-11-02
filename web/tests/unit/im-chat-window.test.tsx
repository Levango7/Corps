// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { Conversation, Message } from "@/components/im/types";
import { ChatWindow } from "@/components/im/ChatWindow";

const { apiMock, pushMock, listProps, inputProps, searchProps, notifyProps } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
  listProps: {} as Record<string, unknown>,
  inputProps: {} as Record<string, unknown>,
  searchProps: {} as Record<string, unknown>,
  notifyProps: {} as Record<string, unknown>,
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ locale: "zh", wid: "ws-1" }),
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

vi.mock("@/components/im/MessageList", () => ({
  MessageList: (props: Record<string, unknown>) => {
    Object.assign(listProps, props);
    return <div data-testid="msg-list" />;
  },
}));

vi.mock("@/components/im/MessageInput", () => ({
  MessageInput: (props: Record<string, unknown>) => {
    Object.assign(inputProps, props);
    return <div data-testid="msg-input" />;
  },
}));

vi.mock("@/components/im/MessageSearch", () => ({
  MessageSearch: (props: Record<string, unknown>) => {
    Object.assign(searchProps, props);
    return <div data-testid="msg-search" />;
  },
}));

vi.mock("@/components/im/IncomingCallNotification", () => ({
  IncomingCallNotification: (props: Record<string, unknown>) => {
    Object.assign(notifyProps, props);
    return null;
  },
}));

function mkConversation(over: Record<string, unknown> = {}): Conversation {
  return {
    id: "conv-1",
    workspaceId: "ws-1",
    type: "direct",
    title: null,
    avatar: null,
    description: null,
    createdBy: "u-me",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    lastMessageAt: null,
    members: [
      {
        id: "mem-1",
        conversationId: "conv-1",
        userId: "u-me",
        role: "member",
        joinedAt: "2026-06-01T00:00:00Z",
        lastReadAt: null,
        muted: false,
        user: { id: "u-me", name: "Me", email: "me@x.com", image: null },
      },
      {
        id: "mem-2",
        conversationId: "conv-1",
        userId: "u-alice",
        role: "member",
        joinedAt: "2026-06-01T00:00:00Z",
        lastReadAt: null,
        muted: false,
        user: { id: "u-alice", name: "Alice", email: "alice@x.com", image: null },
      },
    ],
    ...over,
  } as Conversation;
}

function groupConversation(): Conversation {
  return mkConversation({
    type: "group",
    title: "Team",
    members: [
      ...mkConversation().members,
      {
        id: "mem-3",
        conversationId: "conv-1",
        userId: "u-bob",
        role: "admin",
        joinedAt: "2026-06-01T00:00:00Z",
        lastReadAt: null,
        muted: false,
        user: { id: "u-bob", name: "Bob", email: "bob@x.com", image: null },
      },
    ],
  });
}

function mkInvite(over: Record<string, unknown> = {}): Message {
  return {
    id: "msg-invite",
    conversationId: "conv-1",
    authorId: "u-alice",
    author: { id: "u-alice", name: "Alice", email: "alice@x.com", image: null },
    body: "加入通话 /zh/w/ws-1/meetings/m-9",
    type: "call_invite",
    createdAt: "2026-06-01T10:00:00Z",
    editedAt: null,
    revokedAt: null,
    revokedBy: null,
    replyToId: null,
    mentions: [],
    attachments: [],
    ...over,
  } as Message;
}

const baseProps = {
  conversation: mkConversation(),
  messages: [] as Message[],
  currentUserId: "u-me",
  onSend: vi.fn(),
  onEdit: vi.fn(),
  onRevoke: vi.fn(),
};

/** 默认 api：POST 建会 + GET 会议状态（只有发起者自己） */
function defaultMeetingApi() {
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/api/v1/workspaces/ws-1/meetings") return { id: "m-1" };
    if (path.startsWith("/api/v1/workspaces/ws-1/meetings/")) {
      return { status: "active", participants: [{ userId: "u-me", joinedAt: "x" }] };
    }
    throw new Error(`unexpected api path: ${path}`);
  });
}

async function settle() {
  await act(async () => {});
}

describe("ChatWindow", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    pushMock.mockReset();
    baseProps.onSend.mockClear();
    baseProps.onEdit.mockClear();
    baseProps.onRevoke.mockClear();
    for (const props of [listProps, inputProps, searchProps, notifyProps]) {
      for (const key of Object.keys(props)) delete props[key];
    }
  });

  it("renders the group title and member count", () => {
    render(<ChatWindow {...baseProps} conversation={groupConversation()} />);
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("uses the other member name as the direct conversation title", () => {
    render(<ChatWindow {...baseProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("falls back to unknownUser when the other member has no name or email", () => {
    const conversation = mkConversation({
      members: [
        baseProps.conversation.members[0],
        {
          id: "mem-x",
          conversationId: "conv-1",
          userId: "u-x",
          role: "member",
          joinedAt: "2026-06-01T00:00:00Z",
          lastReadAt: null,
          muted: false,
          user: { id: "u-x", name: null, email: null, image: null },
        },
      ],
    });
    render(<ChatWindow {...baseProps} conversation={conversation} />);
    expect(screen.getByText("chat:unknownUser")).toBeInTheDocument();
  });

  it("shows the settings button only when onSettings is provided", () => {
    const { rerender } = render(<ChatWindow {...baseProps} />);
    expect(screen.queryByLabelText("chat:settings")).toBeNull();
    const onSettings = vi.fn();
    rerender(<ChatWindow {...baseProps} onSettings={onSettings} />);
    fireEvent.click(screen.getByLabelText("chat:settings"));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("toggles the in-conversation search panel", async () => {
    render(<ChatWindow {...baseProps} />);
    const toggle = screen.getByLabelText("chat:search");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await settle();
    fireEvent.click(toggle);
    await settle();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("msg-search")).toBeInTheDocument();
    expect(searchProps.workspaceId).toBe("ws-1");
    expect(searchProps.conversationId).toBe("conv-1");
    // 再次点击收起
    fireEvent.click(toggle);
    await settle();
    expect(screen.queryByTestId("msg-search")).toBeNull();
  });

  it("passes messages, pagination and loading state to MessageList", () => {
    const messages = [mkInvite()];
    const onLoadMore = vi.fn();
    render(
      <ChatWindow
        {...baseProps}
        messages={messages}
        onLoadMore={onLoadMore}
        loadingMore={true}
        conversation={mkConversation({ hasMoreMessages: true })}
      />,
    );
    expect(listProps.messages).toBe(messages);
    expect(listProps.currentUserId).toBe("u-me");
    expect(listProps.hasMore).toBe(true);
    expect(listProps.loading).toBe(true);
    expect(listProps.onLoadMore).toBe(onLoadMore);
    expect(listProps.onEdit).toBe(baseProps.onEdit);
    expect(listProps.onRevoke).toBe(baseProps.onRevoke);
  });

  it("maps conversation members into the MessageInput mention list", () => {
    render(<ChatWindow {...baseProps} />);
    expect(inputProps.onSend).toBe(baseProps.onSend);
    expect(inputProps.conversationId).toBe("conv-1");
    expect(inputProps.members).toEqual([
      { userId: "u-me", user: { id: "u-me", name: "Me", image: null } },
      { userId: "u-alice", user: { id: "u-alice", name: "Alice", image: null } },
    ]);
  });

  it("shows the reply target in MessageInput and clears it on cancel", async () => {
    const messages = [
      {
        ...mkInvite(),
        id: "msg-1",
        type: "text" as const,
        body: "hi there",
      },
    ];
    render(<ChatWindow {...baseProps} messages={messages} />);
    await settle();
    await act(async () => {
      (listProps.onReply as (id: string) => void)("msg-1");
    });
    expect(inputProps.replyTo).toEqual({ id: "msg-1", authorName: "Alice", body: "hi there" });
    await act(async () => {
      (inputProps.onCancelReply as () => void)();
    });
    expect(inputProps.replyTo).toBeNull();
  });

  it("starts a video call: creates an instant meeting, sends a call_invite and routes to the room", async () => {
    defaultMeetingApi();
    render(<ChatWindow {...baseProps} />);
    fireEvent.click(screen.getByLabelText("im:videoCall"));
    await settle();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/meetings", {
      method: "POST",
      body: JSON.stringify({ title: "im:videoCall", type: "instant", videoEnabled: true }),
    });
    expect(baseProps.onSend).toHaveBeenCalledWith("im:callInvite: /zh/w/ws-1/meetings/m-1", {
      type: "call_invite",
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/zh/w/ws-1/meetings/m-1?conversationId=conv-1&skipLobby=true",
    );
  });

  it("starts a voice call with the voice title and invite body", async () => {
    defaultMeetingApi();
    render(<ChatWindow {...baseProps} />);
    fireEvent.click(screen.getByLabelText("im:voiceCall"));
    await settle();
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/meetings", {
      method: "POST",
      body: JSON.stringify({ title: "im:voiceCall", type: "instant", videoEnabled: false }),
    });
    expect(baseProps.onSend).toHaveBeenCalledWith("im:voiceCallInvite: /zh/w/ws-1/meetings/m-1", {
      type: "call_invite",
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/zh/w/ws-1/meetings/m-1?conversationId=conv-1&skipLobby=true",
    );
  });

  it("disables both call buttons and shows a spinner while a call is starting", async () => {
    apiMock.mockImplementation(() => new Promise<{ id: string }>(() => {}));
    render(<ChatWindow {...baseProps} />);
    fireEvent.click(screen.getByLabelText("im:videoCall"));
    await settle();
    expect(screen.getByLabelText("im:calling")).toBeDisabled();
    expect(screen.getByLabelText("im:voiceCall")).toBeDisabled();
  });

  it("auto-sends call_ended after the timeout when nobody else joined", async () => {
    vi.useFakeTimers();
    try {
      defaultMeetingApi();
      render(<ChatWindow {...baseProps} />);
      fireEvent.click(screen.getByLabelText("im:videoCall"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
      expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/meetings/m-1");
      expect(baseProps.onSend).toHaveBeenCalledWith("im:callEnded", { type: "call_ended" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send call_ended when the meeting has other participants", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockImplementation(async (path: string) => {
        if (path === "/api/v1/workspaces/ws-1/meetings") return { id: "m-1" };
        return {
          status: "active",
          participants: [
            { userId: "u-me", joinedAt: "x" },
            { userId: "u-alice", joinedAt: "x" },
          ],
        };
      });
      render(<ChatWindow {...baseProps} />);
      fireEvent.click(screen.getByLabelText("im:videoCall"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
      // 只有 call_invite 一条，没有 call_ended
      expect(baseProps.onSend).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send call_ended when the meeting status check fails", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockImplementation(async (path: string) => {
        if (path === "/api/v1/workspaces/ws-1/meetings") return { id: "m-1" };
        throw new Error("meeting api down");
      });
      render(<ChatWindow {...baseProps} />);
      fireEvent.click(screen.getByLabelText("im:videoCall"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
      expect(baseProps.onSend).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers when meeting creation fails: no invite, no routing, buttons re-enabled", async () => {
    apiMock.mockRejectedValue(new Error("boom"));
    render(<ChatWindow {...baseProps} />);
    fireEvent.click(screen.getByLabelText("im:videoCall"));
    await settle();
    expect(baseProps.onSend).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    // finally 已复位 calling 状态，按钮恢复可用
    expect(screen.getByLabelText("im:videoCall")).toBeEnabled();
  });

  it("raises an incoming call notification for a call_invite from another member", async () => {
    render(<ChatWindow {...baseProps} messages={[mkInvite()]} />);
    await settle();
    expect(notifyProps.callData).toEqual({
      messageId: "msg-invite",
      callerId: "u-alice",
      callerName: "Alice",
      callerImage: null,
      callType: "video",
      meetingUrl: "/zh/w/ws-1/meetings/m-9",
      meetingId: "m-9",
    });
  });

  it("detects a voice call from the message body", async () => {
    render(
      <ChatWindow
        {...baseProps}
        messages={[mkInvite({ body: "语音通话 /zh/w/ws-1/meetings/m-9" })]}
      />,
    );
    await settle();
    expect((notifyProps.callData as { callType: string }).callType).toBe("voice");
  });

  it("ignores call_invite messages authored by the current user", async () => {
    render(<ChatWindow {...baseProps} messages={[mkInvite({ authorId: "u-me" })]} />);
    await settle();
    expect(notifyProps.callData).toBeNull();
  });

  it("clears the notification when the call is ended or rejected downstream", async () => {
    const ended = mkInvite({ type: "call_ended", body: "通话结束" });
    render(<ChatWindow {...baseProps} messages={[mkInvite(), ended]} />);
    await settle();
    expect(notifyProps.callData).toBeNull();
  });

  it("accepts an incoming call and routes into the meeting room", async () => {
    render(<ChatWindow {...baseProps} messages={[mkInvite()]} />);
    await settle();
    await act(async () => {
      (notifyProps.onAccept as (d: unknown) => void)({
        meetingUrl: "/zh/w/ws-1/meetings/m-9",
      });
    });
    // 组件在已含 locale 前缀的 meetingUrl 上再拼一次 /${locale}
    expect(pushMock).toHaveBeenCalledWith(
      "/zh/zh/w/ws-1/meetings/m-9?conversationId=conv-1&skipLobby=true",
    );
    expect(notifyProps.callData).toBeNull();
  });

  it("rejects an incoming call and sends call_rejected", async () => {
    render(<ChatWindow {...baseProps} messages={[mkInvite()]} />);
    await settle();
    await act(async () => {
      (notifyProps.onReject as (d: unknown) => void)({});
    });
    expect(baseProps.onSend).toHaveBeenCalledWith("im:callRejected", { type: "call_rejected" });
    expect(notifyProps.callData).toBeNull();
  });

  it("shows who is typing: one, two, many, and never the current user", async () => {
    const { rerender } = render(<ChatWindow {...baseProps} typingUserIds={["u-alice"]} />);
    await settle();
    expect(screen.getByText('chat:typing:{"names":"Alice"}')).toBeInTheDocument();

    rerender(
      <ChatWindow
        {...baseProps}
        conversation={groupConversation()}
        typingUserIds={["u-alice", "u-bob"]}
      />,
    );
    await settle();
    expect(screen.getByText('chat:typing:{"names":"Alice、Bob"}')).toBeInTheDocument();

    rerender(
      <ChatWindow
        {...baseProps}
        conversation={groupConversation()}
        typingUserIds={["u-alice", "u-bob", "u-carol"]}
      />,
    );
    await settle();
    expect(screen.getByText("chat:typingMany")).toBeInTheDocument();

    // 自己输入不提示
    rerender(<ChatWindow {...baseProps} typingUserIds={["u-me"]} />);
    await settle();
    expect(screen.queryByText(/chat:typing/)).toBeNull();
    expect(screen.queryByText("chat:typingMany")).toBeNull();
  });
});
