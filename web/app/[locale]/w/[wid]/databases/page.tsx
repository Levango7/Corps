import { DatabaseList } from "./DatabaseList";

/**
 * 多维表格列表页 · /w/[wid]/databases
 *
 * 与同级 whiteboards / forms 页保持同一约定：服务端组件只 `await params`
 * 拿到 wid，渲染交给客户端列表组件（数据全部走 `@/lib/api` 的浏览器端封装，
 * 页面层不碰 prisma）。loading 由上级 `app/[locale]/w/[wid]/loading.tsx`
 * 兜底，error 由 `app/[locale]/error.tsx` 兜底。
 */
export default async function DatabasesListPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return (
    <main className="flex-1 min-w-0">
      <DatabaseList wid={wid} />
    </main>
  );
}
