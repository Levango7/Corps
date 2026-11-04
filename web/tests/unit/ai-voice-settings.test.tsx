// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * VoiceSettings 契约（components/ai/VoiceSettings.tsx）：
 *  1. 挂载 GET /api/v1/ai/voice/preferences（带 AbortSignal）；loading 态文案 t("loading")
 *  2. 加载成功回填表单：语言 select / 速度 range(0.5-2.0, step 0.1) / 唤醒词 input /
 *     role="switch" 开关；唤醒词为空时回填 t("defaultWakeWord")；加载失败 → t("loadFailed")
 *  3. 保存 → PATCH /api/v1/ai/voice/preferences
 *     body {language, speed, wakeWord, enabled} 精确；保存中按钮变 t("saving") 且 disabled
 *  4. 保存成功 → t("saved") 标记出现，2 秒后（setTimeout 2000）自动消失；
 *     保存失败：401 → t("errorUnauthorized")，其他 → t("error")
 *  5. enabled=false 时 select/range/唤醒词/保存按钮均 disabled
 */

const mocks = vi.hoisted(() => {
  /** 与 @/lib/api 的 ApiError 同构（instanceof + status 分支用） */
  class HoistedApiError extends Error {
    status: number;
    code: number;
    constructor(message: string, status: number, code = status) {
      super(message);
      this.status = status;
      this.code = code;
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiError: HoistedApiError };
});

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
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiError }));

import { VoiceSettings } from "@/components/ai/VoiceSettings";

function prefFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "pref-1",
    language: "zh-CN",
    voiceId: null,
    speed: 1,
    wakeWord: "",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface ApiMap {
  pref?: unknown;
  patchError?: number;
}

function installApi(map: ApiMap = {}) {
  mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (path === "/api/v1/ai/voice/preferences" && method === "GET") {
      const pref = map.pref ?? prefFixture();
      return pref instanceof Error ? Promise.reject(pref) : Promise.resolve(pref);
    }
    if (path === "/api/v1/ai/voice/preferences" && method === "PATCH") {
      if (map.patchError) {
        return Promise.reject(new mocks.ApiError("失败", map.patchError, map.patchError));
      }
      return Promise.resolve(map.pref ?? prefFixture());
    }
    return Promise.reject(new Error(`unexpected api: ${method} ${path}`));
  });
}

const select = () => screen.getByLabelText("ai.aiVoice:language") as HTMLSelectElement;
const range = () => screen.getByLabelText("ai.aiVoice:speed") as HTMLInputElement;
const wakeWord = () => screen.getByLabelText("ai.aiVoice:wakeWord") as HTMLInputElement;
const switchBtn = () => screen.getByRole("switch");
const saveButton = () => screen.getByText("ai.aiVoice:save").closest("button") as HTMLButtonElement;
const patchCalls = () =>
  mocks.api.mock.calls.filter(
    (c) =>
      String(c[0]) === "/api/v1/ai/voice/preferences" &&
      (c[1] as RequestInit | undefined)?.method === "PATCH",
  );

/** 等加载完成（loading 消失、表单出现） */
async function loaded() {
  await screen.findByLabelText("ai.aiVoice:speed");
  expect(screen.queryByText("ai.aiVoice:loading")).toBeFalsy();
}

/** 点击保存并等 PATCH 请求落地（用于断言 body） */
async function clickSaveAndWait() {
  fireEvent.click(saveButton());
  await waitFor(() => expect(patchCalls()).toHaveLength(1));
}

