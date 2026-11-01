// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

/**
 * 拖拽上传契约（components/files/FileUploader.tsx）：
 *  - compact：内联按钮；非 compact：拖拽区（role=button、Enter/Space 触发、拖拽态翻转）
 *  - 任务状态机：uploading（Loader2 + 百分比 + 无关闭按钮）→ done（Check + 大小 + 100%）
 *    或 error（AlertCircle + 服务端 message / 默认文案 / 网络错误）
 *  - XHR：POST 到 /api/v1/workspaces/{id}/files/upload，FormData 带 file + 可选 folderId
 *  - 全部任务结束后才回调 onUploadComplete（多文件并行只一次）；done/error 可移除任务
 */

interface FakeProgressEvent {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

class FakeXHR {
  status = 0;
  responseText = "";
  url = "";
  method = "";
  body: FormData | null = null;
  upload: { onprogress: ((e: FakeProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  opened = false;
  sent = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    this.opened = true;
    xhrState.instances.push(this);
  }

  send(body?: FormData | null) {
    this.body = body ?? null;
    this.sent = true;
  }

  fireProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }

  fireSuccess(status = 200, responseText = "{}") {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }

  fireError() {
    this.onerror?.();
  }
}

const xhrState = vi.hoisted(() => ({ instances: [] as FakeXHR[] }));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import { FileUploader } from "@/components/files/FileUploader";

const mkFile = (name = "a.png", size = 2048) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

const setFiles = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
};

const dropFiles = (el: HTMLElement, files: File[]) =>
  fireEvent.drop(el, {
    dataTransfer: { files },
  } as unknown as Parameters<typeof fireEvent.drop>[1]);

const flushAnd = async (x: FakeXHR, done: (x: FakeXHR) => void) => {
  await act(async () => {
    done(x);
  });
};

beforeEach(() => {
  document.body.innerHTML = "";
  xhrState.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FileUploader 触发区", () => {
  it("compact：内联按钮且无拖拽区；点击触发文件选择", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const { getByText, queryByRole, container } = render(<FileUploader workspaceId="w1" compact />);
    expect(getByText("files.fileUploader:upload")).toBeTruthy();
    expect(container.querySelector("svg.lucide-upload-cloud")).toBeTruthy();
    expect(queryByRole("button", { name: "files.fileUploader:dropAria" })).toBeNull();
    expect(
      queryByRole("button", { name: "files.fileUploader:upload" }) ??
        getByText("files.fileUploader:upload").closest("button"),
    ).toBeTruthy();

    fireEvent.click(getByText("files.fileUploader:upload").closest("button")!);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("非 compact：拖拽区语义与提示文案", () => {
    const { getByRole, getByText } = render(<FileUploader workspaceId="w1" />);
    const zone = getByRole("button", { name: "files.fileUploader:dropAria" });
    expect(zone.getAttribute("tabindex")).toBe("0");
    expect(getByText("files.fileUploader:clickOrDrop")).toBeTruthy();
    expect(getByText("files.fileUploader:hint")).toBeTruthy();
  });

  it("键盘：Enter 与 Space 都触发文件选择且阻止默认行为", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const { getByRole } = render(<FileUploader workspaceId="w1" />);
    const zone = getByRole("button", { name: "files.fileUploader:dropAria" });
    fireEvent.keyDown(zone, { key: "Enter" });
    fireEvent.keyDown(zone, { key: " " });
    expect(clickSpy).toHaveBeenCalledTimes(2);
    // 其他键不触发
    fireEvent.keyDown(zone, { key: "a" });
    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it("拖拽：dragOver 进态、dragLeave 出态（类名与文案翻转）", () => {
    const { getByRole, getByText, queryByText } = render(<FileUploader workspaceId="w1" />);
    const zone = getByRole("button", { name: "files.fileUploader:dropAria" });
    fireEvent.dragOver(zone);
    expect(zone.className).toContain("border-[var(--accent)]");
    expect(getByText("files.fileUploader:releaseToUpload")).toBeTruthy();
    fireEvent.dragLeave(zone);
    expect(zone.className).toContain("border-[var(--border)]");
    expect(queryByText("files.fileUploader:releaseToUpload")).toBeNull();
    expect(getByText("files.fileUploader:clickOrDrop")).toBeTruthy();
  });
});

describe("FileUploader 任务状态机", () => {
  it("input 选择文件后：uploading 任务 + 请求 URL/method/accept", async () => {
    const { container } = render(<FileUploader workspaceId="w1" folderId="fld-1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute("multiple")).toBe("");
    expect(input.getAttribute("accept")).toContain(".pdf");
    expect(input.getAttribute("accept")).toContain(".txt");

    setFiles(input, [mkFile()]);
    const li = container.querySelector("ul > li")!;
    expect(li.querySelector("svg.lucide-loader-2")).toBeTruthy();
    expect(li.textContent).toContain("a.png");
    expect(li.textContent).toContain("0%");
    // uploading 期间无关闭按钮
    expect(li.querySelector('[aria-label="files.fileUploader:removeAria"]')).toBeNull();

    expect(xhrState.instances).toHaveLength(1);
    const x = xhrState.instances[0];
    expect(x.method).toBe("POST");
    expect(x.url).toBe("/api/v1/workspaces/w1/files/upload");
    expect(x.body?.get("file")).toBeInstanceOf(File);
    expect(x.body?.get("folderId")).toBe("fld-1");
  });

  it("拖放也能发起上传（与 input 同路径）", async () => {
    const { getByRole, container } = render(<FileUploader workspaceId="w1" />);
    const zone = getByRole("button", { name: "files.fileUploader:dropAria" });
    dropFiles(zone, [mkFile("b.md")]);
    expect(container.querySelector("ul > li")?.textContent).toContain("b.md");
    expect(xhrState.instances).toHaveLength(1);
  });

  it("进度事件驱动百分比，完成后转 done：Check 图标 + 文件大小 + 100% 条 + onUploadComplete 一次", async () => {
    const onUploadComplete = vi.fn();
    const { container } = render(
      <FileUploader workspaceId="w1" onUploadComplete={onUploadComplete} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [mkFile("c.pdf", 2048)]);
    const x = xhrState.instances[0];

    await flushAnd(x, (xx) => xx.fireProgress(420, 1000));
    expect(container.querySelector("ul > li")?.textContent).toContain("42%");

    await flushAnd(x, (xx) => xx.fireSuccess(200, "{}"));
    const li = container.querySelector("ul > li")!;
    expect(li.querySelector("svg.lucide-check")).toBeTruthy();
    expect(li.querySelector("svg.lucide-loader-2")).toBeNull();
    expect(li.textContent).toContain("2.0 KB");
    expect(li.querySelector(".h-1 > div")?.getAttribute("style")).toContain("width: 100%");
    const removeBtn = li.querySelector('[aria-label="files.fileUploader:removeAria"]');
    expect(removeBtn).toBeTruthy();
    expect(onUploadComplete).toHaveBeenCalledTimes(1);
  });

  it("两文件并行：同时 uploading、各自独立完成，onUploadComplete 只在全部结束时一次", async () => {
    const onUploadComplete = vi.fn();
    const { container } = render(
      <FileUploader workspaceId="w1" onUploadComplete={onUploadComplete} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [mkFile("d.png"), mkFile("e.png")]);
    const [x1, x2] = xhrState.instances;
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);

    await flushAnd(x1, (xx) => xx.fireSuccess());
    // 只完成一个时还不通知父组件
    expect(onUploadComplete).toHaveBeenCalledTimes(0);
    const lis = container.querySelectorAll("ul > li");
    expect(lis[0].querySelector("svg.lucide-check")).toBeTruthy();
    expect(lis[1].querySelector("svg.lucide-loader-2")).toBeTruthy();

    await flushAnd(x2, (xx) => xx.fireSuccess());
    expect(onUploadComplete).toHaveBeenCalledTimes(1);
  });

  it("HTTP 错误且响应为 JSON：error 文案取服务端 message", async () => {
    const { container } = render(<FileUploader workspaceId="w1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [mkFile()]);
    await flushAnd(xhrState.instances[0], (x) =>
      x.fireSuccess(413, JSON.stringify({ message: "文件超过 50MB" })),
    );
    const li = container.querySelector("ul > li")!;
    expect(li.querySelector("svg.lucide-alert-circle")).toBeTruthy();
    expect(li.textContent).toContain("文件超过 50MB");
    expect(li.querySelector(".h-1 > div")?.getAttribute("style")).toContain("width: 100%");
    expect(li.querySelector(".h-1 > div")?.className).toContain("bg-[var(--danger)]");
    // 任务完成后出现关闭按钮
    expect(li.querySelector('[aria-label="files.fileUploader:removeAria"]')).toBeTruthy();
  });

  it("HTTP 错误且响应非 JSON：回退默认文案", async () => {
    const { container } = render(<FileUploader workspaceId="w1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [mkFile()]);
    await flushAnd(xhrState.instances[0], (x) => x.fireSuccess(500, "<html>oops</html>"));
    expect(container.querySelector("ul > li")?.textContent).toContain(
      "files.fileUploader:uploadFailed",
    );
  });

  it("网络错误（onerror）：networkError 文案", async () => {
    const { container } = render(<FileUploader workspaceId="w1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [mkFile()]);
    await flushAnd(xhrState.instances[0], (x) => x.fireError());
    const li = container.querySelector("ul > li")!;
    expect(li.textContent).toContain("files.fileUploader:networkError");
    expect(li.querySelector("svg.lucide-alert-circle")).toBeTruthy();
  });

  it("关闭按钮：done/error 可移除任务，uploading 不可", async () => {
    const { container } = render(<FileUploader workspaceId="w1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [mkFile()]);
    expect(container.querySelectorAll("ul > li")).toHaveLength(1);

    await flushAnd(xhrState.instances[0], (x) => x.fireSuccess());
    const li = container.querySelector("ul > li")!;
    fireEvent.click(li.querySelector('[aria-label="files.fileUploader:removeAria"]')!);
    expect(container.querySelectorAll("ul > li")).toHaveLength(0);
  });

  it("无 folderId：FormData 只含 file", async () => {
    const { container } = render(<FileUploader workspaceId="w1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(input, [mkFile()]);
    const x = xhrState.instances[0];
    expect(x.body?.get("file")).toBeInstanceOf(File);
    expect(x.body?.get("folderId")).toBeNull();
  });

  it("空文件列表：不创建任务也不回调", () => {
    const onUploadComplete = vi.fn();
    const { getByRole, container } = render(
      <FileUploader workspaceId="w1" onUploadComplete={onUploadComplete} />,
    );
    const zone = getByRole("button", { name: "files.fileUploader:dropAria" });
    dropFiles(zone, []);
    expect(container.querySelector("ul")).toBeNull();
    expect(onUploadComplete).not.toHaveBeenCalled();
  });
});
