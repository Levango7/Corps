// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * TemplateEditor 契约（components/ai/TemplateEditor.tsx）：
 *  1. 创建模式（无 template）：标题 t("create")、空表单、单条默认步骤
 *     （capability=task-breakdown、config 文本 "{}"）；仅 1 步时删除按钮 disabled
 *  2. 编辑模式（传 template）：标题 t("edit")、字段预填、config 输入为
 *     JSON.stringify(config, null, 2)
 *  3. 步骤增删：addStep 追加（上限 50 步禁用添加）；removeStep 删除后剩 1 步时 disabled
 *  4. 提交校验：config 文本非法 JSON → t("error") 且不发请求；name/description
 *     为空 → t("error") 且不发请求
 *  5. 提交：无 template → POST /api/v1/ai/templates；有 template →
 *     PATCH /api/v1/ai/templates/{id}；body {wid?, name, description, category, steps,
 *     isPublic}（isPublic: wid 存在时取开关值，否则恒 true）；成功 → toast +
 *     onSaved + onClose；失败 → t("error") 且不关闭
 *  6. Escape 或点击遮罩 → onClose（提交中除外）
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
  onSaved: vi.fn(),
}));

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
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import TemplateEditor from "@/components/ai/TemplateEditor";

const WID = "ws-ate-1";
const NS = "ai.aiTemplate";

const TEMPLATE = {
  id: "tpl-1",
  name: "需求拆解模板",
  description: "把需求拆成可执行任务",
  category: "meeting",
  steps: [
    { name: "拆解步骤", capability: "task-breakdown", config: { maxTasks: 5 } },
    { name: "总结步骤", capability: "summarize", config: { lang: "zh" } },
  ],
  isPublic: true,
};

const nameInput = () => screen.getByLabelText(`${NS}:name`) as HTMLInputElement;
const descInput = () => screen.getByLabelText(`${NS}:description`) as HTMLTextAreaElement;
const stepName = (i: number) =>
  screen.getByLabelText(`${NS}:steps ${i + 1} ${NS}:name`) as HTMLInputElement;
const stepConfig = (i: number) =>
  screen.getByLabelText(`${NS}:steps ${i + 1} config`) as HTMLInputElement;
const removeBtns = () => screen.getAllByLabelText("button:delete");
const saveBtn = () => screen.getByText("button:save").closest("button") as HTMLButtonElement;

/** 创建模式填充必填字段（name/description/步骤 1 名称） */
function fillValidForm() {
  fireEvent.change(nameInput(), { target: { value: "新模板" } });
  fireEvent.change(descInput(), { target: { value: "模板描述" } });
  fireEvent.change(stepName(0), { target: { value: "第一步" } });
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onClose.mockReset();
  mocks.onSaved.mockReset();
});
afterEach(() => cleanup());

