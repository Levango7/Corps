// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * 文件预览模态契约（components/files/FilePreviewDialog.tsx）：
 *  - open=false → 不渲染任何内容；open=true → 原样透传给 FilePreview（url/fileName/fileType/onClose）
 *  - 本组件只做开关门控，不自己处理 ESC/遮罩（由内部 FilePreview 负责）
 */
vi.mock("@/components/files/FilePreview", () => ({
  FilePreview: (props: Record<string, unknown>) => (
    <div
      data-testid="file-preview-stub"
      data-url={String(props.url)}
      data-filename={String(props.fileName)}
      data-filetype={String(props.fileType)}
      data-onclose={typeof props.onClose}
    />
  ),
}));

import { FilePreviewDialog } from "@/components/files/FilePreviewDialog";

const file = {
  url: "https://x/a.pdf",
  fileName: "a.pdf",
  fileType: "pdf",
  onClose: vi.fn(),
};

describe("FilePreviewDialog", () => {
  it("open=false：不渲染", () => {
    const { container } = render(<FilePreviewDialog open={false} file={file as never} />);
    expect(container.firstChild).toBeNull();
  });

  it("open=true：FilePreview 收到完整 file 属性（含 onClose 引用）", () => {
    const { getByTestId } = render(<FilePreviewDialog open file={file as never} />);
    const stub = getByTestId("file-preview-stub");
    expect(stub.getAttribute("data-url")).toBe("https://x/a.pdf");
    expect(stub.getAttribute("data-filename")).toBe("a.pdf");
    expect(stub.getAttribute("data-filetype")).toBe("pdf");
    expect(stub.getAttribute("data-onclose")).toBe("function");
  });
});
