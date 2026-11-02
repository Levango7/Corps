// @vitest-environment jsdom

/**
 * TaskDecisions 契约（components/task/TaskDecisions.tsx）：
 * 决策列表与空态、新增决策编辑器（编辑/预览切换、Markdown 工具栏、快速图表插入）、
 * 保存（POST + 前置新决策 + 清空草稿 + 触发行动项刷新）、失败 onError、
 * 单条导出预览、导出 PDF 打印容器、版本历史拉取与 Escape 关闭。
 */
import { render, screen, fireEvent, cleanup, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, afterEach, describe, it, expect } from "vitest";
import { TaskDecisions } from "@/components/task/TaskDecisions";
import type { Decision, DecisionVersion, Task } from "@/components/task/types";

const { apiMock, editorKeysSpy } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  editorKeysSpy: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
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

vi.mock("@/components/Markdown", () => ({
  default: (props: { source: string }) => (
    <div data-testid="md" data-source={props.source}>
      md:{props.source}
    </div>
  ),
}));

vi.mock("@/components/ActionItemPanel", () => ({
  ActionItemPanel: (props: {
    decisionId: string;
    workspaceId: string;
    taskId: string;
    locale: string;
    refreshSignal: number;
  }) => (
    <div
      data-testid="action-panel"
      data-decision-id={props.decisionId}
      data-workspace-id={props.workspaceId}
      data-task-id={props.taskId}
      data-locale={props.locale}
      data-refresh-signal={String(props.refreshSignal)}
    >
      action-panel
    </div>
  ),
}));

vi.mock("@/components/MarkdownToolbar", () => ({
  MarkdownToolbar: (props: { value: string }) => (
    <div data-testid="md-toolbar" data-value={props.value}>
      toolbar
    </div>
  ),
  useEditorKeys: () => editorKeysSpy,
}));

vi.mock("@/components/QuickDiagram", () => ({
  QuickDiagram: (props: { open: boolean; onInsert: (block: string) => void }) => (
    <div data-testid="quick-diagram" data-open={props.open ? "1" : "0"}>
      <button type="button" onClick={() => props.onInsert("```mermaid\ngraph TD\nA-->B\n```")}>
        insert-diagram
      </button>
    </div>
  ),
}));

vi.mock("@/components/ExportPreview", () => ({
  ExportPreview: (props: {
    open: boolean;
    title: string;
    markdown: string;
    metaLine?: string;
    onClose: () => void;
  }) => (
    <div
      data-testid="export-preview"
      data-open={props.open ? "1" : "0"}
      data-title={props.title}
      data-markdown={props.markdown}
      data-meteline={props.metaLine ?? ""}
    >
      <button type="button" onClick={props.onClose}>
        preview-close
      </button>
    </div>
  ),
}));

vi.mock("@/components/task/DecisionHistoryDialog", () => ({
  DecisionHistoryDialog: (props: {
    historyFor: Decision | null;
    versions: DecisionVersion[];
    historyLoading: boolean;
    historyError: boolean;
    onRetry: () => void;
  }) => (
    <div
      data-testid="history-dialog"
      data-for-version={props.historyFor?.version ?? ""}
      data-versions={String(props.versions.length)}
      data-loading={props.historyLoading ? "1" : "0"}
      data-error={props.historyError ? "1" : "0"}
    >
      <button type="button" onClick={props.onRetry}>
        history-retry
      </button>
    </div>
  ),
}));

const BASE = "/api/v1/workspaces/ws-1";
const TASK_ID = "t-1";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    title: "任务甲",
    description: null,
    status: "in_progress",
    priority: "high",
    dueDate: null,
    assignee: null,
    creator: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    blocked: false,
    blockedReason: null,
    shareToken: null,
    children: [],
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "d-" + Math.random().toString(36).slice(2, 8),
    markdown: "决策内容",
    version: 1,
    createdAt: "2026-10-03T09:00:00Z",
    author: { id: "u1", name: "Alice", email: "alice@x.com" },
    ...overrides,
  };
}

