// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * FavoriteButton 契约（components/common/FavoriteButton.tsx）：
 *  1. 挂载即 GET /api/v1/favorites/check?wid={wid}&type={type}&targetId={targetId}（带 AbortSignal），
 *     加载期渲染 disabled 按钮（aria-label=title + Loader2）
 *  2. check 失败静默降级为未收藏（无错误 UI）
 *  3. 未收藏态：aria-pressed=false、文案 t("add")、空心 Star；点击展开备注弹层
 *     （role=dialog、aria-label=t("note")、textarea placeholder=t("notePlaceholder")）
 *  4. 弹层内：X/取消按钮与 Escape 关闭（清空 note）；Enter（非 Shift）提交
 *  5. 确认收藏 → POST /api/v1/favorites body { wid, targetType, targetId, note(trim，空剔除) }，
 *     成功 toast success added + favoriteId 记录 + 弹层关闭 + 转已收藏态
 *  6. 已收藏态：aria-pressed=true、文案 t("remove")、实心 Star；点击直接
 *     DELETE /api/v1/favorites/{favoriteId}?wid={wid}，成功 toast success removed 并复原
 *  7. POST/DELETE 失败 → toast error error，状态不变
 *  8. size="sm" 图标 14、默认 16；submitting 期间按钮 disabled
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
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
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import FavoriteButton from "@/components/common/FavoriteButton";

const WID = "ws-fb-1";
const TYPE = "task";
const TID = "t-9";
const CHECK_URL = "/api/v1/favorites/check?wid=ws-fb-1&type=task&targetId=t-9";

const CREATED = {
  id: "fav-1",
  targetType: TYPE,
  targetId: TID,
  note: "备注内容",
  createdAt: new Date().toISOString(),
};

function renderButton(size?: "sm" | "md") {
  return render(<FavoriteButton workspaceId={WID} targetType={TYPE} targetId={TID} size={size} />);
}

function mainButton() {
  return screen.getByLabelText("common.favorite:add").closest("button") as HTMLButtonElement;
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.api.mockResolvedValue({ favorited: false, favoriteId: null });
});
afterEach(() => cleanup());

