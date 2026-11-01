// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 文件浏览器主容器契约（components/files/FileBrowser.tsx）：
 *  - 默认 list 视图；视图切换 aria-pressed 双向翻转，list→role=table / grid→role=grid
 *  - 搜索过滤大小写不敏感；有 query 无结果 → EmptyState type=search（带 query 插值），
 *    无 query 空列表 → EmptyState type=folder
 *  - 选中集合：复选框切换；删除某项时同步从选中集合移除（复选框回弹）并转发 onFileDelete
 *  - 版本入口按回调出现且透传整个 file
 *  - FileUploader 仅当提供 workspaceId 时渲染，且透传 workspaceId/folderId/compact
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

const h = vi.hoisted(() => ({ uploaderProps: null as Record<string, unknown> | null }));

vi.mock("@/components/files/FileUploader", async () => {
  const React = await import("react");
  return {
    FileUploader: (props: Record<string, unknown>) => {
      h.uploaderProps = props;
      return React.createElement("div", { "data-testid": "file-uploader-stub" });
    },
  };
});

vi.mock("@/components/EmptyState", async () => {
  const React = await import("react");
  return {
    default: (props: { type: string; title: string; description?: string }) =>
      React.createElement(
        "div",
        { "data-testid": "empty-state", "data-type": props.type },
        `${props.title}|${props.description ?? ""}`,
      ),
  };
});

import { FileBrowser } from "@/components/files/FileBrowser";
import type { FileAsset } from "@prisma/client";

const file = (over: Record<string, unknown> = {}) =>
  ({
    id: "f1",
    workspaceId: "w1",
    fileName: "报告.pdf",
    fileType: "application/pdf",
    fileSize: 2048,
    createdAt: new Date("2026-10-05T08:30:00Z"),
    thumbnailKey: null,
    folderId: null,
    ...over,
  }) as FileAsset;

const twoFiles = () => [file(), file({ id: "f2", fileName: "笔记.md", fileType: "text/markdown" })];

beforeEach(() => {
  document.body.innerHTML = "";
  h.uploaderProps = null;
});

