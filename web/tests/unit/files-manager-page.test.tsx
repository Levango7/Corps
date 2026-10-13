// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * 云盘页面容器（FileManagerPage）的行为契约 —— ADR-015 接线的回归保护。
 *
 * 容器自身的职责边界（本文件钉这些，不重复测子组件）：
 *  1. 列表请求走文件 API 且带 limit；失败 → 显示错误 + 重试按钮，重试能再发请求；
 *  2. 点击文件 → 预览弹窗拿到的 url 是下载端点、fileType 是**扩名**（FilePreview 按它分发）；
 *  3. 删除必须先过确认弹窗（文案来自 files.page.*，不是 task 默认文案）、
 *     成功后本地剔除该行并 toast，失败则保留该行并 toast error；
 *  4. 上传完成回调触发列表刷新；
 *  5. 版本历史（2026-10-14 续接）：打开时请求 versions 端点、渲染列表与权威当前版本号；
 *     回滚走确认弹窗 → POST restore → **两个列表都刷新**（版本 + 文件本体）；
 *     版本列表拉取失败时 toast 并收起弹层。
 *
 * 五个子组件（FileBrowser / FilePreviewDialog / ConfirmDialog / FileVersionList /
 * FileVersionRestore）均以桩替换：视图渲染另有真机走查覆盖
 * （上传→预览→删除→同内容重传造 v2→回滚 v1 全链路），这里只测接线逻辑。
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apiList: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next-intl", () => ({
  // 带上 ICU 参数（JSON 化）——让"文案里嵌了文件名/版本号"这类断言可判
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${ns}:${key}:${JSON.stringify(params)}` : `${ns}:${key}`,
}));
vi.mock("@/lib/api", () => ({ api: mocks.api, apiList: mocks.apiList }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

// 桩 1：FileBrowser —— 暴露五个回调入口 + 当前文件数
vi.mock("@/components/files/FileBrowser", () => ({
  FileBrowser: (props: {
    files: Array<{ id: string; fileName: string }>;
    onFileClick?: (f: unknown) => void;
    onFileDelete?: (id: string) => void;
    onFileVersions?: (f: unknown) => void;
    onUploadComplete?: () => void;
  }) => (
    <div data-testid="stub-browser">
      <span data-testid="stub-count">{props.files.length}</span>
      <button data-testid="stub-click" onClick={() => props.onFileClick?.(props.files[0])}>
        click
      </button>
      <button data-testid="stub-delete" onClick={() => props.onFileDelete?.(props.files[0].id)}>
        delete
      </button>
      <button
        data-testid="stub-versions-open"
        onClick={() => props.onFileVersions?.(props.files[0])}
      >
        versions
      </button>
      <button data-testid="stub-upload-done" onClick={() => props.onUploadComplete?.()}>
        uploaded
      </button>
    </div>
  ),
}));

// 桩 2：预览弹窗 —— 透出容器推导出的 url/fileName/fileType
vi.mock("@/components/files/FilePreviewDialog", () => ({
  FilePreviewDialog: (props: {
    open: boolean;
    file: { url: string; fileName: string; fileType: string; onClose: () => void };
  }) =>
    props.open ? (
      <div
        data-testid="stub-preview"
        data-url={props.file.url}
        data-name={props.file.fileName}
        data-type={props.file.fileType}
      >
        <button data-testid="stub-preview-close" onClick={props.file.onClose}>
          close
        </button>
      </div>
    ) : null,
}));

// 桩 3：确认弹窗 —— 与真实组件同序：onConfirm() 后立即 onClose()
vi.mock("@/components/task/ConfirmDialog", () => ({
  ConfirmDialog: (props: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    deleting: boolean;
    labels?: { description: string };
  }) =>
    props.open ? (
      <div data-testid="stub-confirm" data-desc={props.labels?.description}>
        <button
          data-testid="stub-confirm-go"
          onClick={() => {
            props.onConfirm();
            props.onClose();
          }}
        >
          go
        </button>
        <button data-testid="stub-confirm-cancel" onClick={props.onClose}>
          cancel
        </button>
      </div>
    ) : null,
}));

// 桩 4：版本列表 —— 透出当前版本号，非当前版本各给一个回滚按钮
vi.mock("@/components/files/FileVersionList", () => ({
  FileVersionList: (props: {
    versions: Array<{ id: string; version: number; createdAt?: unknown }>;
    currentVersion: number;
    loading?: boolean;
    onRestore?: (versionId: string) => void;
  }) => (
    <div
      data-testid="stub-versions"
      data-count={props.versions.length}
      data-current={props.currentVersion}
      data-loading={String(Boolean(props.loading))}
      data-createdIsDate={String(props.versions[0]?.createdAt instanceof Date)}
    >
      {props.versions
        .filter((v) => v.version !== props.currentVersion)
        .map((v) => (
          <button
            key={v.id}
            data-testid={`versions-restore-${v.version}`}
            onClick={() => props.onRestore?.(v.id)}
          >
            restore-v{v.version}
          </button>
        ))}
    </div>
  ),
}));

// 桩 5：回滚确认 —— 透出版本号与文件名
vi.mock("@/components/files/FileVersionRestore", () => ({
  FileVersionRestore: (props: { version: number; fileName: string; onConfirm: () => void }) => (
    <div data-testid="stub-restore-confirm" data-version={props.version} data-name={props.fileName}>
      <button data-testid="stub-restore-go" onClick={props.onConfirm}>
        go
      </button>
    </div>
  ),
}));

import { FileManagerPage } from "@/components/files/FileManagerPage";

const WID = "w-1";
const F1 = { id: "f1", fileName: "需求文档.txt" };
const F2 = { id: "f2", fileName: "架构图.png" };
// createdAt 用 ISO 字符串——模拟 API 的 wire 形状（容器负责转回 Date，见 loadVersions）
const V1 = { id: "v-1", version: 1, createdAt: "2026-10-14T02:00:00.000Z" };
const V2 = { id: "v-2", version: 2, createdAt: "2026-10-14T02:05:00.000Z" };

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
  mocks.toast.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("FileManagerPage（云盘容器）", () => {
  it("列表请求带 limit，渲染子组件并显示文件数", async () => {
    mocks.apiList.mockResolvedValueOnce([F1, F2]);
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");
    expect(mocks.apiList).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/files?limit=100`);
    expect(screen.getByTestId("stub-count")).toHaveTextContent("2");
  });

  it("加载失败 → 错误态 + 重试可再发请求并恢复", async () => {
    mocks.apiList.mockRejectedValueOnce(new Error("network"));
    render(<FileManagerPage wid={WID} />);
    const retry = await screen.findByRole("button", { name: "files:page.retry" });
    expect(screen.getByText("files:page.loadFailed")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-browser")).not.toBeInTheDocument();

    mocks.apiList.mockResolvedValueOnce([F1]);
    fireEvent.click(retry);
    await screen.findByTestId("stub-browser");
    expect(mocks.apiList).toHaveBeenCalledTimes(2);
  });

  it("点击文件 → 预览弹窗拿到下载端点 url 与扩名 fileType，可关闭", async () => {
    mocks.apiList.mockResolvedValueOnce([F1]);
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");
    fireEvent.click(screen.getByTestId("stub-click"));

    const preview = screen.getByTestId("stub-preview");
    expect(preview).toHaveAttribute("data-url", `/api/v1/workspaces/${WID}/files/f1/download`);
    expect(preview).toHaveAttribute("data-name", "需求文档.txt");
    expect(preview).toHaveAttribute("data-type", "txt");

    fireEvent.click(screen.getByTestId("stub-preview-close"));
    expect(screen.queryByTestId("stub-preview")).not.toBeInTheDocument();
  });

  it("删除：先确认（files 文案）→ DELETE 到对端点 + toast 成功 + 行移除", async () => {
    mocks.apiList.mockResolvedValueOnce([F1, F2]);
    mocks.api.mockResolvedValueOnce(null);
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");

    fireEvent.click(screen.getByTestId("stub-delete"));
    const confirm = screen.getByTestId("stub-confirm");
    // 文案来自 files.page.*（覆盖 ConfirmDialog 的 task 默认文案），且带上文件名
    expect(confirm.getAttribute("data-desc")).toContain("files:page.deleteConfirmBody");
    expect(confirm.getAttribute("data-desc")).toContain("需求文档.txt");

    fireEvent.click(screen.getByTestId("stub-confirm-go"));
    await waitFor(() => expect(screen.getByTestId("stub-count")).toHaveTextContent("1"));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/files/f1`, {
      method: "DELETE",
    });
    expect(mocks.toast).toHaveBeenCalledWith("success", "files:page.deleteDone");
    // 确认弹窗已随 onClose 关闭
    expect(screen.queryByTestId("stub-confirm")).not.toBeInTheDocument();
  });

  it("删除失败：toast error 且行保留", async () => {
    mocks.apiList.mockResolvedValueOnce([F1]);
    mocks.api.mockRejectedValueOnce(new Error("403"));
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");

    fireEvent.click(screen.getByTestId("stub-delete"));
    fireEvent.click(screen.getByTestId("stub-confirm-go"));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("error", "files:page.deleteFailed"),
    );
    expect(screen.getByTestId("stub-count")).toHaveTextContent("1");
  });

  it("上传完成 → 触发列表刷新", async () => {
    mocks.apiList.mockResolvedValueOnce([F1]).mockResolvedValueOnce([F1, F2]);
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");

    fireEvent.click(screen.getByTestId("stub-upload-done"));
    await waitFor(() => expect(screen.getByTestId("stub-count")).toHaveTextContent("2"));
    expect(mocks.apiList).toHaveBeenCalledTimes(2);
  });

  it("打开版本历史 → 请求 versions 端点、渲染列表与权威当前版本，仅非当前版本可回滚", async () => {
    mocks.apiList.mockResolvedValueOnce([F1]);
    mocks.api.mockResolvedValueOnce({ items: [V2, V1], currentVersion: 2 });
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");

    fireEvent.click(screen.getByTestId("stub-versions-open"));
    const list = await screen.findByTestId("stub-versions");
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/files/f1/versions?limit=100`);
    expect(list).toHaveAttribute("data-count", "2");
    expect(list).toHaveAttribute("data-current", "2");
    // createdAt 必须是 Date 实例（wire 字符串转换的回归守卫——
    // 不转换会在真机渲染期抛 v.createdAt.toISOString is not a function）
    expect(list).toHaveAttribute("data-createdIsDate", "true");
    // 回滚按钮只出现在非当前版本上（v1 有、v2 没有）
    expect(screen.getByTestId("versions-restore-1")).toBeInTheDocument();
    expect(screen.queryByTestId("versions-restore-2")).not.toBeInTheDocument();
  });

  it("回滚：确认弹窗带版本号/文件名 → POST restore → 版本与文件两个列表都刷新 + toast", async () => {
    mocks.apiList.mockResolvedValueOnce([F1]);
    mocks.api.mockResolvedValueOnce({ items: [V2, V1], currentVersion: 2 });
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");
    fireEvent.click(screen.getByTestId("stub-versions-open"));
    await screen.findByTestId("versions-restore-1");

    fireEvent.click(screen.getByTestId("versions-restore-1"));
    const confirm = screen.getByTestId("stub-restore-confirm");
    expect(confirm).toHaveAttribute("data-version", "1");
    expect(confirm).toHaveAttribute("data-name", "需求文档.txt");

    mocks.api.mockResolvedValueOnce(null); // POST restore
    mocks.api.mockResolvedValueOnce({ items: [V2, V1], currentVersion: 1 }); // 版本列表刷新
    mocks.apiList.mockResolvedValueOnce([F1]); // 文件列表刷新
    fireEvent.click(screen.getByTestId("stub-restore-go"));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "success",
        'files:versionList.restoreDone:{"version":1}',
      ),
    );
    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/workspaces/${WID}/files/f1/versions/v-1/restore`,
      { method: "POST" },
    );
    // 权威当前版本号已随刷新更新为 1
    await waitFor(() =>
      expect(screen.getByTestId("stub-versions")).toHaveAttribute("data-current", "1"),
    );
    expect(mocks.apiList).toHaveBeenCalledTimes(2);
  });

  it("版本历史加载失败 → toast error 且弹层收起（不给空壳）", async () => {
    mocks.apiList.mockResolvedValueOnce([F1]);
    mocks.api.mockRejectedValueOnce(new Error("500"));
    render(<FileManagerPage wid={WID} />);
    await screen.findByTestId("stub-browser");

    fireEvent.click(screen.getByTestId("stub-versions-open"));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("error", "files:versionList.loadFailed"),
    );
    expect(screen.queryByTestId("stub-versions")).not.toBeInTheDocument();
  });
});
