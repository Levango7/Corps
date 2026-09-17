import { useTranslations } from "next-intl";

export default function OfflinePage() {
  const t = useTranslations("offline");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6" style={{ minHeight: "100dvh" }}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--elev-sm)]">
          <p className="text-[length:var(--text-lg)] font-[weight:var(--weight-medium)] text-[var(--fg)]">{t("title")}</p>
          <p className="mt-2 text-[length:var(--text-sm)] text-[var(--muted)]">{t("message")}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            {t("retry")}
          </button>
        </div>
      </div>
    </main>
  );
}