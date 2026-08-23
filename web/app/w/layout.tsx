import { NextResponse } from "next/server";

export function generateMetadata({ params }: { params: Promise<{ wid: string }> }) {
  return {
    title: "corps · 工作台",
    description: "团队 SaaS - 任务看板",
  };
}

export default function WorkspaceRoot() {
  return null;
}
