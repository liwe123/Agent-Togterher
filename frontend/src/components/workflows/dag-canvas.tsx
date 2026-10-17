"use client"

import { useMemo } from "react"

import { layoutPositions, type DagNodeLike } from "@/lib/dag-layout"
import { cn } from "@/lib/utils"

interface DagCanvasProps<T extends DagNodeLike> {
  nodes: T[]
  className?: string
  onSelectNode?: (node: T) => void
}

const NODE_WIDTH = 148
const NODE_HEIGHT = 52

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}

/**
 * 纯 SVG 自绘的分层 DAG 画布（PRD-工作流运行记录与画布可视化 FR4）。
 *
 * 不引入 reactflow / d3：分层用 @/lib/dag-layout 的 Kahn 纯函数（有单测），
 * 这里只负责把分层结果画成节点与依赖连线。
 */
export function DagCanvas<T extends DagNodeLike>({
  nodes,
  className,
  onSelectNode,
}: DagCanvasProps<T>) {
  const layout = useMemo(() => layoutPositions(nodes, { nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT }), [nodes])

  if (layout.length === 0) {
    return (
      <div className={cn("rounded-xl border border-dashed border-border bg-secondary/20 p-6 text-center text-xs text-muted-foreground", className)}>
        该模板暂无节点
      </div>
    )
  }

  const columns = Math.max(...layout.map((item) => item.x)) + NODE_WIDTH
  const rows = Math.max(...layout.map((item) => item.y)) + NODE_HEIGHT
  const positionById = new Map(layout.map((item) => [item.node.id, item]))

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border bg-secondary/20 p-3", className)}>
      <svg
        width={columns + 8}
        height={rows + 8}
        viewBox={`-4 -4 ${columns + 8} ${rows + 8}`}
        role="img"
        aria-label="工作流 DAG 分层画布"
      >
        <defs>
          <marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/70" />
          </marker>
        </defs>

        {/* 依赖连线：先画线，节点覆盖其上 */}
        {layout.map(({ node, x, y }) =>
          (node.dependencies ?? [])
            // 归一化：排除自依赖、重复依赖与未知依赖，避免自环与重复 path/key
            .filter(
              (depId, index, all) =>
                depId !== node.id && all.indexOf(depId) === index && positionById.has(depId)
            )
            .map((depId) => {
              const source = positionById.get(depId)!
              const x1 = source.x + NODE_WIDTH / 2
              const y1 = source.y + NODE_HEIGHT
              const x2 = x + NODE_WIDTH / 2
              const y2 = y
              const midY = (y1 + y2) / 2
              return (
                <path
                  key={`${depId}->${node.id}`}
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none"
                  strokeWidth="1.5"
                  markerEnd="url(#dag-arrow)"
                  className="stroke-muted-foreground/50"
                />
              )
            })
        )}

        {layout.map(({ node, x, y }) => {
          const isApproval = node.type === "human_approval"
          return (
            <g
              key={node.id}
              transform={`translate(${x}, ${y})`}
              className={onSelectNode ? "cursor-pointer" : undefined}
              onClick={onSelectNode ? () => onSelectNode(node) : undefined}
            >
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx="12"
                strokeWidth="1.5"
                className={isApproval ? "fill-amber-500/10 stroke-amber-500/70" : "fill-card stroke-border"}
              />
              <text x="10" y="20" className="fill-foreground text-[11px] font-semibold">
                {truncate(node.name ?? node.id, 16)}
              </text>
              <text x="10" y="36" className="fill-muted-foreground text-[10px] font-mono">
                {isApproval ? "人工审批" : truncate(node.agent_role ?? "agent", 18)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
