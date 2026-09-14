import { FormList } from "@/components/form/FormList";

/**
 * 表单管理页面。
 *
 * 布局：直接渲染 FormList（列表 + 构建器 + 预览 + 提交列表，均通过弹窗承载）。
 */
export default async function FormsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <FormList wid={wid} />
    </main>
  );
}