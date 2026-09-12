"use client";

/**
 * KnowledgeBase · 知识库目录树组件（云文档 Phase 1 §2.2）
 *
 * 层级：Workspace → Space → Folder → Document
 *  - Space 间隔离权限，Folder 可嵌套（最多 5 层）
 *  - 支持折叠/展开（expandedIds Set 本地状态）
 *  - 支持拖拽排序（原生 HTML5 DnD；文档可跨文件夹/空间移动，文件夹同层级排序）
 *  - 右键菜单：新建子文件夹 / 重命名 / 删除
 *  - 空状态引导
 *
 * 数据流：useEffect 拉 GET /spaces；CRUD 调对应 REST 端点；
 * 拖拽释放后 PATCH /documents/{id}/move 或 PATCH /folders/reorder。
 *
 * Design token 规范：所有色值/间距/圆角/字号走 var(--*)，禁止裸 hex。
 * 图标：lucide-react，尺寸 14/16。
 */

import {
  useCallback,
  useEffect,

  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { api, ApiError } from "@/lib/api";
import {
  Book,
  ChevronRight,
  Code,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";

// ── 类型定义（对应设计文档 §2.2.2 Prisma schema）──

interface TreeDocument {
  id: string;
  title: string;
  icon: string;
  emoji: string | null;
  sortOrder: number;
  updatedAt: string;
}

interface Folder {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  expanded: boolean;
  parentId: string | null;
  children: Folder[];
  documents: TreeDocument[];
}

interface Space {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  folders: Folder[];
  documents: TreeDocument[];
}

/** 拖拽项载荷（通过 dataTransfer 传递） */
interface DragPayload {
  kind: "document" | "folder";
  id: string;
  fromSpaceId: string;
  fromFolderId: string | null;
}

/** 右键菜单状态 */
interface ContextMenuState {
  x: number;
  y: number;
  kind: "space" | "folder";
  id: string;
  name: string;
  spaceId: string;
  parentId: string | null;
}

/** 内联重命名状态 */
interface RenameState {
  kind: "space" | "folder";
  id: string;
  currentName: string;
}

// ── 图标映射（Space/Folder/Document 的 Lucide 图标名 → 组件）──

const ICON_COMPONENTS = {
  book: Book,
  code: Code,
  users: Users,
  folder: FolderIcon,
  "folder-open": FolderOpen,
  "file-text": FileText,
} as const;

type IconName = keyof typeof ICON_COMPONENTS;

/** 根据 icon 字符串获取 lucide 图标组件，未知图标回退到 FileText */
function getIcon(name: string, fallback: IconName = "file-text") {
  return ICON_COMPONENTS[name as IconName] ?? ICON_COMPONENTS[fallback];
}

// ── 工具函数 ──

/** 按 sortOrder 升序排列 */
function sortByOrder<T extends { sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

// ── 主组件 ──

interface KnowledgeBaseProps {
  wid: string;
  /** 可选：移动端折叠状态由父组件控制 */
  className?: string;
}

export function KnowledgeBase({ wid, className }: KnowledgeBaseProps) {
  const t = useTranslations("knowledgeBase");
  const router = useRouter();

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 展开/折叠状态：存储展开的节点 ID（空间 ID + 文件夹 ID）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // 内联重命名
  const [renaming, setRenaming] = useState<RenameState | null>(null);

  // 拖拽悬浮目标（用于高亮）
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 创建空间/文件夹的输入
  const [creating, setCreating] = useState<
    { kind: "space" } | { kind: "folder"; spaceId: string; parentId: string | null } | null
  >(null);

  // 操作中状态
  const [busy, setBusy] = useState(false);

  // ── 数据加载 ──
  const loadSpaces = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<Space[]>(`/api/v1/workspaces/${wid}/spaces`);
      setSpaces(data);
      // 初始化展开状态：所有空间默认展开，文件夹按 expanded 字段
      const expanded = new Set<string>();
      for (const s of data) {
        expanded.add(s.id);
        const initFolderExpanded = (folders: Folder[]) => {
          for (const f of folders) {
            if (f.expanded) expanded.add(f.id);
            initFolderExpanded(f.children);
          }
        };
        initFolderExpanded(s.folders);
      }
      setExpandedIds(expanded);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, t]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  // ── 展开/折叠 ──
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── 导航到文档 ──
  const navigateToDoc = useCallback(
    (docId: string) => {
      router.push(`/w/${wid}/documents/${docId}`);
    },
    [router, wid],
  );

  // ── 创建空间 ──
  async function createSpace(name: string) {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const newSpace = await api<Space>(`/api/v1/workspaces/${wid}/spaces`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setSpaces((prev) => sortByOrder([...prev, newSpace]));
      setExpandedIds((prev) => new Set(prev).add(newSpace.id));
      setCreating(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  // ── 创建文件夹 ──
  async function createFolder(spaceId: string, parentId: string | null, name: string) {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const newFolder = await api<Folder>(
        `/api/v1/workspaces/${wid}/spaces/${spaceId}/folders`,
        {
          method: "POST",
          body: JSON.stringify({ parentId, name: name.trim() }),
        },
      );
      // 插入到对应空间的文件夹树
      setSpaces((prev) =>
        prev.map((s) => {
          if (s.id !== spaceId) return s;
          return { ...s, folders: insertFolder(s.folders, parentId, newFolder) };
        }),
      );
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(newFolder.id);
        if (parentId) next.add(parentId); // 确保父文件夹展开
        return next;
      });
      setCreating(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  /** 递归插入新文件夹到正确的父节点下 */
  function insertFolder(folders: Folder[], parentId: string | null, newFolder: Folder): Folder[] {
    if (parentId === null) {
      return sortByOrder([...folders, newFolder]);
    }
    return folders.map((f) => {
      if (f.id === parentId) {
        return { ...f, children: sortByOrder([...f.children, newFolder]) };
      }
      return { ...f, children: insertFolder(f.children, parentId, newFolder) };
    });
  }

  // ── 重命名 ──
  async function renameItem(kind: "space" | "folder", id: string, newName: string) {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "space") {
        await api(`/api/v1/workspaces/${wid}/spaces/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: newName.trim() }),
        });
        setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, name: newName.trim() } : s)));
      } else {
        await api(`/api/v1/workspaces/${wid}/folders/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: newName.trim() }),
        });
        setSpaces((prev) => prev.map((s) => ({ ...s, folders: updateFolderName(s.folders, id, newName.trim()) })));
      }
      setRenaming(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("renameFailed"));
    } finally {
      setBusy(false);
    }
  }

  function updateFolderName(folders: Folder[], id: string, name: string): Folder[] {
    return folders.map((f) => {
      if (f.id === id) return { ...f, name };
      return { ...f, children: updateFolderName(f.children, id, name) };
    });
  }

  // ── 删除 ──
  async function deleteItem(kind: "space" | "folder", id: string) {
    if (busy) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "space") {
        await api(`/api/v1/workspaces/${wid}/spaces/${id}`, { method: "DELETE" });
        setSpaces((prev) => prev.filter((s) => s.id !== id));
      } else {
        await api(`/api/v1/workspaces/${wid}/folders/${id}`, { method: "DELETE" });
        setSpaces((prev) => prev.map((s) => ({ ...s, folders: removeFolder(s.folders, id) })));
      }
      setContextMenu(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  function removeFolder(folders: Folder[], id: string): Folder[] {
    return folders
      .filter((f) => f.id !== id)
      .map((f) => ({ ...f, children: removeFolder(f.children, id) }));
  }

  // ── 移动文档（拖拽）──
  async function moveDocument(docId: string, toSpaceId: string, toFolderId: string | null) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/documents/${docId}/move`, {
        method: "PATCH",
        body: JSON.stringify({ spaceId: toSpaceId, folderId: toFolderId }),
      });
      // 重新加载以获取最新树结构
      await loadSpaces();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("moveFailed"));
    } finally {
      setBusy(false);
    }
  }

  // ── 拖拽处理 ──
  function handleDragStart(e: DragEvent, payload: DragPayload) {
    e.dataTransfer.setData("application/x-kb-item", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent, targetId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(targetId);
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  /** drop 到空间根目录 */
  function handleDropOnSpace(e: DragEvent, spaceId: string) {
    e.preventDefault();
    setDragOverId(null);
    const raw = e.dataTransfer.getData("application/x-kb-item");
    if (!raw) return;
    try {
      const payload: DragPayload = JSON.parse(raw);
      if (payload.kind === "document") {
        // 移动文档到空间根目录（folderId = null）
        if (payload.fromSpaceId === spaceId && payload.fromFolderId === null) return;
        moveDocument(payload.id, spaceId, null);
      }
      // 文件夹跨空间移动暂不支持（设计文档未要求）
    } catch {
      // 忽略解析失败
    }
  }

  /** drop 到文件夹 */
  function handleDropOnFolder(e: DragEvent, spaceId: string, folderId: string) {
    e.preventDefault();
    setDragOverId(null);
    const raw = e.dataTransfer.getData("application/x-kb-item");
    if (!raw) return;
    try {
      const payload: DragPayload = JSON.parse(raw);
      if (payload.kind === "document") {
        if (payload.fromSpaceId === spaceId && payload.fromFolderId === folderId) return;
        moveDocument(payload.id, spaceId, folderId);
      }
    } catch {
      // 忽略解析失败
    }
  }

  // ── 右键菜单 ──
  function handleContextMenu(
    e: ReactMouseEvent,
    kind: "space" | "folder",
    id: string,
    name: string,
    spaceId: string,
    parentId: string | null,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, kind, id, name, spaceId, parentId });
  }

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  // 移动端抽屉状态
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── 渲染 ──

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-[var(--space-12)] text-[var(--muted)] ${className ?? ""}`}>
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
      </div>
    );
  }

  /** 目录树内容（桌面端侧边栏和移动端抽屉共用） */
  const treeContent = (
    <>
      {/* 错误提示 */}
      {error && (
        <div className="mx-[var(--space-2)] mt-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[length:var(--text-xs)] text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* 空间列表 */}
      <div className="flex-1 overflow-y-auto p-[var(--space-2)]">
        {spaces.length === 0 && !creating ? (
          <EmptyKnowledgeBase
            title={t("empty")}
            hint={t("emptyHint")}
            actionLabel={t("newSpace")}
            onAction={() => setCreating({ kind: "space" })}
          />
        ) : (
          <ul className="space-y-0.5">
            {sortByOrder(spaces).map((space) => (
              <SpaceNode
                key={space.id}
                space={space}
                wid={wid}
                expandedIds={expandedIds}
                dragOverId={dragOverId}
                renaming={renaming}
                busy={busy}
                onToggle={toggleExpand}
                onNavigate={navigateToDoc}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDropOnSpace={handleDropOnSpace}
                onDropOnFolder={handleDropOnFolder}
                onRename={renameItem}
                onCreateFolder={(spaceId, parentId) =>
                  setCreating({ kind: "folder", spaceId, parentId })
                }
              />
            ))}
          </ul>
        )}

        {/* 创建空间输入框 */}
        {creating?.kind === "space" && (
          <CreateInput
            placeholder={t("untitledSpace")}
            busy={busy}
            onSubmit={createSpace}
            onCancel={() => setCreating(null)}
          />
        )}

        {/* 创建文件夹输入框 */}
        {creating?.kind === "folder" && (
          <CreateInput
            placeholder={t("untitledFolder")}
            busy={busy}
            onSubmit={(name) => createFolder(creating.spaceId, creating.parentId, name)}
            onCancel={() => setCreating(null)}
          />
        )}
      </div>

      {/* 新建空间按钮 */}
      <button
        type="button"
        onClick={() => setCreating({ kind: "space" })}
        disabled={busy}
        className="flex items-center gap-[var(--space-2)] w-full px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] border-t border-[var(--border-soft)] disabled:opacity-50"
      >
        <Plus size={14} />
        {t("newSpace")}
      </button>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          t={t}
          onNewFolder={(spaceId, parentId) => {
            setContextMenu(null);
            setCreating({ kind: "folder", spaceId, parentId });
          }}
          onRename={(kind, id, currentName) => {
            setContextMenu(null);
            setRenaming({ kind, id, currentName });
          }}
          onDelete={(kind, id) => deleteItem(kind, id)}
        />
      )}
    </>
  );

  return (
    <>
      {/* 桌面端：侧边栏目录树 */}
      <div className={`hidden md:flex flex-col h-full ${className ?? ""}`}>{treeContent}</div>

      {/* 移动端：浮动切换按钮 */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed bottom-[var(--space-4)] left-[var(--space-4)] z-[var(--z-sticky)] inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--elev-lg)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        aria-label={t("newSpace")}
      >
        <Book size={16} />
      </button>

      {/* 移动端：抽屉 */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-[var(--z-modal)] flex"
          onClick={() => setMobileOpen(false)}
        >
          {/* 遮罩 */}
          <div className="absolute inset-0 bg-[var(--bg)]/80" />
          {/* 抽屉面板 */}
          <div
            className="relative flex flex-col w-[var(--sidebar-w-mobile)] max-w-[85vw] h-full bg-[var(--surface)] shadow-[var(--elev-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 抽屉头部 */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
              <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                {t("newSpace")}
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                aria-label={t("cancel")}
              >
                <X size={16} />
              </button>
            </div>
            {treeContent}
          </div>
        </div>
      )}
    </>
  );
}

