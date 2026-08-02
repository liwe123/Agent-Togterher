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

const providerDisplayName = (p: string) =>
  providerLabels[p.toLowerCase()] ?? p

/* Model purpose → badge color */
const purposeColors: Record<string, string> = {
  manager_model: "bg-primary/12 text-primary",
  code_model: "bg-muted text-foreground/80",
  writing_model: "bg-orange-400/10 text-orange-300",
  review_model: "bg-emerald-500/15 text-emerald-400",
  cheap_model: "bg-zinc-500/15 text-zinc-400",
}

const roleLabels: Record<string, string> = {
  manager_model: "管理模型",
  code_model: "代码模型",
  writing_model: "写作模型",
  review_model: "审查模型",
  cheap_model: "低成本模型",
}

/** Known model purposes, used to populate the custom-model form. */
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
    addCustomModel,
    deleteCustomModel,
  } = useSettings()

  // Local state for API key editor
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({})

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

  // Merge env-var provider status with stored key status for the tiles.
  // A provider is "configured" if either source says it is.
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

  // Combined unique provider list for the API key editor
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

  // Display list: YAML models first, then custom models.
  const displayModels = useMemo(() => {
    const yaml = models.map((m) => ({ ...m, isCustom: false }))
    const custom = customModels.map((m) => ({ ...m, isCustom: true }))
    return [...yaml, ...custom]
  }, [models, customModels])

  // Provider options for the custom-model form.
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

  // Fallback options reference existing model names.
  const fallbackOptions = useMemo(
    () => displayModels.map((m) => m.name),
    [displayModels],
  )

  const handleSaveKey = async (provider: string) => {
    const apiKey = keyInputs[provider]?.trim()
    if (!apiKey) return
    setSavingKeys((prev) => ({ ...prev, [provider]: true }))
    setKeyErrors((prev) => ({ ...prev, [provider]: null }))
    try {
      await saveProviderKey(provider, apiKey)
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }))
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
    } catch (err) {
      setKeyErrors((prev) => ({
        ...prev,
        [provider]: err instanceof Error ? err.message : "删除失败",
      }))
    } finally {
      setSavingKeys((prev) => ({ ...prev, [provider]: false }))
    }
  }

  const isProviderConfigured = (provider: string) =>
    mergedProviders.find(
      (p) => p.provider.toLowerCase() === provider.toLowerCase(),
    )?.configured ?? false

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[232px_minmax(0,1fr)]">
      <AppSidebar connectionStatus="online" activeItem="settings" />

      <ErrorBoundary>
        <main className="console-main px-4 py-5 sm:px-6 md:px-8 md:py-8 xl:px-10">
          <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-7">
            {/* Header */}
            <header className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em]">
                  模型设置
                </h1>
                <p className="truncate text-xs text-muted-foreground sm:text-sm">
                  模型配置与 Provider 状态管理
                </p>
              </div>
              <Badge className="connection-chip" variant="outline">
                <Settings aria-hidden="true" className="mr-1 size-3" />
                {models.length + customModels.length} 个模型
              </Badge>
            </header>

            {/* Provider key status */}
            <section aria-label="Provider 密钥状态" className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">Provider 状态</h2>
                  <p className="mt-1 text-xs text-muted-foreground">API 密钥可用性概览</p>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{mergedProviders.length} SOURCES</span>
              </div>
              {isLoading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : (
                <div className="console-panel grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card/70 sm:grid-cols-3 lg:grid-cols-5">
                  {mergedProviders.map((p) => (
                    <div
                      key={p.provider}
                      className={cn(
                        "flex min-h-16 items-center gap-3 border-r border-b border-border/75 px-3 py-3 transition-colors lg:border-b-0",
                        p.configured
                          ? "bg-emerald-500/5"
                          : "bg-transparent",
                      )}
                    >
                      {p.configured ? (
                        <ShieldCheck
                          aria-hidden="true"
                          className="size-5 shrink-0 text-emerald-400"
                        />
                      ) : (
                        <ShieldX
                          aria-hidden="true"
                          className="size-5 shrink-0 text-muted-foreground"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">
                          {providerDisplayName(p.provider)}
                        </p>
                        <p
                          className={cn(
                            "text-[11px]",
                            p.configured
                              ? "text-emerald-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {p.configured ? "已配置" : "未配置"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* API Key management */}
            <section aria-label="API Key 管理" className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">API Key 管理</h2>
                  <p className="mt-1 text-xs text-muted-foreground">管理各 Provider 的 API 密钥</p>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{allProviders.length} PROVIDERS</span>
              </div>
              <div className="console-panel overflow-hidden rounded-xl border border-border bg-card/72">
                {isLoading ? (
                  <div className="space-y-0 divide-y divide-border">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-9 flex-1 rounded-lg" />
                        <Skeleton className="h-8 w-14 rounded-lg" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {allProviders.map((p) => {
                      const configured = isProviderConfigured(p.provider)
                      const isSaving = savingKeys[p.provider] ?? false
                      const err = keyErrors[p.provider] ?? null
                      const showKey = showKeys[p.provider] ?? false

                      return (
                        <div
                          key={p.provider}
                          className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5"
                        >
                          {/* Provider label */}
                          <span className="min-w-0 shrink-0 text-sm font-semibold sm:w-28">
                            {providerDisplayName(p.provider)}
                          </span>

                          {/* Input + buttons */}
                          <div className="flex min-w-0 flex-1 items-center gap-2">
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
                                  configured ? "••••••••" : "输入 API Key…"
                                }
                                disabled={isSaving}
                                className={cn(
                                  "w-full rounded-lg border bg-[oklch(0.195_0.014_70)] px-3 py-2 text-sm text-primary-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50",
                                  configured
                                    ? "border-[oklch(0.72_0.15_155)]"
                                    : "border-[oklch(0.31_0.018_70)]",
                                )}
                              />
                              {/* Eye toggle */}
                              <button
                                type="button"
                                aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                                onClick={() =>
                                  setShowKeys((prev) => {
                                    const current = prev[p.provider] ?? false
                                    return { ...prev, [p.provider]: !current }
                                  })
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
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
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 aria-hidden="true" className="size-3.5" />
                              </Button>
                            )}
                          </div>

                          {/* Error message */}
                          {err && (
                            <p className="text-[11px] text-destructive">{err}</p>
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
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                <p className="min-w-0 flex-1 truncate">{error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={retry}
                >
                  重试
                </Button>
              </div>
            ) : null}

            {/* Model list */}
            <section aria-label="模型配置列表">
              <div className="console-panel overflow-hidden rounded-xl border border-border bg-card/72">
                <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="section-mark flex size-9 shrink-0 items-center justify-center rounded-md">
                      <Cpu aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold sm:text-base">
                        模型列表
                      </h2>
                      <p className="text-[11px] text-muted-foreground sm:text-xs">
                        models.yaml 配置与自定义模型
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {displayModels.length} 个
                  </span>
                </div>

                {isLoading ? (
                  <ModelListSkeleton />
                ) : error && displayModels.length === 0 ? (
                  <ModelListError error={error} onRetry={retry} />
                ) : displayModels.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Cpu aria-hidden="true" className="size-5" />
                    </span>
                    <div>
                      <h3 className="text-sm font-medium">暂无模型配置</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        请检查 config/models.yaml 文件或添加自定义模型。
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-px bg-border/40 sm:grid-cols-1 lg:grid-cols-2">
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
                <div className="border-t border-border px-4 py-4 sm:px-5">
                  {!showAddForm ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddForm(true)}
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                      添加自定义模型
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-semibold">添加自定义模型</h3>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            注册 models.yaml 之外的额外模型配置
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
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

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
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
                            className="w-full rounded-lg border border-[oklch(0.31_0.018_70)] bg-[oklch(0.195_0.014_70)] px-3 py-2 text-sm text-primary-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
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
                            className="w-full rounded-lg border border-[oklch(0.31_0.018_70)] bg-[oklch(0.195_0.014_70)] px-3 py-2 text-sm text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            {providerOptions.map((p) => (
                              <option key={p} value={p}>
                                {providerDisplayName(p)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
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
                            className="w-full rounded-lg border border-[oklch(0.31_0.018_70)] bg-[oklch(0.195_0.014_70)] px-3 py-2 text-sm text-primary-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            用途 <span className="text-muted-foreground/60">可选</span>
                          </span>
                          <select
                            value={modelForm.purpose}
                            onChange={(e) =>
                              setModelForm((prev) => ({
                                ...prev,
                                purpose: e.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-[oklch(0.31_0.018_70)] bg-[oklch(0.195_0.014_70)] px-3 py-2 text-sm text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Fallback <span className="text-muted-foreground/60">可选</span>
                          </span>
                          <select
                            value={modelForm.fallback_model}
                            onChange={(e) =>
                              setModelForm((prev) => ({
                                ...prev,
                                fallback_model: e.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-[oklch(0.31_0.018_70)] bg-[oklch(0.195_0.014_70)] px-3 py-2 text-sm text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                        <p className="text-xs text-destructive">
                          {modelFormError}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
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
                          添加
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
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
  const colorClass = purposeColors[model.name] ?? "bg-muted text-muted-foreground"

  return (
    <div className="flex flex-col gap-4 bg-card/60 px-4 py-5 transition-colors hover:bg-muted/25 sm:px-5">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
              colorClass,
            )}
          >
            {model.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold">
                {roleLabels[model.name] ?? model.name}
              </h3>
              {isCustom && (
                <Badge
                  variant="secondary"
                  className="shrink-0 px-1.5 text-[10px]"
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
              className="text-muted-foreground hover:text-destructive"
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
              "shrink-0 text-[10px]",
              providerConfigured
                ? "border-emerald-500/40 text-emerald-400"
                : "border-orange-500/40 text-orange-400",
            )}
          >
            {providerConfigured ? "已配置" : "未配置"}
          </Badge>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <DetailItem label="Provider" value={providerDisplayName(model.provider)} />
        <DetailItem label="Model ID" value={model.model} mono />
        <DetailItem label="用途" value={model.purpose} span2 />
        {model.fallback_model ? (
          <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
            <ChevronRight aria-hidden="true" className="size-3" />
            <span>Fallback：</span>
            <span className="font-mono text-foreground/80">
              {roleLabels[model.fallback_model] ?? model.fallback_model}
            </span>
          </div>
        ) : (
          <div className="col-span-2 text-muted-foreground">无 Fallback</div>
        )}
      </div>

      {/* Test button + result */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          variant={testState.status === "error" ? "destructive" : "outline"}
          className="w-full"
          disabled={testState.status === "testing"}
          onClick={onTest}
        >
          {testState.status === "testing" ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="mr-1.5 size-3.5 animate-spin"
              />
              测试中…
            </>
          ) : (
            <>
              <FlaskConical aria-hidden="true" className="mr-1.5 size-3.5" />
              测试连通性
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
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "block truncate text-foreground/90",
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
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
        <CheckCircle2 aria-hidden="true" className="size-3.5" />
        测试成功
        {result.fallback_used && (
          <Badge variant="outline" className="ml-1 text-[10px]">
            Fallback
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock aria-hidden="true" className="size-2.5" />
            延迟
          </span>
          <span className="font-mono font-semibold">
            {result.latency_ms} ms
          </span>
        </div>
        <div>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Zap aria-hidden="true" className="size-2.5" />
            Token
          </span>
          <span className="font-mono font-semibold">
            {result.usage.total_tokens}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">模型</span>
          <span className="block truncate font-mono">{result.model_name}</span>
        </div>
      </div>
      {result.content && (
        <div className="mt-2 border-t border-emerald-500/15 pt-2">
          <span className="text-[11px] text-muted-foreground">输出：</span>
          <p className="mt-0.5 line-clamp-3 font-mono text-[11px] text-foreground/80">
            {result.content}
          </p>
        </div>
      )}
    </div>
  )
}

function TestResultError({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-destructive">
        <XCircle aria-hidden="true" className="size-3.5" />
        测试失败
      </div>
      <p className="line-clamp-4 text-[11px] leading-5 text-destructive/80">
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
    <div className="grid gap-px bg-border/40 lg:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-3 bg-card/60 px-5 py-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
          <Skeleton className="h-9 w-full rounded-md" />
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
      <span className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertCircle aria-hidden="true" className="size-5" />
      </span>
      <div className="max-w-md">
        <h3 className="text-sm font-semibold">无法加载模型配置</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {error}
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        重新加载
      </Button>
    </div>
  )
}