function relTime(iso: string) {
  return `rel:${iso}`;
}

function renderDecisions(
  overrides: {
    decisions?: Decision[];
    decisionRefreshSignal?: number;
    base?: string;
    task?: Task;
  } = {},
) {
  const props = {
    task: overrides.task ?? makeTask(),
    decisions: overrides.decisions ?? [],
    wid: "ws-1",
    id: TASK_ID,
    base: overrides.base ?? BASE,
    decisionRefreshSignal: overrides.decisionRefreshSignal ?? 0,
    onDecisionsChange: vi.fn(),
    onDecisionRefresh: vi.fn(),
    onError: vi.fn(),
    relTime,
  };
  const { container } = render(<TaskDecisions {...props} />);
  return { container, ...props };
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TaskDecisions", () => {
  it("渲染标题与决策计数徽标", () => {
    renderDecisions({ decisions: [makeDecision(), makeDecision({ version: 2 })] });
    expect(screen.getByText("task:decisionsTitle")).toBeInTheDocument();
    expect(
      screen.getByText("task:decisionsTitle").closest("h2")?.querySelector("span")?.textContent,
    ).toBe("2");
  });

  it("无决策且编辑器未展开时显示空态并禁用导出 PDF", () => {
    renderDecisions();
    expect(screen.getByText("task:decisionsEmpty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /task:exportPdf/ })).toBeDisabled();
  });

  it("点击新增决策展开编辑器（标签改为取消），再点收起", () => {
    renderDecisions();
    const toggle = screen.getByRole("button", { name: "task:addDecision" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "task:editTab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "button:cancel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "button:cancel" }));
    expect(screen.queryByRole("button", { name: "task:editTab" })).not.toBeInTheDocument();
  });

  it("编辑态渲染工具栏与 textarea（快捷键层挂载），切到预览态渲染 Markdown", () => {
    renderDecisions();
    fireEvent.click(screen.getByRole("button", { name: "task:addDecision" }));
    const editor = screen.getByPlaceholderText("task:decisionTemplate") as HTMLTextAreaElement;
    expect(screen.getByTestId("md-toolbar")).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "预览这段" } });
    expect(editorKeysSpy).not.toHaveBeenCalled(); // 编辑器按键由 useEditorKeys 提供，本测试只验证挂载
    fireEvent.click(screen.getByRole("button", { name: "task:previewTab" }));
    const md = screen.getByTestId("md");
    expect(md).toHaveAttribute("data-source", "预览这段");
    // 切回编辑态：aria-pressed 跟随
    fireEvent.click(screen.getByRole("button", { name: "task:editTab" }));
    expect(screen.getByPlaceholderText("task:decisionTemplate")).toBeInTheDocument();
  });

  it("预览空草稿显示 noPreviewContent", () => {
    renderDecisions();
    fireEvent.click(screen.getByRole("button", { name: "task:addDecision" }));
    fireEvent.click(screen.getByRole("button", { name: "task:previewTab" }));
    expect(screen.getByText("task:noPreviewContent")).toBeInTheDocument();
  });

  it("草稿为空时保存按钮禁用", () => {
    renderDecisions();
    fireEvent.click(screen.getByRole("button", { name: "task:addDecision" }));
    expect(screen.getByRole("button", { name: /task:saveAsVersion/ })).toBeDisabled();
  });

  it("保存决策 POST 正确负载，成功后前置新决策、清空草稿、收起编辑器并触发行动项刷新", async () => {
    const created = makeDecision({ id: "d-new", markdown: "新决策", version: 1 });
    apiMock.mockResolvedValue(created);
    const { onDecisionsChange, onDecisionRefresh, onError } = renderDecisions();
    fireEvent.click(screen.getByRole("button", { name: "task:addDecision" }));
    const editor = screen.getByPlaceholderText("task:decisionTemplate") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "  新决策  " } });
    fireEvent.click(screen.getByRole("button", { name: /task:saveAsVersion/ }));
    expect(apiMock).toHaveBeenCalledWith(`${BASE}/tasks/${TASK_ID}/decisions`, {
      method: "POST",
      body: JSON.stringify({ markdown: "新决策" }),
    });
    await waitFor(() => expect(onDecisionsChange).toHaveBeenCalled());
    const updater = onDecisionsChange.mock.calls[0][0] as (prev: Decision[]) => Decision[];
    expect(updater([])).toEqual([created]);
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("task:decisionTemplate")).not.toBeInTheDocument(),
    );
    expect(onDecisionRefresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("保存失败调用 onError（错误消息）且编辑器保持打开", async () => {
    apiMock.mockRejectedValue(new Error("保存爆炸"));
    const { onError, onDecisionRefresh } = renderDecisions();
    fireEvent.click(screen.getByRole("button", { name: "task:addDecision" }));
    fireEvent.change(screen.getByPlaceholderText("task:decisionTemplate"), {
      target: { value: "草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: /task:saveAsVersion/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("保存爆炸"));
    expect(onDecisionRefresh).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("task:decisionTemplate")).toBeInTheDocument();
  });

  it("保存按钮文案含下一版本号（现有最新版本 + 1）", () => {
    renderDecisions({ decisions: [makeDecision({ version: 2 })] });
    fireEvent.click(screen.getByRole("button", { name: "task:addDecision" }));
    const save = screen.getByRole("button", { name: /task:saveAsVersion/ });
    expect(save.textContent).toContain('task:saveAsVersion:{"version":3}');
  });

  it("决策卡片渲染版本徽标、作者、相对时间、Markdown 源", () => {
    const d = makeDecision({ markdown: "正文甲", version: 4 });
    const { container } = renderDecisions({ decisions: [d] });
    expect(container.textContent).toContain("v4");
    // 作者、相对时间渲染在同一 span 内（中间由 · 分隔）
    expect(screen.getByText(/Alice · rel:2026-10-03T09:00:00Z/)).toBeInTheDocument();
    expect(screen.getByTestId("md")).toHaveAttribute("data-source", "正文甲");
  });

  it("作者为 null 时卡片显示已删除用户兜底", () => {
    renderDecisions({ decisions: [makeDecision({ author: null })] });
    expect(screen.getByText(/task:deletedUser · rel:/)).toBeInTheDocument();
  });

  it("ActionItemPanel 接收 decisionId/workspaceId/taskId/locale/refreshSignal", () => {
    const d = makeDecision();
    renderDecisions({ decisions: [d], decisionRefreshSignal: 7 });
    const panel = screen.getByTestId("action-panel");
    expect(panel).toHaveAttribute("data-decision-id", d.id);
    expect(panel).toHaveAttribute("data-workspace-id", "ws-1");
    expect(panel).toHaveAttribute("data-task-id", TASK_ID);
    expect(panel).toHaveAttribute("data-locale", "zh");
    expect(panel).toHaveAttribute("data-refresh-signal", "7");
  });

  it("单条导出按钮打开 ExportPreview（标题/markdown/metaLine），onClose 后关闭", () => {
    const { container } = renderDecisions({
      decisions: [makeDecision({ markdown: "导出我", version: 2 })],
    });
    // 决策卡片内的导出按钮（与工具条的批量导出按钮同名，需限定在 article 内）
    const card = container.querySelector("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "task:exportPdf" }));
    const preview = screen.getByTestId("export-preview");
    expect(preview).toHaveAttribute("data-open", "1");
    expect(preview).toHaveAttribute("data-title", "任务甲 · task:decisionsTitle v2");
    expect(preview).toHaveAttribute("data-markdown", "导出我");
    expect(preview.getAttribute("data-meteline")).toContain("v2");
    expect(preview.getAttribute("data-meteline")).toContain("Alice");
    fireEvent.click(screen.getByRole("button", { name: "preview-close" }));
    expect(screen.getByTestId("export-preview")).toHaveAttribute("data-open", "0");
  });

  it("版本历史：GET versions 成功后结果传给弹窗", async () => {
    const d = makeDecision({ version: 1 });
    const versions: DecisionVersion[] = [
      {
        id: "v1",
        decisionId: d.id,
        markdown: "初版",
        version: 1,
        createdAt: "2026-10-03T08:00:00Z",
        author: null,
      },
    ];
    apiMock.mockResolvedValue(versions);
    renderDecisions({ decisions: [d] });
    fireEvent.click(screen.getByRole("button", { name: "task:versionHistory" }));
    expect(apiMock).toHaveBeenCalledWith(`${BASE}/tasks/${TASK_ID}/decisions/${d.id}/versions`);
    await waitFor(() => {
      expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-for-version", "1");
      expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-versions", "1");
      expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-loading", "0");
    });
  });

  it("版本历史：请求失败时 historyError 传给弹窗，重试按钮触发重新拉取", async () => {
    apiMock.mockRejectedValue(new Error("网络断了"));
    const d = makeDecision({ version: 1 });
    renderDecisions({ decisions: [d] });
    fireEvent.click(screen.getByRole("button", { name: "task:versionHistory" }));
    await waitFor(() =>
      expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-error", "1"),
    );
    expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-versions", "0");
    fireEvent.click(screen.getByRole("button", { name: "history-retry" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
  });

  it("Escape 键关闭版本历史弹窗", async () => {
    apiMock.mockResolvedValue([]);
    const d = makeDecision({ version: 1 });
    renderDecisions({ decisions: [d] });
    fireEvent.click(screen.getByRole("button", { name: "task:versionHistory" }));
    await waitFor(() =>
      expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-for-version", "1"),
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await waitFor(() =>
      expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-for-version", ""),
    );
  });

  it("快速图表插入：空草稿直接落块；结尾非换行补 \\n\\n；结尾已换行不补", () => {
    renderDecisions();
    fireEvent.click(screen.getByRole("button", { name: "task:addDecision" }));
    fireEvent.click(screen.getByRole("button", { name: "diagramQuick:title" }));
    fireEvent.click(screen.getByRole("button", { name: "insert-diagram" }));
    const editor = screen.getByPlaceholderText("task:decisionTemplate") as HTMLTextAreaElement;
    expect(editor).toHaveValue("```mermaid\ngraph TD\nA-->B\n```");
    fireEvent.change(editor, { target: { value: "已有正文" } });
    fireEvent.click(screen.getByRole("button", { name: "insert-diagram" }));
    expect(editor).toHaveValue("已有正文\n\n```mermaid\ngraph TD\nA-->B\n```");
    fireEvent.change(editor, { target: { value: "换行结尾\n" } });
    fireEvent.click(screen.getByRole("button", { name: "insert-diagram" }));
    expect(editor).toHaveValue("换行结尾\n```mermaid\ngraph TD\nA-->B\n```");
  });

  it("导出 PDF：触发 window.print、挂载打印容器，afterprint 后卸载", async () => {
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    const decisions = [makeDecision({ markdown: "打印正文", version: 1 })];
    renderDecisions({ decisions });
    // 工具条上的批量导出按钮（页面中第一个同名按钮）
    fireEvent.click(screen.getAllByRole("button", { name: /task:exportPdf/ })[0]);
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    const printArea = document.querySelector(".print-area");
    expect(printArea?.textContent).toContain("任务甲 · task:decisionsTitle");
    expect(printArea?.textContent).toContain("打印正文");
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    await waitFor(() => expect(document.querySelector(".print-area")).toBeNull());
  });
});
