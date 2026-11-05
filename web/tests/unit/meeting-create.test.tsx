// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiList: vi.fn() }));

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
vi.mock("@/lib/api", () => ({ api: mocks.api, apiList: mocks.apiList }));

import { MeetingCreate } from "@/components/meeting/MeetingCreate";

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
});
afterEach(() => cleanup());

/** 取表单控件：按 id 取（label 包 svg 且部分控件无 htmlFor，getByLabelText 不可靠） */
function field<T extends HTMLElement>(container: HTMLElement, id: string): T {
  const el = container.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** 提交表单（jsdom 不实现 requestSubmit，直接 dispatch submit 事件） */
function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("missing form");
  fireEvent.submit(form);
}

describe("MeetingCreate", () => {
  it("创建模式：渲染标题与提交按钮，不上屏预约/重复字段", () => {
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // 标题走 button:edit / meeting:create 两个 ns，创建模式取 meeting:create
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("meeting:create");
    expect(container.querySelector("#mc-scheduled")).toBeNull();
    expect(container.querySelector("#mc-recurring-freq")).toBeNull();
    // 默认类型 instant：三个类型按钮中只有 instant 处于按下态
    const pressed = container.querySelectorAll('button[aria-pressed="true"]');
    expect(pressed.length).toBe(1);
    expect(pressed[0]).toHaveTextContent("meeting:instant");
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("标题为空时提交按钮 disabled，挂载不发请求", () => {
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    const submit = screen.getByRole("button", { name: "meeting:create" });
    expect(submit).toBeDisabled();

    fireEvent.change(field(container, "mc-title"), { target: { value: "   " } });
    expect(submit).toBeDisabled();

    fireEvent.change(field(container, "mc-title"), { target: { value: "周会" } });
    expect(submit).toBeEnabled();
  });

  it("创建即时会议：POST 精确 URL + method + body（只带 title/type/recordingEnabled）", async () => {
    const onCreated = vi.fn();
    mocks.api.mockResolvedValue({ id: "m1", title: "周会" });
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={onCreated} />,
    );

    fireEvent.change(field(container, "mc-title"), { target: { value: "  周会  " } });
    submitForm(container);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "m1", title: "周会" }));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    const [path, opts] = mocks.api.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/workspaces/w1/meetings");
    expect(opts.method).toBe("POST");
    // 标题已 trim；description 为空不传；instant 不带 scheduledAt
    expect(JSON.parse(opts.body as string)).toEqual({
      title: "周会",
      type: "instant",
      recordingEnabled: false,
    });
  });

  it("预约会议 + 参与人数 + 描述 + 录制：body 带 ISO 时间的 scheduledAt", async () => {
    const onCreated = vi.fn();
    mocks.api.mockResolvedValue({ id: "m2", title: "评审" });
    const { container } = render(
      <MeetingCreate workspaceId="w7" onClose={vi.fn()} onCreated={onCreated} />,
    );

    fireEvent.change(field(container, "mc-title"), { target: { value: "评审" } });
    fireEvent.change(field(container, "mc-desc"), { target: { value: "  季度评审  " } });
    fireEvent.click(screen.getByRole("button", { name: "meeting:scheduled" }));
    fireEvent.change(field(container, "mc-scheduled"), { target: { value: "2030-05-06T10:30" } });
    fireEvent.change(field(container, "mc-max"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "meeting:recordingEnabled" }));
    submitForm(container);

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [path, opts] = mocks.api.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/workspaces/w7/meetings");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      title: "评审",
      type: "scheduled",
      description: "季度评审",
      maxParticipants: 25,
      recordingEnabled: true,
    });
    expect(body.scheduledAt).toBe(new Date("2030-05-06T10:30").toISOString());
  });

  it("重复会议：按频率生成 iCal RRULE 一并提交", async () => {
    mocks.api.mockResolvedValue({ id: "m3", title: "站会" });
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    fireEvent.change(field(container, "mc-title"), { target: { value: "站会" } });
    fireEvent.click(screen.getByRole("button", { name: "meeting:recurring" }));
    fireEvent.change(field(container, "mc-scheduled"), { target: { value: "2030-05-06T09:00" } });
    fireEvent.change(field(container, "mc-recurring-freq"), { target: { value: "weekly" } });
    submitForm(container);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mocks.api.mock.calls[0][1] as RequestInit).body as string);
    expect(body.type).toBe("recurring");
    expect(body.recurringRule).toBe("FREQ=WEEKLY;INTERVAL=1");
  });

  it("预约会议未填时间：本地拦截，不发请求并显示 scheduledAtRequired", async () => {
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    fireEvent.change(field(container, "mc-title"), { target: { value: "评审" } });
    fireEvent.click(screen.getByRole("button", { name: "meeting:scheduled" }));
    submitForm(container);

    expect(await screen.findByText("meeting:scheduledAtRequired")).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("会议密码两次不一致：本地拦截并要求重新输入", () => {
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    fireEvent.change(field(container, "mc-title"), { target: { value: "评审" } });
    fireEvent.change(field(container, "mc-password"), { target: { value: "abc123" } });
    fireEvent.change(field(container, "mc-password-confirm"), { target: { value: "abc124" } });
    submitForm(container);

    expect(screen.getByText("meeting:passwordMismatch")).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("密码一致：password 进 body，错误提示可手动关闭", async () => {
    mocks.api.mockResolvedValue({ id: "m4", title: "评审" });
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    fireEvent.change(field(container, "mc-title"), { target: { value: "评审" } });
    fireEvent.change(field(container, "mc-password"), { target: { value: " pass " } });
    fireEvent.change(field(container, "mc-password-confirm"), { target: { value: " pass " } });
    submitForm(container);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(JSON.parse((mocks.api.mock.calls[0][1] as RequestInit).body as string).password).toBe(
      "pass",
    );

    // 制造一个错误再关闭：两次密码不一致触发，然后点错误条里的关闭按钮
    cleanup();
    const second = render(<MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(field(second.container, "mc-title"), { target: { value: "评审" } });
    fireEvent.change(field(second.container, "mc-password"), { target: { value: "a" } });
    fireEvent.change(field(second.container, "mc-password-confirm"), { target: { value: "b" } });
    submitForm(second.container);
    expect(screen.getByText("meeting:passwordMismatch")).toBeInTheDocument();
    // 头部关闭按钮 + 错误条关闭按钮同 aria-label（button:close），取最后一个
    const closeButtons = screen.getAllByRole("button", { name: "button:close" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByText("meeting:passwordMismatch")).toBeNull();
  });

  it("编辑模式：PATCH 会议 URL，标题与初始值来自 props", async () => {
    const onCreated = vi.fn();
    mocks.api.mockResolvedValue({ id: "m9", title: "改名后" });
    const { container } = render(
      <MeetingCreate
        workspaceId="w1"
        onClose={vi.fn()}
        onCreated={onCreated}
        meeting={{
          id: "m9",
          title: "旧名",
          description: "旧描述",
          type: "scheduled",
          scheduledAt: "2030-01-02T03:04:00.000Z",
          maxParticipants: 12,
          recordingEnabled: true,
        }}
      />,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("button:edit");
    expect(field<HTMLInputElement>(container, "mc-title").value).toBe("旧名");
    expect(field<HTMLInputElement>(container, "mc-max").value).toBe("12");
    // type=scheduled 的初始值让预约时间字段直接上屏（截断到分钟）
    expect(field<HTMLInputElement>(container, "mc-scheduled").value).toBe("2030-01-02T03:04");

    fireEvent.change(field(container, "mc-title"), { target: { value: "改名后" } });
    submitForm(container);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "m9", title: "改名后" }));
    const [path, opts] = mocks.api.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/workspaces/w1/meetings/m9");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toMatchObject({ title: "改名后", type: "scheduled" });
  });

  it("提交失败：展示后端 e.message 并退回可再次提交", async () => {
    mocks.api.mockRejectedValue(new Error("会议数量已达上限"));
    const { container } = render(
      <MeetingCreate workspaceId="w1" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    fireEvent.change(field(container, "mc-title"), { target: { value: "评审" } });
    submitForm(container);

    expect(await screen.findByText("会议数量已达上限")).toBeInTheDocument();
    // submitting 在 finally 里复位：标题非空 → 按钮重新可用
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "meeting:create" })).toBeEnabled(),
    );
  });

  it("Esc 关闭：按下 Escape 调用 onClose，其他键不触发", () => {
    const onClose = vi.fn();
    render(<MeetingCreate workspaceId="w1" onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭，点击弹窗内部不关闭，取消按钮调用 onClose", () => {
    const onClose = vi.fn();
    render(<MeetingCreate workspaceId="w1" onClose={onClose} onCreated={vi.fn()} />);

    const backdrop = screen.getByRole("presentation");
    const dialog = screen.getByRole("dialog");

    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    // 事件会冒泡到遮罩：target !== currentTarget 时组件主动 return
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "button:cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
