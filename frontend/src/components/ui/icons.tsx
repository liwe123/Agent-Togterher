"use client"

import type { SVGProps } from "react"

import {
  ICON_COMPONENT_MAP,
  ICONS,
  type IconDefinition,
  type IconName,
  type IconPrimitive,
} from "@/lib/icon-paths"
import { cn } from "@/lib/utils"

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  /** 渲染尺寸（px），默认 16；通常由调用方 className 的 Tailwind 尺寸控制。 */
  size?: number
  /** 线宽覆盖，默认取图标定义（1.5 / 1.6 / 1.8）。 */
  strokeWidth?: number
}

function Primitive({ prim, inherited }: { prim: IconPrimitive; inherited: number }) {
  const strokeWidth = prim.sw ?? inherited
  switch (prim.t) {
    case "path":
      return (
        <path
          d={prim.d}
          fill={prim.fill ? "currentColor" : "none"}
          stroke={prim.fill ? "none" : "currentColor"}
          strokeWidth={strokeWidth}
        />
      )
    case "circle":
      return (
        <circle
          cx={prim.cx}
          cy={prim.cy}
          r={prim.r}
          fill={prim.fill ? "currentColor" : "none"}
          stroke={prim.fill ? "none" : "currentColor"}
          strokeWidth={strokeWidth}
        />
      )
    case "rect":
      return (
        <rect
          x={prim.x}
          y={prim.y}
          width={prim.w}
          height={prim.h}
          rx={prim.rx}
          fill={prim.fill ? "currentColor" : "none"}
          stroke={prim.fill ? "none" : "currentColor"}
          strokeWidth={strokeWidth}
        />
      )
    case "line":
      return <line x1={prim.x1} y1={prim.y1} x2={prim.x2} y2={prim.y2} strokeWidth={strokeWidth} />
    case "polyline":
      return (
        <polyline
          points={prim.points}
          fill={prim.fill ? "currentColor" : "none"}
          stroke={prim.fill ? "none" : "currentColor"}
          strokeWidth={strokeWidth}
        />
      )
    case "polygon":
      return (
        <polygon
          points={prim.points}
          fill={prim.fill ? "currentColor" : "none"}
          stroke={prim.fill ? "none" : "currentColor"}
          strokeWidth={strokeWidth}
        />
      )
    default:
      return null
  }
}

/** DS-Bot 图标渲染器：20×20 画布、currentColor 描边、圆头圆角、默认 aria-hidden。 */
export function Icon({
  name,
  size = 16,
  strokeWidth,
  className,
  ...rest
}: IconProps & { name: IconName }) {
  const def: IconDefinition = ICONS[name]
  const inherited = strokeWidth ?? def.sw ?? 1.6
  const labelled = typeof rest["aria-label"] === "string" && rest["aria-label"].length > 0
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={inherited}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={def.dash}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      className={cn("shrink-0", className)}
      {...rest}
    >
      <g transform={def.transform}>
        {def.prims.map((prim, index) => (
          <Primitive key={index} prim={prim} inherited={inherited} />
        ))}
      </g>
    </svg>
  )
}

function createIcon(name: IconName) {
  const Component = (props: IconProps) => <Icon name={name} {...props} />
  Component.displayName = name
  return Component
}

