"use client";

import { useReportWebVitals } from "next/web-vitals";

/**
 * Web Vitals 性能监控组件。
 *
 * 在根布局中挂载一次，自动采集 Core Web Vitals 指标并输出到 console。
 * - 开发环境: 详细输出（含 rating 与 navigationType），便于本地调优。
 * - 生产环境: 简洁输出；后续可在此处接入分析服务（Vercel Analytics、
 *   自建 endpoint 等），无需改动调用方。
 *
 * 采集指标:
 *   - TTFB  Time to First Byte       服务端响应速度
 *   - LCP   Largest Contentful Paint  最大内容绘制（加载体验核心）
 *   - FID   First Input Delay         首次输入延迟（兼容旧指标）
 *   - INP   Interaction to Next Paint 交互到下一帧（FID 的现代替代）
 *   - CLS   Cumulative Layout Shift   累积布局偏移（视觉稳定性）
 *
 * 依赖: Next.js 内置 web-vitals 支持，无额外依赖。
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const { name, value, rating, id, navigationType } = metric;

    if (process.env.NODE_ENV === "production") {
      // 生产: 简洁格式，便于日志聚合。后续可替换为上报调用。
      // eslint-disable-next-line no-console
      console.log(`[web-vitals] ${name}=${value.toFixed(2)} rating=${rating}`);
    } else {
      // 开发: 详细格式，含 metric id 与导航类型，便于排查回归。
      // eslint-disable-next-line no-console
      console.log(
        `[web-vitals] ${name} = ${value.toFixed(2)} (${rating}) | id=${id} nav=${navigationType}`,
      );
    }
  });

  return null;
}