beforeEach(() => {
  mocks.api.mockReset();
  installApi();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("VoiceSettings", () => {
  it("加载中：loading 文案，不渲染表单；加载完成后表单出现", async () => {
    let resolveGet!: (v: unknown) => void;
    mocks.api.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );
    render(<VoiceSettings />);
    expect(screen.getByText("ai.aiVoice:loading")).toBeInTheDocument();
    expect(screen.queryByLabelText("ai.aiVoice:speed")).toBeFalsy();

    await act(async () => {
      resolveGet(prefFixture());
    });
    await loaded();
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/v1/ai/voice/preferences",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("加载成功：GET URL 精确，表单回填语言/速度/唤醒词/开关初始值", async () => {
    installApi({
      pref: prefFixture({ language: "zh-CN", speed: 1.2, wakeWord: "小助手", enabled: true }),
    });
    render(<VoiceSettings />);
    await loaded();

    expect(mocks.api).toHaveBeenCalledWith(
      "/api/v1/ai/voice/preferences",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(select().value).toBe("zh-CN");
    expect(range().value).toBe("1.2");
    expect(screen.getByText("1.2x")).toBeInTheDocument();
    expect(wakeWord().value).toBe("小助手");
    expect(switchBtn().getAttribute("aria-checked")).toBe("true");
  });

  it("唤醒词为空时回填 defaultWakeWord 文案", async () => {
    render(<VoiceSettings />);
    await loaded();
    expect(wakeWord().value).toBe("ai.aiVoice:defaultWakeWord");
  });

  it("加载失败 → loadFailed 错误提示", async () => {
    installApi({ pref: new Error("load boom") });
    render(<VoiceSettings />);
    expect(await screen.findByText("ai.aiVoice:loadFailed")).toBeInTheDocument();
  });

  it("切换语言后保存：PATCH body 精确断言，saved 标记出现", async () => {
    render(<VoiceSettings />);
    await loaded();
    fireEvent.change(select(), { target: { value: "en-US" } });
    await clickSaveAndWait();

    expect(patchCalls()[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        language: "en-US",
        speed: 1,
        wakeWord: "ai.aiVoice:defaultWakeWord",
        enabled: true,
      }),
    });
    await waitFor(() => expect(screen.getByText("ai.aiVoice:saved")).toBeTruthy());
  });

  it("开关点击翻转 aria-checked（关闭时保存按钮禁用），恢复开启后保存 body enabled=true", async () => {
    render(<VoiceSettings />);
    await loaded();
    fireEvent.click(switchBtn());
    expect(switchBtn().getAttribute("aria-checked")).toBe("false");
    expect(saveButton()).toBeDisabled(); // !enabled 时不可保存

    fireEvent.click(switchBtn());
    expect(switchBtn().getAttribute("aria-checked")).toBe("true");
    await clickSaveAndWait();

    expect((patchCalls()[0]?.[1] as { body: string }).body).toContain('"enabled":true');
  });

  it("速度滑块调整显示 1.5x，保存 body speed=1.5", async () => {
    render(<VoiceSettings />);
    await loaded();
    fireEvent.change(range(), { target: { value: "1.5" } });
    expect(screen.getByText("1.5x")).toBeInTheDocument();
    await clickSaveAndWait();

    expect((patchCalls()[0]?.[1] as { body: string }).body).toContain('"speed":1.5');
  });

  it("保存成功后 saved 标记出现，2 秒后自动消失", async () => {
    render(<VoiceSettings />);
    await loaded();

    vi.useFakeTimers();
    try {
      fireEvent.click(saveButton());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("ai.aiVoice:saved")).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText("ai.aiVoice:saved")).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("保存中：按钮文案切为 saving 且 disabled；完成后恢复", async () => {
    let resolvePatch!: (v: unknown) => void;
    mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
      const method = (opts?.method ?? "GET").toUpperCase();
      if (method === "GET") return Promise.resolve(prefFixture());
      return new Promise((resolve) => {
        resolvePatch = resolve;
      });
    });
    render(<VoiceSettings />);
    await loaded();

    fireEvent.click(saveButton());
    expect(screen.getByText("ai.aiVoice:saving")).toBeInTheDocument();
    expect(screen.getByText("ai.aiVoice:saving").closest("button")).toBeDisabled();

    await act(async () => {
      resolvePatch(prefFixture());
    });
    await waitFor(() => expect(screen.getByText("ai.aiVoice:saved")).toBeTruthy());
    expect(screen.getByText("ai.aiVoice:save").closest("button")).not.toBeDisabled();
  });

  it("保存失败（非 401）→ error 文案", async () => {
    render(<VoiceSettings />);
    await loaded();
    mocks.api.mockRejectedValueOnce(new Error("save boom"));
    fireEvent.click(saveButton());

    expect(await screen.findByText("ai.aiVoice:error")).toBeInTheDocument();
    expect(screen.queryByText("ai.aiVoice:saved")).toBeFalsy();
  });

  it("保存 401 → errorUnauthorized 文案", async () => {
    render(<VoiceSettings />);
    await loaded();
    mocks.api.mockRejectedValueOnce(new mocks.ApiError("未授权", 401, 401));
    fireEvent.click(saveButton());

    expect(await screen.findByText("ai.aiVoice:errorUnauthorized")).toBeInTheDocument();
  });

  it("enabled=false：表单控件与保存按钮禁用", async () => {
    installApi({ pref: prefFixture({ enabled: false }) });
    render(<VoiceSettings />);
    await loaded();

    expect(switchBtn().getAttribute("aria-checked")).toBe("false");
    expect(select()).toBeDisabled();
    expect(range()).toBeDisabled();
    expect(wakeWord()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
  });
});
