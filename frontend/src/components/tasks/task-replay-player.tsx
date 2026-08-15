"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  Clock,
  Coins,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react"

import { formatCost, formatDuration, formatTokens, stepLabel } from "@/lib/task-format"
import { requestData } from "@/lib/task-api"
import { cn } from "@/lib/utils"
import type { ReplayFrame, TaskReplayResponse } from "@/types/replay"

interface TaskReplayPlayerProps {
  taskId: number
  onTaskResumed?: () => void
}

export function TaskReplayPlayer({ taskId, onTaskResumed }: TaskReplayPlayerProps) {
  const [replay, setReplay] = useState<TaskReplayResponse | null>(null)
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 2 | 5>(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isResuming, setIsResuming] = useState(false)

  const loadedIdRef = useRef<number | null>(null)

  const loadReplayData = useCallback(async (id: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await requestData<TaskReplayResponse>(`/api/v1/tasks/${id}/replay`)
      setReplay(data)
      setCurrentFrameIndex(0)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "获取任务回放轨迹失败")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (loadedIdRef.current === taskId) return
    loadedIdRef.current = taskId
    void loadReplayData(taskId)
  }, [taskId, loadReplayData])

  // Playback timer effect
  useEffect(() => {
    if (!isPlaying || !replay || replay.frames.length === 0) return

    const intervalMs = Math.round(1500 / speed)
    const timer = setInterval(() => {
      setCurrentFrameIndex((prev) => {
        if (prev >= replay.frames.length - 1) {
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, intervalMs)

    return () => clearInterval(timer)
  }, [isPlaying, replay, speed])

  const handleResumeStep = async (stepId: number) => {
    setIsResuming(true)
    try {
      await requestData(`/api/v1/tasks/${taskId}/resume-from-step`, {
        method: "POST",
        body: JSON.stringify({ step_id: stepId }),
      })
      if (onTaskResumed) onTaskResumed()
      void loadReplayData(taskId)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "恢复任务失败")
    } finally {
      setIsResuming(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-card">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !replay || replay.frames.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
        {error || "该任务暂无可回放的步骤帧"}
      </div>
    )
  }

  const currentFrame = replay.frames[currentFrameIndex] as ReplayFrame | undefined

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm space-y-6">
      {/* Player Top Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">任务时序步进回放</h3>
            <p className="text-[11px] text-muted-foreground font-mono">
              帧 {currentFrameIndex + 1} / {replay.frames.length} · 累计花费 {formatCost(replay.total_cost_usd)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Speed selector */}
          <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5 text-xs font-mono">
            {([1, 2, 5] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={cn(
                  "rounded-md px-2 py-0.5 font-semibold transition-colors",
                  speed === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Reset Frame */}
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false)
              setCurrentFrameIndex(0)
            }}
            className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="重置到第一帧"
          >
            <RotateCcw className="size-3.5" />
          </button>

          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={() => {
              if (currentFrameIndex >= replay.frames.length - 1) {
                setCurrentFrameIndex(0)
              }
              setIsPlaying((prev) => !prev)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            {isPlaying ? (
              <>
                <Pause className="size-3.5" /> 暂停
              </>
            ) : (
              <>
                <Play className="size-3.5" /> 播放回放
              </>
            )}
          </button>
        </div>
      </div>

      {/* Timeline Scrub Track */}
      <div className="space-y-2">
        <div className="relative flex items-center justify-between">
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-secondary" />
          <div
            style={{
              width: `${(currentFrameIndex / Math.max(replay.frames.length - 1, 1)) * 100}%`,
            }}
            className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary transition-all duration-200"
          />

          {replay.frames.map((frame, idx) => {
            const isPassed = idx <= currentFrameIndex
            const isCurrent = idx === currentFrameIndex
            const isFailed = frame.status === "failed"

            return (
              <button
                key={frame.step_id}
                type="button"
                onClick={() => {
                  setIsPlaying(false)
                  setCurrentFrameIndex(idx)
                }}
                className={cn(
                  "relative z-10 flex size-7 items-center justify-center rounded-full text-[10px] font-mono font-bold transition-all duration-200",
                  isCurrent
                    ? "ring-4 ring-primary/30 bg-primary text-primary-foreground scale-110 shadow-md"
                    : isPassed
                    ? isFailed
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-primary/80 text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                )}
                title={`第 ${idx + 1} 步: ${stepLabel(frame.step_name)}`}
              >
                {idx + 1}
              </button>
            )
          })}
        </div>
      </div>

      {/* Active Step Details Card */}
      {currentFrame && (
        <div className="rounded-xl border border-border/80 bg-secondary/30 p-4 space-y-4 animate-in fade-in duration-200">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary font-mono">
                Step #{currentFrame.step_id}
              </span>
              <h4 className="text-sm font-semibold text-foreground">
                {stepLabel(currentFrame.step_name)}
              </h4>
              <span className="text-xs text-muted-foreground font-mono">
                ({currentFrame.agent_role || "系统"})
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3 text-muted-foreground" />
                {formatDuration(currentFrame.duration_ms)}
              </span>
              <span className="flex items-center gap-1">
                <Coins className="size-3 text-amber-400" />
                {formatTokens(currentFrame.tokens_used)}
              </span>
              <span className="flex items-center gap-1 font-semibold text-primary">
                {formatCost(currentFrame.cost_usd)}
              </span>
            </div>
          </div>

          {/* Status & Error */}
          {currentFrame.error_message && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/15 p-3 text-xs text-destructive">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">步骤执行异常：</span>
                  <p className="mt-0.5 font-mono">{currentFrame.error_message}</p>
                </div>
              </div>

              <button
                type="button"
                disabled={isResuming}
                onClick={() => handleResumeStep(currentFrame.step_id)}
                className="flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
              >
                {isResuming ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                从此步恢复
              </button>
            </div>
          )}

          {/* Payloads Inspector */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div className="space-y-1.5">
              <span className="font-semibold text-muted-foreground">输入 Payload：</span>
              <pre className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background/80 p-2.5 font-mono text-[11px] text-muted-foreground">
                {JSON.stringify(currentFrame.input_payload, null, 2) || "无输入载荷"}
              </pre>
            </div>
            <div className="space-y-1.5">
              <span className="font-semibold text-muted-foreground">输出 Payload：</span>
              <pre className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background/80 p-2.5 font-mono text-[11px] text-primary">
                {JSON.stringify(currentFrame.output_payload, null, 2) || "无输出载荷"}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
