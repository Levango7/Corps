// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * NewTaskDialog 组件单元测试
 *
 * 覆盖 web/components/NewTaskDialog.tsx：
 *  - 空标题时提交按钮 disabled
 *  - 标题 maxLength 限制（200 字符）
 *  - 正确调用 onCreated 回调（含创建后的参数）
 *  - 关闭时清空表单
 *  - open=false 不渲染
 *  - 关闭按钮 / 遮罩点击 / Escape 键关闭
 *  - 提交错误时显示错误信息
 *
 * 通过 vi.mock("@/lib/api") 隔离真实网络请求。
 */

// Mock api 模块，避免真实 HTTP 请求。
// vi.mock 工厂被 hoist 到文件顶部，不能引用外部变量，
// 需用 vi.hoisted 将 apiMock 也 hoist 到同层，使其在工厂执行时可用。
const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));
// i18n mock：useTranslations 按 zh.json 展平查表返回真实中文（t(key) → 中文），
// NextIntlClientProvider 退化为透传。render/rerender 均无需包 provider。
const { zhFlat } = vi.hoisted(() => {
  const req = process.getBuiltinModule("module").createRequire(
    process.cwd() + "/tests/unit/newtaskdialog.test.tsx",
  );
  const zh = req("../../messages/zh.json");
  const flat: Record<string, string> = {};
  const walk = (o: unknown, p = "") => {
    if (typeof o !== "object" || o === null) return;
    for (const [k, v] of Object.entries(o)) {
      const np = p ? `${p}.${k}` : k;
      if (typeof v === "object" && v !== null) walk(v, np);
      else flat[np] = String(v);
    }
  };
  walk(zh, "");
  return { zhFlat: flat };
});
vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useTranslations: (ns: string) => (key: string) => zhFlat[`${ns}.${key}`] ?? key,
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

import NewTaskDialog from "@/components/NewTaskDialog";

const WID = "ws-test-001";
const onClose = vi.fn();
const onCreated = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // 默认：按请求路由返回空列表（组件打开时并发拉取 members/labels/milestones 三个列表）
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === "POST") return Promise.resolve({ id: "task-1" });
    return Promise.resolve([]);
  });
});

afterEach(() => {
  cleanup();
});

/**
 * 按请求路由构造 apiMock。
 * 组件 v2 起打开时并发拉取 members/labels/milestones 三个列表，
 * 用例不得假设固定调用顺序；POST /tasks 的行为由 opts 显式指定。
 */
function routeApi(
  opts: {
    members?: unknown;
    labels?: unknown;
    milestones?: unknown;
    post?: unknown;
    postError?: Error;
  } = {},
) {
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (opts.postError) return Promise.reject(opts.postError);
      return Promise.resolve(opts.post ?? { id: "task-1" });
    }
    if (path.endsWith("/members")) return Promise.resolve(opts.members ?? []);
    if (path.endsWith("/labels")) return Promise.resolve(opts.labels ?? []);
    if (path.endsWith("/milestones")) return Promise.resolve(opts.milestones ?? []);
    return Promise.resolve([]);
  });
}

/** 取提交任务（POST）那次调用的 [path, init]，避免依赖固定调用序号 */
function findPostCall(): [string, RequestInit] {
  const call = apiMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
  if (!call) throw new Error("未找到 POST 创建调用");
  return call as [string, RequestInit];
}

/** 渲染打开状态的对话框（默认成员列表为空） */
function renderOpen(
  props: {
    members?: Array<{ id: string; name: string | null; email: string }>;
    labels?: unknown[];
    milestones?: unknown[];
  } = {},
) {
  // 仅当用例显式提供列表数据时才覆盖 mock，避免冲掉先设置的 POST 桩
  if (Object.keys(props).length > 0) routeApi(props);
  return render(<NewTaskDialog wid={WID} open={true} onClose={onClose} onCreated={onCreated} />);
}

