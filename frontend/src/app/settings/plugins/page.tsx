"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Blocks,
  Code,
  Globe,
  Loader2,
  Lock,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { usePermissions } from "@/hooks/use-permissions"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { requestData } from "@/lib/task-api"
import { cn } from "@/lib/utils"
import type { PluginItem } from "@/types/plugin"

export default function PluginsSettingsPage() {
  const { activeWorkspace } = useWorkspaces()
  const { isAdmin } = usePermissions()

  const [plugins, setPlugins] = useState<PluginItem[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Manifest inspection drawer
  const [selectedPlugin, setSelectedPlugin] = useState<PluginItem | null>(null)

  // Register modal
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [regName, setRegName] = useState("")
  const [regDisplayName, setRegDisplayName] = useState("")
  const [regDesc, setRegDesc] = useState("")
  const [regAuthor, setRegAuthor] = useState("")
  const [regManifest, setRegManifest] = useState(
    JSON.stringify(
      {
        name: "my-custom-plugin",
        version: "1.0.0",
        display_name: "自定义扩展插件",
        tools: [
          {
            name: "fetch_data",
            description: "从外部接口拉取业务数据",
            parameters: { url: "string" },
          },
        ],
      },
      null,
      2
    )
  )
  const [isRegistering, setIsRegistering] = useState(false)

  const loadedWsIdRef = useRef<number | null>(null)

  const loadPlugins = useCallback(async (wsId?: number) => {
    setIsLoading(true)
    setMessage(null)
    try {
      const url = wsId ? `/api/v1/plugins?workspace_id=${wsId}` : "/api/v1/plugins"
      const data = await requestData<PluginItem[]>(url)
      setPlugins(data)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "获取插件失败" })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspace) return
    if (loadedWsIdRef.current === activeWorkspace.id) return
    loadedWsIdRef.current = activeWorkspace.id
    void loadPlugins(activeWorkspace.id)
  }, [activeWorkspace, loadPlugins])

  const handleToggle = async (plugin: PluginItem) => {
    if (!activeWorkspace || !isAdmin) return
    setActionLoadingId(plugin.id)
    setMessage(null)
    try {
      const nextState = !plugin.is_enabled
      await requestData(
        `/api/v1/workspaces/${activeWorkspace.id}/plugins/${plugin.id}/toggle`,
        {
          method: "POST",
          body: JSON.stringify({
            is_enabled: nextState,
          }),
        }
      )
      setMessage({
        type: "success",
        text: `已${nextState ? "启用" : "停用"}插件「${plugin.display_name}」`,
      })
      void loadPlugins(activeWorkspace.id)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "操作失败" })
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsRegistering(true)
    setMessage(null)
    try {
      await requestData<PluginItem>("/api/v1/plugins", {
        method: "POST",
        body: JSON.stringify({
          name: regName.trim(),
          display_name: regDisplayName.trim(),
          description: regDesc.trim() || undefined,
          author: regAuthor.trim() || undefined,
          manifest_json: regManifest,
          is_public: true,
        }),
      })
      setMessage({ type: "success", text: `插件「${regDisplayName}」注册成功` })
      setShowRegisterModal(false)
      setRegName("")
      setRegDisplayName("")
      setRegDesc("")
      if (activeWorkspace) {
        void loadPlugins(activeWorkspace.id)
      }
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "注册插件失败" })
    } finally {
      setIsRegistering(false)
    }
  }

  const filteredPlugins = plugins.filter(
    (p) =>
      p.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar connectionStatus="online" activeItem="settings" />

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Link
                  href="/settings"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <h1 className="text-2xl font-bold tracking-tight">插件注册中心</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                当前工作区：
                <span className="font-semibold text-foreground">
                  {activeWorkspace?.name || "默认工作区"}
                </span>{" "}
                · 扩展 Agent Function Calling 工具集与第三方服务热插拔
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => activeWorkspace && loadPlugins(activeWorkspace.id)}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-secondary transition-colors"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin text-primary")} />
                刷新
              </button>

              <button
                type="button"
                onClick={() => setShowRegisterModal(true)}
                className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
              >
                <Plus className="h-3.5 w-3.5" />
                注册新插件
              </button>
            </div>
          </div>

          {/* Feedback banner */}
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

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索插件名称、描述或作者..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Plugin Grid */}
          {isLoading && plugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-2">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm">正在加载插件仓库...</p>
            </div>
          ) : filteredPlugins.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center space-y-3">
              <Blocks className="size-10 text-muted-foreground mx-auto opacity-50" />
              <div className="text-sm font-medium text-foreground">未找到匹配的插件</div>
              <p className="text-xs text-muted-foreground">
                可点击右上角「注册新插件」发布自定义 OpenAPI/Manifest 工具
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredPlugins.map((plugin) => {
                const isWorking = actionLoadingId === plugin.id
                return (
                  <div
                    key={plugin.id}
                    className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                            <Wrench className="size-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="text-sm font-bold text-foreground">
                                {plugin.display_name}
                              </h2>
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                                v{plugin.version}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-muted-foreground">
                              {plugin.name}
                            </div>
                          </div>
                        </div>

                        {/* Status badge */}
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-medium shrink-0",
                            plugin.is_enabled
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-secondary text-muted-foreground"
                          )}
                        >
                          {plugin.is_enabled ? "已启用" : "未启用"}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {plugin.description || "暂无插件描述说明。"}
                      </p>

                      <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1">
                        <span className="flex items-center gap-1">
                          <Code className="size-3" />
                          {plugin.tools_count} 个工具声明
                        </span>
                        {plugin.author && (
                          <span className="flex items-center gap-1">
                            <Globe className="size-3" />
                            {plugin.author}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                      <button
                        type="button"
                        onClick={() => setSelectedPlugin(plugin)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        查看 Manifest
                      </button>

                      {isAdmin ? (
                        <button
                          type="button"
                          disabled={isWorking}
                          onClick={() => handleToggle(plugin)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                            plugin.is_enabled
                              ? "bg-destructive/15 text-destructive hover:bg-destructive/20"
                              : "bg-primary text-primary-foreground hover:opacity-90"
                          )}
                        >
                          {isWorking ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Power className="size-3.5" />
                          )}
                          {plugin.is_enabled ? "停用插件" : "在当前工作区启用"}
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Lock className="size-3" /> 仅管理员可配置
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Manifest Inspector Drawer */}
          {selectedPlugin && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
              <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-5 text-primary" />
                    <h2 className="text-base font-bold text-foreground">
                      {selectedPlugin.display_name} · Manifest 详情
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPlugin(null)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground mb-2">工具声明清单</h3>
                    <div className="space-y-2">
                      {selectedPlugin.manifest.tools && selectedPlugin.manifest.tools.length > 0 ? (
                        selectedPlugin.manifest.tools.map((t, idx) => (
                          <div key={idx} className="rounded-xl bg-secondary/40 p-3 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-mono font-bold text-foreground">
                                {t.name}
                              </span>
                              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-mono text-primary">
                                {t.method || "POST"}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{t.description}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">该插件未包含独立工具声明</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground mb-2">原始 JSON</h3>
                    <pre className="rounded-xl bg-secondary/30 p-3 text-xs font-mono text-foreground overflow-x-auto">
                      {JSON.stringify(selectedPlugin.manifest, null, 2)}
                    </pre>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setSelectedPlugin(null)}
                    className="rounded-xl border border-border px-4 py-2 text-xs font-medium hover:bg-secondary"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Register Plugin Modal */}
          {showRegisterModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
              <form
                onSubmit={handleRegister}
                className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Plus className="size-5 text-primary" />
                    <h2 className="text-base font-bold text-foreground">注册新插件</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRegisterModal(false)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">
                        插件英文标识 (Unique ID) *
                      </label>
                      <input
                        type="text"
                        required
                        pattern="[a-z0-9-_]+"
                        placeholder="e.g. jira-connector"
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">
                        插件显示名称 *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Jira 缺陷协同"
                        value={regDisplayName}
                        onChange={(e) => setRegDisplayName(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">作者 / 团队</label>
                      <input
                        type="text"
                        placeholder="e.g. DevOps Team"
                        value={regAuthor}
                        onChange={(e) => setRegAuthor(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">简要描述</label>
                      <input
                        type="text"
                        placeholder="e.g. 同步缺陷与触发部署"
                        value={regDesc}
                        onChange={(e) => setRegDesc(e.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Manifest JSON 定义 *
                    </label>
                    <textarea
                      rows={8}
                      required
                      value={regManifest}
                      onChange={(e) => setRegManifest(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      必须为合法的 JSON 格式，包含 tools 数组声明
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setShowRegisterModal(false)}
                    className="rounded-xl border border-border px-4 py-2 text-xs font-medium hover:bg-secondary"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isRegistering}
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {isRegistering ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                    提交注册
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
