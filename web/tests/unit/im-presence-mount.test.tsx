// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * 在线成员条的挂载契约。
 *
 * 背景（2026-10-06 实测）：`/api/v1/workspaces/{wid}/presence` 的 GET 与 POST 心跳
 * 早已实现，`components/OnlinePresence.tsx` 也写好了轮询与清理，但**全仓没有一处挂载**
 * ——它只被同样零挂载的 CollaborationProvider 引用。属于"能力存在但没通电"。
 * 这里钉两件事：
 *  1. IM 页（多会话模式）确实挂上，且拿到的是当前工作区 id；
 *  2. 单会话模式（任务详情内嵌聊天）不挂 —— 那种场景不该替用户起 2 分钟心跳。
 */

let presenceProps: Record<string, unknown> = {};

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => ({ id: "u1" })),
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/components/im/useIM", () => ({
  useIM: () => ({
    conversations: [],
    activeConversation: null,
    messages: [],
    loading: false,
    error: null,
    typingUsers: [],
    loadingMore: false,
    selectConversation: vi.fn(),
    loadMoreMessages: vi.fn(),
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    revokeMessage: vi.fn(),
    loadConversations: vi.fn(),
  }),
}));

vi.mock("@/components/OnlinePresence", () => ({
  default: (props: Record<string, unknown>) => {
    presenceProps = props;
    return <div data-testid="presence-strip" />;
  },
}));

vi.mock("@/components/im/ConversationList", () => ({
  ConversationList: () => {
    return <div data-testid="conversation-list" />;
  },
}));
vi.mock("@/components/im/ChatWindow", () => ({
  ChatWindow: () => <div data-testid="chat-window" />,
}));
vi.mock("@/components/im/MessageSearch", () => ({ MessageSearch: () => null }));
vi.mock("@/components/im/ConversationCreate", () => ({ ConversationCreate: () => null }));
vi.mock("@/components/im/ConversationSettings", () => ({ ConversationSettings: () => null }));

import { IMClient } from "@/components/im/IMClient";

afterEach(() => {
  cleanup();
  presenceProps = {};
});

describe("IM 在线成员条挂载", () => {
  it("多会话模式挂上 OnlinePresence，并带上当前工作区 id", () => {
    render(<IMClient workspaceId="w-42" />);
    expect(screen.getByTestId("presence-strip")).toBeInTheDocument();
    expect(presenceProps.wid).toBe("w-42");
  });

  it("单会话模式不挂（不给任务内嵌聊天起心跳）", () => {
    render(<IMClient workspaceId="w-42" singleConversationId="c-7" />);
    expect(screen.queryByTestId("presence-strip")).not.toBeInTheDocument();
    // 注意：单会话模式是用 class=hidden 隐藏列表，组件仍会渲染，
    // 所以这里只断言 presence 被条件渲染掉，不断言列表。
  });
});
