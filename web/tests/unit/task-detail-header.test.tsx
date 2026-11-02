// @vitest-environment jsdom

/**
 * TaskDetailHeader 契约（components/task/TaskDetailHeader.tsx）：
 * 标题 textarea（受控 + 自动高度 + blur 保存守卫）、描述 textarea（blur 保存）、
 * 星标按钮、自动保存指示（saving / autosave）。
 * 标题/描述草稿与 dirty 均为父组件提升状态，本组件只回写。
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, afterEach, describe, it, expect } from "vitest";
import { TaskDetailHeader } from "@/components/task/TaskDetailHeader";
import type { Task, TaskPatch } from "@/components/task/types";

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

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "原始标题",
    description: "原始描述",
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

interface HarnessProps {
  task?: Task;
  titleDraft?: string;
  descDraft?: string;
  dirty?: boolean;
  saving?: boolean;
  starred?: boolean;
}

function renderHeader(props: HarnessProps = {}) {
  const titleDraft = props.titleDraft ?? props.task?.title ?? "原始标题";
  const descDraft = props.descDraft ?? props.task?.description ?? "原始描述";
  const onPatch = vi.fn();
  const onToggleFavorite = vi.fn();
  const setTitleDraft = vi.fn();
  const setDescDraft = vi.fn();
  const setDirty = vi.fn();
  // 普通对象即可满足 RefObject 契约（React 运行时对对象 ref 直接写 current）
  const titleRef: { current: HTMLTextAreaElement | null } = { current: null };
  const { rerender, container } = render(
    <TaskDetailHeader
      task={props.task ?? makeTask()}
      titleDraft={titleDraft}
      setTitleDraft={setTitleDraft}
      descDraft={descDraft}
      setDescDraft={setDescDraft}
      dirty={props.dirty ?? false}
      setDirty={setDirty}
      onPatch={onPatch}
      saving={props.saving ?? false}
      starred={props.starred ?? false}
      onToggleFavorite={onToggleFavorite}
      titleRef={titleRef}
    />,
  );
  const titleTextarea = container.querySelector<HTMLTextAreaElement>('textarea[rows="1"]')!;
  const descTextarea = container.querySelector<HTMLTextAreaElement>(
    "textarea[placeholder='task:detailDescriptionPlaceholder']",
  )!;
  return {
    rerender,
    container,
    onPatch,
    onToggleFavorite,
    setTitleDraft,
    setDescDraft,
    setDirty,
    titleRef,
    titleTextarea,
    descTextarea,
    rerenderWith(next: Partial<HarnessProps> & { task?: Task }) {
      rerender(
        <TaskDetailHeader
          task={next.task ?? props.task ?? makeTask()}
          titleDraft={next.titleDraft ?? titleDraft}
          setTitleDraft={setTitleDraft}
          descDraft={next.descDraft ?? descDraft}
          setDescDraft={setDescDraft}
          dirty={next.dirty ?? props.dirty ?? false}
          setDirty={setDirty}
          onPatch={onPatch}
          saving={next.saving ?? props.saving ?? false}
          starred={next.starred ?? props.starred ?? false}
          onToggleFavorite={onToggleFavorite}
          titleRef={titleRef}
        />,
      );
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TaskDetailHeader", () => {
  it("渲染标题草稿与描述占位文案", () => {
    const { titleTextarea, descTextarea } = renderHeader();
    expect(titleTextarea).toHaveValue("原始标题");
    expect(descTextarea).toHaveValue("原始描述");
    expect(descTextarea).toHaveAttribute("placeholder", "task:detailDescriptionPlaceholder");
  });

  it("标题变更回写 setTitleDraft 并置 dirty", () => {
    const { titleTextarea, setTitleDraft, setDirty } = renderHeader();
    fireEvent.change(titleTextarea, { target: { value: "改过的标题" } });
    expect(setTitleDraft).toHaveBeenCalledWith("改过的标题");
    expect(setDirty).toHaveBeenCalledWith(true);
  });

  it("描述变更回写 setDescDraft 并置 dirty", () => {
    const { descTextarea, setDescDraft, setDirty } = renderHeader();
    fireEvent.change(descTextarea, { target: { value: "新描述" } });
    expect(setDescDraft).toHaveBeenCalledWith("新描述");
    expect(setDirty).toHaveBeenCalledWith(true);
  });

  it("dirty=false 时标题 blur 不触发 patch", () => {
    const { titleTextarea, onPatch } = renderHeader({ titleDraft: "别的标题", dirty: false });
    fireEvent.blur(titleTextarea);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("dirty=true 且标题不同时 blur 触发 patch 并去除首尾空白", () => {
    const { titleTextarea, onPatch } = renderHeader({
      titleDraft: "  已修改标题  ",
      dirty: true,
    });
    fireEvent.blur(titleTextarea);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ title: "已修改标题" });
  });

  it("dirty=true 但标题与原值相同时 blur 不 patch", () => {
    const { titleTextarea, onPatch } = renderHeader({
      titleDraft: "原始标题",
      dirty: true,
    });
    fireEvent.blur(titleTextarea);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("dirty=true 但标题全为空白时 blur 不 patch", () => {
    const { titleTextarea, onPatch } = renderHeader({ titleDraft: "   ", dirty: true });
    fireEvent.blur(titleTextarea);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("描述 blur 时内容变化触发 patch（保留原值不 trim）", () => {
    const { descTextarea, onPatch } = renderHeader({ descDraft: "  修改后的描述  " });
    fireEvent.blur(descTextarea);
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0] as TaskPatch;
    expect(patch).toEqual({ description: "  修改后的描述  " });
  });

  it("描述 blur 时内容与原值相同不 patch", () => {
    const { descTextarea, onPatch } = renderHeader({ descDraft: "原始描述" });
    fireEvent.blur(descTextarea);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("description 为 null 时空描述 blur 不 patch，非空才 patch", () => {
    const task = makeTask({ description: null });
    const { descTextarea, rerenderWith, onPatch } = renderHeader({ task, descDraft: "" });
    fireEvent.blur(descTextarea);
    expect(onPatch).not.toHaveBeenCalled();
    rerenderWith({ descDraft: "补上的描述" });
    fireEvent.blur(descTextarea);
    expect(onPatch).toHaveBeenCalledWith({ description: "补上的描述" });
  });

  it("星标按钮 aria-label 随 starred 翻转，点击调用 onToggleFavorite", () => {
    const { rerenderWith, onToggleFavorite } = renderHeader({ starred: false });
    const star = screen.getByRole("button", { name: "task:star" });
    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    rerenderWith({ starred: true });
    expect(screen.getByRole("button", { name: "task:unstar" })).toBeInTheDocument();
  });

  it("saving=true 时显示 task:saving，否则显示 task:autosave", () => {
    const { rerenderWith } = renderHeader({ saving: true });
    expect(screen.getByText("task:saving")).toBeInTheDocument();
    rerenderWith({ saving: false });
    expect(screen.getByText("task:autosave")).toBeInTheDocument();
  });

  it("标题草稿变化时自动高度 effect 写入 style.height", () => {
    const { rerenderWith, titleRef } = renderHeader({ titleDraft: "原始标题" });
    // jsdom 中 scrollHeight 恒为 0，effect 会写入 "auto" 后再写入 "0px"
    expect(titleRef.current?.style.height).toBe("0px");
    rerenderWith({ titleDraft: "更高的标题换行\n第二行" });
    expect(titleRef.current?.style.height).toBe("0px");
  });
});
