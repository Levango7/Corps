import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "corps · 团队",
  description: "面向中小团队的轻量协作 SaaS",
};

/**
 * 在首帧前同步解析主题偏好，避免深色用户看到一次浅色闪白。
 * 与设置页 / 顶栏共用 localStorage key：corps_theme。
 */
const themeBootstrap = `
(function(){
  try{
    var p = localStorage.getItem("corps_theme") || "system";
    var d = p === "dark" || (p === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", d ? "dark" : "light");
  }catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
