/**
 * IM 主页面 · /w/[wid]/im
 *
 * 服务端组件，渲染客户端 IM 容器。
 * - 左侧：ConversationList（会话列表）
 * - 右侧：空状态提示 或 ChatWindow
 *
 * Next.js 16 页面组件为服务端组件，params 为 Promise，需 await 解包。
 * 客户端交互逻辑封装在 IMClient 中。
 */

import { IMClient } from "@/components/im/IMClient";

export default async function IMPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return <IMClient workspaceId={wid} />;
}