describe("FileBrowser", () => {
  it("基础渲染：testid + 工具栏 + 默认 list 视图（table，list 按钮激活）", () => {
    const { getByTestId, getByRole, getByLabelText, container } = render(
      <FileBrowser files={twoFiles()} />,
    );
    expect(getByTestId("file-browser")).toBeTruthy();
    // 搜索框语义
    const search = getByLabelText("files.fileBrowser:searchAria");
    expect(search.getAttribute("placeholder")).toBe("files.fileBrowser:searchPlaceholder");
    // 默认 list
    expect(container.querySelector('[role="table"]')).toBeTruthy();
    expect(getByLabelText("files.fileBrowser:listViewAria").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(getByLabelText("files.fileBrowser:gridViewAria").getAttribute("aria-pressed")).toBe(
      "false",
    );
    // 视图切换组
    expect(getByRole("group").getAttribute("aria-label")).toBe("files.fileBrowser:viewSwitchAria");
  });

  it("切换到 grid：role=grid 出现、table 消失、aria-pressed 翻转", () => {
    const { getByLabelText, container } = render(<FileBrowser files={twoFiles()} />);
    fireEvent.click(getByLabelText("files.fileBrowser:gridViewAria"));
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
    expect(container.querySelector('[role="table"]')).toBeNull();
    expect(getByLabelText("files.fileBrowser:gridViewAria").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(getByLabelText("files.fileBrowser:listViewAria").getAttribute("aria-pressed")).toBe(
      "false",
    );
    // 切回 list
    fireEvent.click(getByLabelText("files.fileBrowser:listViewAria"));
    expect(container.querySelector('[role="table"]')).toBeTruthy();
  });

  it("viewMode 初始值可为 grid", () => {
    const { container } = render(<FileBrowser files={twoFiles()} viewMode="grid" />);
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
  });

  it("搜索过滤：大小写不敏感，只剩匹配项", () => {
    const { getByLabelText, getAllByRole } = render(<FileBrowser files={twoFiles()} />);
    const search = getByLabelText("files.fileBrowser:searchAria") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "PDF" } });
    expect(getAllByRole("row").length).toBe(1);
    expect(getAllByRole("row")[0].textContent).toContain("报告.pdf");
    // 清空恢复
    fireEvent.change(search, { target: { value: "" } });
    expect(getAllByRole("row").length).toBe(2);
  });

  it("搜索无结果：EmptyState 用 type=search 且 query 插值进描述", () => {
    const { getByLabelText, getByTestId } = render(<FileBrowser files={twoFiles()} />);
    fireEvent.change(getByLabelText("files.fileBrowser:searchAria"), {
      target: { value: "  不存在  " },
    });
    const empty = getByTestId("empty-state");
    expect(empty.getAttribute("data-type")).toBe("search");
    expect(empty.textContent).toContain("files.fileBrowser:searchEmptyDescription");
    expect(empty.textContent).toContain('"query":"不存在"');
  });

  it("空文件夹（无搜索）：EmptyState 用 type=folder", () => {
    const { getByTestId } = render(<FileBrowser files={[]} />);
    const empty = getByTestId("empty-state");
    expect(empty.getAttribute("data-type")).toBe("folder");
    expect(empty.textContent).toContain("files.fileBrowser:folderEmptyTitle");
  });

  it("选中切换：复选框随选中集合翻转", () => {
    const { getAllByRole } = render(<FileBrowser files={twoFiles()} />);
    const boxes = getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    expect(boxes[0].getAttribute("aria-checked")).toBe("true");
    expect(boxes[1].getAttribute("aria-checked")).toBe("false");
    fireEvent.click(boxes[0]);
    expect(boxes[0].getAttribute("aria-checked")).toBe("false");
  });

  it("删除：转发 onFileDelete 并把该文件移出选中集合（复选框回弹）", () => {
    const onFileDelete = vi.fn();
    const { getAllByRole, getAllByLabelText } = render(
      <FileBrowser files={twoFiles()} onFileDelete={onFileDelete} />,
    );
    const box = getAllByRole("checkbox")[0];
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(getAllByLabelText("files.fileListItem:deleteAria")[0]);
    expect(onFileDelete).toHaveBeenCalledTimes(1);
    expect(onFileDelete).toHaveBeenCalledWith("f1");
    // 选中集合已同步移除 → 复选框回到未选中
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("未提供 onFileDelete：列表项不渲染删除按钮", () => {
    const { container } = render(<FileBrowser files={twoFiles()} onFileVersions={vi.fn()} />);
    expect(container.querySelector('[aria-label="files.fileListItem:deleteAria"]')).toBeNull();
    // 版本按钮仍在
    expect(container.querySelector('[aria-label="files.fileListItem:versionsAria"]')).toBeTruthy();
  });

  it("版本历史：转发整个 file 对象", () => {
    const onFileVersions = vi.fn();
    const { getAllByLabelText } = render(
      <FileBrowser files={twoFiles()} onFileVersions={onFileVersions} />,
    );
    fireEvent.click(getAllByLabelText("files.fileListItem:versionsAria")[0]);
    expect(onFileVersions).toHaveBeenCalledTimes(1);
    const arg = onFileVersions.mock.calls[0][0] as FileAsset;
    expect(arg.id).toBe("f1");
    expect(arg.fileName).toBe("报告.pdf");
  });

  it("行点击转发 onFileClick", () => {
    const onFileClick = vi.fn();
    const { getByText } = render(<FileBrowser files={twoFiles()} onFileClick={onFileClick} />);
    fireEvent.click(getByText("笔记.md"));
    expect(onFileClick).toHaveBeenCalledTimes(1);
    expect(onFileClick.mock.calls[0][0].id).toBe("f2");
  });

  it("FileUploader：仅当提供 workspaceId 时渲染，且透传 compact/folderId/回调", () => {
    const onUploadComplete = vi.fn();
    const { rerender, queryByTestId, getByTestId } = render(
      <FileBrowser files={twoFiles()} currentFolderId="fld-9" />,
    );
    expect(queryByTestId("file-uploader-stub")).toBeNull();
    expect(h.uploaderProps).toBeNull();

    rerender(
      <FileBrowser
        files={twoFiles()}
        workspaceId="w1"
        currentFolderId="fld-9"
        onUploadComplete={onUploadComplete}
      />,
    );
    expect(getByTestId("file-uploader-stub")).toBeTruthy();
    expect(h.uploaderProps).toMatchObject({
      workspaceId: "w1",
      folderId: "fld-9",
      compact: true,
      onUploadComplete,
    });
  });
});
