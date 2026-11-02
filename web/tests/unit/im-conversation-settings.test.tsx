// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { Conversation, ConversationMember } from "@/components/im/types";
import { ConversationSettings } from "@/components/im/ConversationSettings";

const { apiMock, apiListMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  apiListMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock, apiList: apiListMock }));

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

const onCloseMock = vi.fn();
const onUpdateMock = vi.fn();
const onLeaveMock = vi.fn();

const TS = "2026-01-01T00:00:00Z";
const WID = "ws-1";
const CID = "conv-1";

function mkMember(over: Record<string, unknown> = {}): ConversationMember {
  return {
    id: "mem-x",
    conversationId: CID,
    userId: "u-x",
    role: "member",
    joinedAt: TS,
    lastReadAt: null,
    muted: false,
    user: { id: "u-x", name: "X", email: "x@example.com", image: null },
    ...over,
  } as ConversationMember;
}

/** Owner (u-me) + admin (u-alice) + plain member (u-bob). */
function mkMembers(over: Record<string, unknown> = {}): ConversationMember[] {
  return [
    mkMember({
      id: "mem-me",
      userId: "u-me",
      role: "owner",
      user: { id: "u-me", name: "Me", email: "me@example.com", image: null },
      ...over,
    }),
    mkMember({
      id: "mem-alice",
      userId: "u-alice",
      role: "admin",
      user: { id: "u-alice", name: "Alice", email: "alice@example.com", image: null },
    }),
    mkMember({
      id: "mem-bob",
      userId: "u-bob",
      role: "member",
      user: { id: "u-bob", name: "Bob", email: "bob@example.com", image: null },
    }),
  ];
}

function mkConversation(over: Record<string, unknown> = {}): Conversation {
  return {
    id: CID,
    workspaceId: WID,
    type: "group",
    title: "Team",
    avatar: null,
    description: "Group description",
    createdBy: "u-me",
    createdAt: TS,
    updatedAt: TS,
    lastMessageAt: null,
    members: mkMembers(),
    ...over,
  } as Conversation;
}

/** Workspace candidates for the add-member panel (carol + dave, nobody in the group). */
function mkCandidates(): Record<string, unknown>[] {
  return [
    {
      userId: "u-carol",
      role: "member",
      user: { id: "u-carol", name: "Carol", email: "carol@example.com", image: null },
    },
    {
      userId: "u-dave",
      role: "admin",
      user: { id: "u-dave", name: "Dave", email: "dave@example.com", image: null },
    },
  ];
}

/** Apply an override to one member of a list (matched by userId). */
function withMember(
  members: ConversationMember[],
  userId: string,
  over: Record<string, unknown>,
): ConversationMember[] {
  return members.map((m) => (m.userId === userId ? ({ ...m, ...over } as ConversationMember) : m));
}

function renderSettings(over: Record<string, unknown> = {}) {
  const props = {
    conversation: mkConversation(),
    currentUserId: "u-me",
    onClose: onCloseMock,
    onUpdate: onUpdateMock,
    onLeave: onLeaveMock,
    ...over,
  } as ComponentProps<typeof ConversationSettings>;
  return render(<ConversationSettings {...props} />);
}

/** Locate the member row (<li>) containing a given display name. */
function memberRow(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  apiListMock.mockReset();
  onCloseMock.mockReset();
  onUpdateMock.mockReset();
  onLeaveMock.mockReset();
});

