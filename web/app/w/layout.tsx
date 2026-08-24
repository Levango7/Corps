export function generateMetadata() {
  return {
    title: "corps · 工作台",
    description: "团队 SaaS - 任务看板",
  };
}

export default function WorkspaceRoot({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
