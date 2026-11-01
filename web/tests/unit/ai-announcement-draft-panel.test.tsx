// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AnnouncementDraftPanel 契约（components/ai/AnnouncementDraftPanel.tsx）：
 *  1. 初始空态：Sparkles(size32) + t("empty")
 *  2. 主题输入（可选，maxLength 500）+ 生成按钮 → consumeAiStream(
 *     "/api/v1/ai/announcement-draft", { wid, topic: trim||undefined })
 *  3. 流式中：生成按钮/主题输入 disabled，按钮换 Loader2 + t("generating")
 *  4. onDelta 增量实时渲染 Markdown；完成后全文 Markdown + 编辑/预览切换
 *  5. 保存（hasContent 才显示）→ POST /api/v1/workspaces/{wid}/announcements：
 *     首行 `# 标题` 提取为 title、其余为 content；无标题行则 title 用
 *     t("announcementTitle")、content 取全文
 *  6. 保存成功 → t("saved") 且按钮 disabled；失败 → t("saveFailed")
 *  7. 生成失败（非 AbortError）→ t("generateFailed") 回到 idle；
 *     AbortError 不视为错误
 *  8. 编辑 textarea 修改内容会清除 saved 标志
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  stream: vi.fn(),
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
vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));
vi.mock("@/components/ai/FeedbackButtons", () => ({
  FeedbackButtons: (props: { capability?: string }) => (
    <div data-testid="fb" data-capability={props.capability ?? ""} />
  ),
}));
vi.mock("@/components/editor/aiStream", () => ({
  consumeAiStream: mocks.stream,
}));

import { AnnouncementDraftPanel } from "@/components/ai/AnnouncementDraftPanel";

const WID = "ws-ad-1";

/** 一次可控的流 */
interface StreamHarness {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (d: string) => void;
  resolve: (text: string) => void;
  reject: (e: Error) => void;
}

function streamHarness(): StreamHarness {
  const h = {} as StreamHarness;
  mocks.stream.mockImplementationOnce(
    (
      url: string,
      body: Record<string, unknown>,
      opts?: { signal?: AbortSignal; onDelta?: (d: string) => void },
    ) => {
      h.url = url;
      h.body = body;
      h.signal = opts?.signal;
      h.onDelta = opts?.onDelta;
      return new Promise<string>((res, rej) => {
        h.resolve = res;
        h.reject = rej;
      });
    },
  );
  return h;
}

/** 完成一次"生成"直至保存按钮出现 */
async function generateDone(h: StreamHarness, text: string) {
  fireEvent.click(generateButton());
  await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
  h.resolve(text);
  await waitFor(() => expect(screen.getByText("ai.announcementDraft:save")).toBeTruthy());
}

/** 生成按钮（header 内，文案与 streaming 态不同） */
function generateButton() {
  return screen.getByText("ai.announcementDraft:generate").closest("button") as HTMLButtonElement;
}