describe("ConversationSettings", () => {
  it("renders the modal with editable group info for a group conversation", () => {
    renderSettings();
    expect(screen.getByRole("dialog", { name: "chat:settings" })).toBeInTheDocument();
    const name = screen.getByLabelText("chat:groupName") as HTMLInputElement;
    const desc = screen.getByLabelText("chat:groupDescription") as HTMLTextAreaElement;
    expect(name.value).toBe("Team");
    expect(desc.value).toBe("Group description");
    expect(name).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "chat:save" })).toBeInTheDocument();
  });

  it("hides the group info section for direct conversations", () => {
    renderSettings({ conversation: mkConversation({ type: "direct" }) });
    expect(screen.queryByLabelText("chat:groupName")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("chat:groupDescription")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "chat:save" })).not.toBeInTheDocument();
  });

  it("closes via the X button, the overlay and ESC", () => {
    const { rerender } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "chat:cancel" }));
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    rerender(
      <ConversationSettings
        conversation={mkConversation()}
        currentUserId="u-me"
        onClose={onCloseMock}
        onUpdate={onUpdateMock}
        onLeave={onLeaveMock}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "chat:settings" });
    fireEvent.click(dialog.querySelector('div[aria-hidden="true"]') as HTMLElement);
    expect(onCloseMock).toHaveBeenCalledTimes(2);

    rerender(
      <ConversationSettings
        conversation={mkConversation()}
        currentUserId="u-me"
        onClose={onCloseMock}
        onUpdate={onUpdateMock}
        onLeave={onLeaveMock}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseMock).toHaveBeenCalledTimes(3);
  });

  it("ESC closes the add-member panel instead of the settings modal while it is open", async () => {
    apiListMock.mockResolvedValue(mkCandidates());
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    expect(screen.getByRole("dialog", { name: "chat:addMember" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "chat:addMember" })).not.toBeInTheDocument();
    expect(onCloseMock).not.toHaveBeenCalled();

    // A second ESC now falls through to the modal itself.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("disables group info editing and hides management actions for a plain member", () => {
    renderSettings({ currentUserId: "u-bob" });
    expect(screen.getByLabelText("chat:groupName")).toBeDisabled();
    expect(screen.getByLabelText("chat:groupDescription")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "chat:save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "chat:addMember" })).not.toBeInTheDocument();
    // The owner row is not Bob's to manage.
    expect(screen.queryAllByLabelText(/chat:(makeAdmin|makeMember|removeMember)/)).toHaveLength(0);
    expect(screen.getByText("chat:roleMember")).toBeInTheDocument();
  });

  it("saves trimmed group info, refreshes the list and clears the banner after 2s", async () => {
    vi.useFakeTimers();
    try {
      renderSettings();
      fireEvent.change(screen.getByLabelText("chat:groupName"), {
        target: { value: "  Team v2  " },
      });
      fireEvent.change(screen.getByLabelText("chat:groupDescription"), {
        target: { value: "  New text  " },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "chat:save" }));
      });

      expect(apiMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/conversations/${CID}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Team v2", description: "New text" }),
      });
      expect(onUpdateMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("chat:settingsSaved")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.queryByText("chat:settingsSaved")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the thrown error message when saving fails", async () => {
    apiMock.mockRejectedValueOnce(new Error("network down"));
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:save" }));
    });
    expect(screen.getByText("network down")).toBeInTheDocument();
    expect(onUpdateMock).not.toHaveBeenCalled();
  });

  it("falls back to the generic failure key for non-Error rejections", async () => {
    apiMock.mockRejectedValueOnce("nope");
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:save" }));
    });
    expect(screen.getByText("chat:settingsSaveFailed")).toBeInTheDocument();
  });

  it("toggles mute optimistically and PATCHes the self-member row", async () => {
    renderSettings();
    const btn = screen.getByRole("button", { name: "chat:muteNotifications" });
    expect(btn.querySelector(".w-9")?.className).not.toContain("bg-[var(--accent)]");

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(apiMock).toHaveBeenCalledWith(
      `/api/v1/workspaces/${WID}/conversations/${CID}/members/u-me`,
      { method: "PATCH", body: JSON.stringify({ muted: true }) },
    );
    expect(screen.getByRole("button", { name: "chat:unmuteNotifications" })).toBeInTheDocument();

    const toggled = screen.getByRole("button", { name: "chat:unmuteNotifications" });
    expect(toggled.querySelector(".w-9")?.className).toContain("bg-[var(--accent)]");
    await act(async () => {
      fireEvent.click(toggled);
    });
    expect(apiMock).toHaveBeenLastCalledWith(
      `/api/v1/workspaces/${WID}/conversations/${CID}/members/u-me`,
      { method: "PATCH", body: JSON.stringify({ muted: false }) },
    );
  });

  it("initializes the mute switch from the conversation member state", () => {
    renderSettings({
      conversation: mkConversation({
        members: mkMembers({ muted: true }),
      }),
    });
    expect(screen.getByRole("button", { name: "chat:unmuteNotifications" })).toBeInTheDocument();
  });

  it("rolls back and reports when the mute PATCH fails", async () => {
    apiMock.mockRejectedValueOnce(new Error("server"));
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:muteNotifications" }));
    });
    expect(screen.getByRole("button", { name: "chat:muteNotifications" })).toBeInTheDocument();
    expect(screen.getByText("chat:settingsMuteFailed")).toBeInTheDocument();
  });

  it("renders members with names, role badges, self marker and avatar initials", () => {
    renderSettings();
    expect(
      screen.getByText("chat:memberCount:" + JSON.stringify({ count: 3 })),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("chat:roleOwner")).toBeInTheDocument();
    expect(screen.getByText("chat:roleAdmin")).toBeInTheDocument();
    expect(screen.getByText("chat:roleMember")).toBeInTheDocument();
    expect(screen.getByText("(chat:settingsMe)")).toBeInTheDocument();
    // Avatar fallback shows the first letter of the name.
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders an avatar image when the member has one", () => {
    renderSettings({
      conversation: mkConversation({
        members: mkMembers({
          user: { id: "u-me", name: "Me", email: "me@example.com", image: "https://img/me.png" },
        }),
      }),
    });
    expect(document.querySelector('img[src="https://img/me.png"]')).toBeInTheDocument();
  });

  it("falls back to the email when the name is missing", () => {
    renderSettings({
      conversation: mkConversation({
        members: [
          mkMember({
            id: "mem-me",
            userId: "u-me",
            role: "owner",
            user: { id: "u-me", name: null, email: "me@example.com", image: null },
          }),
        ],
      }),
    });
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
  });

  it("promotes a member to admin and refreshes the member list", async () => {
    apiListMock.mockResolvedValue(withMember(mkMembers(), "u-bob", { role: "admin" }));
    renderSettings();
    const promote = screen.getByLabelText("chat:makeAdmin");
    await act(async () => {
      fireEvent.click(promote);
    });
    expect(apiMock).toHaveBeenCalledWith(
      `/api/v1/workspaces/${WID}/conversations/${CID}/members/u-bob`,
      { method: "PATCH", body: JSON.stringify({ role: "admin" }) },
    );
    expect(apiListMock).toHaveBeenCalledWith(
      `/api/v1/workspaces/${WID}/conversations/${CID}/members`,
    );
    // The refreshed list has Bob as admin: the demote button replaced the promote one.
    expect(screen.queryByLabelText("chat:makeAdmin")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("chat:makeMember")).toHaveLength(2);
  });

  it("reports a failure when the role change is rejected", async () => {
    apiMock.mockRejectedValueOnce("boom");
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("chat:makeAdmin"));
    });
    expect(screen.getByText("chat:settingsRoleFailed")).toBeInTheDocument();
  });

  it("asks for confirmation before removing a member, then removes them", async () => {
    renderSettings();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(memberRow("Bob")).getByLabelText("chat:removeMember"));
    });
    const confirm = screen.getByRole("presentation");
    const dialog = confirm.querySelector('div[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByText("im:confirmRemoveMember")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "chat:cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "im:confirm" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "im:confirm" }));
    });
    expect(apiMock).toHaveBeenCalledWith(
      `/api/v1/workspaces/${WID}/conversations/${CID}/members/u-bob`,
      { method: "DELETE" },
    );
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("keeps the member when the removal confirmation is cancelled", async () => {
    renderSettings();
    await act(async () => {
      fireEvent.click(within(memberRow("Bob")).getByLabelText("chat:removeMember"));
    });
    const dialog = screen
      .getByRole("presentation")
      .querySelector('div[role="dialog"]') as HTMLElement;

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "chat:cancel" }));
    });
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("cancels the confirmation when only the overlay is clicked", async () => {
    renderSettings();
    await act(async () => {
      fireEvent.click(within(memberRow("Bob")).getByLabelText("chat:removeMember"));
    });
    fireEvent.click(screen.getByRole("presentation"));
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("deletes the group as owner after confirmation and calls onLeave", async () => {
    renderSettings();
    expect(screen.getByRole("button", { name: "chat:deleteConversation" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:deleteConversation" }));
    });
    const dialog = screen
      .getByRole("presentation")
      .querySelector('div[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByText("im:confirmDeleteGroup")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "im:confirm" }));
    });
    expect(apiMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/conversations/${CID}`, {
      method: "DELETE",
    });
    expect(onLeaveMock).toHaveBeenCalledTimes(1);
  });

  it("offers leave (not delete) to a plain member", async () => {
    renderSettings({ currentUserId: "u-bob" });
    expect(screen.getByRole("button", { name: "chat:leaveConversation" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "chat:deleteConversation" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:leaveConversation" }));
    });
    const dialog = screen
      .getByRole("presentation")
      .querySelector('div[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByText("im:confirmLeaveGroup")).toBeInTheDocument();
  });

  it("reports a leave failure and does not navigate away", async () => {
    apiMock.mockRejectedValueOnce(new Error("cannot leave"));
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:deleteConversation" }));
    });
    const dialog = screen
      .getByRole("presentation")
      .querySelector('div[role="dialog"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "im:confirm" }));
    });
    expect(screen.getByText("cannot leave")).toBeInTheDocument();
    expect(onLeaveMock).not.toHaveBeenCalled();
  });

  it("hides the danger section for direct conversations", () => {
    renderSettings({ conversation: mkConversation({ type: "direct" }) });
    expect(
      screen.queryByRole("button", { name: "chat:deleteConversation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "chat:leaveConversation" }),
    ).not.toBeInTheDocument();
    // No per-member management in a direct conversation either.
    expect(screen.queryAllByLabelText("chat:removeMember")).toHaveLength(0);
  });

  it("opens the add-member panel without already-present members", async () => {
    apiListMock.mockResolvedValue(mkCandidates());
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    expect(apiListMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/members`);

    const panel = screen.getByRole("dialog", { name: "chat:addMember" });
    expect(within(panel).getByText("Carol")).toBeInTheDocument();
    expect(within(panel).getByText("Dave")).toBeInTheDocument();
    // Existing group members (Me/Alice/Bob) are never offered.
    expect(within(panel).queryByText("Alice")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Bob")).not.toBeInTheDocument();
    // Nothing selected yet → the confirm button stays disabled.
    expect(within(panel).getByRole("button", { name: "chat:addMember" })).toBeDisabled();
  });

  it("filters candidates by name or email", async () => {
    apiListMock.mockResolvedValue(mkCandidates());
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    const panel = screen.getByRole("dialog", { name: "chat:addMember" });
    fireEvent.change(within(panel).getByLabelText("chat:selectMembers"), {
      target: { value: "car" },
    });
    expect(within(panel).getByText("Carol")).toBeInTheDocument();
    expect(within(panel).queryByText("Dave")).not.toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("chat:selectMembers"), {
      target: { value: "nobody" },
    });
    expect(within(panel).getByText("chat:createNoMembers")).toBeInTheDocument();
  });

  it("adds the selected members, closes the panel and refreshes", async () => {
    apiListMock.mockResolvedValue(mkCandidates());
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    const panel = screen.getByRole("dialog", { name: "chat:addMember" });
    const carolBtn = within(panel).getByRole("button", { name: /Carol/ });
    expect(carolBtn.querySelector("svg.lucide-check")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(carolBtn);
    });
    expect(carolBtn.querySelector("svg.lucide-check")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "chat:addMember" })).toBeEnabled();

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "chat:addMember" }));
    });
    expect(apiMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/conversations/${CID}/members`, {
      method: "POST",
      body: JSON.stringify({ userIds: ["u-carol"] }),
    });
    expect(screen.queryByRole("dialog", { name: "chat:addMember" })).not.toBeInTheDocument();
    expect(onUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failure and keeps the panel open when adding members fails", async () => {
    apiListMock.mockResolvedValueOnce(mkCandidates());
    apiMock.mockRejectedValueOnce(new Error("denied"));
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    const panel = screen.getByRole("dialog", { name: "chat:addMember" });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /Carol/ }));
    });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "chat:addMember" }));
    });
    expect(screen.getByText("denied")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "chat:addMember" })).toBeInTheDocument();
  });

  it("reports a failure when the workspace member list cannot be loaded", async () => {
    apiListMock.mockRejectedValueOnce(new Error("500"));
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    expect(screen.getByText("chat:createLoadMembersFailed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "chat:addMember" })).toBeInTheDocument();
  });

  it("closes the add-member panel via its own overlay and cancel button", async () => {
    apiListMock.mockResolvedValue(mkCandidates());
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    const panel = screen.getByRole("dialog", { name: "chat:addMember" });
    fireEvent.click(panel.querySelector('div[aria-hidden="true"]') as HTMLElement);
    expect(screen.queryByRole("dialog", { name: "chat:addMember" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "chat:addMember" }));
    });
    const panel2 = screen.getByRole("dialog", { name: "chat:addMember" });
    // Two buttons carry the cancel label (header X + footer); the footer one is last.
    fireEvent.click(
      within(panel2).getAllByRole("button", { name: "chat:cancel" }).at(-1) as HTMLElement,
    );
    expect(screen.queryByRole("dialog", { name: "chat:addMember" })).not.toBeInTheDocument();
    // The settings modal itself is untouched.
    expect(screen.getByRole("dialog", { name: "chat:settings" })).toBeInTheDocument();
    expect(onCloseMock).not.toHaveBeenCalled();
  });
});
