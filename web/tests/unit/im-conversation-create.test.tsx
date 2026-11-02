// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { Conversation } from "@/components/im/types";
import { ConversationCreate } from "@/components/im/ConversationCreate";

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

const members = [
  {
    userId: "u-me",
    role: "member",
    user: { id: "u-me", name: "Me", email: "me@x.com", image: null },
  },
  {
    userId: "u-alice",
    role: "member",
    user: { id: "u-alice", name: "Alice", email: "alice@x.com", image: null },
  },
  {
    userId: "u-bob",
    role: "admin",
    user: { id: "u-bob", name: "Bob", email: "bob@x.com", image: null },
  },
];

const baseProps = {
  workspaceId: "ws-1",
  currentUserId: "u-me",
  conversations: [] as Conversation[],
  onCreated: vi.fn(),
  onClose: vi.fn(),
};

function renderCreate(over: Partial<typeof baseProps> = {}) {
  // 只在未配置过返回值时装默认成员，允许调用方先 mockRejectedValue / 空列表等
  if (apiListMock.getMockImplementation() === undefined) {
    apiListMock.mockResolvedValue(members);
  }
  const props = { ...baseProps, ...over };
  return render(<ConversationCreate {...props} />);
}

function clickMember(name: string) {
  fireEvent.click(screen.getByText(name).closest("button")!);
}

function createButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "chat:create" });
}

async function settle() {
  await act(async () => {});
}

