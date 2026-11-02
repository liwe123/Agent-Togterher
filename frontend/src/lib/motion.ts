export interface SpringCurve {
  stiffness: number
  damping: number
  duration: number
  easing: string
}

/**
 * DS-Bot `springEasing` 的同算法实现：解析阻尼振荡曲线，
 * 采样 25 个点生成 CSS `linear()` 缓动，并解出 1e-3 容差下的 settle 时长。
 * 详见 docs/DS-Bot分析报告/DS-Bot前端UI与交互模式分析.md §1.6。
 */
export function springEasing(stiffness: number, damping: number): SpringCurve {
  const w0 = Math.sqrt(stiffness)
  const zeta = damping / (2 * w0)
  const at = (t: number): number => {
    if (zeta >= 1) return 1 - (1 + w0 * t) * Math.exp(-w0 * t)
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    return (
      1 -
      Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    )
  }
  let end = 0.05
  while (end < 2 && Math.abs(1 - at(end)) > 1e-3) end += 0.01
  const points = Array.from({ length: 25 }, (_, index) =>
    index === 24 ? 1 : Number(at((end * index) / 24).toFixed(4)),
  )
  return {
    stiffness,
    damping,
    duration: Math.round(end * 1000),
    easing: `linear(${points.map((point) => point.toFixed(4)).join(",")})`,
  }
}

export const SPRING = {
  shape: springEasing(400, 31.2),
  tap: springEasing(900, 48),
  list: springEasing(484, 35.2),
  stretch: springEasing(320, 20),
  pop: springEasing(500, 22),
  lead: springEasing(784, 48.2),
  trail: springEasing(289, 29.2),
  glide: springEasing(1000, 63),
  quickLead: springEasing(900, 51),
  quickTrail: springEasing(400, 34),
} as const

export type SpringName = keyof typeof SPRING

/** 拼装形如 `height 420ms linear(...), opacity 420ms linear(...)` 的 transition 值。 */
export function springTransition(curve: SpringCurve, ...properties: string[]): string {
  return properties
    .map((property) => `${property} ${curve.duration}ms ${curve.easing}`)
    .join(", ")
}

/** 用户是否要求减少动效（SSR 下返回 false）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