describe("NewTaskDialog - 渲染控制", () => {
  it("open=false 时不渲染任何内容", () => {
    // Arrange & Act
    const { container } = render(
      <NewTaskDialog wid={WID} open={false} onClose={onClose} onCreated={onCreated} />,
    );

    // Assert
    expect(container).toBeEmptyDOMElement();
  });

  it("open=true 时渲染对话框与标题", () => {
    // Arrange & Act
    renderOpen();

    // Assert
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("新建任务")).toBeInTheDocument();
  });

  it("对话框具有 aria-modal='true'", () => {
    // Arrange & Act
    renderOpen();

    // Assert
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});

describe("NewTaskDialog - 空标题时提交按钮 disabled", () => {
  it("初始状态下提交按钮 disabled（标题为空）", () => {
    // Arrange & Act
    renderOpen();
    const submitButton = screen.getByRole("button", { name: /创建/ });

    // Assert
    expect(submitButton).toBeDisabled();
  });

  it("输入纯空格标题时提交按钮仍 disabled", () => {
    // Arrange
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const submitButton = screen.getByRole("button", { name: /创建/ });

    // Act
    fireEvent.change(titleInput, { target: { value: "   " } });

    // Assert
    expect(submitButton).toBeDisabled();
  });

  it("输入有效标题后提交按钮 enabled", () => {
    // Arrange
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const submitButton = screen.getByRole("button", { name: /创建/ });

    // Act
    fireEvent.change(titleInput, { target: { value: "有效任务标题" } });

    // Assert
    expect(submitButton).not.toBeDisabled();
  });

  it("输入后清空标题，提交按钮恢复 disabled", () => {
    // Arrange
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const submitButton = screen.getByRole("button", { name: /创建/ });

    // Act
    fireEvent.change(titleInput, { target: { value: "有标题" } });
    fireEvent.change(titleInput, { target: { value: "" } });

    // Assert
    expect(submitButton).toBeDisabled();
  });
});

describe("NewTaskDialog - 标题 maxLength 限制", () => {
  it("标题输入框 maxLength=200", () => {
    // Arrange & Act
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");

    // Assert
    expect(titleInput).toHaveAttribute("maxlength", "200");
  });

  it("输入 200 字符时不被截断", () => {
    // Arrange
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么") as HTMLInputElement;

    // Act
    const twoHundredChars = "a".repeat(200);
    fireEvent.change(titleInput, { target: { value: twoHundredChars } });

    // Assert
    expect(titleInput.value).toHaveLength(200);
  });

  it("描述输入框 maxLength=2000", () => {
    // Arrange & Act
    renderOpen();
    const descInput = screen.getByPlaceholderText("背景、验收标准，或粘贴相关链接…");

    // Assert
    expect(descInput).toHaveAttribute("maxlength", "2000");
  });
});

describe("NewTaskDialog - 正确调用 onCreated 回调", () => {
  it("提交成功后调用 onCreated 并传入创建结果", async () => {
    // Arrange
    const createdTask = { id: "task-new-001" };
    routeApi({ post: createdTask });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "新任务标题" } });
    fireEvent.submit(form);

    // Assert
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith(createdTask);
    });
  });

  it("提交成功后调用 onClose 关闭对话框", async () => {
    // Arrange
    routeApi({ post: { id: "task-1" } });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "任务" } });
    fireEvent.submit(form);

    // Assert
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("提交时 api 被以正确的 path 与 body 调用", async () => {
    // Arrange
    routeApi({ post: { id: "task-1" } });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "带标题的任务" } });
    fireEvent.submit(form);

    // Assert：创建任务那次调用（按 method 定位，不依赖固定序号）
    await waitFor(() => {
      const [path, init] = findPostCall();
      expect(path).toBe(`/api/v1/workspaces/${WID}/tasks`);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.title).toBe("带标题的任务");
      expect(body.status).toBe("todo");
      expect(body.priority).toBe("medium");
    });
  });

  it("标题前后空格在提交时被 trim", async () => {
    // Arrange
    routeApi({ post: { id: "task-1" } });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "  带空格的标题  " } });
    fireEvent.submit(form);

    // Assert
    await waitFor(() => {
      const [, init] = findPostCall();
      const body = JSON.parse(init.body as string);
      expect(body.title).toBe("带空格的标题");
    });
  });

  it("描述非空时包含在提交 body 中", async () => {
    // Arrange
    routeApi({ post: { id: "task-1" } });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const descInput = screen.getByPlaceholderText("背景、验收标准，或粘贴相关链接…");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "任务" } });
    fireEvent.change(descInput, { target: { value: "任务详细描述" } });
    fireEvent.submit(form);

    // Assert
    await waitFor(() => {
      const [, init] = findPostCall();
      const body = JSON.parse(init.body as string);
      expect(body.description).toBe("任务详细描述");
    });
  });

  it("描述为空时 body 中 description 为 undefined", async () => {
    // Arrange
    routeApi({ post: { id: "task-1" } });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "任务" } });
    fireEvent.submit(form);

    // Assert
    await waitFor(() => {
      const [, init] = findPostCall();
      const body = JSON.parse(init.body as string);
      expect(body.description).toBeUndefined();
    });
  });
});