export const Activity = createIcon(ICON_COMPONENT_MAP.Activity)
export const AlertCircle = createIcon(ICON_COMPONENT_MAP.AlertCircle)
export const AlertTriangle = createIcon(ICON_COMPONENT_MAP.AlertTriangle)
export const ArrowDown = createIcon(ICON_COMPONENT_MAP.ArrowDown)
export const ArrowDownRight = createIcon(ICON_COMPONENT_MAP.ArrowDownRight)
export const ArrowLeft = createIcon(ICON_COMPONENT_MAP.ArrowLeft)
export const ArrowRight = createIcon(ICON_COMPONENT_MAP.ArrowRight)
export const ArrowUpRight = createIcon(ICON_COMPONENT_MAP.ArrowUpRight)
export const Blocks = createIcon(ICON_COMPONENT_MAP.Blocks)
export const Bot = createIcon(ICON_COMPONENT_MAP.Bot)
export const Braces = createIcon(ICON_COMPONENT_MAP.Braces)
export const CalendarClock = createIcon(ICON_COMPONENT_MAP.CalendarClock)
export const Check = createIcon(ICON_COMPONENT_MAP.Check)
export const CheckCircle2 = createIcon(ICON_COMPONENT_MAP.CheckCircle2)
export const ChevronRight = createIcon(ICON_COMPONENT_MAP.ChevronRight)
export const ChevronUp = createIcon(ICON_COMPONENT_MAP.ChevronUp)
export const ChevronsUpDown = createIcon(ICON_COMPONENT_MAP.ChevronsUpDown)
export const Circle = createIcon(ICON_COMPONENT_MAP.Circle)
export const CircleAlert = createIcon(ICON_COMPONENT_MAP.CircleAlert)
export const CircleDashed = createIcon(ICON_COMPONENT_MAP.CircleDashed)
export const Clock = createIcon(ICON_COMPONENT_MAP.Clock)
export const Clock3 = createIcon(ICON_COMPONENT_MAP.Clock3)
export const Code = createIcon(ICON_COMPONENT_MAP.Code)
export const CodeXml = createIcon(ICON_COMPONENT_MAP.CodeXml)
export const Coins = createIcon(ICON_COMPONENT_MAP.Coins)
export const ContactRound = createIcon(ICON_COMPONENT_MAP.ContactRound)
export const Copy = createIcon(ICON_COMPONENT_MAP.Copy)
export const CornerDownLeft = createIcon(ICON_COMPONENT_MAP.CornerDownLeft)
export const Cpu = createIcon(ICON_COMPONENT_MAP.Cpu)
export const Crown = createIcon(ICON_COMPONENT_MAP.Crown)
export const DollarSign = createIcon(ICON_COMPONENT_MAP.DollarSign)
export const ExternalLink = createIcon(ICON_COMPONENT_MAP.ExternalLink)
export const Eye = createIcon(ICON_COMPONENT_MAP.Eye)
export const EyeOff = createIcon(ICON_COMPONENT_MAP.EyeOff)
export const FileInput = createIcon(ICON_COMPONENT_MAP.FileInput)
export const Flame = createIcon(ICON_COMPONENT_MAP.Flame)
export const FlaskConical = createIcon(ICON_COMPONENT_MAP.FlaskConical)
export const Gauge = createIcon(ICON_COMPONENT_MAP.Gauge)
export const GitBranch = createIcon(ICON_COMPONENT_MAP.GitBranch)
export const Globe = createIcon(ICON_COMPONENT_MAP.Globe)
export const History = createIcon(ICON_COMPONENT_MAP.History)
export const Info = createIcon(ICON_COMPONENT_MAP.Info)
export const KeyRound = createIcon(ICON_COMPONENT_MAP.KeyRound)
export const Layers = createIcon(ICON_COMPONENT_MAP.Layers)
export const LayoutDashboard = createIcon(ICON_COMPONENT_MAP.LayoutDashboard)
export const Link2 = createIcon(ICON_COMPONENT_MAP.Link2)
export const ListChecks = createIcon(ICON_COMPONENT_MAP.ListChecks)
export const ListTodo = createIcon(ICON_COMPONENT_MAP.ListTodo)
export const Loader2 = createIcon(ICON_COMPONENT_MAP.Loader2)
export const LoaderCircle = createIcon(ICON_COMPONENT_MAP.LoaderCircle)
export const Lock = createIcon(ICON_COMPONENT_MAP.Lock)
export const LogOut = createIcon(ICON_COMPONENT_MAP.LogOut)
export const Mail = createIcon(ICON_COMPONENT_MAP.Mail)
export const MessageCircleMore = createIcon(ICON_COMPONENT_MAP.MessageCircleMore)
export const MessageSquare = createIcon(ICON_COMPONENT_MAP.MessageSquare)
export const MessagesSquare = createIcon(ICON_COMPONENT_MAP.MessagesSquare)
export const Minus = createIcon(ICON_COMPONENT_MAP.Minus)
export const MinusCircle = createIcon(ICON_COMPONENT_MAP.MinusCircle)
export const Moon = createIcon(ICON_COMPONENT_MAP.Moon)
export const MousePointer2 = createIcon(ICON_COMPONENT_MAP.MousePointer2)
export const MousePointerClick = createIcon(ICON_COMPONENT_MAP.MousePointerClick)
export const Palette = createIcon(ICON_COMPONENT_MAP.Palette)
export const Pause = createIcon(ICON_COMPONENT_MAP.Pause)
export const Play = createIcon(ICON_COMPONENT_MAP.Play)
export const Plus = createIcon(ICON_COMPONENT_MAP.Plus)
export const Power = createIcon(ICON_COMPONENT_MAP.Power)
export const Radio = createIcon(ICON_COMPONENT_MAP.Radio)
export const RefreshCw = createIcon(ICON_COMPONENT_MAP.RefreshCw)
export const RotateCcw = createIcon(ICON_COMPONENT_MAP.RotateCcw)
export const Save = createIcon(ICON_COMPONENT_MAP.Save)
export const Search = createIcon(ICON_COMPONENT_MAP.Search)
export const Send = createIcon(ICON_COMPONENT_MAP.Send)
export const ServerCog = createIcon(ICON_COMPONENT_MAP.ServerCog)
export const Settings = createIcon(ICON_COMPONENT_MAP.Settings)
export const Shield = createIcon(ICON_COMPONENT_MAP.Shield)
export const ShieldAlert = createIcon(ICON_COMPONENT_MAP.ShieldAlert)
export const ShieldCheck = createIcon(ICON_COMPONENT_MAP.ShieldCheck)
export const ShieldX = createIcon(ICON_COMPONENT_MAP.ShieldX)
export const SlidersHorizontal = createIcon(ICON_COMPONENT_MAP.SlidersHorizontal)
export const Sparkles = createIcon(ICON_COMPONENT_MAP.Sparkles)
export const Sun = createIcon(ICON_COMPONENT_MAP.Sun)
export const Timer = createIcon(ICON_COMPONENT_MAP.Timer)
export const Trash2 = createIcon(ICON_COMPONENT_MAP.Trash2)
export const TrendingUp = createIcon(ICON_COMPONENT_MAP.TrendingUp)
export const TriangleAlert = createIcon(ICON_COMPONENT_MAP.TriangleAlert)
export const User = createIcon(ICON_COMPONENT_MAP.User)
export const UserPlus = createIcon(ICON_COMPONENT_MAP.UserPlus)
export const UserRound = createIcon(ICON_COMPONENT_MAP.UserRound)
export const Users = createIcon(ICON_COMPONENT_MAP.Users)
export const UsersRound = createIcon(ICON_COMPONENT_MAP.UsersRound)
export const Workflow = createIcon(ICON_COMPONENT_MAP.Workflow)
export const Wrench = createIcon(ICON_COMPONENT_MAP.Wrench)
export const X = createIcon(ICON_COMPONENT_MAP.X)
export const XCircle = createIcon(ICON_COMPONENT_MAP.XCircle)
export const Zap = createIcon(ICON_COMPONENT_MAP.Zap)

/** 扩展图标（非历史 lucide 语义名）：外部集成节点图形。 */
export const Plug = createIcon("plug")
