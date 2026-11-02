// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConversationItem } from "@/components/im/ConversationItem";
import type { Conversation, ConversationMember } from "@/components/im/types";

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

const NOW = new Date("2026-06-15T12:00:00Z").getTime();

function mkMember(
  userId: string,
  name: string | null,
  email: string | null,
  opts?: { muted?: boolean; image?: string | null },
): ConversationMember {
  return {
    id: `mem-${userId}`,
    conversationId: "conv-1",
    userId,
    role: "member",
    joinedAt: "2026-01-01T00:00:00Z",
    lastReadAt: null,
    muted: opts?.muted ?? false,
    user: { id: userId, name, email, image: opts?.image ?? null },
  };
}

function mkConversation(over: Partial<Conversation>): Conversation {
  return {
    id: "conv-1",
    workspaceId: "ws-1",
    type: "direct",
    title: null,
    avatar: null,
    description: null,
    createdBy: "me",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    lastMessageAt: null,
    members: [],
    ...over,
  };
}

const me = mkMember("me", "Me", "me@x.com");
const alice = mkMember("u2", "Alice", "alice@x.com", { image: "http://x/a.png" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("ConversationItem", () => {
  it("uses the group title as the display name and avatar initial", () => {
    const conv = mkConversation({
      type: "group",
      title: "团队",
      members: [me],
    });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("团队")).toBeTruthy();
    expect(screen.getByTitle("团队")).toBeTruthy();
    // initial comes from the title
    expect(screen.getByText("团")).toBeTruthy();
  });

  it("falls back to the group label when a group has no title", () => {
    const conv = mkConversation({ type: "group", title: null, members: [me] });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("chat:groupConversation")).toBeTruthy();
    // no title at all -> "?" initial
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("uses the other member name for direct conversations", () => {
    const conv = mkConversation({ members: [me, alice] });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Alice")).toBeTruthy();
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("http://x/a.png");
  });

  it("falls back to email then to the unknown-user label for direct chats", () => {
    const noName = mkMember("u3", null, "carol@x.com");
    const conv = mkConversation({ members: [me, noName] });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("carol@x.com")).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();

    cleanup();
    const conv2 = mkConversation({ members: [me] });
    render(
      <ConversationItem
        conversation={conv2}
        active={false}
        currentUserId="me"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("chat:unknownUser")).toBeTruthy();
  });

  it("treats a whitespace-only name as empty when deriving the initial", () => {
    // a whitespace name is truthy for the `??` chain (empty string is not),
    // but getInitial guards it and falls back to "?"
    const blank = mkMember("u4", "   ", "dee@x.com");
    const conv = mkConversation({ members: [me, blank] });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.queryByText("D")).toBeNull();
  });

  it("shows the truncated last-message preview", () => {
    const longBody = "a".repeat(40);
    const conv = mkConversation({
      members: [me, alice],
      messages: [
        {
          id: "m1",
          conversationId: "conv-1",
          authorId: "u2",
          author: null,
          body: longBody,
          type: "text",
          createdAt: "2026-06-15T11:59:00Z",
          editedAt: null,
          revokedAt: null,
          revokedBy: null,
          replyToId: null,
          replyTo: null,
          mentions: [],
          attachments: [],
        },
      ],
    });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("a".repeat(30) + "…")).toBeTruthy();
  });

  it("falls back to the description then to the no-messages label", () => {
    const conv = mkConversation({ members: [me, alice], description: "group about tests" });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("group about tests")).toBeTruthy();

    cleanup();
    const conv2 = mkConversation({ members: [me, alice], description: "" });
    render(
      <ConversationItem
        conversation={conv2}
        active={false}
        currentUserId="me"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("chat:noMessages")).toBeTruthy();
  });

  it("formats relative times across the just-now/minutes/hours/days bands", () => {
    const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
    const cases: Array<[string, string]> = [
      [iso(30 * 1000), "time:justNow"],
      [iso(5 * 60 * 1000), 'time:minutesAgo:{"count":5}'],
      [iso(3 * 60 * 60 * 1000), 'time:hoursAgo:{"count":3}'],
      [iso(25 * 60 * 60 * 1000), 'time:daysAgo:{"count":1}'],
      [iso(5 * 24 * 60 * 60 * 1000), 'time:daysAgo:{"count":5}'],
    ];
    for (const [lastMessageAt, expected] of cases) {
      const conv = mkConversation({ members: [me, alice], lastMessageAt });
      const { unmount } = render(
        <ConversationItem
          conversation={conv}
          active={false}
          currentUserId="me"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("renders a locale date for messages older than 30 days", () => {
    const old = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString();
    const expected = new Date(old).toLocaleDateString("zh", { month: "numeric", day: "numeric" });
    const conv = mkConversation({ members: [me, alice], lastMessageAt: old });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("omits the time when lastMessageAt is missing or invalid", () => {
    const conv = mkConversation({ members: [me, alice] });
    const { unmount } = render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.queryByText("time:justNow")).toBeNull();
    unmount();

    const conv2 = mkConversation({ members: [me, alice], lastMessageAt: "not-a-date" });
    render(
      <ConversationItem
        conversation={conv2}
        active={false}
        currentUserId="me"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("time:justNow")).toBeNull();
  });

  it("renders the unread badge from unreadCount", () => {
    const conv = mkConversation({ members: [me, alice], unreadCount: 7 });
    render(
      <ConversationItem conversation={conv} active={false} currentUserId="me" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("reflects self-mute and online state in the rendered child", () => {
    const mutedMe = mkMember("me", "Me", "me@x.com", { muted: true });
    const conv = mkConversation({ members: [mutedMe, alice] });
    render(
      <ConversationItem
        conversation={conv}
        active={false}
        currentUserId="me"
        onSelect={vi.fn()}
        isOnline
      />,
    );
    expect(document.querySelector("svg.lucide-bell-off")).not.toBeNull();
    expect(screen.getByLabelText("chat:online")).toBeTruthy();
  });

  it("selects the conversation on click and honours the active flag", () => {
    const onSelect = vi.fn();
    const conv = mkConversation({ members: [me, alice] });
    render(
      <ConversationItem conversation={conv} active={true} currentUserId="me" onSelect={onSelect} />,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-current", "true");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("conv-1");
  });
});
