"use client"

import {
  Bot,
  Braces,
  CodeXml,
  MousePointer2,
  Sparkles,
  Workflow,
} from "lucide-react"
import type { CSSProperties } from "react"
import { useMemo, useState } from "react"

import { useWorkspaces } from "@/hooks/use-workspaces"
import { useIntegrations } from "@/hooks/use-integrations"
import type { IntegrationNode } from "@/types/integration"

const ICONS = {
  cursor: MousePointer2,
  codex: Braces,
  trae: Workflow,
  antigravity: Sparkles,
  claude: CodeXml,
  default: Bot,
} as const

function iconFor(provider: string) {
  return ICONS[provider.toLowerCase() as keyof typeof ICONS] || ICONS.default
}

function toneFor(provider: string) {
  const value = provider.toLowerCase()
  if (value.includes("cursor")) return 6
  if (value.includes("codex")) return 2
  if (value.includes("trae")) return 1
  if (value.includes("antigravity")) return 3
  if (value.includes("claude")) return 5
  return 4
}

function statusText(status: string) {
  if (status === "online") return "当前在线"
  if (status === "busy") return "任务处理中"
  if (status === "connecting") return "连接中"
  if (status === "error") return "发生错误"
  if (status === "removed") return "已移除"
  return "连接断开"
}

export function SoftwareDock() {
  const { activeWorkspace } = useWorkspaces()
  const workspaceId = activeWorkspace?.id ?? null
  const { nodes, isLoading, error, refresh } = useIntegrations(workspaceId)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  const fallbackNodes: IntegrationNode[] = []
  const visibleNodes = nodes.length > 0 ? nodes : fallbackNodes

  return (
    <section aria-labelledby="software-dock" className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 p-5 sm:p-6 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Workflow aria-hidden="true" className="size-4.5" />
          </span>
          <div>
            <h2 id="software-dock" className="text-base font-semibold tracking-tight text-foreground">软件 Dock</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">动态展示外部 Agent 节点状态与接入能力</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <span className="rounded-full border border-border/60 bg-secondary/40 px-3 py-1 text-xs text-muted-foreground">
            {isLoading ? "加载中" : `${visibleNodes.length} 个节点已登记`}
          </span>
          <button
            type="button"
            onClick={refresh}
            className="rounded-full border border-border/60 bg-secondary/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            刷新
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-6">
        {visibleNodes.map((item) => {
          const Icon = iconFor(item.provider)
          const isSelected = selectedId === item.id
          const tone = toneFor(item.provider)
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isSelected}
              aria-label={`查看 ${item.name} 连接状态`}
              onClick={() => setSelectedId((current) => current === item.id ? null : item.id)}
              className="group flex min-w-0 flex-col items-center gap-2.5 rounded-2xl p-2 text-center transition-all duration-200 hover:bg-secondary/60 active:scale-95"
              style={{ "--tool-tone": `var(--avatar-${tone})` } as CSSProperties}
            >
              <span className="tool-launcher relative flex size-14 items-center justify-center rounded-2xl border border-[color-mix(in_oklch,var(--tool-tone)_45%,var(--border))] bg-[color-mix(in_oklch,var(--tool-tone)_18%,var(--card))] text-[var(--tool-tone)] transition-transform duration-200 ease-out group-hover:-translate-y-0.5 sm:size-16">
                <Icon aria-hidden="true" className="size-6 sm:size-7" />
                <span
                  className="absolute -bottom-1 size-2.5 rounded-full border-2 border-card shadow-[0_0_4px_var(--status-running)]"
                  style={{
                    backgroundColor: item.status === "online" ? "var(--status-running)" : item.status === "busy" ? "var(--primary)" : "var(--muted)",
                  }}
                  aria-hidden="true"
                />
              </span>
              <span className="w-full truncate text-[11px] font-medium text-foreground sm:text-xs">{item.name}</span>
              <span className="w-full truncate text-[10px] text-muted-foreground">{item.mode.toUpperCase()} · {statusText(item.status)}</span>
            </button>
          )
        })}
      </div>

      {selectedNode ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-5 py-3.5 text-xs shadow-sm" aria-live="polite">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{selectedNode.name}</p>
            <p className="mt-0.5 text-muted-foreground">
              {selectedNode.provider} · {selectedNode.mode} · {selectedNode.endpoint || "无端点"}
            </p>
            <p className="mt-1 truncate text-muted-foreground">
              能力：{selectedNode.capabilities.length > 0 ? selectedNode.capabilities.join("、") : "未配置"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="flex items-center gap-2 rounded-full bg-primary/20 px-3 py-1 font-medium text-primary">
              <span className="status-dot size-2 rounded-full" data-status={selectedNode.status} aria-hidden="true" />
              {statusText(selectedNode.status)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              心跳：{selectedNode.last_heartbeat_at ? new Date(selectedNode.last_heartbeat_at).toLocaleString() : "暂无"}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
