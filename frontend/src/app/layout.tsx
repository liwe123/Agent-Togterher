import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Console · 多智能体协同运行台",
  description: "编排多模型与多 Agent、追踪任务执行和实时状态的协同运行台",
};

import { AuthGuard } from "@/components/auth-guard";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col">
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
