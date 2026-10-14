export interface DagNodeLike {
  id: string
  name?: string
  agent_role?: string
  dependencies?: string[]
  type?: string
}

export interface DagLayer<T extends DagNodeLike> {
  index: number
  nodes: T[]
}

function normalizeDependencies<T extends DagNodeLike>(
  node: T,
  byId: Map<string, T>,
): string[] {
  const raw = node.dependencies ?? []
  const result: string[] = []
  for (const dep of raw) {
    // 容错：空值、自依赖、未知节点一律忽略；重复依赖去重。
    if (!dep || dep === node.id || !byId.has(dep)) continue
    if (!result.includes(dep)) result.push(dep)
  }
  return result
}

/**
 * Kahn 拓扑分层（PRD-工作流运行记录与画布可视化 FR4）。
 *
 * 返回按层分组的节点：同层节点之间没有依赖，可并行渲染/执行。
 * 容错策略（画布是展示层，不能因为脏数据白屏）：
 *   - 未知依赖 / 自依赖 / 空依赖：忽略；
 *   - 环：环内节点在 Kahn 主循环中永远无法入队，统一兜底追加为最后一层，
 *     保证函数一定终止且不丢节点。
 */
export function layoutDag<T extends DagNodeLike>(nodes: T[]): DagLayer<T>[] {
  const byId = new Map<string, T>()
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node)
  }
  const unique = Array.from(byId.values())
  if (unique.length === 0) return []

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const node of unique) {
    const deps = normalizeDependencies(node, byId)
    indegree.set(node.id, deps.length)
    for (const dep of deps) {
      const list = dependents.get(dep) ?? []
      list.push(node.id)
      dependents.set(dep, list)
    }
  }

  const layers: T[][] = []
  const placed = new Set<string>()
  let frontier = unique.filter((node) => (indegree.get(node.id) ?? 0) === 0)

  while (frontier.length > 0) {
    layers.push(frontier)
    for (const node of frontier) placed.add(node.id)
    const next: T[] = []
    for (const node of frontier) {
      for (const childId of dependents.get(node.id) ?? []) {
        if (placed.has(childId)) continue
        const remaining = (indegree.get(childId) ?? 0) - 1
        indegree.set(childId, remaining)
        const child = byId.get(childId)
        if (remaining === 0 && child && !next.includes(child)) next.push(child)
      }
    }
    frontier = next
  }

  const unresolved = unique.filter((node) => !placed.has(node.id))
  if (unresolved.length > 0) layers.push(unresolved)

  return layers.map((layerNodes, index) => ({ index, nodes: layerNodes }))
}

/** 分层结果 → 便于渲染的落点坐标（每层一行，层内按序号横向排布）。 */
export function layoutPositions<T extends DagNodeLike>(
  nodes: T[],
  options: { nodeWidth?: number; nodeHeight?: number; gapX?: number; gapY?: number } = {},
): { node: T; x: number; y: number; layer: number }[] {
  const nodeWidth = options.nodeWidth ?? 148
  const nodeHeight = options.nodeHeight ?? 52
  const gapX = options.gapX ?? 28
  const gapY = options.gapY ?? 44
  const positions: { node: T; x: number; y: number; layer: number }[] = []
  for (const layer of layoutDag(nodes)) {
    layer.nodes.forEach((node, indexInLayer) => {
      positions.push({
        node,
        x: indexInLayer * (nodeWidth + gapX),
        y: layer.index * (nodeHeight + gapY),
        layer: layer.index,
      })
    })
  }
  return positions
}
