// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 文件项契约（components/files/{FileListItem,FileGridItem}.tsx）：
 *  - 列表项：role=row；复选框 aria-checked/aria-label 随选中态翻转；图标按 MIME、
 *    大小/日期走 file-utils 格式化；操作按钮只回调提供的那些
 *  - 网格项：图片且有 thumbnailKey 时出缩略图（走 download 端点），加载失败回退图标；
 *    无 onSelect 不渲染复选框；选中态换边框色
 *  - 两者：点复选框/操作按钮都 stopPropagation，不触发整行 onClick
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import { FileListItem } from "@/components/files/FileListItem";
import { FileGridItem } from "@/components/files/FileGridItem";

const file = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  workspaceId: "w1",
  fileName: "报告.pdf",
  fileType: "application/pdf",
  fileSize: 2048,
  createdAt: new Date("2026-10-05T08:30:00Z"),
  thumbnailKey: null,
  folderId: null,
  ...over,
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("FileListItem", () => {
  it("基础渲染：role=row + 名称/大小/日期 + 按 MIME 取图标", () => {
    const { container, getByText } = render(<FileListItem file={file() as never} />);
    expect(container.querySelector('[role="row"]')).toBeTruthy();
    expect(getByText("报告.pdf")).toBeTruthy();
    expect(getByText("2.0 KB")).toBeTruthy();
    expect(getByText(/^\d{4}-\d{2}-\d{2}$/)).toBeTruthy();
    expect(container.querySelector("svg.lucide-file-text")).toBeTruthy();
  });

  it("未选中：aria-checked=false + selectAria；选中：true + unselectAria + 对勾", () => {
    const { container, rerender, getByRole } = render(<FileListItem file={file() as never} />);
    const box = getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.getAttribute("aria-label")).toBe("files.fileListItem:selectAria");
    expect(container.querySelector("svg.lucide-check")).toBeNull();

    rerender(<FileListItem file={file() as never} selected />);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.getAttribute("aria-label")).toBe("files.fileListItem:unselectAria");
    expect(container.querySelector("svg.lucide-check")).toBeTruthy();
    expect(container.querySelector('[role="row"]')?.className).toContain("surface-3");
  });

  it("点复选框：只触发 onSelect，不触发整行 onClick", () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    const { getByRole } = render(
      <FileListItem file={file() as never} onClick={onClick} onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("checkbox"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("点整行：触发 onClick 且行可点样式生效", () => {
    const onClick = vi.fn();
    const { getByText, container } = render(
      <FileListItem file={file() as never} onClick={onClick} />,
    );
    fireEvent.click(getByText("报告.pdf"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="row"]')?.className).toContain("cursor-pointer");
  });

  it("操作按钮按回调出现；点删除/版本历史各自转发且不冒泡", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    const onVersions = vi.fn();
    const { getByLabelText } = render(
      <FileListItem
        file={file() as never}
        onClick={onClick}
        onDelete={onDelete}
        onVersions={onVersions}
      />,
    );

    fireEvent.click(getByLabelText("files.fileListItem:deleteAria"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(getByLabelText("files.fileListItem:versionsAria"));
    expect(onVersions).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("未提供回调：不出操作按钮", () => {
    const { container } = render(<FileListItem file={file() as never} />);
    expect(container.querySelector('[aria-label="files.fileListItem:deleteAria"]')).toBeNull();
    expect(container.querySelector('[aria-label="files.fileListItem:versionsAria"]')).toBeNull();
  });
});

describe("FileGridItem", () => {
  it("图片 + thumbnailKey：渲染缩略图，src 走 download 端点", () => {
    const { container } = render(
      <FileGridItem file={file({ fileType: "image/png", thumbnailKey: "thumb/x.png" }) as never} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/v1/workspaces/w1/files/f1/download");
    expect(img?.getAttribute("alt")).toBe("报告.pdf");
    expect(container.querySelector("svg.lucide-image")).toBeNull();
  });

  it("缩略图加载失败：回退到类型图标", () => {
    const { container } = render(
      <FileGridItem file={file({ fileType: "image/png", thumbnailKey: "thumb/x.png" }) as never} />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.lucide-image")).toBeTruthy();
  });

  it("无 thumbnailKey 的图片：直接出图标；非图片类型也不出 img", () => {
    const { container, unmount } = render(
      <FileGridItem file={file({ fileType: "image/png" }) as never} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.lucide-image")).toBeTruthy();
    unmount();

    const second = render(<FileGridItem file={file() as never} />);
    expect(second.container.querySelector("img")).toBeNull();
    expect(second.container.querySelector("svg.lucide-file-text")).toBeTruthy();
  });

  it("未提供 onSelect：不渲染复选框；提供时选中态切边框", () => {
    const { container, rerender } = render(<FileGridItem file={file() as never} />);
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    expect(container.querySelector('[role="gridcell"]')?.className).toContain(
      "border-[var(--border)]",
    );

    const onSelect = vi.fn();
    rerender(<FileGridItem file={file() as never} onSelect={onSelect} selected />);
    expect(container.querySelector('[role="gridcell"]')?.className).toContain(
      "border-[var(--accent)]",
    );
    fireEvent.click(container.querySelector('[role="checkbox"]')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("操作按钮：版本历史与删除互不干扰，且都不冒泡", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    const onVersions = vi.fn();
    const { getByLabelText, container } = render(
      <FileGridItem
        file={file() as never}
        onClick={onClick}
        onDelete={onDelete}
        onVersions={onVersions}
      />,
    );

    expect(container.textContent).toContain("2.0 KB");
    fireEvent.click(getByLabelText("files.fileGridItem:versionsAria"));
    fireEvent.click(getByLabelText("files.fileGridItem:deleteAria"));
    expect(onVersions).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("文件名走 title 提示且最多两行截断样式", () => {
    const { getByTitle } = render(<FileGridItem file={file() as never} />);
    expect(getByTitle("报告.pdf").className).toContain("line-clamp-2");
  });
});
