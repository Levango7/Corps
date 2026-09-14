"use client";

/**
 * 项目模板管理页 · /w/[wid]/templates
 *
 * 组合 TemplateList + TemplateEditor + TemplateApplyDialog：
 *  - 列表展示所有模板，支持分类过滤
 *  - "新建"打开编辑器（空模板）
 *  - 卡片"编辑"打开编辑器（预填）
 *  - 卡片"应用"打开应用弹窗
 *  - 编辑器保存 / 应用成功后刷新列表
 */

import { use, useState } from "react";
import { TemplateList, type TemplateListItem } from "@/components/template/TemplateList";
import { TemplateEditor } from "@/components/template/TemplateEditor";
import { TemplateApplyDialog } from "@/components/template/TemplateApplyDialog";

export default function TemplatesPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);

  // 编辑器状态：open + 当前编辑的模板（null=新建）
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateListItem | null>(null);

  // 应用弹窗状态：open + 当前应用的模板
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState<TemplateListItem | null>(null);

  // 列表刷新 key：每次创建/更新/应用后递增，触发 TemplateList 重新拉取
  const [refreshKey, setRefreshKey] = useState(0);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(tpl: TemplateListItem) {
    setEditing(tpl);
    setEditorOpen(true);
  }

  function openApply(tpl: TemplateListItem) {
    setApplying(tpl);
    setApplyOpen(true);
  }

  function handleSaved() {
    setRefreshKey((k) => k + 1);
  }

  function handleApplied() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
      {/* refreshKey 作为 key 强制重新挂载以重新拉取列表 */}
      <TemplateList
        key={refreshKey}
        wid={wid}
        onCreate={openCreate}
        onEdit={openEdit}
        onApply={openApply}
        onDelete={() => setRefreshKey((k) => k + 1)}
      />
      <TemplateEditor
        wid={wid}
        template={editing}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={handleSaved}
      />
      <TemplateApplyDialog
        wid={wid}
        template={applying}
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        onApplied={handleApplied}
      />
    </>
  );
}