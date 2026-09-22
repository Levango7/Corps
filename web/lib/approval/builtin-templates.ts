/**
 * 内置审批模板定义
 *
 * 提供 5 个预置审批模板：请假、报销、采购、合同、入职。
 * 通过 getBuiltinTemplates() 返回模板定义数组，
 * 供 POST /approvals/templates?action=init-builtin 批量初始化使用。
 *
 * @module builtin-templates
 */

// ─── 类型定义 ───────────────────────────────────────────────

/** 内置模板的审批节点定义 */
export interface BuiltinNode {
  id: string;
  type: "approval";
  name: string;
  approverRole: string;
  order: number;
  mode: "sequential";
}

/** 内置模板的表单字段定义 */
export interface BuiltinFormField {
  name: string;
  label: string;
  type: "select" | "date" | "textarea" | "text" | "number" | "file";
  options?: string[];
  required: boolean;
}

/** 内置模板的表单 Schema */
export interface BuiltinFormSchema {
  fields: BuiltinFormField[];
}

/** 内置模板完整定义 */
export interface BuiltinTemplate {
  name: string;
  description: string;
  category: string;
  icon: string;
  flowType: string;
  nodes: BuiltinNode[];
  formSchema: BuiltinFormSchema;
}

// ─── 内置模板定义 ───────────────────────────────────────────

const leaveTemplate: BuiltinTemplate = {
  name: "请假审批",
  description: "员工请假申请，经直属主管和 HR 审批后生效",
  category: "leave",
  icon: "calendar-off",
  flowType: "sequential",
  nodes: [
    { id: "node-1", type: "approval", name: "直属主管审批", approverRole: "admin", order: 1, mode: "sequential" },
    { id: "node-2", type: "approval", name: "HR审批", approverRole: "admin", order: 2, mode: "sequential" },
  ],
  formSchema: {
    fields: [
      { name: "leaveType", label: "请假类型", type: "select", options: ["年假", "事假", "病假", "调休"], required: true },
      { name: "startDate", label: "开始时间", type: "date", required: true },
      { name: "endDate", label: "结束时间", type: "date", required: true },
      { name: "reason", label: "请假原因", type: "textarea", required: true },
    ],
  },
};

const expenseTemplate: BuiltinTemplate = {
  name: "报销审批",
  description: "员工费用报销申请，经直属主管和财务审批后生效",
  category: "expense",
  icon: "receipt",
  flowType: "sequential",
  nodes: [
    { id: "node-1", type: "approval", name: "直属主管审批", approverRole: "admin", order: 1, mode: "sequential" },
    { id: "node-2", type: "approval", name: "财务审批", approverRole: "admin", order: 2, mode: "sequential" },
  ],
  formSchema: {
    fields: [
      { name: "expenseType", label: "报销类型", type: "select", options: ["差旅费", "办公费", "招待费", "其他"], required: true },
      { name: "amount", label: "报销金额", type: "number", required: true },
      { name: "reason", label: "报销事由", type: "textarea", required: true },
      { name: "attachment", label: "附件", type: "file", required: false },
    ],
  },
};

const purchaseTemplate: BuiltinTemplate = {
  name: "采购审批",
  description: "采购申请，经直属主管和采购部审批后生效",
  category: "purchase",
  icon: "shopping-cart",
  flowType: "sequential",
  nodes: [
    { id: "node-1", type: "approval", name: "直属主管审批", approverRole: "admin", order: 1, mode: "sequential" },
    { id: "node-2", type: "approval", name: "采购部审批", approverRole: "admin", order: 2, mode: "sequential" },
  ],
  formSchema: {
    fields: [
      { name: "itemName", label: "采购物品", type: "text", required: true },
      { name: "quantity", label: "采购数量", type: "number", required: true },
      { name: "estimatedAmount", label: "预估金额", type: "number", required: true },
      { name: "reason", label: "采购原因", type: "textarea", required: true },
    ],
  },
};

const contractTemplate: BuiltinTemplate = {
  name: "合同审批",
  description: "合同签订申请，经法务、财务和总经理审批后生效",
  category: "contract",
  icon: "file-signature",
  flowType: "sequential",
  nodes: [
    { id: "node-1", type: "approval", name: "法务审批", approverRole: "admin", order: 1, mode: "sequential" },
    { id: "node-2", type: "approval", name: "财务审批", approverRole: "admin", order: 2, mode: "sequential" },
    { id: "node-3", type: "approval", name: "总经理审批", approverRole: "admin", order: 3, mode: "sequential" },
  ],
  formSchema: {
    fields: [
      { name: "contractName", label: "合同名称", type: "text", required: true },
      { name: "contractAmount", label: "合同金额", type: "number", required: true },
      { name: "counterparty", label: "对方公司", type: "text", required: true },
      { name: "summary", label: "合同摘要", type: "textarea", required: true },
    ],
  },
};

const onboardingTemplate: BuiltinTemplate = {
  name: "入职审批",
  description: "新员工入职申请，经 HR 和部门负责人审批后生效",
  category: "hr",
  icon: "user-plus",
  flowType: "sequential",
  nodes: [
    { id: "node-1", type: "approval", name: "HR审批", approverRole: "admin", order: 1, mode: "sequential" },
    { id: "node-2", type: "approval", name: "部门负责人审批", approverRole: "admin", order: 2, mode: "sequential" },
  ],
  formSchema: {
    fields: [
      { name: "employeeName", label: "入职人姓名", type: "text", required: true },
      { name: "department", label: "入职部门", type: "text", required: true },
      { name: "position", label: "入职职位", type: "text", required: true },
      { name: "onboardingDate", label: "入职日期", type: "date", required: true },
    ],
  },
};

// ─── 导出函数 ───────────────────────────────────────────────

/**
 * 获取所有内置审批模板定义
 *
 * 返回 5 个预置模板：请假、报销、采购、合同、入职。
 * 每个模板包含 nodes（审批节点）和 formSchema（表单字段），
 * 供初始化 API 批量写入数据库。
 *
 * @returns 内置模板定义数组
 */
export function getBuiltinTemplates(): BuiltinTemplate[] {
  return [leaveTemplate, expenseTemplate, purchaseTemplate, contractTemplate, onboardingTemplate];
}