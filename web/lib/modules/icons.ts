import {
  LayoutDashboard,
  Kanban,
  CheckSquare,
  Scale,
  MessageSquare,
  FileText,
  Video,
  NotebookPen,
  CheckCircle2,
  Megaphone,
  Calendar as CalendarIcon,
  Contact as ContactIcon,
  FolderOpen,
  BookOpen,
  PenTool,
  Table2,
  ClipboardList,
  Trash2,
  Target,
  GitBranch,
  LayoutTemplate,
  Clock,
  Wand2,
  Lightbulb,
  HelpCircle,
  Newspaper,
  PenLine,
  Users,
  CreditCard,
  BarChart3,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 模块图标表 —— 注册表只存**键名**，图标组件在这里落地。
 *
 * 为什么不让注册表直接存组件：注册表要能被单测与设置页（服务端）当作纯数据导入，
 * 引入 React 组件会让它变成客户端依赖；键名 + 一张映射表既保持数据纯净，
 * 又能在编译期保证「注册表里写的每个图标键都存在」。
 */
export const MODULE_ICONS = {
  overview: LayoutDashboard,
  board: Kanban,
  myTasks: CheckSquare,
  decisions: Scale,
  im: MessageSquare,
  documents: FileText,
  meetings: Video,
  meetingMinutes: NotebookPen,
  approvals: CheckCircle2,
  announcements: Megaphone,
  calendar: CalendarIcon,
  contacts: ContactIcon,
  files: FolderOpen,
  wiki: BookOpen,
  whiteboards: PenTool,
  databases: Table2,
  forms: ClipboardList,
  recycleBin: Trash2,
  okr: Target,
  workflows: GitBranch,
  templates: LayoutTemplate,
  timeTracking: Clock,
  aiTools: Wand2,
  insight: Lightbulb,
  knowledgeQa: HelpCircle,
  dailyReport: Newspaper,
  announcementDraft: PenLine,
  members: Users,
  billing: CreditCard,
  analytics: BarChart3,
  settings: Settings,
} as const satisfies Record<string, LucideIcon>;

export type ModuleIconName = keyof typeof MODULE_ICONS;
