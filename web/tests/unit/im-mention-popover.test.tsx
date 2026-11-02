// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MentionPopover } from "@/components/im/MentionPopover";

// jsdom does not implement scrollIntoView (the active-item scroll effect calls it)
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

interface M {
  userId: string;
  user: { id: string; name: string | null; email: string | null; image: string | null };
}

const members: M[] = [
  { userId: "u1", user: { id: "u1", name: "Alice", email: "alice@x.com", image: null } },
  { userId: "u2", user: { id: "u2", name: "Bob", email: "bob@x.com", image: "http://x/2.png" } },
  { userId: "u3", user: { id: "u3", name: null, email: "carol@x.com", image: null } },
];

const position = { top: 10, left: 20 };

afterEach(() => {
  cleanup();
});

describe("MentionPopover", () => {
  it("filters by name and email, case-insensitively", () => {
    const { rerender } = render(
      <MentionPopover
        query="ali"
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    expect(screen.getAllByRole("option").length).toBe(1);
    expect(screen.getByText("Alice")).toBeTruthy();

    rerender(
      <MentionPopover
        query="CAROL"
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    expect(screen.getAllByRole("option").length).toBe(1);
    // u3 has no name, so the email renders as both the display name and the meta line
    expect(screen.getAllByText("carol@x.com").length).toBe(2);
  });

  it("shows the first eight members for an empty query", () => {
    const many: M[] = Array.from({ length: 12 }, (_, i) => ({
      userId: `u${i}`,
      user: { id: `u${i}`, name: `Name${i}`, email: `n${i}@x.com`, image: null },
    }));
    render(
      <MentionPopover
        query=""
        members={many}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    expect(screen.getAllByRole("option").length).toBe(8);
  });

  it("renders nothing when nothing matches", () => {
    const { container } = render(
      <MentionPopover
        query="zzz"
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("positions the listbox and marks the active option", () => {
    render(
      <MentionPopover
        query=""
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    const listbox = screen.getByRole("listbox", { name: "mention-suggestions" });
    expect(listbox.getAttribute("style")).toContain("top: 10px");
    expect(listbox.getAttribute("style")).toContain("left: 20px");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("navigates with arrow keys and confirms with Enter", () => {
    const onSelect = vi.fn();
    render(
      <MentionPopover
        query=""
        members={members}
        onSelect={onSelect}
        onClose={vi.fn()}
        position={position}
      />,
    );
    const options = () => screen.getAllByRole("option");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(options()[0]).toHaveAttribute("aria-selected", "false");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("u2", "Bob");
  });

  it("wraps around with ArrowUp", () => {
    render(
      <MentionPopover
        query=""
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowUp" });
    const options = screen.getAllByRole("option");
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("resets the active index when the query changes", () => {
    const { rerender } = render(
      <MentionPopover
        query=""
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    rerender(
      <MentionPopover
        query="a"
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <MentionPopover
        query=""
        members={members}
        onSelect={vi.fn()}
        onClose={onClose}
        position={position}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("selects on mouse down and tracks hover", () => {
    const onSelect = vi.fn();
    render(
      <MentionPopover
        query=""
        members={members}
        onSelect={onSelect}
        onClose={vi.fn()}
        position={position}
      />,
    );
    const options = screen.getAllByRole("option");
    fireEvent.mouseEnter(options[2]);
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseDown(options[2]);
    // name falls back to email when the member has no name
    expect(onSelect).toHaveBeenCalledWith("u3", "carol@x.com");
  });

  it("renders avatars and email lines", () => {
    render(
      <MentionPopover
        query=""
        members={members}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        position={position}
      />,
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("http://x/2.png");
    expect(img!.getAttribute("alt")).toBe("Bob");
    // u1 has an email, so the meta line renders
    expect(screen.getByText("alice@x.com")).toBeTruthy();
  });
});
