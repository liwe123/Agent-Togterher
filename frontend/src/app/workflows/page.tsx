"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  ChevronRight,
  GitBranch,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { usePermissions } from "@/hooks/use-permissions"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { requestData } from "@/lib/task-api"
import { cn } from "@/lib/utils"
import type {
  WorkflowNode,
  WorkflowRunResponse,
  WorkflowTemplateItem,
  WorkflowVariable,
} from "@/types/workflow"

export default function WorkflowsPage() {
  const router = useRouter()
  const { activeWorkspace } = useWorkspaces()
  const { isAdmin } = usePermissions()

  const [templates, setTemplates] = useState<WorkflowTemplateItem[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Run modal state
  const [runningTpl, setRunningTpl] = useState<WorkflowTemplateItem | null>(null)
  const [runVariables, setRunVariables] = useState<Record<string, string>>({})
  const [customTitle, setCustomTitle] = useState("")
  const [isSubmittingRun, setIsSubmittingRun] = useState(false)

  // Inspect nodes drawer
  const [inspectTpl, setInspectTpl] = useState<WorkflowTemplateItem | null>(null)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTplName, setNewTplName] = useState("")
  const [newTplDisplayName, setNewTplDisplayName] = useState("")
  const [newTplDesc, setNewTplDesc] = useState("")
  const [newNodes, setNewNodes] = useState<WorkflowNode[]>([
    {
      id: "node-1",
      name: "第一阶段：方案设计",
      agent_role: "manager",
      prompt_template: "为「{{title}}」设计方案",
      dependencies: [],
    },
    {
      id: "node-2",
      name: "第二阶段：代码实现",
      agent_role: "coder",
      prompt_template: "根据前序方案实现「{{title}}」核心代码",
      dependencies: ["node-1"],
    },
  ])
  const [newVariables] = useState<WorkflowVariable[]>([
    {
      key: "title",
      label: "任务主题",
      default: "新特性开发",
      required: true,
    },
  ])
  const [isCreating, setIsCreating] = useState(false)

  const loadedWsIdRef = useRef<number | null>(null)

  const loadWorkflows = useCallback(async (wsId: number) => {
    setIsLoading(true)
    setMessage(null)
    try {
      const data = await requestData<WorkflowTemplateItem[]>(
        `/api/v1/workspaces/${wsId}/workflows`
      )
      setTemplates(data)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "获取工作流失败" })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspace) return
    if (loadedWsIdRef.current === activeWorkspace.id) return
    loadedWsIdRef.current = activeWorkspace.id
    void loadWorkflows(activeWorkspace.id)
  }, [activeWorkspace, loadWorkflows])

  const openRunModal = (tpl: WorkflowTemplateItem) => {
    setRunningTpl(tpl)
    const initialVars: Record<string, string> = {}
    tpl.variables.forEach((v) => {
      initialVars[v.key] = v.default || ""
    })
    setRunVariables(initialVars)
    setCustomTitle("")
  }

  const handleRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeWorkspace || !runningTpl) return
    setIsSubmittingRun(true)
    setMessage(null)
    try {
      const res = await requestData<WorkflowRunResponse>(
        `/api/v1/workspaces/${activeWorkspace.id}/workflows/${runningTpl.id}/run`,
        {
          method: "POST",
          body: JSON.stringify({
            variables: runVariables,
            custom_title: customTitle.trim() || undefined,
          }),
        }
      )
      setMessage({ type: "success", text: `已成功创建任务 #${res.task_id}，正在前往详情...` })
      setRunningTpl(null)
      setTimeout(() => {
        router.push(`/tasks/${res.task_id}`)
      }, 500)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "启动工作流失败" })
    } finally {
      setIsSubmittingRun(false)
    }
  }

  const handleDelete = async (tpl: WorkflowTemplateItem) => {
    if (!activeWorkspace || !isAdmin || tpl.is_system) return
    if (!confirm(`确认删除自定义工作流模板「${tpl.display_name}」吗？`)) return
    try {
      await requestData(`/api/v1/workspaces/${activeWorkspace.id}/workflows/${tpl.id}`, {
        method: "DELETE",
      })
      setMessage({ type: "success", text: `工作流模板「${tpl.display_name}」已删除` })
      void loadWorkflows(activeWorkspace.id)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "删除失败" })
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeWorkspace || !isAdmin) return
    setIsCreating(true)
    setMessage(null)
    try {
      await requestData<WorkflowTemplateItem>(
        `/api/v1/workspaces/${activeWorkspace.id}/workflows`,
        {
          method: "POST",
          body: JSON.stringify({
            name: newTplName.trim(),
            display_name: newTplDisplayName.trim(),
            description: newTplDesc.trim() || undefined,
            nodes: newNodes,
            variables: newVariables,
          }),
        }
      )
      setMessage({ type: "success", text: `工作流模板「${newTplDisplayName}」创建成功` })
      setShowCreateModal(false)
      setNewTplName("")
      setNewTplDisplayName("")
      setNewTplDesc("")
      void loadWorkflows(activeWorkspace.id)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "创建模板失败" })
    } finally {
      setIsCreating(false)
    }
  }

  const filteredTemplates = templates.filter(
    (t) =>
      t.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar connectionStatus="online" activeItem="workflows" />

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
                  <Workflow className="size-5" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">工作流模板引擎</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                当前工作区：
                <span className="font-semibold text-foreground">
                  {activeWorkspace?.name || "默认工作区"}
                </span>{" "}
                · 沉淀多 Agent 协作流水线、参数化模板一键实例化
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => activeWorkspace && loadWorkflows(activeWorkspace.id)}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-secondary transition-colors"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin text-primary")} />
                刷新
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建工作流
                </button>
              )}
            </div>
          </div>

          {/* Feedback message banner */}
          {message && (
            <div
              className={cn(
                "rounded-xl border p-4 text-sm font-medium animate-in fade-in duration-150",
                message.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                  : "border-destructive/30 bg-destructive/15 text-destructive"
              )}
            >
              {message.text}
            </div>
          )}

          {/* Search filter */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索工作流模板名称、适用场景与描述..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Workflow Cards */}
          {isLoading && templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-2">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm">正在加载工作流模板库...</p>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center space-y-3">
              <Workflow className="size-10 text-muted-foreground mx-auto opacity-50" />
              <div className="text-sm font-medium text-foreground">未找到匹配的工作流模板</div>
              <p className="text-xs text-muted-foreground">
                可点击右上角「新建工作流」创建工作区专属协作流水线
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                          <Layers className="size-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm font-bold text-foreground">
                              {tpl.display_name}
                            </h2>
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-mono",
                                tpl.is_system
                                  ? "bg-secondary text-muted-foreground"
                                  : "bg-primary/15 text-primary"
                              )}
                            >
                              {tpl.is_system ? "系统预设" : "自定义"}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground">
                            {tpl.name}
                          </div>
                        </div>
                      </div>

                      <span className="flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0">
                        <GitBranch className="size-3" />
                        {tpl.nodes_count} 个协作节点
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {tpl.description || "暂无工作流流水线描述。"}
                    </p>

                    {/* Nodes flow preview pills */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {tpl.nodes.map((node, idx) => (
                        <div key={node.id} className="flex items-center gap-1">
                          <span className="rounded-lg bg-secondary/60 px-2 py-1 text-[11px] text-foreground font-mono">
                            {node.name}
                          </span>
                          {idx < tpl.nodes.length - 1 && (
                            <ChevronRight className="size-3 text-muted-foreground" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex items-center justify-between border-t border-border/60 pt-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setInspectTpl(tpl)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        链路节点详情
                      </button>
                      {!tpl.is_system && isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDelete(tpl)}
                          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => openRunModal(tpl)}
                      className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity active:scale-[0.98]"
                    >
                      <Play className="size-3.5" />
                      立即运行
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Run Modal with dynamic variable form */}
          {runningTpl && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
              <form
                onSubmit={handleRunSubmit}
                className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl space-y-5"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-5 text-primary" />
                    <h2 className="text-base font-bold text-foreground">
                      实例化运行 · {runningTpl.display_name}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRunningTpl(null)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      自定义任务标题 (选填)
                    </label>
                    <input
                      type="text"
                      placeholder={`e.g. ${runningTpl.display_name} - 专项任务`}
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {runningTpl.variables.length > 0 && (
                    <div className="space-y-3 border-t border-border/60 pt-3">
                      <div className="text-xs font-semibold text-foreground">流水线输入参数</div>
                      {runningTpl.variables.map((v) => (
                        <div key={v.key} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">
                              {v.label} {v.required && <span className="text-destructive">*</span>}
                            </label>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {`{{${v.key}}}`}
                            </span>
                          </div>
                          <input
                            type="text"
                            required={v.required}
                            value={runVariables[v.key] || ""}
                            placeholder={v.description || `输入 ${v.label}`}
                            onChange={(e) =>
                              setRunVariables((prev) => ({ ...prev, [v.key]: e.target.value }))
                            }
                            className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setRunningTpl(null)}
                    className="rounded-xl border border-border px-4 py-2 text-xs font-medium hover:bg-secondary"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingRun}
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {isSubmittingRun ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="size-3.5" />
                    )}
                    创建并启动任务
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Inspect Drawer */}
          {inspectTpl && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
              <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Workflow className="size-5 text-primary" />
                    <h2 className="text-base font-bold text-foreground">
                      {inspectTpl.display_name} · 协作链路节点
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectTpl(null)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {inspectTpl.nodes.map((node, idx) => (
                    <div
                      key={node.id}
                      className="rounded-xl border border-border bg-secondary/30 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-foreground">{node.name}</span>
                        </div>
                        <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                          角色: {node.agent_role}
                        </span>
                      </div>
                      <div className="rounded-lg bg-background/80 p-2.5 text-xs font-mono text-muted-foreground">
                        {node.prompt_template}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setInspectTpl(null)}
                    className="rounded-xl border border-border px-4 py-2 text-xs font-medium hover:bg-secondary"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Create Workflow Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
              <form
                onSubmit={handleCreateSubmit}
                className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Plus className="size-5 text-primary" />
                    <h2 className="text-base font-bold text-foreground">新建自定义工作流模板</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">
                        模板标识 (Unique Name) *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. backend-api-generator"
                        value={newTplName}
                        onChange={(e) => setNewTplName(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">
                        显示名称 *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. 后端 API 敏捷研发流水线"
                        value={newTplDisplayName}
                        onChange={(e) => setNewTplDisplayName(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">描述说明</label>
                    <input
                      type="text"
                      placeholder="e.g. 数据模型设计 -> 端点编写 -> 测试用例生成"
                      value={newTplDesc}
                      onChange={(e) => setNewTplDesc(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {/* Nodes Editor Simple View */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-foreground">
                        协作步骤节点 ({newNodes.length})
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setNewNodes((prev) => [
                            ...prev,
                            {
                              id: `node-${prev.length + 1}`,
                              name: `阶段 ${prev.length + 1}`,
                              agent_role: "coder",
                              prompt_template: "执行对应子任务",
                              dependencies: [],
                            },
                          ])
                        }
                        className="text-xs text-primary hover:underline"
                      >
                        + 添加节点
                      </button>
                    </div>

                    {newNodes.map((n, idx) => (
                      <div key={n.id} className="rounded-xl border border-border/80 bg-secondary/20 p-3 space-y-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            type="text"
                            placeholder="节点名称"
                            value={n.name}
                            onChange={(e) => {
                              const val = e.target.value
                              setNewNodes((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, name: val } : item))
                              )
                            }}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
                          />
                          <select
                            value={n.agent_role}
                            onChange={(e) => {
                              const val = e.target.value
                              setNewNodes((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, agent_role: val } : item))
                              )
                            }}
                            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono"
                          >
                            <option value="manager">manager</option>
                            <option value="coder">coder</option>
                            <option value="reviewer">reviewer</option>
                            <option value="researcher">researcher</option>
                            <option value="analyst">analyst</option>
                          </select>
                        </div>
                        <textarea
                          rows={2}
                          placeholder="Prompt 模板（可使用 {{var_name}} 占位符）"
                          value={n.prompt_template}
                          onChange={(e) => {
                            const val = e.target.value
                            setNewNodes((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, prompt_template: val } : item))
                            )
                          }}
                          className="w-full rounded-lg border border-border bg-background p-2 text-xs font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="rounded-xl border border-border px-4 py-2 text-xs font-medium hover:bg-secondary"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {isCreating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    创建模板
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
