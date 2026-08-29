/**
 * IM 升级：聊天相关共享类型
 *
 * 与后端 Prisma 模型对齐的前端类型定义，供 ChatPanel 及子组件使用。
 */

export interface Person {
  id: string;
  name: string | null;
  email: string;
  image?: string | null;
}

/** 消息已读记录 */
export interface MessageRead {
  userId: string;
  readAt: string;
}

/** 消息附件 */
export interface MessageAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

/** 聊天消息（含作者、已读列表、附件列表） */
export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  author: Person | null;
  reads?: MessageRead[];
  attachments?: MessageAttachment[];
}

/** 在线状态 */
export interface PresenceUser {
  userId: string;
  online: boolean;
}

/** SSE 推送的事件类型 */
export type ChatStreamEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "read"; messageId: string; userId: string; readAt: string }
  | { type: "presence"; taskId: string; userId: string; online: boolean }
  | { type: "ping" };

/** 上传附件元数据（attachments 端点返回） */
export interface AttachmentMeta {
  url: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  thumbnailUrl: string | null;
}
