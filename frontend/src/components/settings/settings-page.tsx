"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  AlertCircle,
  Blocks,
  CheckCircle2,
  ChevronRight,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  Eye,
  EyeOff,
  FlaskConical,
  Gauge,
  KeyRound,
  LoaderCircle,
  Palette,
  Plus,
  Save,
  Settings,
  Shield,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Trash2,
  Users,
  XCircle,
  Zap,
} from "@/components/ui/icons"

import { AppSidebar } from "@/components/console/app-sidebar"
import { ErrorBoundary } from "@/components/error-boundary"
import { AppearanceCard } from "@/components/settings/appearance-card"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState, InlineError } from "@/components/ui/feedback"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/hooks/use-settings"
import { useWorkspaceConnection } from "@/hooks/use-workspace-connection"
import { useWorkspaces } from "@/hooks/use-workspaces"
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

const roleLabels: Record<string, string> = {
  manager_model: "管理模型",
  code_model: "代码模型",
  writing_model: "写作模型",
  review_model: "审查模型",
  cheap_model: "低成本模型",
}

const purposeOptions = Object.keys(roleLabels)

const FIELD_CLASS =
  "h-9 w-full rounded-[10px] border border-console-line bg-console-surface-2 px-3 text-[13px] text-console-ink placeholder:text-console-ink-3 transition-colors focus:border-console-accent focus:outline-none focus:ring-2 focus:ring-console-accent/20 disabled:opacity-50"

const ROW_CLASS =
  "flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-console-hover/40"

/* -------------------------------------------------------------------------- */
/* Settings information architecture                                          */
/* -------------------------------------------------------------------------- */

const SETTINGS_SECTIONS = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "models", label: "模型与密钥", icon: KeyRound },
  { id: "appearance", label: "外观", icon: Palette },
] as const

const SETTINGS_PAGES = [
  { label: "审计", href: "/settings/audit", icon: Shield },
  { label: "成本", href: "/settings/cost", icon: Coins },
  { label: "配额", href: "/settings/quota", icon: Gauge },
  { label: "插件", href: "/settings/plugins", icon: Blocks },
  { label: "成员", href: "/settings/members", icon: Users },
] as const

const MANAGEMENT_ENTRIES = [
  {
    label: "成员与权限",
    description: "多租户角色与邀请",
    href: "/settings/members",
    icon: Users,
  },
  {
    label: "操作审计日志",
    description: "安全合规操作流",
    href: "/settings/audit",
    icon: Shield,
  },
  {
    label: "成本中心统计",
    description: "费用趋势与 Top 任务",
    href: "/settings/cost",
    icon: Coins,
  },
  {
    label: "配额与限流",
    description: "预算水位与熔断规则",
    href: "/settings/quota",
    icon: Gauge,
  },
  {
    label: "插件注册中心",
    description: "工具生态与热插拔",
    href: "/settings/plugins",
    icon: Blocks,
  },
] as const

