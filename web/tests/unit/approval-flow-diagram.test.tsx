// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  ApprovalFlowDiagram,
  type ApprovalFlowNode,
} from "@/components/approval/ApprovalFlowDiagram";

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

afterEach(cleanup);

function mkNodes(orders: number[]): ApprovalFlowNode[] {
  return orders.map((order) => ({ name: `Node ${order}`, order }));
}

function renderDiagram(nodes: ApprovalFlowNode[], currentNode: number, status: string) {
  return render(<ApprovalFlowDiagram nodes={nodes} currentNode={currentNode} status={status} />);
}

describe("ApprovalFlowDiagram", () => {
  it("renders the empty hint when there are no nodes", () => {
    renderDiagram([], 0, "pending");
    expect(screen.getByText("approval:noContent")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("sorts nodes by order regardless of input order", () => {
    const nodes: ApprovalFlowNode[] = [
      { name: "Third", order: 3 },
      { name: "First", order: 1 },
      { name: "Second", order: 2 },
    ];
    renderDiagram(nodes, 0, "pending");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
      expect.stringContaining("Third"),
    ]);
  });

  it("marks only the current node as the current step with a clock icon while pending", () => {
    renderDiagram(mkNodes([1, 2, 3]), 1, "pending");
    const items = screen.getAllByRole("listitem");
    // aria-current 落在节点卡片 div 上（li 只是布局容器）
    expect(items[0].querySelector("[aria-current='step']")).not.toBeInTheDocument();
    expect(items[1].querySelector("[aria-current='step']")).toBeInTheDocument();
    expect(items[1].querySelector("svg.lucide-clock")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("approval:waiting");
    expect(items[0]).toHaveTextContent("approval:passed");
    expect(items[2]).toHaveTextContent("approval:notReached");
  });

  it("marks the passed nodes with a check icon before the current node while pending", () => {
    renderDiagram(mkNodes([1, 2]), 1, "pending");
    const items = screen.getAllByRole("listitem");
    expect(items[0].querySelector("svg.lucide-check-circle-2")).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("approval:passed");
  });

  it("marks every node passed and skips the step marker when the instance is approved", () => {
    renderDiagram(mkNodes([1, 2]), -1, "approved");
    const items = screen.getAllByRole("listitem");
    items.forEach((item) => {
      expect(item.querySelector("[aria-current='step']")).not.toBeInTheDocument();
      expect(item.querySelector("svg.lucide-check-circle-2")).toBeInTheDocument();
      expect(item).toHaveTextContent("approval:passed");
    });
  });

  it("marks the rejected node with the danger icon when the instance is rejected", () => {
    // currentNode 为 0-based：order 2（idx 1）是被拒绝的节点
    renderDiagram(mkNodes([1, 2, 3]), 1, "rejected");
    const items = screen.getAllByRole("listitem");
    expect(items[1].querySelector("svg.lucide-x-circle")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("approval:rejected");
    expect(items[0]).toHaveTextContent("approval:passed");
    expect(items[2]).toHaveTextContent("approval:notReached");
  });

  it("renders only notReached for withdrawn instances without a current step", () => {
    renderDiagram(mkNodes([1, 2]), -1, "withdrawn");
    const items = screen.getAllByRole("listitem");
    items.forEach((item) => {
      expect(item).toHaveTextContent("approval:notReached");
      expect(item.querySelector("svg.lucide-check-circle-2")).not.toBeInTheDocument();
      expect(item.querySelector("svg.lucide-x-circle")).not.toBeInTheDocument();
      expect(item.querySelector("svg.lucide-clock")).not.toBeInTheDocument();
    });
  });

  it("prefers the approver display name over the role label", () => {
    const nodes: ApprovalFlowNode[] = [
      { name: "N1", order: 1, approverDisplayName: "Alice", approverRole: "manager" },
    ];
    renderDiagram(nodes, 0, "pending");
    expect(screen.getByText('approval:nodeApprover:{"name":"Alice"}')).toBeInTheDocument();
    expect(screen.queryByText(/nodeApproverRole/)).not.toBeInTheDocument();
  });

  it("falls back to the role label when no display name is set", () => {
    const nodes: ApprovalFlowNode[] = [{ name: "N1", order: 1, approverRole: "manager" }];
    renderDiagram(nodes, 0, "pending");
    expect(screen.getByText('approval:nodeApproverRole:{"role":"manager"}')).toBeInTheDocument();
  });

  it("renders no approver line when neither display name nor role is set", () => {
    renderDiagram([{ name: "N1", order: 1 }], 0, "pending");
    expect(screen.queryByText(/nodeApprover/)).not.toBeInTheDocument();
  });

  it("falls back to a positional name and title when the node name is empty", () => {
    const nodes: ApprovalFlowNode[] = [
      { name: "", order: 2 },
      { name: "", order: 1 },
    ];
    renderDiagram(nodes, 0, "pending");
    const spans = screen.getAllByText(/^Node \d+$/);
    expect(spans.map((s) => s.textContent)).toEqual(["Node 1", "Node 2"]);
    expect(spans[1]).toHaveAttribute("title", "Node 2");
  });

  it("renders one connector arrow between each pair of nodes and none after the last", () => {
    renderDiagram(mkNodes([1, 2, 3]), 0, "pending");
    expect(document.querySelectorAll("svg.lucide-arrow-right").length).toBe(2);
    const last = screen.getAllByRole("listitem")[2];
    expect(last.querySelector("svg.lucide-arrow-right")).not.toBeInTheDocument();
  });

  it("renders no arrow for a single node", () => {
    renderDiagram(mkNodes([1]), 0, "pending");
    expect(document.querySelectorAll("svg.lucide-arrow-right").length).toBe(0);
  });
});
