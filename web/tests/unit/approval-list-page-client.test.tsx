// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ApprovalListPageClient } from "@/components/approval/ApprovalListPageClient";

const { listMounts } = vi.hoisted(() => ({ listMounts: { count: 0 } }));

// 四个子组件全部打桩：本组件只负责装配、开关覆盖层与 key 重建刷新
vi.mock("@/components/approval/ApprovalList", async () => {
  const React = await import("react");
  return {
    ApprovalList: (props: { workspaceId: string }) => {
      React.useEffect(() => {
        listMounts.count += 1;
      }, []);
      return React.createElement("div", {
        "data-testid": "approval-list",
        "data-workspace": props.workspaceId,
      });
    },
  };
});

vi.mock("@/components/approval/ApprovalSubmit", async () => {
  const React = await import("react");
  return {
    ApprovalSubmit: (props: {
      workspaceId: string;
      onClose: () => void;
      onSubmitted: () => void;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "approval-submit", "data-workspace": props.workspaceId },
        React.createElement(
          "button",
          {
            "data-testid": "approval-submit-fire",
            onClick: () => {
              props.onSubmitted();
              props.onClose();
            },
          },
          "fire",
        ),
        React.createElement(
          "button",
          { "data-testid": "approval-submit-close", onClick: props.onClose },
          "close",
        ),
      ),
  };
});

vi.mock("@/components/approval/ApprovalTemplateManage", async () => {
  const React = await import("react");
  return {
    ApprovalTemplateManage: (props: { workspaceId: string }) =>
      React.createElement("div", {
        "data-testid": "approval-template-manage",
        "data-workspace": props.workspaceId,
      }),
  };
});

vi.mock("@/components/approval/ApprovalDelegateSettings", async () => {
  const React = await import("react");
  return {
    ApprovalDelegateSettings: (props: { workspaceId: string }) =>
      React.createElement("div", {
        "data-testid": "approval-delegate-settings",
        "data-workspace": props.workspaceId,
      }),
  };
});

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

afterEach(() => {
  cleanup();
  listMounts.count = 0;
});

function renderPage() {
  return render(<ApprovalListPageClient workspaceId="ws-1" />);
}

describe("ApprovalListPageClient", () => {
  it("renders the list and the three action buttons, all labeled in the approval namespace", () => {
    renderPage();
    const list = screen.getByTestId("approval-list");
    expect(list).toHaveAttribute("data-workspace", "ws-1");
    expect(screen.getByRole("button", { name: "approval:templateManage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "approval:delegateSettings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "approval:submit" })).toBeInTheDocument();
    expect(listMounts.count).toBe(1);
  });

  it("opens the template overlay as a dialog and closes it on the close button", () => {
    renderPage();
    // 初始无覆盖层
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "approval:templateManage" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const manage = screen.getByTestId("approval-template-manage");
    expect(manage).toHaveAttribute("data-workspace", "ws-1");
    expect(dialog).toContainElement(manage);
    fireEvent.click(screen.getByRole("button", { name: "approval:close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approval-template-manage")).not.toBeInTheDocument();
  });

  it("opens the delegate overlay as a dialog and closes it on the close button", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "approval:delegateSettings" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const delegate = screen.getByTestId("approval-delegate-settings");
    expect(delegate).toHaveAttribute("data-workspace", "ws-1");
    expect(dialog).toContainElement(delegate);
    fireEvent.click(screen.getByRole("button", { name: "approval:close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mounts the submit modal and tears it down via onClose", () => {
    renderPage();
    expect(screen.queryByTestId("approval-submit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "approval:submit" }));
    const submit = screen.getByTestId("approval-submit");
    expect(submit).toHaveAttribute("data-workspace", "ws-1");
    // 父级按钮区域仍渲染（覆盖层与列表并存，不互斥）
    expect(screen.getByTestId("approval-list")).toBeInTheDocument();
    // 只调用 onClose 的退出路径（不触发刷新）
    fireEvent.click(screen.getByTestId("approval-submit-close"));
    expect(screen.queryByTestId("approval-submit")).not.toBeInTheDocument();
  });

  it("remounts the list after a successful submission", async () => {
    renderPage();
    expect(listMounts.count).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "approval:submit" }));
    fireEvent.click(screen.getByTestId("approval-submit-fire"));
    await act(async () => {});
    // onSubmitted ⇒ refreshKey+1 ⇒ 列表重建一次；onClose ⇒ 弹窗关闭
    expect(listMounts.count).toBe(2);
    expect(screen.queryByTestId("approval-submit")).not.toBeInTheDocument();
  });
});
