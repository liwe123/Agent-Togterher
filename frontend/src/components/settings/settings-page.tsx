"use client"

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  FlaskConical,
  LoaderCircle,
  Settings,
  ShieldCheck,
  ShieldX,
  XCircle,
  Zap,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/hooks/use-settings"
import { cn } from "@/lib/utils"
import type { ModelConfig, TestState } from "@/types/settings"

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

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SettingsPage() {
  const {
    models,
    providers,
    isLoading,
    error,
    retry,
    testStates,
    testModel,
  } = useSettings()

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[232px_minmax(0,1fr)]">
      <AppSidebar connectionStatus="online" activeItem="settings" />

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
              {models.length} 个模型
            </Badge>
          </header>

          {/* Provider key status */}
          <section aria-label="Provider 密钥状态" className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Provider 状态</h2>
                <p className="mt-1 text-xs text-muted-foreground">API 密钥可用性概览</p>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">{providers.length} SOURCES</span>
            </div>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="console-panel grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card/70 sm:grid-cols-3 lg:grid-cols-5">
                {providers.map((p) => (
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
                      来自 models.yaml 配置
                    </p>
                  </div>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {models.length} 个
                </span>
              </div>

              {isLoading ? (
                <ModelListSkeleton />
              ) : error && models.length === 0 ? (
                <ModelListError error={error} onRetry={retry} />
              ) : models.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Cpu aria-hidden="true" className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">暂无模型配置</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      请检查 config/models.yaml 文件。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-px bg-border/40 sm:grid-cols-1 lg:grid-cols-2">
                  {models.map((model) => (
                    <ModelCard
                      key={model.name}
                      model={model}
                      testState={
                        testStates[model.name] ?? { status: "idle" }
                      }
                      onTest={() => testModel(model.name)}
                      providerConfigured={
                        providers.find(
                          (p) =>
                            p.provider.toLowerCase() ===
                            model.provider.toLowerCase(),
                        )?.configured ?? false
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Model Card                                                                 */
/* -------------------------------------------------------------------------- */

function ModelCard({
  model,
  testState,
  onTest,
  providerConfigured,
}: {
  model: ModelConfig
  testState: TestState
  onTest: () => void
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
            <h3 className="truncate text-sm font-semibold">
              {roleLabels[model.name] ?? model.name}
            </h3>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {model.name}
            </p>
          </div>
        </div>
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
