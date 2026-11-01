// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 版本管理契约（components/files/{FileVersionList,FileVersionRestore}.tsx）：
 *  - 列表：loading（aria-busy + spinner）/ 空态 / 版本号倒序；当前版本出对勾标签且无回滚按钮；
 *    非当前版本显示变更说明（空则占位），回滚按钮 aria-label 带版本号
 *  - 上传者：已注销（null）显示 unknownUploader，否则截 UUID 前 8 位
 *  - 回滚确认框：dialog 语义 + 文件名/版本插值；确认/取消/Esc/遮罩四通道；
 *    loading 时禁用全部关闭通道并显示 spinner
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import { FileVersionList } from "@/components/files/FileVersionList";
import { FileVersionRestore } from "@/components/files/FileVersionRestore";

const asset = () => ({
  id: "f1",
  workspaceId: "w1",
  fileName: "季度报告.pdf",
  fileType: "application/pdf",
  fileSize: 1024,
  createdAt: new Date(2026, 9, 1, 9, 0),
});

const version = (id: string, v: number, over: Record<string, unknown> = {}) => ({
  id,
  fileId: "f1",
  version: v,
  message: `变更 ${v}`,
  uploadedBy: "abcdef1234567890",
  createdAt: new Date(2026, 9, 5, 8, 30),
  ...over,
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("FileVersionList", () => {
  it("loading：aria-busy + spinner + loading 文案", () => {
    const { container, getByText } = render(
      <FileVersionList file={asset() as never} versions={[]} currentVersion={1} loading />,
    );
    const section = container.querySelector('[data-testid="file-version-list"]');
    expect(section?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("svg.lucide-loader-2")).toBeTruthy();
    expect(getByText("files.versionList:loading")).toBeTruthy();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("空态：无版本时显示 empty 文案与 aria-label 插值", () => {
    const { container, getByText } = render(
      <FileVersionList file={asset() as never} versions={[]} currentVersion={1} />,
    );
    expect(getByText("files.versionList:empty")).toBeTruthy();
    expect(container.querySelector("ul")).toBeNull();
    expect(
      container.querySelector('[data-testid="file-version-list"]')?.getAttribute("aria-label"),
    ).toBe('files.versionList:ariaLabel:{"name":"季度报告.pdf"}');
  });

  it("版本倒序 + 当前版本对勾 + 非当前版本回滚按钮", () => {
    const onRestore = vi.fn();
    const { container, getByText, getAllByText } = render(
      <FileVersionList
        file={asset() as never}
        versions={
          [
            version("v1", 1, { message: "" }),
            version("v3", 3),
            version("v2", 2, { uploadedBy: null }),
          ] as never
        }
        currentVersion={2}
        onRestore={onRestore}
      />,
    );

    const versions = Array.from(container.querySelectorAll("ul > li")).map(
      (li) => li.querySelector("span.shrink-0.text-\\[length\\:var\\(--text-sm\\)\\]")?.textContent,
    );
    expect(versions).toEqual(["v3", "v2", "v1"]);
    // 当前版本：对勾 + 当前版本标签，且无回滚按钮
    expect(getByText("files.versionList:currentVersion")).toBeTruthy();
    expect(container.querySelector("svg.lucide-check")).toBeTruthy();
    expect(container.querySelectorAll("svg.lucide-rotate-ccw").length).toBe(2);
    // 空变更说明占位
    expect(getByText("—")).toBeTruthy();
    // 上传者：null → unknownUploader；UUID → 前 8 位（两条都有上传者）
    expect(getByText("files.versionList:unknownUploader")).toBeTruthy();
    expect(getAllByText("abcdef12").length).toBe(2);
    // 总数插值
    expect(container.textContent).toContain('files.versionList:totalCount:{"count":3}');
  });

  it("回滚按钮：带版本号 aria-label，点击回调该版本 id", () => {
    const onRestore = vi.fn();
    const { getByLabelText } = render(
      <FileVersionList
        file={asset() as never}
        versions={[version("v1", 1), version("v2", 2)] as never}
        currentVersion={2}
        onRestore={onRestore}
      />,
    );
    const btn = getByLabelText('files.versionList:restoreAria:{"version":1}');
    expect(btn.textContent).toContain("files.versionList:restoreToVersion");
    fireEvent.click(btn);
    expect(onRestore).toHaveBeenCalledWith("v1");
  });

  it("未提供 onRestore：不出回滚按钮", () => {
    const { container } = render(
      <FileVersionList
        file={asset() as never}
        versions={[version("v1", 1), version("v2", 2)] as never}
        currentVersion={2}
      />,
    );
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("时间格式：YYYY-MM-DD HH:mm（本地时区）", () => {
    const { getByText } = render(
      <FileVersionList
        file={asset() as never}
        versions={[version("v1", 1)] as never}
        currentVersion={1}
      />,
    );
    expect(getByText("2026-10-05 08:30")).toBeTruthy();
  });
});

describe("FileVersionRestore", () => {
  const baseProps = () => ({
    version: 3,
    fileName: "季度报告.pdf",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    loading: false,
  });

  it("dialog 语义 + 文件名/版本插值 + 提示文案", () => {
    const { getByRole, getByText, container } = render(<FileVersionRestore {...baseProps()} />);
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("file-version-restore-title");
    expect(getByText("files.versionRestore:title")).toBeTruthy();
    expect(
      getByText('files.versionRestore:confirmBody:{"fileName":"季度报告.pdf","version":3}'),
    ).toBeTruthy();
    expect(getByText("files.versionRestore:hint")).toBeTruthy();
    expect(container.querySelector("svg.lucide-triangle-alert")).toBeTruthy();
  });

  it("确认/取消按钮各自回调", () => {
    const props = baseProps();
    const { getByText } = render(<FileVersionRestore {...props} />);
    fireEvent.click(getByText("files.versionRestore:confirm"));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText("files.versionRestore:cancel"));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("点遮罩取消、点面板不取消", () => {
    const props = baseProps();
    const { getByRole, container } = render(<FileVersionRestore {...props} />);
    fireEvent.click(getByRole("dialog"));
    expect(props.onCancel).not.toHaveBeenCalled();

    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape 取消；卸载后移除监听", () => {
    const props = baseProps();
    const { unmount } = render(<FileVersionRestore {...props} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("loading：按钮禁用、spinner、Esc 与遮罩都不再关闭", () => {
    const props = { ...baseProps(), loading: true };
    const { getByText, container } = render(<FileVersionRestore {...props} />);

    const confirm = getByText("files.versionRestore:confirm").closest("button")!;
    const cancel = getByText("files.versionRestore:cancel").closest("button")!;
    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(container.querySelector("svg.lucide-loader-2")).toBeTruthy();
    expect(container.querySelector("svg.lucide-rotate-ccw")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});