describe("TemplateEditor", () => {
  it("创建模式骨架：dialog 角色 + 标题 t('create')、空表单、单条默认步骤、删除按钮 disabled、无 public 开关", () => {
    // 不传 wid：无可见性开关（与"创建提交"用例区分）
    render(<TemplateEditor onClose={mocks.onClose} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(`${NS}:create`)).toBeTruthy();
    expect(nameInput().value).toBe("");
    expect(descInput().value).toBe("");
    expect((screen.getByLabelText(`${NS}:category`) as HTMLSelectElement).value).toBe("project");
    expect(stepName(0).value).toBe("");
    expect(stepConfig(0).value).toBe("{}");
    expect((screen.getByLabelText("capability") as HTMLSelectElement).value).toBe("task-breakdown");
    expect(removeBtns()[0]).toBeDisabled();
    expect(screen.queryByRole("switch")).toBeFalsy();
  });

  it("编辑模式预填：标题 t('edit')、字段与 config 文本（JSON.stringify 2 空格）回填、删除按钮可点", () => {
    render(<TemplateEditor wid={WID} template={TEMPLATE} onClose={mocks.onClose} />);

    expect(screen.getByText(`${NS}:edit`)).toBeTruthy();
    expect(nameInput().value).toBe("需求拆解模板");
    expect(descInput().value).toBe("把需求拆成可执行任务");
    expect((screen.getByLabelText(`${NS}:category`) as HTMLSelectElement).value).toBe("meeting");
    expect(stepName(0).value).toBe("拆解步骤");
    expect(stepName(1).value).toBe("总结步骤");
    // 单行 input 会做换行清洗，比较时归一化空白
    const compact = (s: string) => s.replace(/\s+/g, "");
    expect(compact(stepConfig(0).value)).toBe(compact(JSON.stringify({ maxTasks: 5 }, null, 2)));
    expect(compact(stepConfig(1).value)).toBe(compact(JSON.stringify({ lang: "zh" }, null, 2)));
    expect(removeBtns()).toHaveLength(2);
    expect(removeBtns()[0]).not.toBeDisabled();
  });

  it("addStep 追加空白步骤；removeStep 删除一条后剩 1 步时删除按钮 disabled", () => {
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} />);

    fireEvent.click(screen.getByText("button:add"));
    expect(stepName(1)).toBeTruthy();
    expect(stepConfig(1).value).toBe("{}");
    expect(removeBtns()).toHaveLength(2);

    fireEvent.click(removeBtns()[0]);
    expect(screen.queryByLabelText(`${NS}:steps 2 ${NS}:name`)).toBeFalsy();
    expect(stepName(0)).toBeTruthy();
    expect(removeBtns()[0]).toBeDisabled();
  });

  it("创建提交：POST /api/v1/ai/templates（body 含 wid/isPublic:false/steps 解析后 config）→ toast + onSaved + onClose", async () => {
    mocks.api.mockResolvedValue({});
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} onSaved={mocks.onSaved} />);
    fillValidForm();
    fireEvent.click(saveBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/templates", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        name: "新模板",
        description: "模板描述",
        category: "project",
        steps: [{ name: "第一步", capability: "task-breakdown", config: {} }],
        isPublic: false,
      }),
      signal: expect.any(AbortSignal),
    });
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:templateCreated`);
    expect(mocks.onSaved).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("编辑提交：PATCH /api/v1/ai/templates/{id}（多步 config 解析回对象）→ toast templateUpdated", async () => {
    mocks.api.mockResolvedValue({});
    render(
      <TemplateEditor
        wid={WID}
        template={TEMPLATE}
        onClose={mocks.onClose}
        onSaved={mocks.onSaved}
      />,
    );
    fireEvent.click(saveBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/ai/templates/${TEMPLATE.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        wid: WID,
        name: "需求拆解模板",
        description: "把需求拆成可执行任务",
        category: "meeting",
        steps: [
          { name: "拆解步骤", capability: "task-breakdown", config: { maxTasks: 5 } },
          { name: "总结步骤", capability: "summarize", config: { lang: "zh" } },
        ],
        isPublic: true,
      }),
      signal: expect.any(AbortSignal),
    });
    expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:templateUpdated`);
    expect(mocks.onSaved).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("config 文本非法 JSON → t('error') 错误条，不调 api 也不关闭", () => {
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} />);
    fillValidForm();
    fireEvent.change(stepConfig(0), { target: { value: "not-json" } });
    fireEvent.click(saveBtn());

    expect(screen.getByText(`${NS}:error`)).toBeTruthy();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("name/description 为空 → t('error')，不调 api", () => {
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} />);
    // 只填步骤名，name/description 留空
    fireEvent.change(stepName(0), { target: { value: "第一步" } });
    fireEvent.click(saveBtn());

    expect(screen.getByText(`${NS}:error`)).toBeTruthy();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("api 失败 → t('error') 错误条，onClose 不调用", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} />);
    fillValidForm();
    fireEvent.click(saveBtn());

    await waitFor(() => expect(screen.getByText(`${NS}:error`)).toBeTruthy());
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("isPublic 开关（传 wid 时出现）：点击切换 aria-checked，提交 body.isPublic 取开关值", async () => {
    mocks.api.mockResolvedValue({});
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");

    fillValidForm();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mocks.api.mock.calls[0][1] as { body: string }).body) as {
      isPublic: boolean;
    };
    expect(body.isPublic).toBe(true);
  });

  it("不传 wid：无 public 开关，提交 body 无 wid 键且 isPublic 恒 true", async () => {
    mocks.api.mockResolvedValue({});
    render(<TemplateEditor onClose={mocks.onClose} />);
    expect(screen.queryByRole("switch")).toBeFalsy();

    fillValidForm();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mocks.api.mock.calls[0][1] as { body: string }).body) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      name: "新模板",
      description: "模板描述",
      category: "project",
      steps: [{ name: "第一步", capability: "task-breakdown", config: {} }],
      isPublic: true,
    });
  });

  it("Escape 键与点击遮罩均触发 onClose", () => {
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("presentation"));
    expect(mocks.onClose).toHaveBeenCalledTimes(2);
  });

  it("编辑 config 文本后提交，解析结果进入 steps.config", async () => {
    mocks.api.mockResolvedValue({});
    render(<TemplateEditor wid={WID} onClose={mocks.onClose} />);
    fillValidForm();
    fireEvent.change(stepConfig(0), { target: { value: '{"limit":3}' } });
    fireEvent.click(saveBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mocks.api.mock.calls[0][1] as { body: string }).body) as {
      steps: { config: unknown }[];
    };
    expect(body.steps[0].config).toEqual({ limit: 3 });
  });
});