describe("NewTaskDialog - 提交错误处理", () => {
  it("api 创建失败时显示错误信息且不调用 onCreated", async () => {
    // Arrange
    routeApi({ postError: new Error("创建失败：标题重复") });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "重复标题" } });
    fireEvent.submit(form);

    // Assert
    await waitFor(() => {
      expect(screen.getByText("创建失败：标题重复")).toBeInTheDocument();
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("错误后提交按钮恢复 enabled（可重试）", async () => {
    // Arrange
    routeApi({ postError: new Error("网络错误") });
    renderOpen();
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;

    // Act
    fireEvent.change(titleInput, { target: { value: "任务" } });
    fireEvent.submit(form);

    // Assert：错误后按钮不再 disabled
    await waitFor(() => {
      const submitButton = screen.getByRole("button", { name: /创建/ });
      expect(submitButton).not.toBeDisabled();
    });
  });
});

describe("NewTaskDialog - 关闭与表单清空", () => {
  it("点击关闭按钮（X）调用 onClose", () => {
    // Arrange
    renderOpen();
    const closeButton = screen.getByRole("button", { name: "关闭" });

    // Act
    fireEvent.click(closeButton);

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击取消按钮调用 onClose", () => {
    // Arrange
    renderOpen();
    const cancelButton = screen.getByRole("button", { name: "取消" });

    // Act
    fireEvent.click(cancelButton);

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("按 Escape 键调用 onClose", () => {
    // Arrange
    renderOpen();

    // Act
    fireEvent.keyDown(window, { key: "Escape" });

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("重新打开时表单被重置（标题为空）", () => {
    // Arrange：首次渲染输入标题
    const { rerender } = render(
      <NewTaskDialog wid={WID} open={true} onClose={onClose} onCreated={onCreated} />,
    );
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "残留标题" } });
    expect(titleInput.value).toBe("残留标题");

    // Act：关闭后重新打开
    rerender(<NewTaskDialog wid={WID} open={false} onClose={onClose} onCreated={onCreated} />);
    rerender(<NewTaskDialog wid={WID} open={true} onClose={onClose} onCreated={onCreated} />);

    // Assert：标题应被重置为空
    const titleInputAfter = screen.getByPlaceholderText("一句话说清要做什么") as HTMLInputElement;
    expect(titleInputAfter.value).toBe("");
  });

  it("重新打开时错误信息被清除", async () => {
    // Arrange：首次渲染触发错误
    routeApi({ postError: new Error("首次错误") });
    const { rerender } = render(
      <NewTaskDialog wid={WID} open={true} onClose={onClose} onCreated={onCreated} />,
    );
    const titleInput = screen.getByPlaceholderText("一句话说清要做什么");
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.change(titleInput, { target: { value: "任务" } });
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByText("首次错误")).toBeInTheDocument();
    });

    // Act：关闭后重新打开
    routeApi();
    rerender(<NewTaskDialog wid={WID} open={false} onClose={onClose} onCreated={onCreated} />);
    rerender(<NewTaskDialog wid={WID} open={true} onClose={onClose} onCreated={onCreated} />);

    // Assert：错误信息不再存在
    expect(screen.queryByText("首次错误")).not.toBeInTheDocument();
  });
});

describe("NewTaskDialog - 成员列表加载", () => {
  it("打开时拉取工作区成员列表并填充负责人下拉", async () => {
    // Arrange
    const members = [
      { id: "m1", name: "张三", email: "zhang@test.com" },
      { id: "m2", name: null, email: "li@test.com" },
    ];
    renderOpen({ members });

    // Assert：等待成员选项出现
    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
      // name 为 null 时回退到 email
      expect(screen.getByText("li@test.com")).toBeInTheDocument();
    });
  });

  it("成员列表拉取失败时静默处理（不阻塞对话框）", async () => {
    // Arrange
    apiMock.mockRejectedValueOnce(new Error("网络错误"));

    // Act & Assert：不应抛错，对话框仍正常渲染
    renderOpen();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    // 负责人下拉仍有"未指派"默认项
    expect(screen.getByText("未指派")).toBeInTheDocument();
  });
});

describe("NewTaskDialog - 状态与优先级选择", () => {
  it("状态默认为 todo（待办）", () => {
    // Arrange & Act
    renderOpen();
    const statusSelect = screen.getByDisplayValue("待办");

    // Assert
    expect(statusSelect).toBeInTheDocument();
  });

  it("优先级默认为 medium（中）", () => {
    // Arrange & Act
    renderOpen();
    const prioritySelect = screen.getByDisplayValue("中");

    // Assert
    expect(prioritySelect).toBeInTheDocument();
  });

  it("状态选项包含 4 种状态", () => {
    // Arrange & Act
    renderOpen();

    // Assert
    expect(screen.getByText("待办")).toBeInTheDocument();
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("评审")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("优先级选项包含 4 种优先级", () => {
    // Arrange & Act
    renderOpen();

    // Assert
    expect(screen.getByText("低")).toBeInTheDocument();
    expect(screen.getByText("中")).toBeInTheDocument();
    expect(screen.getByText("高")).toBeInTheDocument();
    expect(screen.getByText("紧急")).toBeInTheDocument();
  });
});
