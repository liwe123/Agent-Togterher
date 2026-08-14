"use client"

import { useMemo, useState } from "react"

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  FlaskConical,
  LoaderCircle,
  Plus,
  Save,
  Settings,
  ShieldCheck,
  ShieldX,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { ErrorBoundary } from "@/components/error-boundary"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/hooks/use-settings"
import { cn } from "@/lib/utils"
import type { CustomModelConfig, ModelConfig, TestState } from "@/types/settings"

/* -------------------------------------------------------------------------- */
/* Provider display helpers                                                   */
/* -------------------------------------------------------------------------- */

const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen / DashScope",
  dashscope: "DashScope",
}

const titleCaseProvider = (name: string) =>
  name
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(".")

const providerDisplayName = (p: string) =>
  providerLabels[p.toLowerCase()] ?? titleCaseProvider(p.toLowerCase())

/* Model purpose → badge color */
const purposeColors: Record<string, string> = {
  manager_model: "bg-primary/20 text-primary border border-primary/30",
  code_model: "bg-secondary text-foreground/90 border border-border",
  writing_model: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  review_model: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  cheap_model: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
}

const roleLabels: Record<string, string> = {
  manager_model: "管理模型",
  code_model: "代码模型",
  writing_model: "写作模型",
  review_model: "审查模型",
  cheap_model: "低成本模型",
}

