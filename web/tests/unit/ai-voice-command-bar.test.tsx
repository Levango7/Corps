// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * VoiceCommandBar 契约（components/ai/VoiceCommandBar.tsx）：
 *  1. 不支持 Web Speech API（window 无 SpeechRecognition）→ role=img + t("notSupported")
 *     降级提示，无录音按钮；挂载仍会 GET /api/v1/ai/voice/preferences 取识别语言
 *  2. 支持态：点麦克风新建 SpeechRecognition 实例（lang=偏好语言、interimResults、
 *     continuous=false）并 start()，状态变 recording（出现 t("stopRecording") 按钮）
 *  3. onresult → 实时转录渲染（final 累加 / interim 追加）
 *  4. onend 且有最终转录 → POST /api/v1/ai/voice/command {workspaceId, transcript} →
 *     渲染意图标签 / 置信度 / response / parameters；确认按钮 PATCH
 *     /api/v1/ai/voice/command/{id} {workspaceId, executed:true} → executed 标记；
 *     取消按钮清空结果与转录
 *  5. 空转录 onend 不发请求回 idle；onerror not-allowed → errorPermissionDenied，
 *     其他 → errorRecognition；POST 401/503/其他 → errorUnauthorized / errorAiNotConfigured / error
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

import { VoiceCommandBar } from "@/components/ai/VoiceCommandBar";

const WID = "ws-vc-1";

const COMMAND_RESULT = {
  id: "cmd-1",
  intent: "create_task",
  parameters: { title: "写周报" },
  confidence: 0.88,
  response: "已准备好创建任务",
  executed: false,
};

/** SpeechRecognition 测试替身：实例可从外部触发回调 */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognition.last = this;
  }
}

/** 构造组件消费的 results 结构：results[i][0].transcript + isFinal */
function recognitionEvent(entries: Array<{ transcript: string; isFinal: boolean }>) {
  return {
    resultIndex: 0,
    results: entries.map((e) => Object.assign([e], { isFinal: e.isFinal })),
  };
}

function installSpeech() {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
}

function uninstallSpeech() {
  const w = window as unknown as Record<string, unknown>;
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
}

interface ApiMap {
  pref?: { language?: string };
  command?: unknown;
  postError?: number;
}

function installApi(map: ApiMap = {}) {
  mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (path === "/api/v1/ai/voice/preferences") {
      return Promise.resolve(map.pref ?? {});
    }
    if (path === "/api/v1/ai/voice/command" && method === "POST") {
      if (map.postError) {
        return Promise.reject(new mocks.ApiError("失败", map.postError, map.postError));
      }
      const result = map.command ?? COMMAND_RESULT;
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    }
    if (path.startsWith("/api/v1/ai/voice/command/") && method === "PATCH") {
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`unexpected api: ${method} ${path}`));
  });
}

const postCalls = () =>
  mocks.api.mock.calls.filter(
    (c) =>
      String(c[0]) === "/api/v1/ai/voice/command" &&
      (c[1] as RequestInit | undefined)?.method === "POST",
  );

/** 点击麦克风并断言实例已 start()，返回实例以便触发回调 */
function clickMic() {
  fireEvent.click(screen.getByLabelText("ai.aiVoice:startRecording"));
  const rec = FakeRecognition.last;
  expect(rec).toBeTruthy();
  expect(rec!.start).toHaveBeenCalledTimes(1);
  return rec!;
}

/** 完整跑一轮：录音 → 最终转录 → 结束（触发命令解析） */
async function runCommand(transcript: string) {
  const rec = clickMic();
  await act(async () => {
    rec.onresult?.(recognitionEvent([{ transcript, isFinal: true }]));
  });
  await act(async () => {
    rec.onend?.();
  });
  return rec;
}

beforeEach(() => {
  mocks.api.mockReset();
  installSpeech();
  installApi();
});

afterEach(() => {
  uninstallSpeech();
  cleanup();
});

