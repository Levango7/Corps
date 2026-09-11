"use client";

/**
 * F3 Widget 仪表盘 — Widget 数据加载共享 hook。
 *
 * 各 Widget 组件用此 hook 独立加载自身数据：
 *  - GET /api/v1/workspaces/:wid/dashboard/widgets/:widgetId
 *  - 自动管理 loading / error / data 状态
 *  - 支持手动刷新（retry 计数器触发）
 *
 * 设计依据：design/FEATURE-DESIGN-v0.7.md §3.6。
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface UseWidgetDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * 加载单个 Widget 数据。
 * @param wid 工作区 id
 * @param widgetId Widget id（与后端白名单对齐）
 */
export function useWidgetData<T = unknown>(wid: string, widgetId: string): UseWidgetDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(`/api/v1/workspaces/${wid}/dashboard/widgets/${widgetId}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wid, widgetId, retryCount]);

  return { data, loading, error, retry };
}