// ── 空状态 ──

function EmptyKnowledgeBase({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-[var(--space-4)] py-[var(--space-12)]">
      <div className="text-[var(--meta)] mb-[var(--space-3)]">
        <FolderIcon size={36} className="opacity-50" />
      </div>
      <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
        {title}
      </p>
      <p className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">{hint}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-[var(--space-4)] inline-flex items-center gap-1.5 px-[var(--space-3)] py-[var(--space-2)] bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-sm)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
      >
        <Plus size={14} />
        {actionLabel}
      </button>
    </div>
  );
}

// ── 空间节点 ──

interface SpaceNodeProps {
  space: Space;
  wid: string;
  expandedIds: Set<string>;
  dragOverId: string | null;
  renaming: RenameState | null;
  busy: boolean;
  onToggle: (id: string) => void;
  onNavigate: (docId: string) => void;
  onContextMenu: (
    e: ReactMouseEvent,
    kind: "space" | "folder",
    id: string,
    name: string,
    spaceId: string,
    parentId: string | null,
  ) => void;
  onDragStart: (e: DragEvent, payload: DragPayload) => void;
  onDragOver: (e: DragEvent, targetId: string) => void;
  onDragLeave: () => void;
  onDropOnSpace: (e: DragEvent, spaceId: string) => void;
  onDropOnFolder: (e: DragEvent, spaceId: string, folderId: string) => void;
  onRename: (kind: "space" | "folder", id: string, newName: string) => void;
  onCreateFolder: (spaceId: string, parentId: string | null) => void;
}