describe("ConversationCreate", () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    apiListMock.mockReset();
    baseProps.onCreated.mockClear();
    baseProps.onClose.mockClear();
  });

  it("renders a modal with the mode toggle and member search", async () => {
    renderCreate();
    await settle();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "chat:createConversation");
    expect(screen.getByText("chat:directMessage")).toBeInTheDocument();
    expect(screen.getByText("chat:groupMessage")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("chat:selectMembers")).toBeInTheDocument();
    // 默认单聊模式：没有群名输入
    expect(screen.queryByPlaceholderText("chat:groupNamePlaceholder")).toBeNull();
  });

  it("loads workspace members on mount and excludes the current user", async () => {
    renderCreate();
    await settle();
    expect(apiListMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/members");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Me")).toBeNull();
  });

  it("shows the loading state while members load", () => {
    apiListMock.mockReturnValue(new Promise<typeof members>(() => {}));
    renderCreate();
    expect(screen.getByText("chat:createLoadingMembers")).toBeInTheDocument();
    expect(document.querySelectorAll("svg.lucide-loader-2").length).toBe(1);
  });

  it("shows createLoadMembersFailed when the member load fails", async () => {
    apiListMock.mockRejectedValue(new Error("boom"));
    renderCreate();
    await settle();
    expect(screen.getByText("chat:createLoadMembersFailed")).toBeInTheDocument();
  });

  it("filters members by name or email case-insensitively", async () => {
    renderCreate();
    await settle();
    fireEvent.change(screen.getByPlaceholderText("chat:selectMembers"), {
      target: { value: "AL" },
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).toBeNull();
    // 邮箱匹配：bob@x.com
    fireEvent.change(screen.getByPlaceholderText("chat:selectMembers"), {
      target: { value: "bob@x" },
    });
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("shows createNoMatch when the filter has no hits", async () => {
    renderCreate();
    await settle();
    fireEvent.change(screen.getByPlaceholderText("chat:selectMembers"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("chat:createNoMatch")).toBeInTheDocument();
    // 清空关键词后回到成员列表
    fireEvent.change(screen.getByPlaceholderText("chat:selectMembers"), {
      target: { value: "" },
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows createNoMembers when the workspace has no other members", async () => {
    apiListMock.mockResolvedValue([members[0]!]); // 只有自己
    renderCreate();
    await settle();
    expect(screen.getByText("chat:createNoMembers")).toBeInTheDocument();
  });

  it("keeps only one selected member in direct mode", async () => {
    renderCreate();
    await settle();
    clickMember("Bob");
    clickMember("Alice");
    // 单聊模式：后选的 Alice 替换 Bob，只剩一个 chip
    const chips = screen.getAllByLabelText("chat:removeMember");
    expect(chips.length).toBe(1);
    expect(chips[0]!.closest("span")!.textContent).toContain("Alice");
    // 只有被选中的成员行显示对勾
    expect(document.querySelectorAll("svg.lucide-check").length).toBe(1);
  });

  it("allows multiple members in group mode and clears the selection on mode switch", async () => {
    renderCreate();
    await settle();
    clickMember("Bob");
    fireEvent.click(screen.getByText("chat:groupMessage"));
    clickMember("Alice");
    clickMember("Bob");
    expect(screen.getAllByLabelText("chat:removeMember").length).toBe(2);
    // 切回单聊清空已选
    fireEvent.click(screen.getByText("chat:directMessage"));
    expect(screen.queryByLabelText("chat:removeMember")).toBeNull();
    expect(document.querySelectorAll("svg.lucide-check").length).toBe(0);
  });

  it("requires a group title before submitting a group chat", async () => {
    renderCreate();
    await settle();
    fireEvent.click(screen.getByText("chat:groupMessage"));
    clickMember("Alice");
    clickMember("Bob");
    // 群名输入出现，但为空 → 提示 + 禁用
    expect(screen.getByPlaceholderText("chat:groupNamePlaceholder")).toBeInTheDocument();
    expect(screen.getByText("chat:enterGroupName")).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("chat:groupNamePlaceholder"), {
      target: { value: "  Team  " },
    });
    expect(screen.queryByText("chat:enterGroupName")).toBeNull();
    expect(createButton()).not.toBeDisabled();
  });

  it("hides the group title hint before two members are selected", async () => {
    renderCreate();
    await settle();
    fireEvent.click(screen.getByText("chat:groupMessage"));
    clickMember("Alice");
    expect(screen.queryByText("chat:enterGroupName")).toBeNull();
    expect(createButton()).toBeDisabled(); // 群聊需 2+ 成员
  });

  it("submits a direct conversation with the selected member", async () => {
    apiMock.mockResolvedValue({ id: "conv-new" });
    renderCreate();
    await settle();
    clickMember("Alice");
    fireEvent.click(createButton());
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/conversations", {
      method: "POST",
      body: JSON.stringify({ type: "direct", memberIds: ["u-alice"] }),
    });
    await settle();
    expect(baseProps.onCreated).toHaveBeenCalledWith("conv-new");
  });

  it("submits a group conversation with a trimmed title", async () => {
    apiMock.mockResolvedValue({ id: "conv-g" });
    renderCreate();
    await settle();
    fireEvent.click(screen.getByText("chat:groupMessage"));
    clickMember("Alice");
    clickMember("Bob");
    fireEvent.change(screen.getByPlaceholderText("chat:groupNamePlaceholder"), {
      target: { value: "  Team  " },
    });
    fireEvent.click(createButton());
    // memberIds 顺序按点击顺序
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/conversations", {
      method: "POST",
      body: JSON.stringify({ type: "group", memberIds: ["u-alice", "u-bob"], title: "Team" }),
    });
    await settle();
    expect(baseProps.onCreated).toHaveBeenCalledWith("conv-g");
  });

  it("shows an error and stays open when creation fails", async () => {
    apiMock.mockRejectedValue(new Error("boom"));
    renderCreate();
    await settle();
    clickMember("Alice");
    fireEvent.click(createButton());
    await settle();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(baseProps.onCreated).not.toHaveBeenCalled();
    // 非 Error 失败用通用文案
    apiMock.mockRejectedValue("not-an-error");
    fireEvent.click(createButton());
    await settle();
    expect(screen.getByText("chat:createFailed")).toBeInTheDocument();
  });

  it("detects an existing direct conversation and offers to jump to it", async () => {
    const existing: Conversation = {
      id: "conv-existing",
      workspaceId: "ws-1",
      type: "direct",
      title: null,
      avatar: null,
      description: null,
      createdBy: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      lastMessageAt: null,
      members: [
        {
          id: "m1",
          conversationId: "conv-existing",
          userId: "u-me",
          role: "member",
          joinedAt: "2026-06-01T00:00:00Z",
          lastReadAt: null,
          muted: false,
          user: { id: "u-me", name: "Me", email: "me@x.com", image: null },
        },
        {
          id: "m2",
          conversationId: "conv-existing",
          userId: "u-alice",
          role: "member",
          joinedAt: "2026-06-01T00:00:00Z",
          lastReadAt: null,
          muted: false,
          user: { id: "u-alice", name: "Alice", email: "alice@x.com", image: null },
        },
      ],
    };
    renderCreate({ conversations: [existing] });
    await settle();
    clickMember("Alice");
    expect(screen.getByText("chat:existingDirectConversation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /chat:jumpToConversation/ }));
    expect(baseProps.onCreated).toHaveBeenCalledWith("conv-existing");
  });

  it("removes a selected member via the chip button", async () => {
    renderCreate();
    await settle();
    clickMember("Alice");
    expect(screen.getAllByLabelText("chat:removeMember").length).toBe(1);
    fireEvent.click(screen.getByLabelText("chat:removeMember"));
    expect(screen.queryByLabelText("chat:removeMember")).toBeNull();
  });

  it("closes on Escape, overlay click and cancel", async () => {
    renderCreate();
    await settle();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    // 遮罩层（aria-hidden 的绝对定位层）
    const overlay = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(overlay);
    expect(baseProps.onClose).toHaveBeenCalledTimes(2);
    // 底部取消按钮（页头 X 关闭按钮也是 chat:cancel，取最后一个）
    const cancelButtons = screen.getAllByRole("button", { name: "chat:cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    expect(baseProps.onClose).toHaveBeenCalledTimes(3);
  });

  it("disables cancel while submitting", async () => {
    apiMock.mockReturnValue(new Promise<{ id: string }>(() => {}));
    renderCreate();
    await settle();
    clickMember("Alice");
    fireEvent.click(createButton());
    await settle();
    const cancelButtons = screen.getAllByRole("button", { name: "chat:cancel" });
    expect(cancelButtons[cancelButtons.length - 1]!).toBeDisabled();
    // 提交中显示 spinner 且不可重复提交
    expect(document.querySelectorAll("svg.lucide-loader-2").length).toBe(1);
    expect(createButton()).toBeDisabled();
  });

  it("focuses the member search on open", async () => {
    renderCreate();
    await settle();
    const input = screen.getByPlaceholderText("chat:selectMembers");
    expect(document.activeElement).toBe(input);
  });
});
