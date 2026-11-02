"use client"

import { useEffect, useId, useRef } from "react"
import type { CSSProperties } from "react"

import { useAppearance } from "@/hooks/use-appearance"
import { BOT_SHAPES, type BotShapeId } from "@/lib/bot-shapes"
import { cn } from "@/lib/utils"

export type BotMarkState = "idle" | "running" | "waiting" | "alert"

interface BotMarkProps {
  shape: BotShapeId
  /** 渲染尺寸（px），默认 36 */
  size?: number
  state?: BotMarkState
  /** 主体填充色；默认 --console-accent，可被父级 --bot-ink 覆盖 */
  ink?: string
  className?: string
  /** 传值则以 img 语义暴露给读屏；不传视为纯装饰 */
  ariaLabel?: string
}

const STATE_ANIMATION: Record<BotMarkState, string> = {
  idle: "",
  running: "console-state-bob",
  waiting: "console-state-sway",
  alert: "console-state-hop",
}

const EYE_TRAVEL = 9
const BODY_TRAVEL = 3

/**
 * DS-Bot 角色形状（SVG 100×100）：主体 + 品牌色 paints + 14% 投影 + 16% 高光，
 * 眼睛以 mask 孔洞透出背景。running/waiting/alert 分别挂
 * console-state-bob/sway/hop；normal/lively 档位下眼睛跟随指针（写 CSS 变量，
 * 不触发 React 重渲染），quiet 与 prefers-reduced-motion 下停用。
 */
export function BotMark({
  shape,
  size = 36,
  state = "idle",
  ink = "var(--console-accent)",
  className,
  ariaLabel,
}: BotMarkProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const frameRef = useRef(0)
  const rawId = useId()
  const maskId = `bot-mark-mask-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`
  const definition = BOT_SHAPES[shape]
  const { motion } = useAppearance()
  const gazeEnabled = motion !== "quiet"

  // 指针视线：normal / lively 档位下单帧写 CSS 变量；quiet / reduced-motion 归零
  useEffect(() => {
    if (!gazeEnabled) return
    const node = rootRef.current
    if (!node || typeof window === "undefined") return
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    let pointerX = 0
    let pointerY = 0
    let hasPointer = false

    const clearGaze = () => {
      node.style.removeProperty("--bot-gx")
      node.style.removeProperty("--bot-gy")
      node.style.setProperty("--bot-gx", "0")
      node.style.setProperty("--bot-gy", "0")
    }

    const writeGaze = () => {
      frameRef.current = 0
      const motion = document.documentElement.dataset.motion
      if (
        !hasPointer ||
        reducedQuery.matches ||
        motion === "quiet" ||
        !node.isConnected
      ) {
        clearGaze()
        return
      }
      node.style.setProperty("--bot-gx", pointerX.toFixed(3))
      node.style.setProperty("--bot-gy", pointerY.toFixed(3))
    }

    const schedule = () => {
      if (frameRef.current !== 0) return
      frameRef.current = window.requestAnimationFrame(writeGaze)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reducedQuery.matches) return
      const rect = node.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      pointerX = Math.max(
        -1,
        Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1),
      )
      pointerY = Math.max(
        -1,
        Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1),
      )
      hasPointer = true
      schedule()
    }

    const resetGaze = () => {
      hasPointer = false
      schedule()
    }

    clearGaze()
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("pointerleave", resetGaze)
    reducedQuery.addEventListener("change", resetGaze)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerleave", resetGaze)
      reducedQuery.removeEventListener("change", resetGaze)
      if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      // 退出 normal/lively（如切到 quiet）时清除残留视线偏移
      node.style.setProperty("--bot-gx", "0")
      node.style.setProperty("--bot-gy", "0")
    }
  }, [gazeEnabled])

  const bodyStyle: CSSProperties | undefined = gazeEnabled
    ? ({
        transform: `translate(calc(var(--bot-gx, 0) * ${BODY_TRAVEL}px), calc(var(--bot-gy, 0) * ${BODY_TRAVEL - 0.5}px))`,
      } as CSSProperties)
    : undefined
  const gazeStyle: CSSProperties | undefined = gazeEnabled
    ? ({
        transform: `translate(calc(var(--bot-gx, 0) * ${EYE_TRAVEL}px), calc(var(--bot-gy, 0) * ${EYE_TRAVEL - 1}px))`,
      } as CSSProperties)
    : undefined

  return (
    <span
      ref={rootRef}
      data-slot="bot-mark"
      data-shape={shape}
      data-state={state}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn("relative inline-flex shrink-0 select-none", className)}
      style={{ width: size, height: size, "--bot-ink": ink } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-full w-full items-center justify-center",
          STATE_ANIMATION[state],
        )}
      >
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full overflow-visible"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x="-100"
              y="-100"
              width="300"
              height="300"
            >
              <rect x="-100" y="-100" width="300" height="300" fill="#fff" />
              <g
                className="transition-transform duration-[180ms] ease-out motion-reduce:transition-none"
                style={gazeStyle}
              >
                {definition.eyes.map(([cx, cy, width, height, tilt], index) => (
                  <g
                    key={index}
                    transform={`translate(${cx} ${cy}) rotate(${tilt})`}
                  >
                    <ellipse
                      cx={0}
                      cy={0}
                      rx={width / 2}
                      ry={height / 2}
                      fill="#000"
                    />
                  </g>
                ))}
              </g>
            </mask>
          </defs>
          <g
            mask={`url(#${maskId})`}
            fillRule="evenodd"
            className="transition-transform duration-[180ms] ease-out motion-reduce:transition-none"
            style={bodyStyle}
          >
            <path d={definition.body} fill="var(--bot-ink, var(--console-accent))" />
            {definition.paints.map(([path, fill, opacity], index) => (
              <path key={index} d={path} fill={fill} fillOpacity={opacity} />
            ))}
            <path d={definition.shade} fill="#000" fillOpacity={0.14} />
            <path d={definition.light} fill="#fff" fillOpacity={0.16} />
          </g>
        </svg>
      </span>

      {state === "alert" ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-console-accent text-[8px] leading-none font-semibold text-console-accent-ink"
        >
          ?
        </span>
      ) : null}
    </span>
  )
}
