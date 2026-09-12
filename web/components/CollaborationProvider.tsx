"use client";

/**
 * 协同编辑 Provider（Phase 2，对应 design/FEATURE-DESIGN-cloud-doc.md §3.1.3 / §3.4）。
 *
 * 职责：
 * - 创建 Yjs Doc + WebSocket Provider + IndexedDB Provider，生命周期与组件绑定。
 * - 通过 React Context 向子组件暴露 ydoc / wsProvider / indexeddbProvider / awareness。
 * - 维护连接状态（connecting / online / offline）与离线缓存加载状态，供 PresenceIndicator 消费。
 * - 设置 awareness user 信息（name / color / avatar），光标颜色基于用户 ID 哈希稳定分配。
 *
 * 设计取舍：
 * - "use client" 隔离：y-websocket / y-indexeddb 仅浏览器端可用，SSR 不初始化。
 * - 资源在 useEffect 中创建（保证浏览器环境），卸载时按 IndexedDB → WS → Doc 顺序 destroy，
 *   避免 WS 重连写入已销毁 Doc。
 * - 光标色板前 4 色复用语义 token（--accent/--success/--warn/--danger），后 4 色用
 *   --cursor-purple/pink/teal/orange，由下方 <style> 注入到 :root（与 design-tokens.css
 *   同模式：hex 仅出现在 token 定义处，使用处全走 var(--*)）。
 * - WS URL 默认读 NEXT_PUBLIC_COLLAB_WS_URL，未配置时回退 ws://localhost:1234（开发态）。
 * - access token 通过 props 传入（string 或取值函数），作为 ws 连接的 params.token，
 *   由 y-websocket 以 query string 发送，服务端按 token 鉴权。
 *
 * i18n 说明：本组件无面向用户文案。PresenceIndicator 的状态文案待后续补充到
 * messages/{en,zh}.json 的 collaboration 命名空间（受本次"不修改现有文件"约束暂未添加）。
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";

// ── 光标色板（§3.2.1）──────────────────────────────────────────────────────
// 前 4 色复用语义 token；后 4 色用自定义光标 token（在组件 <style> 中定义）。
// 使用处全走 var(--*)，hex 仅出现在下方 CURSOR_TOKEN_STYLE 的 token 定义处，
// 与 design-tokens.css 的模式一致。
const CURSOR_COLORS = [
  "var(--accent)", // 蓝
  "var(--success)", // 绿
  "var(--warn)", // 黄
  "var(--danger)", // 红
  "var(--cursor-purple)", // 紫
  "var(--cursor-pink)", // 粉
  "var(--cursor-teal)", // 青
  "var(--cursor-orange)", // 橙
] as const;

/**
 * 光标色 token 定义。仅此处出现 hex（token 定义点），与 design-tokens.css 同模式。
 * 注入到 :root，使用方通过 var(--cursor-*) 消费，无裸 hex 散落在样式中。
 */
const CURSOR_TOKEN_STYLE = `
:root {
  --cursor-purple: #8B5CF6;
  --cursor-pink: #EC4899;
  --cursor-teal: #14B8A6;
  --cursor-orange: #F97316;
}
`;

/**
 * 基于用户 ID 哈希生成稳定光标颜色（§3.2.1）。
 * 同一用户在任何客户端、任何文档中都拿到相同颜色，避免抖动。
 */
export function getUserColor(userId: string): string {
  const hash = userId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 协同用户信息（写入 awareness.user）。 */
export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  avatar?: string | null;
}

/** WS 连接状态。offline 表示已断开（可能正在指数退避重连）。 */
export type ConnectionStatus = "connecting" | "online" | "offline";

/** Awareness 实例类型，从 WebsocketProvider 实例属性推导，避免直接依赖 y-protocols。 */
export type CollaborationAwareness = InstanceType<typeof WebsocketProvider>["awareness"];

interface CollaborationContextValue {
  /** Yjs 文档，ProseMirror 内容挂在 ydoc.getXmlFragment("prosemirror")。 */
  ydoc: Y.Doc;
  /** y-websocket Provider，负责 CRDT 同步 + awareness 广播。 */
  wsProvider: WebsocketProvider;
  /** y-indexeddb Provider，负责离线持久化。 */
  indexeddbProvider: IndexeddbPersistence;
  /** WS Provider 的 awareness 实例，供 CollaborationCursor / PresenceIndicator 订阅。 */
  awareness: CollaborationAwareness;
  /** 当前用户信息（已写入 awareness）。 */
  user: CollaborationUser;
  /** WS 连接状态。 */
  connectionStatus: ConnectionStatus;
  /** 离线缓存是否已从 IndexedDB 加载完成（首次同步完成）。 */
  offlineSynced: boolean;
}

