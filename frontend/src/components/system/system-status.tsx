"use client";

import { useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/task-api";

type ApiStatus = "checking" | "online" | "offline";

export function SystemStatus() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/health`, {
          signal: controller.signal,
        });
        setStatus(response.ok ? "online" : "offline");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setStatus("offline");
        }
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  const labels: Record<ApiStatus, string> = {
    checking: "正在检查 FastAPI...",
    online: "FastAPI 已连接",
    offline: "FastAPI 未连接，请先启动后端",
  };

  return (
    <p className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
      {labels[status]}
    </p>
  );
}
