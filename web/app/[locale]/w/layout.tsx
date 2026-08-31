export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations({ locale, namespace: "nav" });
  return {
    title: t("metaWorkspaceTitle"),
    description: t("metaWorkspaceDesc"),
  };
}

export default function WorkspaceRoot({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