// ── Context ────────────────────────────────────────────────────────────────

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

/**
 * 消费协同上下文。必须在 <CollaborationProvider> 内调用。
 * 返回 ydoc / wsProvider / awareness 等，供 CollaborationCursor、PresenceIndicator
 * 或业务组件接入。
 */
export function useCollaboration(): CollaborationContextValue {
  const ctx = useContext(CollaborationContext);
  if (!ctx) {
    throw new Error("useCollaboration 必须在 <CollaborationProvider> 内使用");
  }
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────

interface CollaborationProviderProps {
  /** 文档 ID，作为 y-websocket roomname 与 IndexedDB 数据库 key。 */
  documentId: string;
  /** 当前用户基本信息（id 用于光标色哈希，name/avatar 写入 awareness）。 */
  user: { id: string; name: string; image?: string | null };
  /**
   * y-websocket 服务端地址。默认读 NEXT_PUBLIC_COLLAB_WS_URL，
   * 未配置回退 ws://localhost:1234（开发态）。
   */
  wsUrl?: string;
  /**
   * 访问令牌，作为 WS 连接的 params.token（y-websocket 以 query string 发送）。
   * 支持 string 或取值函数（函数在连接时求值，便于读取最新 token）。
   */
  token?: string | (() => string | null);
  /** ProseMirror 内容在 Yjs Doc 上的 field 名，默认 "prosemirror"。 */
  field?: string;
  children: ReactNode;
}

/** 默认 WS 服务端地址（开发态回退）。 */
const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "ws://localhost:1234";

export function CollaborationProvider({
  documentId,
  user,
  wsUrl,
  token,
  field = "prosemirror",
  children,
}: CollaborationProviderProps) {
  // 协同上下文对象在首次挂载时创建，卸载时销毁。
  // 用 ref 持有，避免 React 严格模式双调用 effect 时重复创建（effect 内做幂等守卫）。
  const ctxRef = useRef<CollaborationContextValue | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [offlineSynced, setOfflineSynced] = useState(false);

  // 稳定的用户信息（color 由 id 哈希得出），写入 awareness。
  const collabUser = useMemo<CollaborationUser>(
    () => ({
      id: user.id,
      name: user.name,
      color: getUserColor(user.id),
      avatar: user.image ?? null,
    }),
    [user.id, user.name, user.image],
  );

  // 解析 WS URL 与 token params（token 可能是函数，在创建 provider 时求值）。
  const resolvedWsUrl = wsUrl ?? DEFAULT_WS_URL;
  const tokenParams = useMemo(() => {
    if (token == null) return undefined;
    const tokenValue = typeof token === "function" ? token() : token;
    if (!tokenValue) return undefined;
    return { token: tokenValue };
  }, [token]);

  useEffect(() => {
    // ── 创建 Yjs Doc + Providers（仅浏览器端）──────────────────────────────
    const ydoc = new Y.Doc();

    // 离线持久化：IndexedDB key 与 WS roomname 都用 documentId，保证同一文档跨连接复用缓存。
    const indexeddbProvider = new IndexeddbPersistence(`doc-${documentId}`, ydoc);

    // WebSocket 协同：CRDT 同步 + awareness 广播。
    const wsProvider = new WebsocketProvider(
      resolvedWsUrl,
      documentId,
      ydoc,
      {
        // 显式开启连接（默认即 true，写出来便于未来按需 disable）。
        connect: true,
        // 透传 token params（undefined 时 y-websocket 忽略）。
        params: tokenParams,
      },
    );

    // 写入 awareness user 信息（光标颜色 / 名称 / 头像）。
    // CollaborationCursor 扩展自动维护 cursor 字段，这里只设置 user 元数据。
    wsProvider.awareness.setLocalStateField("user", {
      name: collabUser.name,
      color: collabUser.color,
      avatar: collabUser.avatar,
    });

    // ── 监听连接状态（y-websocket ObservableV2 'status' 事件）──────────────
    const handleStatus = (event: { status: "connected" | "disconnected" | "connecting" }) => {
      if (event.status === "connected") {
        setConnectionStatus("online");
      } else if (event.status === "disconnected") {
        setConnectionStatus("offline");
      } else {
        setConnectionStatus("connecting");
      }
    };
    wsProvider.on("status", handleStatus);

    // ── 监听离线缓存加载完成（IndexeddbPersistence 'synced' 事件）──────────
    const handleIdbSynced = () => {
      setOfflineSynced(true);
    };
    indexeddbProvider.on("synced", handleIdbSynced);

    // 暴露上下文（触发子组件 re-render 拿到 providers）。
    const ctxValue: CollaborationContextValue = {
      ydoc,
      wsProvider,
      indexeddbProvider,
      awareness: wsProvider.awareness,
      user: collabUser,
      connectionStatus: "connecting",
      offlineSynced: false,
    };
    ctxRef.current = ctxValue;
    // 强制更新一次，让 useCollaboration 拿到非 null 值。
    setInitialized((n) => n + 1);

    // ── cleanup：按 IndexedDB → WS → Doc 顺序销毁 ──────────────────────────
    // 先停 IndexedDB（停止向 Doc 写入），再断 WS（停止同步），最后销毁 Doc。
    return () => {
      wsProvider.off("status", handleStatus);
      indexeddbProvider.off("synced", handleIdbSynced);
      // 清除本地 awareness，让其他客户端看到本用户离线。
      try {
        wsProvider.awareness.setLocalState(null);
      } catch {
        // awareness 可能已随 provider 销毁，忽略。
      }
      void indexeddbProvider.destroy();
      wsProvider.destroy();
      ydoc.destroy();
      ctxRef.current = null;
    };
    // documentId / resolvedWsUrl / collabUser / tokenParams 变化时重建连接。
    // collabUser 由 user.id/name/image 派生，已 memo 化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, resolvedWsUrl, collabUser, tokenParams]);

  // 初始化完成标记（effect 内 setInitialized 触发首次渲染拿到 ctx）。
  const [, setInitialized] = useState(0);

  // 当前上下文值（合并最新 connectionStatus / offlineSynced）。
  const value = useMemo<CollaborationContextValue | null>(() => {
    const base = ctxRef.current;
    if (!base) return null;
    return {
      ...base,
      connectionStatus,
      offlineSynced,
    };
  }, [connectionStatus, offlineSynced]);

  return (
    <>
      {/* 光标色 token 注入（仅此处出现 hex，与 design-tokens.css 同模式） */}
      <style dangerouslySetInnerHTML={{ __html: CURSOR_TOKEN_STYLE }} />
      <CollaborationContext.Provider value={value}>
        {value ? children : null}
      </CollaborationContext.Provider>
    </>
  );
}

// ── 便捷 hook：在线用户列表 ────────────────────────────────────────────────
// 从 awareness 读取所有已上线用户（state.user 存在即视为在线）。
// 供 PresenceIndicator 使用，也方便业务组件直接消费。

/** awareness 中的用户元数据形态。 */
export interface AwarenessUser {
  name: string;
  color: string;
  avatar?: string | null;
}

/** awareness state 形态（user 元数据 + CollaborationCursor 维护的 cursor）。 */
export interface AwarenessState {
  user?: AwarenessUser;
  cursor?: { anchor: unknown; head: unknown } | null;
}

/**
 * 订阅 awareness 变化，返回在线用户列表（排除本地客户端）。
 * 在 <CollaborationProvider> 内使用。返回值按 clientID 排序保证稳定顺序。
 */
export function useOnlineUsers(): Array<{ clientId: number; user: AwarenessUser }> {
  const { awareness } = useCollaboration();
  const [users, setUsers] = useState<Array<{ clientId: number; user: AwarenessUser }>>([]);

  // awareness 引用稳定（同一 wsProvider 实例），effect 只订阅一次。
  const awarenessRef = useRef(awareness);
  awarenessRef.current = awareness;

  useEffect(() => {
    const compute = () => {
      const next: Array<{ clientId: number; user: AwarenessUser }> = [];
      awarenessRef.current.getStates().forEach((state: AwarenessState, clientId: number) => {
        if (state.user) {
          next.push({ clientId, user: state.user });
        }
      });
      next.sort((a, b) => a.clientId - b.clientId);
      setUsers(next);
    };

    compute();
    awarenessRef.current.on("change", compute);
    return () => {
      awarenessRef.current.off("change", compute);
    };
  }, [awareness]);

  return users;
}

// ── 便捷 hook：连接状态（带重连动作）──────────────────────────────────────

/**
 * 返回连接状态与手动重连方法。
 * offline 时调用 reconnect() 触发 wsProvider.connect()。
 */
export function useConnection() {
  const { wsProvider, connectionStatus } = useCollaboration();
  const reconnect = useCallback(() => {
    // y-websocket 内部已有指数退避重连，这里提供手动触发入口。
    wsProvider.connect();
  }, [wsProvider]);
  return { connectionStatus, reconnect };
}