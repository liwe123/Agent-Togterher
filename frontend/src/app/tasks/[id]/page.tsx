import type { Metadata } from "next"

import { TaskDetailPage } from "@/components/tasks/task-detail-page"

export const metadata: Metadata = {
  title: "任务详情 · Agent Console",
  description: "查看任务输入、执行步骤、模型调用、token、耗时与错误信息。",
}

export default async function TaskDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <TaskDetailPage taskId={Number(id)} />
}
