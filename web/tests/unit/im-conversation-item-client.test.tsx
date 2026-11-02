// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConversationItemClient } from "@/components/im/ConversationItemClient";

const baseProps = {
  conversationId: "conv-1",
  active: false,
  displayName: "Alice",
  avatarUrl: null as string | null,
  initial: "A",
  preview: "hello world",
  timeStr: "10:00" as string | null,
  unread: 0,
  isOnline: false,
  isMuted: false,
  onlineLabel: "online",
  noMessagesLabel: "no messages",
  onSelect: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe("ConversationItemClient", () => {
  it("renders display name, preview and time", () => {
    render(<ConversationItemClient {...baseProps} />);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("hello world")).toBeTruthy();
    expect(screen.getByText("10:00")).toBeTruthy();
  });

  it("calls onSelect with the conversation id on click", () => {
    const onSelect = vi.fn();
    render(<ConversationItemClient {...baseProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("conv-1");
  });

  it("sets aria-current only when active", () => {
    const { rerender } = render(<ConversationItemClient {...baseProps} />);
    expect(screen.getByRole("button").getAttribute("aria-current")).toBeNull();
    rerender(<ConversationItemClient {...baseProps} active={true} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });

  it("renders an avatar image when avatarUrl is set, otherwise the initial", () => {
    const { rerender } = render(<ConversationItemClient {...baseProps} />);
    expect(screen.getByText("A")).toBeTruthy();
    expect(containerImg()).toBeNull();

    rerender(<ConversationItemClient {...baseProps} avatarUrl="http://x/avatar.png" />);
    const img = containerImg();
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("http://x/avatar.png");
    expect(img!.getAttribute("alt")).toBe("Alice");
  });

  it("shows the online dot only when isOnline", () => {
    const { rerender } = render(<ConversationItemClient {...baseProps} />);
    expect(screen.queryByLabelText("online")).toBeNull();

    rerender(<ConversationItemClient {...baseProps} isOnline={true} />);
    expect(screen.getByLabelText("online")).toBeTruthy();
  });

  it("shows the mute icon only when isMuted", () => {
    const { container } = render(<ConversationItemClient {...baseProps} />);
    expect(container.querySelector("svg.lucide-bell-off")).toBeNull();

    const { container: c2 } = render(<ConversationItemClient {...baseProps} isMuted={true} />);
    expect(c2.querySelector("svg.lucide-bell-off")).not.toBeNull();
  });

  it("renders an unread badge for 1..99 and caps at 99+", () => {
    const { rerender } = render(<ConversationItemClient {...baseProps} unread={1} />);
    expect(screen.getByText("1")).toBeTruthy();

    rerender(<ConversationItemClient {...baseProps} unread={42} />);
    expect(screen.getByText("42")).toBeTruthy();

    rerender(<ConversationItemClient {...baseProps} unread={100} />);
    expect(screen.getByText("99+")).toBeTruthy();

    rerender(<ConversationItemClient {...baseProps} unread={0} />);
    expect(screen.queryByText("99+")).toBeNull();
  });

  it("falls back to noMessagesLabel when the preview is empty", () => {
    render(<ConversationItemClient {...baseProps} preview="" />);
    expect(screen.getByText("no messages")).toBeTruthy();
    expect(screen.queryByText("hello world")).toBeNull();
  });

  it("omits the time span when timeStr is null", () => {
    render(<ConversationItemClient {...baseProps} timeStr={null} />);
    expect(screen.queryByText("10:00")).toBeNull();
  });
});

function containerImg() {
  return document.querySelector("img");
}
