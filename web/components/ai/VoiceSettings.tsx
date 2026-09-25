"use client";

/**
 * 语音设置面板（方向 H）
 *
 * 功能：
 *  - 语言选择（zh-CN / en-US / ja-JP 等）
 *  - 语音速度滑块（0.5 - 2.0）
 *  - 唤醒词输入
 *  - 启用/禁用开关
 *  - 保存按钮 → PATCH /api/v1/ai/voice/preferences
 *
 * 数据来源：GET /api/v1/ai/voice/preferences
 * 样式：design token（var(--*)），lucide-react 图标 size 14/16
 * i18n：useTranslations("ai.aiVoice")
 *
 * 来源：方向 H 任务 7（VoiceSettings.tsx）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Volume2, Save, Loader2, AlertCircle, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 语音偏好（对应 /api/v1/ai/voice/preferences 响应） */
interface VoicePreference {
  id: string;
  language: string;
  voiceId: string | null;
  speed: number;
  wakeWord: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 语言选项 */
const LANGUAGE_OPTIONS = [
  { value: "zh-CN", labelKey: "languageZhCN" },
  { value: "en-US", labelKey: "languageEnUS" },
  { value: "ja-JP", labelKey: "languageJaJP" },
  { value: "ko-KR", labelKey: "languageKoKR" },
] as const;

export function VoiceSettings() {
  const t = useTranslations("ai.aiVoice");

  const [_pref, setPref] = useState<VoicePreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 编辑中的表单状态（与 pref 分离，保存前不写入 pref）
  const [language, setLanguage] = useState("zh-CN");
  const [speed, setSpeed] = useState(1.0);
  const [wakeWord, setWakeWord] = useState("");
  const [enabled, setEnabled] = useState(true);

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载偏好 */
  const loadPreference = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const data = await api<VoicePreference>("/api/v1/ai/voice/preferences", {
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setPref(data);
      setLanguage(data.language);
      setSpeed(data.speed);
      setWakeWord(data.wakeWord || t("defaultWakeWord"));
      setEnabled(data.enabled);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      setError(t("loadFailed"));
      if (process.env.NODE_ENV === "development") {
        console.error("[VoiceSettings] load error:", e);
      }
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void loadPreference();
    return () => abortRef.current?.abort();
  }, [loadPreference]);

  /** 保存偏好 */
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const data = await api<VoicePreference>("/api/v1/ai/voice/preferences", {
        method: "PATCH",
        body: JSON.stringify({ language, speed, wakeWord, enabled }),
      });
      setPref(data);
      setSaved(true);
      // 2 秒后清除"已保存"标记
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError(t("errorUnauthorized"));
      } else {
        setError(t("error"));
      }
      if (process.env.NODE_ENV === "development") {
        console.error("[VoiceSettings] save error:", e);
      }
    } finally {
      setSaving(false);
    }
  }, [language, speed, wakeWord, enabled, t]);

  // 加载态
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)]">
        <div className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("loading")}</div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]"
      aria-label={t("settingsTitle")}
    >
      {/* 标题 */}
      <header className="flex items-center gap-[var(--space-2)]">
        <Volume2 size={16} className="text-[var(--accent)]" />
        <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("settingsTitle")}
        </h2>
      </header>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--danger)]">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* 启用/禁用开关 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[var(--space-1)]">
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("enabled")}
          </span>
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {t("enabledDesc")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("enabled")}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[var(--radius-pill)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
            enabled ? "bg-[var(--accent)]" : "bg-[var(--surface-3)]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--accent-fg)] transition-transform duration-[var(--motion-fast)] ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* 语言选择 */}
      <div className="flex flex-col gap-[var(--space-2)]">
        <label
          htmlFor="voice-language"
          className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]"
        >
          {t("language")}
        </label>
        <select
          id="voice-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={!enabled}
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* 语音速度滑块 */}
      <div className="flex flex-col gap-[var(--space-2)]">
        <label
          htmlFor="voice-speed"
          className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]"
        >
          {t("speed")}
          <span className="ml-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
            {speed.toFixed(1)}x
          </span>
        </label>
        <input
          id="voice-speed"
          type="range"
          min={0.5}
          max={2.0}
          step={0.1}
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          disabled={!enabled}
          className="w-full accent-[var(--accent)] disabled:opacity-50"
          aria-label={t("speed")}
        />
      </div>

      {/* 唤醒词输入 */}
      <div className="flex flex-col gap-[var(--space-2)]">
        <label
          htmlFor="voice-wake-word"
          className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]"
        >
          {t("wakeWord")}
        </label>
        <input
          id="voice-wake-word"
          type="text"
          value={wakeWord}
          onChange={(e) => setWakeWord(e.target.value)}
          disabled={!enabled}
          maxLength={50}
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
          aria-label={t("wakeWord")}
        />
      </div>

      {/* 保存按钮 + 已保存标记 */}
      <div className="flex items-center gap-[var(--space-3)]">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !enabled}
          className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span>{saving ? t("saving") : t("save")}</span>
        </button>
        {saved && (
          <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--success)]">
            <Check size={14} />
            <span>{t("saved")}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default VoiceSettings;
