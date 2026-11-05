// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * ShareDialog 契约（components/doc/ShareDialog.tsx）：
 *  1. dialog 角色 + 标题 + docTitle + 分享链接预览（window.location.origin 派生）
 *  2. 初始 visibility 选中（aria-pressed）；切换 → PATCH {visibility}；失败回滚 + error
 *  3. 点当前 visibility 不重复 PATCH；saving 中按钮 disabled
 *  4. 复制链接 → clipboard.writeText(链接)，按钮变 linkCopied，2s 后恢复
 *  5. Escape / 遮罩点击关闭；内层点击不关
 *  6. 嵌入的 PermissionManager 收到 docId/workspaceId
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  onClose: vi.fn(),
  writeText: vi.fn(),
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
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/components/doc/PermissionManager", () => ({
  PermissionManager: (props: { docId: string; workspaceId: string }) => (
    <div data-testid="pm" data-doc={props.docId} data-wid={props.workspaceId} />
  ),
}));

import { ShareDialog } from "@/components/doc/ShareDialog";

const WID = "ws-share-1";
const DID = "doc-9";

function renderDialog(currentVisibility = "private") {
  return render(
    <ShareDialog
      docId={DID}
      workspaceId={WID}
      docTitle="季度规划文档"
      currentVisibility={currentVisibility}
      onClose={mocks.onClose}
    />,
  );
}

const visButton = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  mocks.api.mockReset();
  mocks.onClose.mockReset();
  mocks.writeText.mockReset();
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ShareDialog", () => {
  it("骨架：dialog 角色、标题、docTitle、分享链接预览", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("doc:shareDialogTitle")).toBeInTheDocument();
    expect(screen.getByText("季度规划文档")).toBeInTheDocument();
    expect(
      screen.getByText(`${window.location.origin}/w/${WID}/documents/${DID}`),
    ).toBeInTheDocument();
  });

  it("权限管理子组件收到 docId/workspaceId", () => {
    renderDialog();
    const pm = screen.getByTestId("pm");
    expect(pm.getAttribute("data-doc")).toBe(DID);
    expect(pm.getAttribute("data-wid")).toBe(WID);
  });

  it("初始 visibility 选中（workspace）", () => {
    renderDialog("workspace");
    expect(visButton("doc:workspace")).toHaveAttribute("aria-pressed", "true");
    expect(visButton("doc:private")).toHaveAttribute("aria-pressed", "false");
  });

  it("切换 visibility：PATCH body {visibility} 且选中态更新", async () => {
    mocks.api.mockResolvedValueOnce({});
    renderDialog("private");
    fireEvent.click(visButton("doc:shared"));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/documents/${DID}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: "shared" }),
      }),
    );
    await waitFor(() => expect(visButton("doc:shared")).toHaveAttribute("aria-pressed", "true"));
  });

  it("点当前 visibility 不重复 PATCH", () => {
    renderDialog("private");
    fireEvent.click(visButton("doc:private"));
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("PATCH 失败 → error 显示 e.message 且选中回滚", async () => {
    mocks.api.mockRejectedValueOnce(new Error("没有权限"));
    renderDialog("private");
    fireEvent.click(visButton("doc:workspace"));

    await waitFor(() => expect(screen.getByText("没有权限")).toBeInTheDocument());
    expect(visButton("doc:private")).toHaveAttribute("aria-pressed", "true");
    expect(visButton("doc:workspace")).toHaveAttribute("aria-pressed", "false");
  });

  it("复制链接：writeText 收到派生链接，按钮变 linkCopied，2s 后恢复", async () => {
    vi.useFakeTimers();
    renderDialog();
    fireEvent.click(screen.getByText("doc:copyLink").closest("button")!);

    // fake timers 下 waitFor 轮询依赖真时钟会死等——用 act + 微任务 flush 代替
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/w/${WID}/documents/${DID}`,
    );
    expect(screen.getByText("doc:linkCopied")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("doc:copyLink")).toBeInTheDocument();
  });

  it("复制失败静默（clipboard 拒绝不显示错误条）", async () => {
    mocks.writeText.mockRejectedValueOnce(new Error("denied"));
    renderDialog();
    fireEvent.click(screen.getByText("doc:copyLink").closest("button")!);
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalled());
    expect(screen.queryByText("denied")).toBeFalsy();
  });

  it("Escape 关闭", () => {
    renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("遮罩（dialog 自身）点击关闭；内层内容点击不关", () => {
    renderDialog();
    fireEvent.click(screen.getByText("季度规划文档"));
    expect(mocks.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog"));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });
});
