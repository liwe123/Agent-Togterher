import type { Metadata } from "next"

import { TasksPage } from "@/components/tasks/tasks-page"

export const metadata: Metadata = {
  title: "任务 · Agent Console",
  description: "查看多 Agent 任务状态、负责人、结果与更新时间。",
}

export default function TasksRoute() {
  return <TasksPage />
}
