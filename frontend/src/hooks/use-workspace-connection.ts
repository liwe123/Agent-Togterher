"use client"

import { useState } from "react"

import { useWorkspaceSocket } from "@/hooks/use-workspace-socket"
import type { ConnectionStatus } from "@/types/agent"

const ignoreSocketEvent = () => {}

/**
 * 订阅当前工作区实时通道的连接状态，用于侧边栏状态灯等 UI。
 *
 * - workspaceId 为 null（尚未载入 / 无工作区）时不建立 WebSocket，直接返回 offline。
 * - 其余情况复用 useWorkspaceSocket 的重连与状态上报逻辑。
 */
export function useWorkspaceConnection(
  workspaceId: number | null,
): ConnectionStatus {
  const [socketStatus, setSocketStatus] =
    useState<ConnectionStatus>("connecting")

  useWorkspaceSocket({
    workspaceId,
    onEvent: ignoreSocketEvent,
    onStatusChange: setSocketStatus,
  })

  // 没有工作区就没有实时通道：固定为 offline，且 useWorkspaceSocket 不会建连
  return workspaceId === null ? "offline" : socketStatus
}
