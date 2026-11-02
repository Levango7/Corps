// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { Conversation, Message } from "@/components/im/types";
import { TaskChatPanel } from "@/components/im/TaskChatPanel";

const { imState, chatProps } = vi.hoisted(() => ({
  imState: {} as Record<string, unknown>,
  chatProps: {} as Record<string, unknown>,
}));

vi.mock("@/components/im/useIM", () => ({
  useIM: (workspaceId: string) => {
    imState.workspaceId = workspaceId;
    return imState;
  },
}));

vi.mock("@/components/im/ChatWindow", () => ({
  ChatWindow: (props: Record<string, unknown>) => {
    Object.assign(chatProps, props);
    return <div data-testid="chat-window" />;
  },
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

function mkConversation(over: Record<string, unknown> = {}): Conversation {
  return {
    id: "conv-1",
    workspaceId: "ws-1",
    type: "group",
    title: "Task chat",
    avatar: null,
    description: null,
    createdBy: "u-me",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastMessageAt: null,
    members: [],
    ...over,
  } as Conversation;
}

function mkMessage(over: Record<string, unknown> = {}): Message {
  return {
    id: "m-1",
    conversationId: "conv-1",
    authorId: "u-alice",
    author: { id: "u-alice", name: "Alice", email: null, image: null },
    body: "hello",
    type: "text",
    createdAt: "2026-01-01T00:00:00Z",
    editedAt: null,
    revokedAt: null,
    revokedBy: null,
    replyToId: null,
    mentions: [],
    attachments: [],
    ...over,
  } as Message;
}

interface ImHookState {
  activeConversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  error: string | null;
  selectTaskConversation: (taskId: string) => void | Promise<void>;
  loadMoreMessages: (conversationId: string) => void | Promise<void>;
  loadingMore: boolean;
  sendMessage: (
    conversationId: string,
    body: string,
    opts?: Record<string, unknown>,
  ) => void | Promise<void>;
  editMessage: (conversationId: string, messageId: string, body: string) => void | Promise<void>;
  revokeMessage: (conversationId: string, messageId: string) => void | Promise<void>;
  typingUsers: Record<string, string[]>;
}

/** Fresh hook state; pass overrides to land on a specific render branch. */
function makeState(over: Partial<ImHookState> = {}): ImHookState {
  return {
    activeConversation: null,
    messages: [],
    loading: false,
    error: null,
    selectTaskConversation: vi.fn(),
    loadMoreMessages: vi.fn(),
    loadingMore: false,
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    revokeMessage: vi.fn(),
    typingUsers: {},
    ...over,
  };
}

function loadState(state: ImHookState) {
  for (const key of Object.keys(imState)) delete imState[key];
  Object.assign(imState, state);
}

afterEach(() => {
  cleanup();
  for (const key of Object.keys(chatProps)) delete chatProps[key];
  for (const key of Object.keys(imState)) delete imState[key];
});

const baseProps = { workspaceId: "ws-1", taskId: "t-1", currentUserId: "u-me" };

describe("TaskChatPanel", () => {
  it("asks useIM for the task conversation on mount with the task id", () => {
    const state = makeState();
    loadState(state);
    render(<TaskChatPanel {...baseProps} />);
    expect(state.selectTaskConversation).toHaveBeenCalledWith("t-1");
    expect(imState.workspaceId).toBe("ws-1");
  });

  it("re-selects when the task id changes", () => {
    const state = makeState();
    loadState(state);
    const { rerender } = render(<TaskChatPanel {...baseProps} />);
    rerender(<TaskChatPanel {...baseProps} taskId="t-2" />);
    expect(state.selectTaskConversation).toHaveBeenCalledWith("t-1");
    expect(state.selectTaskConversation).toHaveBeenCalledWith("t-2");
  });

  it("shows the loading branch before the conversation arrives", () => {
    loadState(makeState({ loading: true }));
    render(<TaskChatPanel {...baseProps} />);
    expect(screen.getByText("chat:loading")).toBeInTheDocument();
    expect(screen.getByText("chat:createLoadingMembers")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });

  it("shows the error branch when loading failed", () => {
    loadState(makeState({ error: "boom" }));
    render(<TaskChatPanel {...baseProps} />);
    expect(screen.getByText("chat:title")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });

  it("loading is ignored once a conversation is present", () => {
    loadState(
      makeState({
        loading: true,
        activeConversation: mkConversation(),
        messages: [mkMessage()],
      }),
    );
    render(<TaskChatPanel {...baseProps} />);
    expect(screen.getByText("Task chat")).toBeInTheDocument();
    expect(screen.getByTestId("chat-window")).toBeInTheDocument();
  });

  it("falls back to the chat title when the conversation has none", () => {
    loadState(makeState({ activeConversation: mkConversation({ title: null }) }));
    render(<TaskChatPanel {...baseProps} />);
    expect(screen.getByText("chat:title")).toBeInTheDocument();
  });

  it("renders the empty branch when there is no conversation and no error", () => {
    loadState(makeState());
    render(<TaskChatPanel {...baseProps} />);
    expect(screen.getByText("chat:title")).toBeInTheDocument();
    expect(screen.getByText("chat:empty")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });

  it("forwards conversation, messages and current user to ChatWindow", () => {
    const conversation = mkConversation();
    const messages = [mkMessage(), mkMessage({ id: "m-2", body: "second" })];
    loadState(makeState({ activeConversation: conversation, messages }));
    render(<TaskChatPanel {...baseProps} />);
    expect(chatProps.conversation).toBe(conversation);
    expect(chatProps.messages).toBe(messages);
    expect(chatProps.currentUserId).toBe("u-me");
  });

  it("maps onSend to sendMessage with the conversation id", async () => {
    const conversation = mkConversation();
    const sendMessage = vi.fn();
    loadState(makeState({ activeConversation: conversation, sendMessage }));
    render(<TaskChatPanel {...baseProps} />);
    await act(async () => {
      (chatProps.onSend as (b: string, o?: Record<string, unknown>) => void)("hi", {
        mentions: ["u-alice"],
      });
    });
    expect(sendMessage).toHaveBeenCalledWith("conv-1", "hi", { mentions: ["u-alice"] });
  });

  it("maps onEdit to editMessage with the conversation id", async () => {
    const conversation = mkConversation();
    const editMessage = vi.fn();
    loadState(makeState({ activeConversation: conversation, editMessage }));
    render(<TaskChatPanel {...baseProps} />);
    await act(async () => {
      (chatProps.onEdit as (m: string, b: string) => void)("m-1", "edited");
    });
    expect(editMessage).toHaveBeenCalledWith("conv-1", "m-1", "edited");
  });

  it("maps onRevoke to revokeMessage with the conversation id", async () => {
    const conversation = mkConversation();
    const revokeMessage = vi.fn();
    loadState(makeState({ activeConversation: conversation, revokeMessage }));
    render(<TaskChatPanel {...baseProps} />);
    await act(async () => {
      (chatProps.onRevoke as (m: string) => void)("m-1");
    });
    expect(revokeMessage).toHaveBeenCalledWith("conv-1", "m-1");
  });

  it("maps onLoadMore to loadMoreMessages with the conversation id", async () => {
    const conversation = mkConversation();
    const loadMoreMessages = vi.fn();
    loadState(makeState({ activeConversation: conversation, loadMoreMessages }));
    render(<TaskChatPanel {...baseProps} />);
    await act(async () => {
      (chatProps.onLoadMore as () => void)();
    });
    expect(loadMoreMessages).toHaveBeenCalledWith("conv-1");
  });

  it("passes loadingMore straight through", () => {
    loadState(makeState({ activeConversation: mkConversation(), loadingMore: true }));
    render(<TaskChatPanel {...baseProps} />);
    expect(chatProps.loadingMore).toBe(true);
  });

  it("resolves typing users for this conversation, defaulting to an empty list", () => {
    const rerenderStage = (typingUsers: Record<string, string[]>) => {
      loadState(makeState({ activeConversation: mkConversation(), typingUsers }));
      return render(<TaskChatPanel {...baseProps} />);
    };
    rerenderStage({ "conv-1": [] });
    expect(chatProps.typingUserIds).toEqual([]);

    // A typo list for another conversation must not leak into this window.
    rerenderStage({ "other-conv": ["u-alice"] });
    expect(chatProps.typingUserIds).toEqual([]);

    rerenderStage({ "conv-1": ["u-alice", "u-bob"] } as Record<string, string[]>);
    expect(chatProps.typingUserIds).toEqual(["u-alice", "u-bob"]);
  });
});