describe("FavoriteButton", () => {
  it("挂载即 GET check：URL 精确、带 AbortSignal，加载期 disabled 按钮含 Loader2", () => {
    let resolve!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    const { container } = renderButton();

    expect(mocks.api).toHaveBeenCalledWith(CHECK_URL, { signal: expect.any(AbortSignal) });
    const loadingBtn = screen.getByLabelText("common.favorite:title").closest("button")!;
    expect(loadingBtn).toBeDisabled();
    expect(loadingBtn.querySelector("svg.lucide-loader-2")).toBeTruthy();
    // 加载分支只渲染 Loader2，不含 Star 图标
    expect(container.querySelector("svg.lucide-star")).toBeNull();
    resolve({ favorited: false, favoriteId: null });
  });

  it("未收藏态：aria-pressed=false、文案 add、实心属性为 none", async () => {
    const { container } = renderButton();
    await waitFor(() => expect(mainButton()).toBeInTheDocument());

    expect(mainButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("common.favorite:add")).toBeInTheDocument();
    const star = container.querySelector("svg.lucide-star") as SVGSVGElement;
    expect(star.getAttribute("width")).toBe("16");
    expect(star.getAttribute("fill")).toBe("none");
  });

  it("size=sm：图标 14；check 失败静默降级为未收藏", async () => {
    const { container } = renderButton("sm");
    await waitFor(() => expect(screen.getByLabelText("common.favorite:add")).toBeInTheDocument());
    const star = container.querySelector("svg.lucide-star") as SVGSVGElement;
    expect(star.getAttribute("width")).toBe("14");

    cleanup();
    mocks.api.mockRejectedValueOnce(new Error("check boom"));
    renderButton();
    await waitFor(() => expect(screen.getByLabelText("common.favorite:add")).toBeInTheDocument());
    // 降级为未收藏且无错误 UI
    expect(screen.queryByText("common.favorite:error")).toBeFalsy();
    expect(screen.getByLabelText("common.favorite:add").closest("button")).toBeEnabled();
  });

  it("点击收藏展开备注弹层（role=dialog + note label），X/取消/Escape 关闭", async () => {
    renderButton();
    await waitFor(() => expect(mainButton()).toBeInTheDocument());

    fireEvent.click(mainButton());
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("common.favorite:note");
    expect(screen.getByPlaceholderText("common.favorite:notePlaceholder")).toBeInTheDocument();

    // Escape 关闭（textarea keyDown）
    fireEvent.keyDown(screen.getByPlaceholderText("common.favorite:notePlaceholder"), {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeFalsy());

    // 再次展开，X 图标按钮关闭
    fireEvent.click(mainButton());
    fireEvent.click(screen.getByLabelText("common.favorite:cancel"));
    expect(screen.queryByRole("dialog")).toBeFalsy();

    // 再展开，文本取消按钮关闭
    fireEvent.click(mainButton());
    fireEvent.click(screen.getAllByText("common.favorite:cancel")[0]);
    expect(screen.queryByRole("dialog")).toBeFalsy();
    expect(mocks.api).toHaveBeenCalledTimes(1); // 仅 check，无 POST
  });

  it("填备注保存：POST body 精确 → toast added、弹层关闭、转已收藏态", async () => {
    mocks.api.mockResolvedValueOnce(CREATED);
    renderButton();
    await waitFor(() => expect(mainButton()).toBeInTheDocument());

    fireEvent.click(mainButton());
    fireEvent.change(screen.getByPlaceholderText("common.favorite:notePlaceholder"), {
      target: { value: "  备注内容  " },
    });
    fireEvent.click(screen.getByText("common.favorite:save").closest("button")!);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/favorites", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        targetType: TYPE,
        targetId: TID,
        note: "备注内容",
      }),
    });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", "common.favorite:added"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeFalsy());
    expect(screen.getByText("common.favorite:remove")).toBeInTheDocument();
    expect(screen.getByLabelText("common.favorite:remove").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("备注为空时 POST body 不含 note 键", async () => {
    mocks.api.mockResolvedValueOnce({ ...CREATED, note: null });
    renderButton();
    await waitFor(() => expect(mainButton()).toBeInTheDocument());

    fireEvent.click(mainButton());
    fireEvent.click(screen.getByText("common.favorite:save").closest("button")!);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/favorites", {
      method: "POST",
      body: JSON.stringify({ wid: WID, targetType: TYPE, targetId: TID }),
    });
  });

  it("Enter（非 Shift）在备注输入框内提交", async () => {
    mocks.api.mockResolvedValueOnce(CREATED);
    renderButton();
    await waitFor(() => expect(mainButton()).toBeInTheDocument());

    fireEvent.click(mainButton());
    fireEvent.change(screen.getByPlaceholderText("common.favorite:notePlaceholder"), {
      target: { value: "回车提交" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("common.favorite:notePlaceholder"), {
      key: "Enter",
    });

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/favorites", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        targetType: TYPE,
        targetId: TID,
        note: "回车提交",
      }),
    });
  });

  it("POST 失败：toast error，弹层保持打开", async () => {
    renderButton();
    await waitFor(() => expect(mainButton()).toBeInTheDocument());

    fireEvent.click(mainButton());
    mocks.api.mockRejectedValueOnce(new Error("post boom"));
    fireEvent.click(screen.getByText("common.favorite:save").closest("button")!);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "common.favorite:error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // 弹层仍开着 → 主按钮与弹层标题各有一份 "add" 文案
    expect(screen.getAllByText("common.favorite:add").length).toBeGreaterThanOrEqual(1);
  });

  it("已收藏初始态：点击直接 DELETE /favorites/{id}?wid → toast removed 并复原为未收藏", async () => {
    mocks.api.mockResolvedValueOnce({ favorited: true, favoriteId: "fav-9" });
    renderButton();
    await waitFor(() =>
      expect(screen.getByLabelText("common.favorite:remove")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("common.favorite:remove").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByLabelText("common.favorite:remove"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/favorites/fav-9?wid=ws-fb-1", {
      method: "DELETE",
    });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", "common.favorite:removed"),
    );
    await waitFor(() => expect(screen.getByLabelText("common.favorite:add")).toBeInTheDocument());
    // 复原后不残留备注弹层
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });

  it("DELETE 失败：toast error，保持已收藏态", async () => {
    mocks.api.mockResolvedValueOnce({ favorited: true, favoriteId: "fav-9" });
    renderButton();
    await waitFor(() =>
      expect(screen.getByLabelText("common.favorite:remove")).toBeInTheDocument(),
    );

    mocks.api.mockRejectedValueOnce(new Error("delete boom"));
    fireEvent.click(screen.getByLabelText("common.favorite:remove"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "common.favorite:error"));
    expect(screen.getByText("common.favorite:remove")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });

  it("submitting 期间主按钮与保存按钮 disabled", async () => {
    let resolve!: (v: unknown) => void;
    renderButton();
    await waitFor(() => expect(mainButton()).toBeInTheDocument());

    fireEvent.click(mainButton());
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    fireEvent.click(screen.getByText("common.favorite:save").closest("button")!);
    await waitFor(() =>
      expect(screen.getByText("common.favorite:save").closest("button")).toBeDisabled(),
    );
    expect(mainButton()).toBeDisabled();
    resolve(CREATED);
  });
});
