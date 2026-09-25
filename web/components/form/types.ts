/**
 * 表单模块共享类型。
 */

/** 表单字段类型 */
export type FormFieldType =
  "text" | "textarea" | "number" | "select" | "radio" | "checkbox" | "date";

/** 表单字段定义（与 Prisma Form.fields JSON 结构一致） */
export interface FormFieldDefinition {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options?: string[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

/** 表单列表项（GET /forms 返回） */
export interface FormItem {
  id: string;
  title: string;
  description: string | null;
  fields: FormFieldDefinition[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { submissions: number };
}

/** 表单详情（GET /forms/[fid] 返回） */
export interface FormDetail extends FormItem {
  _count: { submissions: number };
}

/** 表单提交项（GET /forms/[fid]/submissions 返回） */
export interface FormSubmissionItem {
  id: string;
  data: Record<string, unknown>;
  submittedAt: string;
  submitter: { id: string; name: string | null; email: string } | null;
}

/** 所有支持的字段类型列表（用于构建器选择） */
export const FIELD_TYPES: FormFieldType[] = [
  "text",
  "textarea",
  "number",
  "select",
  "radio",
  "checkbox",
  "date",
];

/** 需要选项配置的字段类型 */
export const OPTION_FIELD_TYPES: FormFieldType[] = ["select", "radio", "checkbox"];