const connectionLabels: Record<string, string> = {
  online: "已连接",
  connecting: "连接中",
  offline: "未连接",
}

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
  const { activeWorkspace } = useWorkspaces()
  const connectionStatus = useWorkspaceConnection(activeWorkspace?.id ?? null)

  const [activeSection, setActiveSection] = useState<string>("general")

  // Local state for API key editor
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({})
  const [keySuccess, setKeySuccess] = useState<Record<string, string | null>>({})

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
  // 删除自定义模型的确认弹层与错误提示（替代原生 confirm）
  const [pendingDeleteModel, setPendingDeleteModel] = useState<CustomModelConfig | null>(null)
  const [isDeletingModel, setIsDeletingModel] = useState(false)
  const [deleteModelError, setDeleteModelError] = useState<string | null>(null)
  const [modelForm, setModelForm] = useState({
    name: "",
    provider: "openai",
    model: "",
    purpose: "",
    fallback_model: "",
  })

  // 锚点导航：滚动时用 IntersectionObserver 高亮当前区块
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return
    const elements = SETTINGS_SECTIONS.map((section) =>
      document.getElementById("settings-" + section.id),
    ).filter((element): element is HTMLElement => element !== null)
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return
        const closest = visible.reduce((best, entry) =>
          Math.abs(entry.boundingClientRect.top) <
          Math.abs(best.boundingClientRect.top)
            ? entry
            : best,
        )
        setActiveSection(closest.target.id.replace("settings-", ""))
      },
      { rootMargin: "-16px 0px -55% 0px", threshold: [0, 0.2, 0.5] },
    )
    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

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

  const handleDeleteCustomModel = (model: CustomModelConfig) => {
    setDeleteModelError(null)
    setPendingDeleteModel(model)
  }

  const confirmDeleteCustomModel = async () => {
    if (!pendingDeleteModel) return
    const model = pendingDeleteModel
    setIsDeletingModel(true)
    setDeleteModelError(null)
    setDeletingModels((prev) => ({ ...prev, [model.name]: true }))
    try {
      await deleteCustomModel(model.name)
    } catch (err) {
      setDeleteModelError(
        err instanceof Error ? err.message : "删除自定义模型失败",
      )
    } finally {
      setDeletingModels((prev) => ({ ...prev, [model.name]: false }))
      setIsDeletingModel(false)
      setPendingDeleteModel(null)
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
    setKeySuccess((prev) => ({ ...prev, [provider]: null }))
    try {
      await saveProviderKey(provider, val)
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }))
      setShowKeys((prev) => ({ ...prev, [provider]: false }))
      setKeySuccess((prev) => ({
        ...prev,
        [provider]: "已保存，密钥将优先于环境变量生效",
      }))
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
    setKeySuccess((prev) => ({ ...prev, [provider]: null }))
    try {
      await removeProviderKey(provider)
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }))
      setShowKeys((prev) => ({ ...prev, [provider]: false }))
      setKeySuccess((prev) => ({ ...prev, [provider]: "已删除数据库中的密钥" }))
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

  const configuredProviderCount = mergedProviders.filter((p) => p.configured).length

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-clip md:grid-cols-[auto_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="settings" />

      <ErrorBoundary>
        <main className="console-main min-w-0 px-4 py-5 sm:px-6 md:px-8 md:py-8 xl:px-10">
          <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-6">
            {/* Header */}
            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="console-section-title">工作区</p>
                <h1 className="text-[1.65rem] leading-[2.1rem] font-bold tracking-[-0.02em] text-console-ink">
                  设置中心
                </h1>
                <p className="text-[13px] leading-[18px] text-console-ink-3">
                  大模型配置、API 密钥、外观偏好与工作区管理
                </p>
              </div>
              <span className="console-pill inline-flex w-fit shrink-0 items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-console-ink-2">
                <Settings aria-hidden="true" className="size-3.5 text-console-accent" />
                {models.length + customModels.length} 个模型已挂载
              </span>
            </header>

            {/* 198px 粘性分页导航 + 内容 */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[198px_minmax(0,1fr)] md:gap-7 lg:gap-8">
              {/* 移动端：顶部横向滚动 chip */}
              <nav
                aria-label="设置分类"
                className="console-scroll flex gap-2 overflow-x-auto pb-1 md:hidden"
              >
                {SETTINGS_SECTIONS.map((section) => {
                  const active = activeSection === section.id
                  return (
                    <a
                      key={section.id}
                      href={"#settings-" + section.id}
                      aria-current={active ? "location" : undefined}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "console-pill flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[13px] transition-colors",
                        active
                          ? "border-console-accent bg-console-active text-console-ink"
                          : "text-console-ink-3 hover:text-console-ink",
                      )}
                    >
                      {section.label}
                    </a>
                  )
                })}
                {SETTINGS_PAGES.map((page) => (
                  <Link
                    key={page.href}
                    href={page.href}
                    className="console-pill flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[13px] text-console-ink-3 transition-colors hover:text-console-ink"
                  >
                    {page.label}
                  </Link>
                ))}
              </nav>

              {/* 桌面端：198px 粘性分页导航 */}
              <nav
                aria-label="设置分类"
                className="hidden md:sticky md:top-6 md:flex md:flex-col md:gap-0.5 md:self-start"
              >
                {SETTINGS_SECTIONS.map((section) => {
                  const Icon = section.icon
                  const active = activeSection === section.id
                  return (
                    <a
                      key={section.id}
                      href={"#settings-" + section.id}
                      aria-current={active ? "location" : undefined}
                      data-active={active ? "true" : undefined}
                      onClick={() => setActiveSection(section.id)}
                      className="console-row min-h-11 gap-2.5 px-2.5 text-[13px]"
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-console-accent" : "text-console-ink-3",
                        )}
                      />
                      <span className="truncate">{section.label}</span>
                    </a>
                  )
                })}
                <div
                  aria-hidden="true"
                  className="my-2 border-t border-console-line"
                />
                {SETTINGS_PAGES.map((page) => {
                  const Icon = page.icon
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      className="console-row min-h-11 gap-2.5 px-2.5 text-[13px]"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-console-ink-3"
                      />
                      <span className="flex-1 truncate">{page.label}</span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-console-ink-3"
                      />
                    </Link>
                  )
                })}
              </nav>

              {/* 内容 */}
              <div className="console-stagger flex min-w-0 flex-col gap-6">
                {/* 通用 */}
                <section
                  id="settings-general"
                  aria-labelledby="settings-general-title"
                  className="flex scroll-mt-6 flex-col gap-3"
                >
                  <SectionHeading
                    id="settings-general-title"
                    title="通用"
                    description="工作区运行状态与管理页快捷入口"
                    meta={mergedProviders.length + " 个 Provider"}
                  />
                  <SettingsCard>
                    <InfoRow
                      label="当前工作区"
                      hint="配额、成本与审计均按工作区隔离"
                      value={activeWorkspace?.name ?? "默认工作区"}
                    />
                    <InfoRow
                      label="已挂载模型"
                      hint="models.yaml 与自定义模型合计"
                      value={displayModels.length + " 个"}
                    />
                    <InfoRow
                      label="Provider 就绪"
                      hint="数据库密钥优先于环境变量"
                      value={configuredProviderCount + " / " + mergedProviders.length}
                    />
                    <InfoRow
                      label="实时通道"
                      hint="WebSocket 事件推送与任务状态"
                      value={
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="status-dot size-2 rounded-full"
                            data-status={connectionStatus}
                          />
                          {connectionLabels[connectionStatus] ?? connectionStatus}
                        </span>
                      }
                    />
                  </SettingsCard>

                  <SettingsCard>
                    {MANAGEMENT_ENTRIES.map((entry) => {
                      const Icon = entry.icon
                      return (
                        <Link
                          key={entry.href}
                          href={entry.href}
                          className="group flex min-h-16 items-center gap-3 px-4 transition-colors hover:bg-console-hover"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-console-tag text-console-ink-2 transition-colors group-hover:text-console-accent">
                            <Icon aria-hidden="true" className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] leading-[18px] text-console-ink">
                              {entry.label}
                            </span>
                            <span className="mt-0.5 block truncate text-xs leading-4 text-console-ink-3">
                              {entry.description}
                            </span>
                          </span>
                          <ChevronRight
                            aria-hidden="true"
                            className="size-4 shrink-0 text-console-ink-3 transition-transform group-hover:translate-x-0.5"
                          />
                        </Link>
                      )
                    })}
                  </SettingsCard>
                </section>

                {/* 模型与密钥 */}
                <section
                  id="settings-models"
                  aria-labelledby="settings-models-title"
                  className="flex scroll-mt-6 flex-col gap-3"
                >
                  <SectionHeading
                    id="settings-models-title"
                    title="模型与密钥"
                    description="Provider 密钥、模型挂载与连通性测试"
                    meta={displayModels.length + " 个模型"}
                  />

                  {error && models.length > 0 ? (
                    <InlineError message={error} onRetry={retry} />
                  ) : null}

                  {/* Provider 状态 */}
                  <SettingsCard
                    title="Provider 状态"
                    hint="各 AI 厂商密钥可用性总览"
                    meta={mergedProviders.length + " SOURCES"}
                  >
                    {isLoading ? (
                      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 xl:grid-cols-5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Skeleton key={i} className="h-16 rounded-[10px]" />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 xl:grid-cols-5">
                        {mergedProviders.map((p) => (
                          <div
                            key={p.provider}
                            className={cn(
                              "flex min-h-16 items-center gap-3 rounded-[10px] p-3 transition-colors",
                              p.configured
                                ? "bg-console-surface-2"
                                : "bg-console-tag",
                            )}
                          >
                            {p.configured ? (
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-console-tag text-console-success">
                                <ShieldCheck aria-hidden="true" className="size-4" />
                              </span>
                            ) : (
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-console-tag text-console-ink-3">
                                <ShieldX aria-hidden="true" className="size-4" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-[13px] leading-[18px] font-medium text-console-ink">
                                {providerDisplayName(p.provider)}
                              </p>
                              <p
                                className={cn(
                                  "text-[11px] leading-4",
                                  p.configured
                                    ? "text-console-success"
                                    : "text-console-ink-3",
                                )}
                              >
                                {p.configured ? "已就绪" : "未配置"}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingsCard>

                  {/* API Key 管理 */}
                  <SettingsCard
                    title="API Key 管理"
                    hint="安全管理各 Provider 的 API 密钥（数据库存储优先于环境变量）"
                    meta={allProviders.length + " PROVIDERS"}
                  >
                    <div className="px-5 py-4">
                      <p className="text-[13px] leading-[18px] font-semibold text-console-ink">
                        添加新厂商
                      </p>
                      <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
                        输入厂商名称与 API Key，保存后即可在下方编辑、测试或删除
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          void handleAddProvider()
                        }}
                        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
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
                          className={cn(FIELD_CLASS, "sm:w-52")}
                        />
                        <input
                          type="password"
                          value={addProviderKey}
                          onChange={(e) => setAddProviderKey(e.target.value)}
                          placeholder="输入对应厂商的 API Key…"
                          disabled={addingProvider}
                          autoComplete="off"
                          className={cn(FIELD_CLASS, "flex-1")}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          className="h-9 shrink-0 rounded-full px-4 font-semibold"
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
                      {addProviderError ? (
                        <div className="mt-2">
                          <InlineError message={addProviderError} />
                        </div>
                      ) : null}
                    </div>

                    {isLoading ? (
                      <div>
                        {Array.from({ length: 4 }, (_, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 px-5 py-4"
                          >
                            <Skeleton className="h-5 w-24 rounded-full" />
                            <Skeleton className="h-9 flex-1 rounded-[10px]" />
                            <Skeleton className="h-9 w-16 rounded-full" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      allProviders.map((p) => {
                        const configured = isProviderConfigured(p.provider)
                        const isSaving = savingKeys[p.provider] ?? false
                        const err = keyErrors[p.provider] ?? null
                        const success = keySuccess[p.provider] ?? null
                        const showKey = showKeys[p.provider] ?? false

                        return (
                          <div key={p.provider} className={ROW_CLASS}>
                            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                              <span className="min-w-0 shrink-0 truncate text-[13px] leading-[18px] font-semibold text-console-ink sm:w-32">
                                {providerDisplayName(p.provider)}
                              </span>
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <div className="relative min-w-0 flex-1">
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
                                        void handleSaveKey(p.provider)
                                      }
                                    }}
                                    placeholder={
                                      configured
                                        ? "••••••••••••••••"
                                        : "输入 API Key…"
                                    }
                                    disabled={isSaving}
                                    className={cn(FIELD_CLASS, "pr-10")}
                                  />
                                  <button
                                    type="button"
                                    aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                                    onClick={() => void handleToggleKey(p.provider)}
                                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1 text-console-ink-3 transition-colors hover:text-console-ink"
                                  >
                                    {showKey ? (
                                      <EyeOff aria-hidden="true" className="size-4" />
                                    ) : (
                                      <Eye aria-hidden="true" className="size-4" />
                                    )}
                                  </button>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-9 shrink-0 rounded-full border-console-line px-3"
                                  disabled={isSaving || !keyInputs[p.provider]?.trim()}
                                  onClick={() => void handleSaveKey(p.provider)}
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
                                {configured ? (
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={
                                      "删除 " +
                                      providerDisplayName(p.provider) +
                                      " 的密钥"
                                    }
                                    disabled={isSaving}
                                    onClick={() => void handleRemoveKey(p.provider)}
                                    className="shrink-0 rounded-full text-console-ink-3 hover:text-console-danger"
                                  >
                                    <Trash2 aria-hidden="true" className="size-4" />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            {err ? <InlineError message={err} /> : null}
                            {success ? (
                              <p className="text-xs leading-4 text-console-success">
                                {success}
                              </p>
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </SettingsCard>

                  {/* 模型列表 */}
                  <SettingsCard
                    title="模型列表与连通性"
                    hint="已注册模型、Fallback 降级链与即时 Ping 测速"
                    meta={displayModels.length + " MODELS"}
                  >
                    {deleteModelError ? (
                      <div className="px-5 py-3">
                        <InlineError
                          message={deleteModelError}
                          onRetry={() => setDeleteModelError(null)}
                        />
                      </div>
                    ) : null}

                    {isLoading ? (
                      <ModelListSkeleton />
                    ) : error && displayModels.length === 0 ? (
                      <div className="flex flex-col items-center gap-3 px-5 py-8">
                        <EmptyState
                          title="无法加载模型配置"
                          description={error}
                          icon={<AlertCircle aria-hidden="true" className="size-5" />}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full"
                          onClick={retry}
                        >
                          重新加载
                        </Button>
                      </div>
                    ) : displayModels.length === 0 ? (
                      <EmptyState
                        className="px-5 py-8"
                        title="暂无模型配置"
                        description="请检查 config/models.yaml 文件或添加自定义模型。"
                        icon={<Cpu aria-hidden="true" className="size-5" />}
                      />
                    ) : (
                      displayModels.map((model) => (
                        <ModelRow
                          key={
                            (model.isCustom ? "custom" : "yaml") +
                            "-" +
                            model.name
                          }
                          model={model}
                          isCustom={model.isCustom}
                          testState={testStates[model.name] ?? { status: "idle" }}
                          onTest={() => void testModel(model.name)}
                          onDelete={() => handleDeleteCustomModel(model)}
                          deleting={deletingModels[model.name] ?? false}
                          providerConfigured={isProviderConfigured(model.provider)}
                        />
                      ))
                    )}

                    {/* 添加自定义模型 */}
                    <div className="px-5 py-4">
                      {!showAddForm ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-full border-console-line px-3.5"
                          onClick={() => setShowAddForm(true)}
                        >
                          <Plus aria-hidden="true" className="size-4" />
                          添加自定义模型
                        </Button>
                      ) : (
                        <div className="flex flex-col gap-3.5">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <h3 className="text-[13px] leading-[18px] font-semibold text-console-ink">
                                添加自定义模型
                              </h3>
                              <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
                                注册 models.yaml 之外的任意 Provider / Model ID 组合与降级链
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="shrink-0 rounded-full text-console-ink-2"
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
                              <span className="text-xs font-semibold text-console-ink">
                                名称 <span className="font-normal text-console-danger">*</span>
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
                                className={FIELD_CLASS}
                              />
                            </label>

                            <label className="flex min-w-0 flex-col gap-1.5">
                              <span className="text-xs font-semibold text-console-ink">
                                Provider <span className="font-normal text-console-danger">*</span>
                              </span>
                              <select
                                value={modelForm.provider}
                                onChange={(e) =>
                                  setModelForm((prev) => ({
                                    ...prev,
                                    provider: e.target.value,
                                  }))
                                }
                                className={FIELD_CLASS}
                              >
                                {providerOptions.map((p) => (
                                  <option key={p} value={p}>
                                    {providerDisplayName(p)}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="flex min-w-0 flex-col gap-1.5">
                              <span className="text-xs font-semibold text-console-ink">
                                模型 ID <span className="font-normal text-console-danger">*</span>
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
                                className={FIELD_CLASS}
                              />
                            </label>

                            <label className="flex min-w-0 flex-col gap-1.5">
                              <span className="text-xs font-semibold text-console-ink">
                                用途 <span className="font-normal text-console-ink-3">可选</span>
                              </span>
                              <select
                                value={modelForm.purpose}
                                onChange={(e) =>
                                  setModelForm((prev) => ({
                                    ...prev,
                                    purpose: e.target.value,
                                  }))
                                }
                                className={FIELD_CLASS}
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
                              <span className="text-xs font-semibold text-console-ink">
                                Fallback <span className="font-normal text-console-ink-3">可选</span>
                              </span>
                              <select
                                value={modelForm.fallback_model}
                                onChange={(e) =>
                                  setModelForm((prev) => ({
                                    ...prev,
                                    fallback_model: e.target.value,
                                  }))
                                }
                                className={FIELD_CLASS}
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

                          {modelFormError ? (
                            <InlineError message={modelFormError} />
                          ) : null}

                          <div className="flex items-center gap-2.5 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-full px-5 font-semibold"
                              disabled={
                                savingModel ||
                                !modelForm.name.trim() ||
                                !modelForm.provider.trim() ||
                                !modelForm.model.trim()
                              }
                              onClick={() => void handleAddCustomModel()}
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
                  </SettingsCard>
                </section>

                {/* 外观 */}
                <section
                  id="settings-appearance"
                  aria-labelledby="settings-appearance-title"
                  className="flex scroll-mt-6 flex-col gap-3"
                >
                  <SectionHeading
                    id="settings-appearance-title"
                    title="外观"
                    description="主题、明暗模式、强调色与动效档位，改动即时生效"
                    meta="仅保存在本机"
                  />
                  <AppearanceCard />
                </section>
              </div>
            </div>
          </div>
        </main>
      </ErrorBoundary>

      <ConfirmDialog
        open={pendingDeleteModel !== null}
        title="删除自定义模型"
        description={
          "确定删除自定义模型「" +
          (pendingDeleteModel?.name ?? "") +
          "」吗？该操作不可撤销。"
        }
        confirmLabel="删除"
        tone="destructive"
        busy={isDeletingModel}
        onConfirm={() => void confirmDeleteCustomModel()}
        onCancel={() => setPendingDeleteModel(null)}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                          */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  id,
  title,
  description,
  meta,
}: {
  id: string
  title: string
  description: string
  meta?: ReactNode
}) {
  return (
    <header className="flex items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        <h2
          id={id}
          className="text-[15px] leading-6 font-semibold tracking-[-0.01em] text-console-ink"
        >
          {title}
        </h2>
        <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
          {description}
        </p>
      </div>
      {meta ? <span className="console-meta shrink-0">{meta}</span> : null}
    </header>
  )
}

function SettingsCard({
  title,
  hint,
  meta,
  children,
  className,
}: {
  title?: string
  hint?: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("console-card overflow-hidden", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-console-line px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-[13px] leading-[18px] font-semibold text-console-ink">
              {title}
            </h3>
            {hint ? (
              <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
                {hint}
              </p>
            ) : null}
          </div>
          {meta ? (
            <span className="console-meta shrink-0">{meta}</span>
          ) : null}
        </div>
      ) : null}
      <div className="divide-y divide-console-line overflow-hidden [&>*:first-child]:rounded-t-[12px] [&>*:last-child]:rounded-b-[12px]">
        {children}
      </div>
    </div>
  )
}

function InfoRow({
  label,
  hint,
  value,
}: {
  label: string
  hint?: string
  value: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="text-[13px] leading-[18px] text-console-ink">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-4 text-console-ink-3">{hint}</p>
        ) : null}
      </div>
      <span className="console-pill console-tabular inline-flex shrink-0 items-center justify-center px-2.5 py-1 text-xs font-medium text-console-ink">
        {value}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Model row                                                                  */
/* -------------------------------------------------------------------------- */

function ModelRow({
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
  const displayName = roleLabels[model.name] ?? model.name

  return (
    <div className={ROW_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-console-tag text-[13px] font-semibold text-console-ink-2">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[13px] leading-[18px] font-semibold text-console-ink">
                {displayName}
              </h3>
              {isCustom ? (
                <span className="console-pill shrink-0 px-1.5 py-0.5 text-[10px] text-console-ink-2">
                  自定义
                </span>
              ) : null}
            </div>
            <p className="console-meta truncate">
              {model.name} · {providerDisplayName(model.provider)} · {model.model}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "console-pill px-2 py-0.5 text-[11px]",
              providerConfigured ? "text-console-success" : "text-console-warn",
            )}
          >
            {providerConfigured ? "已就绪" : "未配置"}
          </span>
          {isCustom ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={deleting}
              onClick={onDelete}
              aria-label={"删除自定义模型 " + model.name}
              className="rounded-full text-console-ink-3 hover:text-console-danger"
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
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={testState.status === "error" ? "destructive" : "outline"}
            className="h-8 rounded-full border-console-line px-3"
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
                <FlaskConical
                  aria-hidden="true"
                  className="mr-1.5 size-3.5 text-console-accent"
                />
                测试连通性
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-12 text-xs leading-4 text-console-ink-3">
        <span>用途：{roleLabels[model.purpose] ?? (model.purpose || "未指定")}</span>
        <span className="flex items-center gap-1">
          <ChevronRight aria-hidden="true" className="size-3 text-console-accent" />
          Fallback：
          {model.fallback_model
            ? roleLabels[model.fallback_model] ?? model.fallback_model
            : "无"}
        </span>
      </div>

      {testState.status === "success" ? (
        <TestResultSuccess result={testState.result} />
      ) : null}
      {testState.status === "error" ? (
        <TestResultError error={testState.error} />
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Test result helpers                                                        */
/* -------------------------------------------------------------------------- */

function TestResultSuccess({
  result,
}: {
  result: NonNullable<Extract<TestState, { status: "success" }>["result"]>
}) {
  return (
    <div className="rounded-[10px] border border-console-line bg-console-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-console-success">
        <CheckCircle2 aria-hidden="true" className="size-4" />
        连通性测试通过
        {result.fallback_used ? (
          <span className="console-pill ml-1 px-1.5 py-0.5 text-[10px] text-console-accent">
            Fallback 触发
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] leading-4">
        <div>
          <span className="flex items-center gap-1 text-console-ink-3">
            <Clock aria-hidden="true" className="size-3" />
            延迟
          </span>
          <span className="console-tabular font-semibold text-console-ink">
            {result.latency_ms} ms
          </span>
        </div>
        <div>
          <span className="flex items-center gap-1 text-console-ink-3">
            <Zap aria-hidden="true" className="size-3" />
            Token
          </span>
          <span className="console-tabular font-semibold text-console-ink">
            {result.usage.total_tokens}
          </span>
        </div>
        <div>
          <span className="text-console-ink-3">实际生效模型</span>
          <span className="block truncate font-mono font-semibold text-console-accent">
            {result.model_name}
          </span>
        </div>
      </div>
      {result.content ? (
        <div className="mt-2.5 border-t border-console-line pt-2">
          <span className="text-[11px] font-medium text-console-ink-3">
            模型回包预览：
          </span>
          <p className="mt-0.5 line-clamp-3 font-mono text-[11px] leading-relaxed text-console-ink-2">
            {result.content}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function TestResultError({ error }: { error: string }) {
  return (
    <div className="rounded-[10px] border border-console-line bg-console-surface-2 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-console-danger">
        <XCircle aria-hidden="true" className="size-4" />
        测试失败
      </div>
      <p className="line-clamp-4 font-mono text-[11px] leading-relaxed text-console-danger">
        {error}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Loading state                                                              */
/* -------------------------------------------------------------------------- */

function ModelListSkeleton() {
  return (
    <div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="size-9 shrink-0 rounded-[10px]" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40 rounded-full" />
            <Skeleton className="h-3 w-64 max-w-full rounded-full" />
          </div>
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      ))}
    </div>
  )
}
