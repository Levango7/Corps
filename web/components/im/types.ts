/**
 * 独立 IM 前端类型定义
 *
 * 与后端 Prisma 模型对齐的前端类型，供 IM 组件（ConversationList /
 * ChatWindow / MessageList 等）及 useIM hook 使用。
 *
 * 设计原则：
 *  - 字段命名与后端 API 响应一致（camelCase）。
 *  - 时间戳统一 ISO 8601 字符串，避免 Date 序列化歧义。
 *  - authorId/authorName 等可为 null，兼容用户注销后消息保留。
 *  - 嵌套对象（author/members/attachments）内联，减少组件间额外请求。
 */

/** 用户摘要（内联在会话成员和消息作者中） */
export interface UserSummary {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/** 会话成员 */
export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  /** 成员角色：owner（创建者）/ admin（管理员）/ member（普通成员） */
  role: "owner" | "admin" | "member";
  joinedAt: string;
  /** 最后已读时间戳；用于计算未读数 */
  lastReadAt: string | null;
  /** 是否静音 */
  muted: boolean;
  user: UserSummary;
}

/** 消息附件 */
export interface MessageAttachment {
  id: string;
  messageId: string;
  fileName: string;
  url: string;
  fileType: string;
  fileSize: number;
  thumbnailUrl: string | null;
}

/** 消息类型：text（普通文本）/ system（系统消息）/ call_invite（通话邀请）/ call_ended（通话结束）/ call_rejected（通话拒绝） */
export type MessageType = "text" | "system" | "call_invite" | "call_ended" | "call_rejected";

/** 单条消息 */
export interface Message {
  id: string;
  conversationId: string | null;
  authorId: string | null;
  author: UserSummary | null;
  body: string;
  /** 消息类型；默认 "text" */
  type: MessageType;
  createdAt: string;
  /** 编辑时间；null 表示未编辑 */
  editedAt: string | null;
  /** 撤回时间；null 表示未撤回 */
  revokedAt: string | null;
  /** 撤回操作者 ID */
  revokedBy: string | null;
  /** 回复的目标消息 ID */
  replyToId: string | null;
  /** 被回复的消息（可选内联） */
  replyTo?: Message | null;
  /** 提及的用户 ID 列表 */
  mentions: string[];
  attachments: MessageAttachment[];
  /** 通话邀请消息中的会议链接（仅 type=call_invite 时有值） */
  meetingUrl?: string;
}

/** 会话（对话） */
export interface Conversation {
  id: string;
  workspaceId: string;
  /** 会话类型：direct（单聊）/ group（群聊） */
  type: "direct" | "group";
  title: string | null;
  avatar: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** 最后一条消息时间；用于会话列表排序 */
  lastMessageAt: string | null;
  members: ConversationMember[];
  /** 消息列表（可选，选择会话后加载） */
  messages?: Message[];
  /** 未读消息数（由后端计算或前端根据 lastReadAt 推算） */
  unreadCount?: number;
  /** 是否还有更早的历史消息可加载（游标分页，由 useIM 维护） */
  hasMoreMessages?: boolean;
}

/** 发送消息时携带的附件（与 MessageInput.Attachment 结构对齐） */
export interface SendAttachment {
  id: string;
  fileName: string;
  url: string;
  fileType: string;
  fileSize: number;
  thumbnailUrl: string | null;
}

/** 发送消息的可选参数 */
export interface SendMessageOptions {
  /** 回复的消息 ID */
  replyToId?: string;
  /** 提及的用户 ID 列表 */
  mentions?: string[];
  /** 附件列表（由 MessageInput 上传后传入） */
  attachments?: SendAttachment[];
  /** 消息类型；默认 "text" */
  type?: MessageType;
}

/** 创建会话的参数 */
export interface CreateConversationParams {
  type: "direct" | "group";
  memberIds: string[];
  title?: string;
}