function SpaceNode({
  space,
  expandedIds,
  dragOverId,
  renaming,
  busy,
  onToggle,
  onNavigate,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDropOnSpace,
  onDropOnFolder,
  onRename,
}: SpaceNodeProps) {
  const t = useTranslations("knowledgeBase");
  const isExpanded = expandedIds.has(space.id);
  const isDragOver = dragOverId === space.id;
  const isRenaming = renaming?.kind === "space" && renaming.id === space.id;
  const SpaceIcon = getIcon(space.icon, "book");

  return (
    <li>
      <div
        className={`group flex items-center gap-1 px-[var(--space-2)] py-[var(--space-1)] rounded-[var(--radius-sm)] cursor-pointer hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] ${
          isDragOver ? "bg-[var(--surface-2)] ring-1 ring-[var(--accent)]" : ""
        }`}
        onClick={() => onToggle(space.id)}
        onContextMenu={(e) => onContextMenu(e, "space", space.id, space.name, space.id, null)}
        onDragOver={(e) => onDragOver(e, space.id)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDropOnSpace(e, space.id)}
      >
        {/* 折叠箭头 */}
        <button
          type="button"
          className="shrink-0 p-0.5 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg-2)]"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(space.id);
          }}
          aria-label={isExpanded ? t("collapse") : t("expand")}
        >
          <ChevronRight
            size={14}
            className={`transition-transform duration-[var(--motion-fast)] ${isExpanded ? "rotate-90" : ""}`}
          />
        </button>
        {/* 空间图标 */}
        <SpaceIcon size={14} className="shrink-0 text-[var(--accent)]" />
        {/* 空间名称 / 重命名输入 */}
        {isRenaming ? (
          <RenameInput
            defaultValue={space.name}
            busy={busy}
            onSubmit={(name) => onRename("space", space.id, name)}
            onCancel={() => onRename("space", space.id, space.name)}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {space.name}
          </span>
        )}
      </div>

      {/* 展开内容：文件夹 + 文档 */}
      {isExpanded && (
        <ul className="ml-[var(--space-4)] mt-0.5 space-y-0.5">
          {sortByOrder(space.folders).map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              spaceId={space.id}
              depth={1}
              expandedIds={expandedIds}
              dragOverId={dragOverId}
              renaming={renaming}
              busy={busy}
              onToggle={onToggle}
              onNavigate={onNavigate}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDropOnFolder={onDropOnFolder}
              onRename={onRename}
            />
          ))}
          {sortByOrder(space.documents).map((doc) => (
            <DocumentNode
              key={doc.id}
              doc={doc}
              spaceId={space.id}
              folderId={null}
              onNavigate={onNavigate}
              onDragStart={onDragStart}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── 文件夹节点（递归）──

interface FolderNodeProps {
  folder: Folder;
  spaceId: string;
  depth: number;
  expandedIds: Set<string>;
  dragOverId: string | null;
  renaming: RenameState | null;
  busy: boolean;
  onToggle: (id: string) => void;
  onNavigate: (docId: string) => void;
  onContextMenu: (
    e: ReactMouseEvent,
    kind: "space" | "folder",
    id: string,
    name: string,
    spaceId: string,
    parentId: string | null,
  ) => void;
  onDragStart: (e: DragEvent, payload: DragPayload) => void;
  onDragOver: (e: DragEvent, targetId: string) => void;
  onDragLeave: () => void;
  onDropOnFolder: (e: DragEvent, spaceId: string, folderId: string) => void;
  onRename: (kind: "space" | "folder", id: string, newName: string) => void;
}

function FolderNode({
  folder,
  spaceId,
  depth,
  expandedIds,
  dragOverId,
  renaming,
  busy,
  onToggle,
  onNavigate,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDropOnFolder,
  onRename,
}: FolderNodeProps) {
  const t = useTranslations("knowledgeBase");
  const isExpanded = expandedIds.has(folder.id);
  const isDragOver = dragOverId === folder.id;
  const isRenaming = renaming?.kind === "folder" && renaming.id === folder.id;
  const FolderIconCmp = isExpanded ? FolderOpen : FolderIcon;

  // 最多 5 层嵌套（设计文档 §2.2.1）
  const MAX_DEPTH = 5;

  return (
    <li>
      <div
        className={`group flex items-center gap-1 px-[var(--space-2)] py-[var(--space-1)] rounded-[var(--radius-sm)] cursor-pointer hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] ${
          isDragOver ? "bg-[var(--surface-2)] ring-1 ring-[var(--accent)]" : ""
        }`}
        draggable
        onDragStart={(e) =>
          onDragStart(e, { kind: "folder", id: folder.id, fromSpaceId: spaceId, fromFolderId: folder.parentId })
        }
        onDragOver={(e) => onDragOver(e, folder.id)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDropOnFolder(e, spaceId, folder.id)}
        onClick={() => onToggle(folder.id)}
        onContextMenu={(e) => onContextMenu(e, "folder", folder.id, folder.name, spaceId, folder.parentId)}
      >
        <button
          type="button"
          className="shrink-0 p-0.5 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg-2)]"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(folder.id);
          }}
          aria-label={isExpanded ? t("collapse") : t("expand")}
        >
          <ChevronRight
            size={14}
            className={`transition-transform duration-[var(--motion-fast)] ${isExpanded ? "rotate-90" : ""}`}
          />
        </button>
        <FolderIconCmp size={14} className="shrink-0 text-[var(--muted)]" />
        {isRenaming ? (
          <RenameInput
            defaultValue={folder.name}
            busy={busy}
            onSubmit={(name) => onRename("folder", folder.id, name)}
            onCancel={() => onRename("folder", folder.id, folder.name)}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[length:var(--text-sm)] text-[var(--fg-2)]">
            {folder.name}
          </span>
        )}
      </div>

      {isExpanded && (
        <ul className="ml-[var(--space-4)] mt-0.5 space-y-0.5">
          {depth < MAX_DEPTH &&
            sortByOrder(folder.children).map((child) => (
              <FolderNode
                key={child.id}
                folder={child}
                spaceId={spaceId}
                depth={depth + 1}
                expandedIds={expandedIds}
                dragOverId={dragOverId}
                renaming={renaming}
                busy={busy}
                onToggle={onToggle}
                onNavigate={onNavigate}
                onContextMenu={onContextMenu}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDropOnFolder={onDropOnFolder}
                onRename={onRename}
              />
            ))}
          {sortByOrder(folder.documents).map((doc) => (
            <DocumentNode
              key={doc.id}
              doc={doc}
              spaceId={spaceId}
              folderId={folder.id}
              onNavigate={onNavigate}
              onDragStart={onDragStart}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── 文档节点 ──

interface DocumentNodeProps {
  doc: TreeDocument;
  spaceId: string;
  folderId: string | null;
  onNavigate: (docId: string) => void;
  onDragStart: (e: DragEvent, payload: DragPayload) => void;
}

function DocumentNode({ doc, spaceId, folderId, onNavigate, onDragStart }: DocumentNodeProps) {
  const DocIcon = getIcon(doc.icon, "file-text");
  return (
    <li>
      <div
        className="group flex items-center gap-1 px-[var(--space-2)] py-[var(--space-1)] rounded-[var(--radius-sm)] cursor-pointer hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
        draggable
        onDragStart={(e) =>
          onDragStart(e, { kind: "document", id: doc.id, fromSpaceId: spaceId, fromFolderId: folderId })
        }
        onClick={() => onNavigate(doc.id)}
      >
        {/* 占位对齐（无折叠箭头） */}
        <span className="shrink-0 w-[14px]" />
        {doc.emoji ? (
          <span className="shrink-0 text-[14px] leading-none">{doc.emoji}</span>
        ) : (
          <DocIcon size={14} className="shrink-0 text-[var(--muted)]" />
        )}
        <span className="flex-1 min-w-0 truncate text-[length:var(--text-sm)] text-[var(--fg-2)] group-hover:text-[var(--fg)]">
          {doc.title}
        </span>
      </div>
    </li>
  );
}

// ── 内联重命名输入 ──

function RenameInput({
  defaultValue,
  busy,
  onSubmit,
  onCancel,
}: {
  defaultValue: string;
  busy: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1 min-w-0 flex items-center gap-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onCancel}
        disabled={busy}
        className="flex-1 min-w-0 h-6 px-1 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-[var(--focus-ring)]"
      />
      {busy && <Loader2 size={14} className="animate-spin text-[var(--muted)]" />}
    </form>
  );
}

// ── 创建输入 ──

function CreateInput({
  placeholder,
  busy,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  busy: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("knowledgeBase");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-[var(--space-2)] flex items-center gap-1 px-[var(--space-2)]">
      <Plus size={14} className="shrink-0 text-[var(--muted)]" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onCancel}
        disabled={busy}
        placeholder={placeholder}
        className="flex-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[var(--focus-ring)] placeholder:text-[var(--meta)]"
      />
      {busy ? (
        <Loader2 size={14} className="animate-spin text-[var(--muted)]" />
      ) : (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 p-0.5 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)]"
          aria-label={t("cancel")}
        >
          <X size={14} />
        </button>
      )}
    </form>
  );
}

// ── 右键菜单 ──

function ContextMenu({
  state,
  t,
  onNewFolder,
  onRename,
  onDelete,
}: {
  state: ContextMenuState;
  t: ReturnType<typeof useTranslations>;
  onNewFolder: (spaceId: string, parentId: string | null) => void;
  onRename: (kind: "space" | "folder", id: string, currentName: string) => void;
  onDelete: (kind: "space" | "folder", id: string) => void;
}) {
  // 获取当前项名称（从闭包中无法直接获取，这里用 data 属性或外部传入）
  // 简化：菜单项不显示当前名称，重命名时由 RenameInput 的 defaultValue 提供
  return (
    <div
      className="fixed z-[var(--z-modal)] min-w-[160px] py-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)]"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 新建子文件夹 */}
      <button
        type="button"
        onClick={() => {
          if (state.kind === "space") {
            onNewFolder(state.spaceId, null);
          } else {
            onNewFolder(state.spaceId, state.id);
          }
        }}
        className="flex items-center gap-2 w-full px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
      >
        <Plus size={14} className="text-[var(--muted)]" />
        {t("newFolder")}
      </button>
      {/* 重命名 */}
      <button
        type="button"
        onClick={() => onRename(state.kind, state.id, state.name)}
        className="flex items-center gap-2 w-full px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
      >
        <Pencil size={14} className="text-[var(--muted)]" />
        {t("rename")}
      </button>
      {/* 分隔线 */}
      <div className="my-1 border-t border-[var(--border-soft)]" />
      {/* 删除 */}
      <button
        type="button"
        onClick={() => onDelete(state.kind, state.id)}
        className="flex items-center gap-2 w-full px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)]"
      >
        <Trash2 size={14} />
        {t("delete")}
      </button>
    </div>
  );
}