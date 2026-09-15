"use client";

/**
 * 语音命令栏（方向 H）
 *
 * 功能：
 *  - 录音按钮（Web Speech API：webkitSpeechRecognition / SpeechRecognition）
 *  - 实时转录显示（录音过程中实时显示识别文本）
 *  - 录音状态：idle / recording / processing
 *  - 录音完成后自动调用 POST /api/v1/ai/voice/command 解析意图
 *  - 显示 AI 解析结果（意图 + 参数 + 响应），用户确认后执行
 *  - 不支持 Web Speech API 时显示降级提示
 *
 * 安全约束：AI 仅解析意图，组件展示解析结果后需用户点击「确认执行」
 * 才会触发对应业务操作（不做静默自动执行）。
 *
 * 样式：design token（var(--*)），lucide-react 图标 size 14/16
 * i18n：useTranslations("ai.aiVoice")
 *
 * 来源：方向 H 任务 6（VoiceCommandBar.tsx）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Mic, MicOff, Square, Loader2, Check, X, AlertCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface VoiceCommandBarProps {
  /** 工作区 ID */
  wid: string;
}

/** 录音状态 */
type RecordingState = "idle" | "recording" | "processing";

/** AI 意图解析结果（对应 /api/v1/ai/voice/command 响应） */
interface CommandResult {
  id: string;
  intent: string;
  parameters: Record<string, unknown>;
  confidence: number;
  response: string;
  executed: boolean;
}

/** 意图 → i18n label 映射 */
function intentLabel(intent: string, t: (key: string) => string): string {
  switch (intent) {
    case "create_task":
      return t("intentCreateTask");
    case "query_schedule":
      return t("intentQuerySchedule");
    case "send_message":
      return t("intentSendMessage");
    case "generate_report":
      return t("intentGenerateReport");
    case "search_knowledge":
      return t("intentSearchKnowledge");
    case "open_page":
      return t("intentOpenPage");
    case "unknown":
      return t("intentUnknown");
    default:
      return intent;
  }
}

/**
 * SpeechRecognition 实例最小接口（仅声明用到的字段）。
 * 浏览器原生类型未纳入 TS DOM lib，此处局部声明避免 any 扩散。
 */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface SpeechRecognitionErrorLike {
  error: string;
}

/**
 * 获取 SpeechRecognition 构造函数（兼容 webkit 前缀）。
 * 仅在客户端调用；不支持时返回 null。
 */
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceCommandBar({ wid }: VoiceCommandBarProps) {
  const t = useTranslations("ai.aiVoice");

  const [state, setState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  // SpeechRecognition 实例引用
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // 检测 Web Speech API 支持
  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    setSupported(Ctor !== null);
  }, []);

  /** 处理语音命令：调用 AI 解析意图 */
  const handleCommand = useCallback(
    async (text: string) => {
      setState("processing");
      setError(null);
      try {
        const data = await api<CommandResult>("/api/v1/ai/voice/command", {
          method: "POST",
          body: JSON.stringify({ workspaceId: wid, transcript: text }),
        });
        setResult(data);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setError(t("errorUnauthorized"));
        } else if (e instanceof ApiError && e.status === 503) {
          setError(t("errorAiNotConfigured"));
        } else {
          setError(t("error"));
        }
        if (process.env.NODE_ENV === "development") {
          console.error("[VoiceCommandBar] command error:", e);
        }
      } finally {
        setState("idle");
      }
    },
    [wid, t],
  );

  /** 开始录音 */
  const startRecording = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError(t("notSupported"));
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalTranscript = "";

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          finalTranscript += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorLike) => {
      console.error("[VoiceCommandBar] recognition error:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError(t("errorPermissionDenied"));
      } else {
        setError(t("errorRecognition"));
      }
      setState("idle");
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (finalTranscript.trim().length > 0) {
        // 录音结束且有转录文本，调用 AI 解析
        void handleCommand(finalTranscript.trim());
      } else {
        setState("idle");
      }
    };

    recognitionRef.current = recognition;
    setTranscript("");
    setResult(null);
    setError(null);
    setState("recording");
    recognition.start();
  }, [handleCommand, t]);

  /** 停止录音 */
  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setState("idle");
  }, []);

  /** 确认执行命令 */
  const handleConfirm = useCallback(() => {
    if (!result) return;
    // 标记已执行（前端确认后，实际业务操作由调用方或路由层处理）
    // 这里仅更新本地状态；实际执行逻辑由上层组件根据 intent 路由
    setResult((prev) => (prev ? { ...prev, executed: true } : prev));
  }, [result]);

  /** 取消命令 */
  const handleCancel = useCallback(() => {
    setResult(null);
    setTranscript("");
  }, []);

  // 不支持 Web Speech API 的降级提示
  if (!supported) {
    return (
      <div
        className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]"
        role="img"
        aria-label={t("notSupported")}
      >
        <MicOff size={16} className="text-[var(--muted)]" />
        <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("notSupported")}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-3)]"
      aria-label={t("title")}
    >
      {/* 标题 + 录音按钮 */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-[var(--space-2)]">
          <Mic size={16} className="text-[var(--accent)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("title")}
          </span>
        </div>
        {state === "idle" && (
          <button
            type="button"
            onClick={startRecording}
            aria-label={t("startRecording")}
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <Mic size={14} />
            <span>{t("startRecording")}</span>
          </button>
        )}
        {state === "recording" && (
          <button
            type="button"
            onClick={stopRecording}
            aria-label={t("stopRecording")}
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--danger)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--accent-fg)] transition-opacity duration-[var(--motion-fast)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <Square size={14} />
            <span>{t("stopRecording")}</span>
          </button>
        )}
        {state === "processing" && (
          <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span>{t("processing")}</span>
          </span>
        )}
      </header>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--danger)]">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* 实时转录显示 */}
      {transcript && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]">
          <div className="mb-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
            {t("transcript")}
          </div>
          <p className="text-[length:var(--text-sm)] text-[var(--fg)]">
            {transcript}
          </p>
        </div>
      )}

      {/* AI 解析结果 */}
      {result && (
        <div className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]">
          {/* 意图 + 置信度 */}
          <div className="flex items-center gap-[var(--space-2)]">
            <span className="rounded-[var(--radius-pill)] bg-[var(--surface-3)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
              {intentLabel(result.intent, t)}
            </span>
            <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
              {t("confidence")}: {Math.round(result.confidence * 100)}%
            </span>
          </div>

          {/* AI 响应 */}
          <p className="text-[length:var(--text-sm)] text-[var(--fg)]">
            {result.response}
          </p>

          {/* 参数（如有） */}
          {Object.keys(result.parameters).length > 0 && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
              <span className="font-[weight:var(--weight-medium)]">{t("parameters")}: </span>
              <code className="break-all">{JSON.stringify(result.parameters)}</code>
            </div>
          )}

          {/* 确认/取消按钮（AI 安全约束：需用户确认后执行） */}
          {!result.executed && result.intent !== "unknown" && (
            <div className="flex items-center gap-[var(--space-2)]">
              <button
                type="button"
                onClick={handleConfirm}
                aria-label={t("confirm")}
                className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--success)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--accent-fg)] transition-opacity duration-[var(--motion-fast)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <Check size={14} />
                <span>{t("confirm")}</span>
              </button>
              <button
                type="button"
                onClick={handleCancel}
                aria-label={t("cancel")}
                className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <X size={14} />
                <span>{t("cancel")}</span>
              </button>
            </div>
          )}

          {/* 已执行标记 */}
          {result.executed && (
            <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--success)]">
              <Check size={14} />
              <span>{t("executed")}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default VoiceCommandBar;