describe("AnnouncementDraftPanel", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.stream.mockReset();
    mocks.api.mockResolvedValue({});
  });
  afterEach(() => cleanup());

  it("初始空态：Sparkles(size32) + t('empty')，无保存栏", () => {
    const { container } = render(<AnnouncementDraftPanel wid={WID} />);
    expect(screen.getByText("ai.announcementDraft:empty")).toBeTruthy();
    // 空态图标 size=32（与 header Megaphone size=16 区分）
    const sparkles = Array.from(container.querySelectorAll("svg.lucide-sparkles"));
    expect(sparkles.some((s) => s.getAttribute("width") === "32")).toBe(true);
    expect(screen.queryByText("ai.announcementDraft:save")).toBeFalsy();
  });

  it("主题输入 maxLength=500；生成带主题（trim）或省略 topic", async () => {
    let h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    expect(screen.getByPlaceholderText("ai.announcementDraft:topicPlaceholder")).toBeTruthy();
    const topicInput = screen.getByLabelText("ai.announcementDraft:topicPlaceholder");
    expect(topicInput.getAttribute("maxlength")).toBe("500");
    fireEvent.change(topicInput, { target: { value: "  年终盘点  " } });
    await generateDone(h, "# 年终盘点");
    expect(h.url).toBe("/api/v1/ai/announcement-draft");
    expect(h.body).toEqual({ wid: WID, topic: "年终盘点" });
    // 第二次：清空主题 → topic: undefined
    fireEvent.change(topicInput, { target: { value: "" } });
    h = streamHarness();
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2));
    expect(h.body).toEqual({ wid: WID });
    h.resolve("x");
  });

  it("流式中：生成按钮与主题输入均 disabled，按钮 Loader2 + t('generating')", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    const btn = generateButton();
    const topicInput = screen.getByLabelText("ai.announcementDraft:topicPlaceholder");
    fireEvent.change(topicInput, { target: { value: "t1" } });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toBeDisabled();
      expect(topicInput).toBeDisabled();
    });
    expect(screen.getByText("ai.announcementDraft:generating")).toBeTruthy();
    expect(btn.querySelector("svg.lucide-loader-2")).toBeTruthy();
    h.resolve("完成");
  });

  it("onDelta 增量实时渲染 Markdown；完成后渲染全文 + FeedbackButtons", async () => {
    const h = streamHarness();
    const { container } = render(<AnnouncementDraftPanel wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.onDelta?.("第一");
    h.onDelta?.("段");
    await waitFor(() => expect(container.querySelectorAll('[data-testid="md"]').length).toBe(1));
    expect(screen.getByTestId("md").textContent).toBe("第一段");
    h.resolve("第一段完成");
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("第一段完成"));
    expect(screen.getByTestId("fb").getAttribute("data-capability")).toBe("announcement-draft");
  });

  it("预览/编辑切换：编辑态出现 textarea（aria-label=t('edit')），回切预览", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    await generateDone(h, "# 公告\n正文");
    // 默认预览态：Markdown 可见、textarea 不存在
    expect(screen.getByTestId("md").textContent).toBe("# 公告\n正文");
    expect(screen.queryByLabelText("ai.announcementDraft:edit")).toBeFalsy();
    fireEvent.click(screen.getByText("ai.announcementDraft:edit").closest("button")!);
    const ta = screen.getByLabelText("ai.announcementDraft:edit") as HTMLTextAreaElement;
    expect(ta.value).toBe("# 公告\n正文");
    fireEvent.click(screen.getByText("ai.announcementDraft:preview").closest("button")!);
    expect(screen.queryByLabelText("ai.announcementDraft:edit")).toBeFalsy();
  });

  it("保存：首行 # 标题 提取为 title，其余为 content", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    await generateDone(h, "# 周五发布\n第一行\n第二行");
    fireEvent.click(screen.getByText("ai.announcementDraft:save").closest("button")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/announcements`, {
      method: "POST",
      body: JSON.stringify({ title: "周五发布", content: "第一行\n第二行" }),
    });
    await waitFor(() => expect(screen.getByText("ai.announcementDraft:saved")).toBeTruthy());
    // saved 后保存按钮 disabled
    expect(screen.getByText("ai.announcementDraft:save").closest("button")).toBeDisabled();
  });

  it("保存：无标题行 → title=t('announcementTitle')，content 取全文", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    await generateDone(h, "没有标题的正文");
    fireEvent.click(screen.getByText("ai.announcementDraft:save").closest("button")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/announcements`, {
      method: "POST",
      body: JSON.stringify({
        title: "ai.announcementDraft:announcementTitle",
        content: "没有标题的正文",
      }),
    });
    h.resolve("ignored");
  });

  it("保存：仅有标题行 → body 为空串走 ||content 兜底，content 回退取全文", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    await generateDone(h, "# 只有标题");
    fireEvent.click(screen.getByText("ai.announcementDraft:save").closest("button")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    // extractTitleAndContent 返回 content=""（falsy）→ 组件用 body||content 兜底为完整 markdown
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/announcements`, {
      method: "POST",
      body: JSON.stringify({ title: "只有标题", content: "# 只有标题" }),
    });
    h.resolve("ignored");
  });

  it("保存失败 → t('saveFailed')，按钮恢复可点", async () => {
    mocks.api.mockRejectedValueOnce(new Error("save boom"));
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    await generateDone(h, "# 标题\n正文");
    fireEvent.click(screen.getByText("ai.announcementDraft:save").closest("button")!);
    await waitFor(() => expect(screen.getByText("ai.announcementDraft:saveFailed")).toBeTruthy());
    expect(screen.getByText("ai.announcementDraft:save").closest("button")).not.toBeDisabled();
    h.resolve("ignored");
  });

  it("生成失败（非 abort）→ t('generateFailed') 回到 idle", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    h.reject(new Error("boom"));
    await waitFor(() =>
      expect(screen.getByText("ai.announcementDraft:generateFailed")).toBeTruthy(),
    );
    // 回到 idle：生成文案恢复
    expect(generateButton()).toBeTruthy();
    expect(screen.queryByText("ai.announcementDraft:save")).toBeFalsy();
  });

  it("生成被 abort（AbortError）不视为错误：无 error 文案，按钮保持 generating（catch 早返回不改 phase）", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    fireEvent.click(generateButton());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalled());
    const e = new Error("aborted");
    e.name = "AbortError";
    h.reject(e);
    await waitFor(() => expect(screen.getByText("ai.announcementDraft:generating")).toBeTruthy());
    expect(screen.queryByText("ai.announcementDraft:generateFailed")).toBeFalsy();
  });

  it("编辑 textarea 修改内容会清除 saved 标志（按钮重新可用）", async () => {
    const h = streamHarness();
    render(<AnnouncementDraftPanel wid={WID} />);
    await generateDone(h, "# 标题一");
    fireEvent.click(screen.getByText("ai.announcementDraft:save").closest("button")!);
    await waitFor(() => expect(screen.getByText("ai.announcementDraft:saved")).toBeTruthy());
    // 编辑
    fireEvent.click(screen.getByText("ai.announcementDraft:edit").closest("button")!);
    fireEvent.change(screen.getByLabelText("ai.announcementDraft:edit"), {
      target: { value: "# 标题二" },
    });
    expect(screen.queryByText("ai.announcementDraft:saved")).toBeFalsy();
    expect(screen.getByText("ai.announcementDraft:save").closest("button")).not.toBeDisabled();
    h.resolve("ignored");
  });

  it("标题栏 Megaphone + t('title')，根容器无报错渲染", () => {
    const { container } = render(<AnnouncementDraftPanel wid={WID} />);
    expect(container.querySelector("svg.lucide-megaphone")).toBeTruthy();
    expect(screen.getByText("ai.announcementDraft:title")).toBeTruthy();
  });
});