describe("VoiceCommandBar", () => {
  it("不支持 Web Speech API：降级提示（role=img + notSupported），无录音按钮，仍拉取偏好", async () => {
    uninstallSpeech();
    render(<VoiceCommandBar wid={WID} />);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "ai.aiVoice:notSupported" })).toBeInTheDocument(),
    );
    expect(screen.getByText("ai.aiVoice:notSupported")).toBeInTheDocument();
    expect(screen.queryByLabelText("ai.aiVoice:startRecording")).toBeFalsy();
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/voice/preferences");
  });

  it("挂载拉取偏好并把识别语言应用到 SpeechRecognition 实例（lang=偏好语言）", async () => {
    installApi({ pref: { language: "en-US" } });
    render(<VoiceCommandBar wid={WID} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    await act(async () => {}); // 等偏好 setState 落地

    const rec = clickMic();
    expect(rec.lang).toBe("en-US");
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(false);
  });

  it("点击麦克风进入 recording：start() 调用，按钮切换为 stopRecording", () => {
    render(<VoiceCommandBar wid={WID} />);
    clickMic();

    expect(screen.queryByLabelText("ai.aiVoice:startRecording")).toBeFalsy();
    expect(screen.getByLabelText("ai.aiVoice:stopRecording")).toBeInTheDocument();
  });

  it("onresult 实时转录：interim 先显示，final 累加覆盖", async () => {
    render(<VoiceCommandBar wid={WID} />);
    const rec = clickMic();

    await act(async () => {
      rec.onresult?.(recognitionEvent([{ transcript: "创建任", isFinal: false }]));
    });
    expect(screen.getByText("ai.aiVoice:transcript")).toBeInTheDocument();
    expect(screen.getByText("创建任")).toBeInTheDocument();

    await act(async () => {
      rec.onresult?.(recognitionEvent([{ transcript: "创建任务", isFinal: true }]));
    });
    expect(screen.getByText("创建任务")).toBeInTheDocument();
    expect(screen.queryByText("创建任")).toBeFalsy(); // exact 匹配不被子串误中
  });

  it("onend → POST /api/v1/ai/voice/command body 精确，渲染意图/置信度/响应/参数", async () => {
    render(<VoiceCommandBar wid={WID} />);
    await runCommand("创建任务");

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ workspaceId: WID, transcript: "创建任务" }),
    });
    expect(screen.getByText("ai.aiVoice:intentCreateTask")).toBeInTheDocument();
    expect(screen.getByText("ai.aiVoice:confidence: 88%")).toBeInTheDocument();
    expect(screen.getByText("已准备好创建任务")).toBeInTheDocument();
    expect(screen.getByText("ai.aiVoice:parameters", { exact: false })).toBeInTheDocument();
    expect(screen.getByText('{"title":"写周报"}')).toBeInTheDocument();
  });

  it("确认执行：PATCH /{id} {workspaceId, executed:true} → executed 标记替换确认按钮", async () => {
    render(<VoiceCommandBar wid={WID} />);
    await runCommand("创建任务");
    await screen.findByText("已准备好创建任务");

    fireEvent.click(screen.getByText("ai.aiVoice:confirm").closest("button")!);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/voice/command/cmd-1", {
        method: "PATCH",
        body: JSON.stringify({ workspaceId: WID, executed: true }),
      }),
    );
    expect(await screen.findByText("ai.aiVoice:executed")).toBeInTheDocument();
    expect(screen.queryByText("ai.aiVoice:confirm")).toBeFalsy();
    expect(screen.queryByText("ai.aiVoice:cancel")).toBeFalsy();
  });

  it("取消命令：结果与转录清空，回到 idle 录音按钮", async () => {
    render(<VoiceCommandBar wid={WID} />);
    await runCommand("创建任务");
    await screen.findByText("已准备好创建任务");

    fireEvent.click(screen.getByText("ai.aiVoice:cancel").closest("button")!);
    expect(screen.queryByText("已准备好创建任务")).toBeFalsy();
    expect(screen.queryByText("创建任务")).toBeFalsy();
    expect(screen.getByLabelText("ai.aiVoice:startRecording")).toBeInTheDocument();
  });

  it("空转录 onend：不发命令请求，直接回 idle", async () => {
    render(<VoiceCommandBar wid={WID} />);
    const rec = clickMic();
    await act(async () => {
      rec.onend?.();
    });

    expect(postCalls()).toHaveLength(0);
    expect(screen.getByLabelText("ai.aiVoice:startRecording")).toBeInTheDocument();
  });

  it("onerror not-allowed → errorPermissionDenied 文案并回 idle", async () => {
    render(<VoiceCommandBar wid={WID} />);
    const rec = clickMic();
    await act(async () => {
      rec.onerror?.({ error: "not-allowed" });
    });

    expect(screen.getByText("ai.aiVoice:errorPermissionDenied")).toBeInTheDocument();
    expect(screen.getByLabelText("ai.aiVoice:startRecording")).toBeInTheDocument();
  });

  it("onerror 其他错误 → errorRecognition 文案", async () => {
    render(<VoiceCommandBar wid={WID} />);
    const rec = clickMic();
    await act(async () => {
      rec.onerror?.({ error: "network" });
    });

    expect(screen.getByText("ai.aiVoice:errorRecognition")).toBeInTheDocument();
  });

  it("命令接口 401 → errorUnauthorized 文案", async () => {
    installApi({ postError: 401 });
    render(<VoiceCommandBar wid={WID} />);
    await runCommand("创建任务");

    await waitFor(() =>
      expect(screen.getByText("ai.aiVoice:errorUnauthorized")).toBeInTheDocument(),
    );
  });

  it("命令接口 503 → errorAiNotConfigured 文案", async () => {
    installApi({ postError: 503 });
    render(<VoiceCommandBar wid={WID} />);
    await runCommand("创建任务");

    await waitFor(() =>
      expect(screen.getByText("ai.aiVoice:errorAiNotConfigured")).toBeInTheDocument(),
    );
  });

  it("命令接口其他错误 → error 文案并回 idle", async () => {
    installApi({ command: new Error("boom") });
    render(<VoiceCommandBar wid={WID} />);
    await runCommand("创建任务");

    await waitFor(() => expect(screen.getByText("ai.aiVoice:error")).toBeInTheDocument());
    expect(screen.getByLabelText("ai.aiVoice:startRecording")).toBeInTheDocument();
  });
});