const purposeOptions = Object.keys(roleLabels)

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SettingsPage() {
  const {
    models,
    providers,
    providerKeys,
    customModels,
    isLoading,
    error,
    retry,
    testStates,
    testModel,
    saveProviderKey,
    removeProviderKey,
    getProviderKey,
    addCustomModel,
    deleteCustomModel,
  } = useSettings()

  // Local state for API key editor
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({})

  // Local state for the "add provider" form
  const [addProviderName, setAddProviderName] = useState("")
  const [addProviderKey, setAddProviderKey] = useState("")
  const [addingProvider, setAddingProvider] = useState(false)
  const [addProviderError, setAddProviderError] = useState<string | null>(null)

  // Local state for the "add custom model" form
  const [showAddForm, setShowAddForm] = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const [deletingModels, setDeletingModels] = useState<Record<string, boolean>>({})
  const [modelFormError, setModelFormError] = useState<string | null>(null)
  const [modelForm, setModelForm] = useState({
    name: "",
    provider: "openai",
    model: "",
    purpose: "",
    fallback_model: "",
  })

  const resetModelForm = () =>
    setModelForm({
      name: "",
      provider: "openai",
      model: "",
      purpose: "",
      fallback_model: "",
    })

  const handleAddCustomModel = async () => {
    const name = modelForm.name.trim()
    const model = modelForm.model.trim()
    if (!name || !model) {
      setModelFormError("名称与模型 ID 为必填项")
      return
    }
    setSavingModel(true)
    setModelFormError(null)
    try {
      await addCustomModel({
        name,
        provider: modelForm.provider,
        model,
        purpose: modelForm.purpose.trim() || undefined,
        fallback_model: modelForm.fallback_model.trim() || null,
      })
      resetModelForm()
      setShowAddForm(false)
    } catch (err) {
      setModelFormError(
        err instanceof Error ? err.message : "添加自定义模型失败",
      )
    } finally {
      setSavingModel(false)
    }
  }

  const handleDeleteCustomModel = async (model: CustomModelConfig) => {
    if (
      !window.confirm(
        `确定删除自定义模型「${model.name}」吗？该操作不可撤销。`,
      )
    ) {
      return
    }
    setDeletingModels((prev) => ({ ...prev, [model.name]: true }))
    try {
      await deleteCustomModel(model.name)
    } finally {
      setDeletingModels((prev) => ({ ...prev, [model.name]: false }))
    }
  }

  const mergedProviders = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const p of providers) {
      map.set(p.provider.toLowerCase(), p.configured)
    }
    for (const pk of providerKeys) {
      if (pk.configured) {
        map.set(pk.provider.toLowerCase(), true)
      }
    }
    return Array.from(map.entries()).map(([provider, configured]) => ({
      provider,
      configured,
    }))
  }, [providers, providerKeys])

  const allProviders = useMemo(() => {
    const seen = new Set<string>()
    const result: { provider: string; configured: boolean }[] = []
    for (const pk of providerKeys) {
      const key = pk.provider.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        result.push(pk)
      }
    }
    for (const p of providers) {
      const key = p.provider.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        result.push(p)
      }
    }
    return result
  }, [providerKeys, providers])

  const displayModels = useMemo(() => {
    const yaml = models.map((m) => ({ ...m, isCustom: false }))
    const custom = customModels.map((m) => ({ ...m, isCustom: true }))
    return [...yaml, ...custom]
  }, [models, customModels])

  const providerOptions = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const key of Object.keys(providerLabels)) {
      const k = key.toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        result.push(k)
      }
    }
    for (const p of allProviders) {
      const k = p.provider.toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        result.push(k)
      }
    }
    return result
  }, [allProviders])

  const fallbackOptions = useMemo(() => {
    const names = new Set<string>()
    for (const m of models) names.add(m.name)
    for (const cm of customModels) names.add(cm.name)
    return Array.from(names)
  }, [models, customModels])

  const isProviderConfigured = (provider: string): boolean => {
    const pLower = provider.toLowerCase()
    const pk = providerKeys.find((k) => k.provider.toLowerCase() === pLower)
    if (pk?.configured) return true
    const p = providers.find((pr) => pr.provider.toLowerCase() === pLower)
    return p?.configured ?? false
  }

  const handleSaveKey = async (provider: string) => {
    const val = keyInputs[provider]?.trim()
    if (!val) return
    setSavingKeys((prev) => ({ ...prev, [provider]: true }))
    setKeyErrors((prev) => ({ ...prev, [provider]: null }))
    try {
      await saveProviderKey(provider, val)
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }))
      setShowKeys((prev) => ({ ...prev, [provider]: false }))
    } catch (err) {
      setKeyErrors((prev) => ({
        ...prev,
        [provider]: err instanceof Error ? err.message : "保存失败",
      }))
    } finally {
      setSavingKeys((prev) => ({ ...prev, [provider]: false }))
    }
  }

  const handleRemoveKey = async (provider: string) => {
    setSavingKeys((prev) => ({ ...prev, [provider]: true }))
    setKeyErrors((prev) => ({ ...prev, [provider]: null }))
    try {
      await removeProviderKey(provider)
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }))
      setShowKeys((prev) => ({ ...prev, [provider]: false }))
    } catch (err) {
      setKeyErrors((prev) => ({
        ...prev,
        [provider]: err instanceof Error ? err.message : "删除失败",
      }))
    } finally {
      setSavingKeys((prev) => ({ ...prev, [provider]: false }))
    }
  }

  const handleToggleKey = async (provider: string) => {
    const current = showKeys[provider] ?? false
    if (!current) {
      if (!keyInputs[provider]) {
        try {
          const res = await getProviderKey(provider)
          if (res?.masked_key) {
            setKeyInputs((prev) => ({ ...prev, [provider]: res.masked_key ?? "" }))
          }
        } catch {
          // ignore
        }
      }
      setShowKeys((prev) => ({ ...prev, [provider]: true }))
    } else {
      setShowKeys((prev) => ({ ...prev, [provider]: false }))
    }
  }

  const handleAddProvider = async () => {
    const name = addProviderName.trim().toLowerCase()
    const key = addProviderKey.trim()
    if (!name || !key) return

    setAddingProvider(true)
    setAddProviderError(null)
    try {
      await saveProviderKey(name, key)
      setAddProviderName("")
      setAddProviderKey("")
    } catch (err) {
      setAddProviderError(
        err instanceof Error ? err.message : "添加厂商失败",
      )
    } finally {
      setAddingProvider(false)
    }
  }

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[76px_minmax(0,1fr)]">
      <AppSidebar connectionStatus="online" activeItem="settings" />

      <ErrorBoundary>
        <main className="console-main px-4 py-5 sm:px-6 md:px-8 md:py-8 xl:px-10">
          <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-7">
            {/* Header */}
            <header className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-[1.85rem] font-bold tracking-[-0.03em] text-foreground">设置中心</h1>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  大模型配置、API 密钥与连通性测试
                </p>
              </div>
              <Badge variant="outline" className="connection-chip rounded-full font-medium">
                <Settings aria-hidden="true" className="mr-1.5 size-3.5 text-primary" />
                {models.length + customModels.length} 个模型已挂载
              </Badge>
            </header>

            {/* Provider key status */}
            <section aria-label="Provider 密钥状态" className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Provider 状态</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">各 AI 厂商密钥可用性总览</p>
                </div>
                <span className="rounded-full bg-secondary/60 px-3 py-1 font-mono text-[11px] text-muted-foreground font-medium">{mergedProviders.length} SOURCES</span>
              </div>
              {isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-18 rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {mergedProviders.map((p) => (
                    <div
                      key={p.provider}
                      className={cn(
                        "flex min-h-18 items-center gap-3 rounded-2xl border p-4 shadow-sm transition-all duration-200",
                        p.configured
                          ? "border-emerald-500/30 bg-emerald-500/8 text-foreground"
                          : "border-border/70 bg-card/85 text-muted-foreground",
                      )}
                    >
                      {p.configured ? (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                          <ShieldCheck aria-hidden="true" className="size-5" />
                        </span>
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                          <ShieldX aria-hidden="true" className="size-5" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-foreground">
                          {providerDisplayName(p.provider)}
                        </p>
                        <p
                          className={cn(
                            "text-[11px] font-medium",
                            p.configured
                              ? "text-emerald-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {p.configured ? "已就绪" : "未配置"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* API Key management */}
            <section aria-label="API Key 管理" className="flex flex-col gap-3.5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">API Key 管理</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">安全管理各 Provider 的 API 密钥（数据库存储优先于环境变量）</p>
                </div>
                <span className="rounded-full bg-secondary/60 px-3 py-1 font-mono text-[11px] text-muted-foreground font-medium">{allProviders.length} PROVIDERS</span>
              </div>

              {/* Add-provider form */}
              <div className="rounded-3xl border border-border/70 bg-card/90 p-5 sm:p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-foreground">添加新厂商</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  输入厂商名称与 API Key，保存后即可在下方编辑、测试或删除
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleAddProvider()
                  }}
                  className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center"
                >
                  <input
                    type="text"
                    value={addProviderName}
                    onChange={(e) =>
                      setAddProviderName(e.target.value.toLowerCase())
                    }
                    placeholder="如 moonshot / zhipu / x.ai"
                    disabled={addingProvider}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-10 w-full rounded-2xl border border-border/70 bg-secondary/40 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 sm:w-60"
                  />
                  <input
                    type="password"
                    value={addProviderKey}
                    onChange={(e) => setAddProviderKey(e.target.value)}
                    placeholder="输入对应厂商的 API Key…"
                    disabled={addingProvider}
                    autoComplete="off"
                    className="h-10 w-full flex-1 rounded-2xl border border-border/70 bg-secondary/40 px-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-10 rounded-full px-5 font-semibold shadow-sm"
                    disabled={
                      addingProvider ||
                      !addProviderName.trim() ||
                      !addProviderKey.trim()
                    }
                  >
                    {addingProvider ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-3.5 animate-spin"
                      />
                    ) : (
                      <Plus aria-hidden="true" className="size-4" />
                    )}
                    添加厂商
                  </Button>
                </form>
                {addProviderError && (
                  <p className="mt-2 text-xs text-destructive font-medium">
                    {addProviderError}
                  </p>
                )}
              </div>

              <div className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
                {isLoading ? (
                  <div className="space-y-0 divide-y divide-border/60">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="flex items-center gap-3 px-5 py-4">
                        <Skeleton className="h-5 w-24 rounded-full" />
                        <Skeleton className="h-10 flex-1 rounded-2xl" />
                        <Skeleton className="h-9 w-16 rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {allProviders.map((p) => {
                      const configured = isProviderConfigured(p.provider)
                      const isSaving = savingKeys[p.provider] ?? false
                      const err = keyErrors[p.provider] ?? null
                      const showKey = showKeys[p.provider] ?? false

                      return (
                        <div
                          key={p.provider}
                          className="flex flex-col gap-2.5 px-5 py-4 sm:flex-row sm:items-center sm:gap-4 hover:bg-secondary/20 transition-colors"
                        >
                          {/* Provider label */}
                          <span className="min-w-0 shrink-0 text-sm font-bold text-foreground sm:w-32">
                            {providerDisplayName(p.provider)}
                          </span>

                          {/* Input + buttons */}
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <div className="relative flex-1">
                              <input
                                type={showKey ? "text" : "password"}
                                value={keyInputs[p.provider] ?? ""}
                                onChange={(e) =>
                                  setKeyInputs((prev) => ({
                                    ...prev,
                                    [p.provider]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault()
                                    handleSaveKey(p.provider)
                                  }
                                }}
                                placeholder={
                                  configured ? "••••••••••••••••" : "输入 API Key…"
                                }
                                disabled={isSaving}
                                className={cn(
                                  "h-10 w-full rounded-2xl border bg-secondary/40 px-4 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition-all",
                                  configured
                                    ? "border-emerald-500/40"
                                    : "border-border/70",
                                )}
                              />
                              {/* Eye toggle */}
                              <button
                                type="button"
                                aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                                onClick={() => void handleToggleKey(p.provider)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                              >
                                {showKey ? (
                                  <EyeOff aria-hidden="true" className="size-4" />
                                ) : (
                                  <Eye aria-hidden="true" className="size-4" />
                                )}
                              </button>
                            </div>

                            {/* Save button */}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full px-4 shadow-sm"
                              disabled={isSaving || !keyInputs[p.provider]?.trim()}
                              onClick={() => handleSaveKey(p.provider)}
                            >
                              {isSaving ? (
                                <LoaderCircle
                                  aria-hidden="true"
                                  className="size-3.5 animate-spin"
                                />
                              ) : (
                                <Save aria-hidden="true" className="size-3.5" />
                              )}
                              <span className="hidden sm:inline">保存</span>
                            </Button>

                            {/* Delete button */}
                            {configured && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isSaving}
                                onClick={() => handleRemoveKey(p.provider)}
                                className="rounded-full text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 aria-hidden="true" className="size-4" />
                              </Button>
                            )}
                          </div>

                          {/* Error message */}
                          {err && (
                            <p className="text-xs text-destructive font-medium">{err}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Error banner */}
            {error && models.length > 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-sm">
                <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                <p className="min-w-0 flex-1 truncate">{error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={retry}
                >
                  重试
                </Button>
              </div>
            ) : null}

            {/* Model list */}
            <section aria-label="模型配置列表" className="flex flex-col gap-3.5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">模型列表与连通性</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">已注册模型、Fallback 降级链与即时 Ping 测速</p>
                </div>
                <span className="rounded-full bg-secondary/60 px-3 py-1 font-mono text-[11px] text-muted-foreground font-medium">{displayModels.length} MODELS</span>
              </div>

              <div className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
                {isLoading ? (
                  <ModelListSkeleton />
                ) : error && displayModels.length === 0 ? (
                  <ModelListError error={error} onRetry={retry} />
                ) : displayModels.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                      <Cpu aria-hidden="true" className="size-5" />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">暂无模型配置</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        请检查 config/models.yaml 文件或添加自定义模型。
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-px bg-border/60 sm:grid-cols-1 lg:grid-cols-2">
                    {displayModels.map((model) => (
                      <ModelCard
                        key={`${model.isCustom ? "custom" : "yaml"}-${model.name}`}
                        model={model}
                        isCustom={model.isCustom}
                        testState={
                          testStates[model.name] ?? { status: "idle" }
                        }
                        onTest={() => testModel(model.name)}
                        onDelete={() => handleDeleteCustomModel(model)}
                        deleting={deletingModels[model.name] ?? false}
                        providerConfigured={isProviderConfigured(model.provider)}
                      />
                    ))}
                  </div>
                )}

                {/* Add custom model */}
                <div className="border-t border-border/60 p-5 sm:p-6 bg-card/40">
                  {!showAddForm ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full px-4.5 shadow-sm"
                      onClick={() => setShowAddForm(true)}
                    >
                      <Plus aria-hidden="true" className="size-4" />
                      添加自定义模型
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">添加自定义模型</h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            注册 models.yaml 之外的任意 Provider / Model ID 组合与降级链
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-full"
                          disabled={savingModel}
                          onClick={() => {
                            setShowAddForm(false)
                            setModelFormError(null)
                          }}
                        >
                          <ChevronUp aria-hidden="true" className="size-3.5" />
                          收起
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            名称 <span className="text-destructive">*</span>
                          </span>
                          <input
                            type="text"
                            value={modelForm.name}
                            onChange={(e) =>
                              setModelForm((prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            placeholder="如 code_model"
                            className="h-10 w-full rounded-2xl border border-border/70 bg-secondary/40 px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            Provider <span className="text-destructive">*</span>
                          </span>
                          <select
                            value={modelForm.provider}
                            onChange={(e) =>
                              setModelForm((prev) => ({
                                ...prev,
                                provider: e.target.value,
                              }))
                            }
                            className="h-10 w-full rounded-2xl border border-border/70 bg-secondary/40 px-3.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            {providerOptions.map((p) => (
                              <option key={p} value={p}>
                                {providerDisplayName(p)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            模型 ID <span className="text-destructive">*</span>
                          </span>
                          <input
                            type="text"
                            value={modelForm.model}
                            onChange={(e) =>
                              setModelForm((prev) => ({
                                ...prev,
                                model: e.target.value,
                              }))
                            }
                            placeholder="如 gpt-4o-mini"
                            className="h-10 w-full rounded-2xl border border-border/70 bg-secondary/40 px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            用途 <span className="text-muted-foreground font-normal">可选</span>
                          </span>
                          <select
                            value={modelForm.purpose}
                            onChange={(e) =>
                              setModelForm((prev) => ({
                                ...prev,
                                purpose: e.target.value,
                              }))
                            }
                            className="h-10 w-full rounded-2xl border border-border/70 bg-secondary/40 px-3.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            <option value="">无</option>
                            {purposeOptions.map((p) => (
                              <option key={p} value={p}>
                                {roleLabels[p]}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            Fallback <span className="text-muted-foreground font-normal">可选</span>
                          </span>
                          <select
                            value={modelForm.fallback_model}
                            onChange={(e) =>
                              setModelForm((prev) => ({
                                ...prev,
                                fallback_model: e.target.value,
                              }))
                            }
                            className="h-10 w-full rounded-2xl border border-border/70 bg-secondary/40 px-3.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            <option value="">无</option>
                            {fallbackOptions.map((name) => (
                              <option key={name} value={name}>
                                {roleLabels[name] ?? name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {modelFormError && (
                        <p className="text-xs text-destructive font-medium">
                          {modelFormError}
                        </p>
                      )}

                      <div className="flex items-center gap-2.5 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-full px-5 shadow-sm font-semibold"
                          disabled={
                            savingModel ||
                            !modelForm.name.trim() ||
                            !modelForm.provider.trim() ||
                            !modelForm.model.trim()
                          }
                          onClick={handleAddCustomModel}
                        >
                          {savingModel ? (
                            <LoaderCircle
                              aria-hidden="true"
                              className="size-3.5 animate-spin"
                            />
                          ) : (
                            <Plus aria-hidden="true" className="size-3.5" />
                          )}
                          确认添加
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="rounded-full px-4"
                          disabled={savingModel}
                          onClick={() => {
                            resetModelForm()
                            setModelFormError(null)
                          }}
                        >
                          重置
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </main>
      </ErrorBoundary>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Model Card                                                                 */
/* -------------------------------------------------------------------------- */

function ModelCard({
  model,
  isCustom,
  testState,
  onTest,
  onDelete,
  deleting,
  providerConfigured,
}: {
  model: ModelConfig
  isCustom: boolean
  testState: TestState
  onTest: () => void
  onDelete: () => void
  deleting: boolean
  providerConfigured: boolean
}) {
  const colorClass = purposeColors[model.name] ?? "bg-secondary text-muted-foreground border border-border"

  return (
    <div className="flex flex-col justify-between gap-4 bg-card/90 p-5.5 transition-all hover:bg-secondary/30">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex size-9.5 shrink-0 items-center justify-center rounded-2xl text-xs font-bold shadow-sm",
              colorClass,
            )}
          >
            {model.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-bold text-foreground">
                {roleLabels[model.name] ?? model.name}
              </h3>
              {isCustom && (
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full px-2 text-[10px] font-medium"
                >
                  自定义
                </Badge>
              )}
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {model.name}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isCustom && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={deleting}
              onClick={onDelete}
              aria-label={`删除自定义模型 ${model.name}`}
              className="rounded-full text-muted-foreground hover:text-destructive"
            >
              {deleting ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 animate-spin"
                />
              ) : (
                <Trash2 aria-hidden="true" className="size-3.5" />
              )}
            </Button>
          )}
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 rounded-full text-[10px] font-medium",
              providerConfigured
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400",
            )}
          >
            {providerConfigured ? "已就绪" : "未配置"}
          </Badge>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs rounded-2xl border border-border/60 bg-secondary/35 p-3.5">
        <DetailItem label="Provider" value={providerDisplayName(model.provider)} />
        <DetailItem label="Model ID" value={model.model} mono />
        <DetailItem label="用途" value={model.purpose} span2 />
        {model.fallback_model ? (
          <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground text-[11px]">
            <ChevronRight aria-hidden="true" className="size-3.5 text-primary" />
            <span>Fallback 降级：</span>
            <span className="font-mono text-primary font-medium">
              {roleLabels[model.fallback_model] ?? model.fallback_model}
            </span>
          </div>
        ) : (
          <div className="col-span-2 text-muted-foreground text-[11px]">无 Fallback 降级配置</div>
        )}
      </div>

      {/* Test button + result */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant={testState.status === "error" ? "destructive" : "outline"}
          className="w-full rounded-full shadow-sm font-medium"
          disabled={testState.status === "testing"}
          onClick={onTest}
        >
          {testState.status === "testing" ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="mr-1.5 size-3.5 animate-spin"
              />
              正在测试 API 连通性…
            </>
          ) : (
            <>
              <FlaskConical aria-hidden="true" className="mr-1.5 size-3.5 text-primary" />
              测试连通性与延迟
            </>
          )}
        </Button>

        {testState.status === "success" && (
          <TestResultSuccess result={testState.result} />
        )}
        {testState.status === "error" && (
          <TestResultError error={testState.error} />
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Detail helpers                                                             */
/* -------------------------------------------------------------------------- */

function DetailItem({
  label,
  value,
  mono,
  span2,
}: {
  label: string
  value: string
  mono?: boolean
  span2?: boolean
}) {
  return (
    <div className={cn("min-w-0", span2 && "col-span-2")}>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          "block truncate text-foreground font-medium text-xs mt-0.5",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function TestResultSuccess({
  result,
}: {
  result: NonNullable<Extract<TestState, { status: "success" }>["result"]>
}) {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
        <CheckCircle2 aria-hidden="true" className="size-4" />
        连通性测试通过
        {result.fallback_used && (
          <Badge variant="outline" className="ml-1 rounded-full text-[10px] bg-primary/20 text-primary border-primary/40">
            Fallback 触发
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock aria-hidden="true" className="size-3" />
            延迟
          </span>
          <span className="font-mono font-bold text-foreground">
            {result.latency_ms} ms
          </span>
        </div>
        <div>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Zap aria-hidden="true" className="size-3" />
            Token
          </span>
          <span className="font-mono font-bold text-foreground">
            {result.usage.total_tokens}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">实际生效模型</span>
          <span className="block truncate font-mono font-semibold text-primary">{result.model_name}</span>
        </div>
      </div>
      {result.content && (
        <div className="mt-2.5 border-t border-emerald-500/20 pt-2">
          <span className="text-[11px] font-medium text-muted-foreground">模型回包预览：</span>
          <p className="mt-0.5 line-clamp-3 font-mono text-[11px] leading-relaxed text-foreground/90">
            {result.content}
          </p>
        </div>
      )}
    </div>
  )
}

function TestResultError({ error }: { error: string }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
        <XCircle aria-hidden="true" className="size-4" />
        测试失败
      </div>
      <p className="line-clamp-4 text-[11px] leading-relaxed text-destructive font-mono">
        {error}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Loading / Error states                                                     */
/* -------------------------------------------------------------------------- */

function ModelListSkeleton() {
  return (
    <div className="grid gap-px bg-border/60 lg:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-3.5 bg-card/70 p-5.5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9.5 rounded-2xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32 rounded-full" />
              <Skeleton className="h-3 w-24 rounded-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-10 w-full rounded-2xl" />
            <Skeleton className="h-10 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-9 w-full rounded-full" />
        </div>
      ))}
    </div>
  )
}

function ModelListError({
  error,
  onRetry,
}: {
  error: string
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertCircle aria-hidden="true" className="size-5" />
      </span>
      <div className="max-w-md">
        <h3 className="text-sm font-semibold text-foreground">无法加载模型配置</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {error}
        </p>
      </div>
      <Button type="button" variant="outline" className="rounded-full" onClick={onRetry}>
        重新加载
      </Button>
    </div>
  )
}
