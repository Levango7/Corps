import { DocumentListView } from "@/components/DocumentListView";

export default async function DocumentsListPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  return <DocumentListView wid={wid} />;
}
