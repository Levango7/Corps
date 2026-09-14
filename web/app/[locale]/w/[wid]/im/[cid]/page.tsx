/**
 * 特定会话页面 · /w/[wid]/im/[cid]
 *
 * 服务端组件，直接打开指定会话。
 * - 用 useIM hook，selectConversation(cid)
 * - 左侧：ConversationList
 * - 右侧：ChatWindow（加载指定 cid 的会话）
 *
 * Next.js 16 页面组件为服务端组件，params 为 Promise，需 await 解包。
 * 客户端交互逻辑封装在 IMClient 中（通过 initialConversationId 指定初始会话）。
 */

import { IMClient } from "@/components/im/IMClient";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ wid: string; cid: string }>;
}) {
  const { wid, cid } = await params;
  return <IMClient workspaceId={wid} initialConversationId={cid} />;
}