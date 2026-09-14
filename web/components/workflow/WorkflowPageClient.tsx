"use client";

/**
 * 工作流管理页面客户端组件。
 *
 * 组合 WorkflowList + WorkflowEditor + WorkflowExecutionList。
 * 管理弹窗开关状态和列表刷新。
 */

import { useState } from "react";
import { WorkflowList, type WorkflowItem } from "@/components/workflow/WorkflowList";
import { WorkflowEditor } from "@/components/workflow/WorkflowEditor";
import { WorkflowExecutionList } from "@/components/workflow/WorkflowExecutionList";

export function WorkflowPageClient({ wid }: { wid: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowItem | null>(null);
  const [executionsWorkflow, setExecutionsWorkflow] = useState<WorkflowItem | null>(null);

  function openCreate() {
    setEditingWorkflow(null);
    setEditorOpen(true);
  }

  function openEdit(wf: WorkflowItem) {
    setEditingWorkflow(wf);
    setEditorOpen(true);
  }

  function handleSaved() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <>
      <WorkflowList
        wid={wid}
        onCreate={openCreate}
        onEdit={openEdit}
        onShowExecutions={(wf) => setExecutionsWorkflow(wf)}
        refreshKey={refreshKey}
      />

      {editorOpen && (
        <WorkflowEditor
          wid={wid}
          workflow={editingWorkflow}
          onClose={() => setEditorOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {executionsWorkflow && (
        <WorkflowExecutionList
          wid={wid}
          workflow={executionsWorkflow}
          onClose={() => setExecutionsWorkflow(null)}
        />
      )}
    </>
  );
}

export default WorkflowPageClient;