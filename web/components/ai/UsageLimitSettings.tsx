"use client";

/**
 * AI 使用限额设置组件（管理员）（方向 G）
 *
 * 功能：
 *  - 显示当前限额配置（日/月 Token 限额 + 日/月调用次数限额）
 *  - 编辑限额值
 *  - 保存按钮调用 PUT /api/v1/ai/usage/limits
 *
 * 数据来源：
 *  - GET  /api/v1/ai/usage/limits?workspaceId=...
 *  - PUT  /api/v1/ai/usage/limits
 *
 * 样式：design token（var(--*)），lucide-react 图标 size 16
 * i18n：useTranslations("ai.usage")
 *
 * 来源：方向 G 任务 5（UsageLimitSettings.tsx）
 *       经验 2026-09-10-tailwind-v4-utility-class-to-design-token-migration
 *       （先读取 design-tokens.css 确认可用 token，不假设名称）
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Settings, Save, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

interface UsageLimitSettingsProps {
  /** 工作区 ID */
  wid: string;
}

/** 限额配置（对应 AiUsageLimit 模型） */
interface UsageLimit {
  id: string;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyCallLimit: number | null;
  monthlyCallLimit: number | null;
}

/** 编辑中的限额表单值（空字符串表示 null/不限制） */
interface LimitForm {
  dailyTokenLimit: string;
  monthlyTokenLimit: string;
  dailyCallLimit: string;
  monthlyCallLimit: string;
}

/** 将 null 转为空字符串用于表单输入 */
function toFormValue(v: number | null): string {
  return v == null ? "" : String(v);
}

/** 将表单字符串转为 number | null（空字符串 = null） */
function toLimitValue(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isNaN(n) || n < 0 ? null : Math.floor(n);
}

export function UsageLimitSettings({ wid }: UsageLimitSettingsProps) {
  const t = useTranslations("ai.usage");
  const { toast } = useToast();

  const [form, setForm] = useState<LimitForm>({
    dailyTokenLimit: "",
    monthlyTokenLimit: "",
    dailyCallLimit: "",
    monthlyCallLimit: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载当前限额配置 */
  const loadLimit = useCallback(async () => {
    // 中止之前未完成的请求
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const result = await api<UsageLimit | null>(
        `/api/v1/ai/usage/limits?workspaceId=${wid}`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      if (result) {
        setForm({
          dailyTokenLimit: toFormValue(result.dailyTokenLimit),
          monthlyTokenLimit: toFormValue(result.monthlyTokenLimit),
          dailyCallLimit: toFormValue(result.dailyCallLimit),
          monthlyCallLimit: toFormValue(result.monthlyCallLimit),
        });
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      // 不泄露 error.message，仅显示 i18n 文案
      setError(t("loadFailed"));
      if (process.env.NODE_ENV === "development") {
        console.error("[UsageLimitSettings] loadLimit error:", e);
      }
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }, [wid, t]);

  useEffect(() => {
    void loadLimit();
    // 组件卸载时中止进行中的请求
    return () => abortRef.current?.abort();
  }, [loadLimit]);

  /** 处理输入变更 */
  const handleChange = useCallback(
    (field: keyof LimitForm) => (e: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    },
    [],
  );

  /** 保存限额配置 */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api("/api/v1/ai/usage/limits", {
        method: "PUT",
        body: JSON.stringify({
          workspaceId: wid,
          userId: null,
          dailyTokenLimit: toLimitValue(form.dailyTokenLimit),
          monthlyTokenLimit: toLimitValue(form.monthlyTokenLimit),
          dailyCallLimit: toLimitValue(form.dailyCallLimit),
          monthlyCallLimit: toLimitValue(form.monthlyCallLimit),
        }),
      });
      toast("success", t("save"));
    } catch (e) {
      // 不泄露 error.message，仅显示 i18n 文案
      toast("error", t("saveFailed"));
      if (process.env.NODE_ENV === "development") {
        console.error("[UsageLimitSettings] handleSave error:", e);
      }
    } finally {
      setSaving(false);
    }
  }, [wid, form, t, toast]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)]">
        <Loader2
          size={16}
          className="animate-spin text-[var(--muted)]"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)]">
        <div className="text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-[var(--space-4)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]"
      aria-label={t("limitSettings")}
    >
      {/* 标题 */}
      <header className="flex items-center gap-[var(--space-2)]">
        <Settings size={16} className="text-[var(--accent)]" />
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("limitSettings")}
        </h1>
      </header>

      {/* 限额表单 */}
      <section className="flex flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-4)]">
        <LimitInput
          id="daily-token-limit"
          label={t("dailyTokenLimit")}
          value={form.dailyTokenLimit}
          onChange={handleChange("dailyTokenLimit")}
          placeholder={t("noLimit")}
        />
        <LimitInput
          id="monthly-token-limit"
          label={t("monthlyTokenLimit")}
          value={form.monthlyTokenLimit}
          onChange={handleChange("monthlyTokenLimit")}
          placeholder={t("noLimit")}
        />
        <LimitInput
          id="daily-call-limit"
          label={t("dailyCallLimit")}
          value={form.dailyCallLimit}
          onChange={handleChange("dailyCallLimit")}
          placeholder={t("noLimit")}
        />
        <LimitInput
          id="monthly-call-limit"
          label={t("monthlyCallLimit")}
          value={form.monthlyCallLimit}
          onChange={handleChange("monthlyCallLimit")}
          placeholder={t("noLimit")}
        />
      </section>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          {t("save")}
        </button>
      </div>
    </div>
  );
}

/** 限额输入行：标签 + 数字输入框 */
function LimitInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <label
        htmlFor={id}
        className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
      />
    </div>
  );
}