"use client";

/**
 * AI 是否已配置的前端探测 hook。
 *
 * 挂载时调一次 GET /api/v1/ai/configured（服务端查 DEEPSEEK/OPENAI key 是否非空，
 * 无 IO 纯内存判断）。返回三态：
 *  - loading=true  探测中（横幅不显示，避免闪烁）
 *  - configured=true  已配置（正常渲染）
 *  - configured=false 未配置（页面顶部横幅提示，面板保留渲染——
 *    深链与既有自动化（无 Provider 的 CI 环境）不破，用户点击动作时仍会收到
 *    服务端统一的 503 文案）
 *
 * 探测失败（网络抖动）按「已配置」处理：宁可让用户点一次拿到明确的服务端错误，
 * 也不误伤可用功能（fail-open 仅限横幅，真正的鉴权与限额在服务端 fail-closed）。
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useAiConfigured(): { configured: boolean; loading: boolean } {
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api<{ configured: boolean }>("/api/v1/ai/configured")
      .then((data) => {
        if (alive) setConfigured(data.configured !== false);
      })
      .catch(() => {
        // 探测失败不横幅（见上方注释），面板自身的错误态兜底
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { configured, loading };
}
