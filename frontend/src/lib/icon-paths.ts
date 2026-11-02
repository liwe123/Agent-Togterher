/**
 * DS-Bot 图标设计体系 · 图标路径注册表（PRD-DS-Bot图标设计体系迁移 FR1）
 *
 * 事实来源：npm 包 @lininn/ds-bot@0.2.6 的 client.js 中 src/client/icons.js
 * （约 L3751-3868）、secret-card.js（L6406-6423）、browser 工具条（L17037-17054）、
 * widgets（L5427）、feedback.js（L15143）等图标定义。
 *
 * 设计语言（与 DS-Bot 一致）：
 * - 画布固定 20×20，内容区约 3~17，圆头圆角（stroke-linecap/linejoin: round）
 * - 线宽 1.5（常规线性）/ 1.6（导航与主要动作）/ 1.8（发送、小尺寸链接）
 * - 描边颜色一律 currentColor；默认 fill: none，仅少量图标使用填充
 * - 纯数据文件：不依赖 React，可被 node --test 直接加载校验
 */

export type IconPrimitive =
  | { t: "path"; d: string; fill?: boolean; sw?: number }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: boolean; sw?: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; rx?: number; fill?: boolean; sw?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; sw?: number }
  | { t: "polyline"; points: string; fill?: boolean; sw?: number }
  | { t: "polygon"; points: string; fill?: boolean; sw?: number }

export interface IconDefinition {
  prims: IconPrimitive[]
  /** 整体变换（SVG transform），用于把路径收进 3~17 内容区或微调重心。 */
  transform?: string
  /** 该图标的默认线宽（1.5 常规 / 1.6 导航 / 1.8 发送与小图标）。 */
  sw?: number
  /** 虚线描边（stroke-dasharray），用于 circle-dashed 等。 */
  dash?: string
}

const I = {
  activity: { prims: [{ t: "path", d: "M3 10.5h3l2-4.5 3.5 9 2.5-6 1.5 1.5H17" }], sw: 1.5 },
  "alert-circle": {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 6.6 },
      { t: "path", d: "M10 6.2v4.6" },
      { t: "path", d: "M10 13.6h.01" },
    ],
    sw: 1.6,
  },
  "alert-triangle": {
    prims: [
      { t: "path", d: "M10 3.5l7 12.5H3z" },
      { t: "path", d: "M10 8.5v3.5" },
      { t: "path", d: "M10 14.2h.01" },
    ],
    sw: 1.5,
  },
  "arrow-down": {
    prims: [
      { t: "path", d: "M10 4v12" },
      { t: "path", d: "M5 11l5 5 5-5" },
    ],
    sw: 1.5,
  },
  "arrow-down-right": {
    prims: [
      { t: "path", d: "M6 6l8 8" },
      { t: "path", d: "M14 8.6V14H8.6" },
    ],
    sw: 1.6,
  },
  "arrow-left": {
    prims: [{ t: "path", d: "M12.5 4.5L7 10l5.5 5.5" }],
    sw: 1.6,
  },
  "arrow-right": {
    prims: [
      { t: "path", d: "M4.5 10h10" },
      { t: "path", d: "M10.5 5.5L15 10l-4.5 4.5" },
    ],
    sw: 1.6,
  },
  "arrow-up-right": {
    prims: [
      { t: "path", d: "M6 14L14 6" },
      { t: "path", d: "M8.6 6H14v5.4" },
    ],
    sw: 1.6,
  },
  blocks: {
    prims: [
      { t: "rect", x: 3.5, y: 3.5, w: 5.6, h: 5.6, rx: 1.4 },
      { t: "rect", x: 10.9, y: 3.5, w: 5.6, h: 5.6, rx: 1.4 },
      { t: "rect", x: 3.5, y: 10.9, w: 13, h: 5.6, rx: 1.4 },
    ],
    sw: 1.5,
  },
  bot: {
    prims: [
      { t: "rect", x: 4.4, y: 6.6, w: 11.2, h: 9, rx: 3.4 },
      { t: "path", d: "M10 3.4v3.2" },
      { t: "circle", cx: 8.1, cy: 10.4, r: 1.05, fill: true },
      { t: "circle", cx: 11.9, cy: 10.4, r: 1.05, fill: true },
      { t: "path", d: "M8.6 13.2h2.8" },
      { t: "path", d: "M2.6 10.2v2.6" },
      { t: "path", d: "M17.4 10.2v2.6" },
    ],
    sw: 1.5,
  },
  braces: {
    prims: [
      { t: "path", d: "M8.2 4.2c-1.5 0-2.2.7-2.2 2.2v1.8c0 1-.5 1.6-1.4 1.8.9.2 1.4.8 1.4 1.8v1.8c0 1.5.7 2.2 2.2 2.2" },
      { t: "path", d: "M11.8 4.2c1.5 0 2.2.7 2.2 2.2v1.8c0 1 .5 1.6 1.4 1.8-.9.2-1.4.8-1.4 1.8v1.8c0 1.5-.7 2.2-2.2 2.2" },
    ],
    sw: 1.5,
  },
  calendar: {
    prims: [
      { t: "path", d: "M5.5 5h9A1.5 1.5 0 0 1 16 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5z" },
      { t: "path", d: "M4 8.75h12" },
      { t: "path", d: "M7.25 3.5v3" },
      { t: "path", d: "M12.75 3.5v3" },
    ],
    sw: 1.5,
  },
  "calendar-clock": {
    prims: [
      { t: "rect", x: 3.06, y: 4.7, w: 9.4, h: 9.2, rx: 1.9 },
      { t: "path", d: "M3.232 8.12h9.4" },
      { t: "path", d: "M6.052 3.608v2.632" },
      { t: "path", d: "M9.812 3.608v2.632" },
      { t: "circle", cx: 14.3, cy: 13.4, r: 2.9 },
      { t: "path", d: "M14.324 11.786v1.692l1.128.752" },
    ],
    sw: 1.5,
  },
  check: { prims: [{ t: "path", d: "M4.5 10.5l3.5 3.5 7.5-8" }], sw: 1.5 },
  "check-circle": {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 6.6 },
      { t: "path", d: "M6.8 10.3l2.2 2.2 4.4-4.8" },
    ],
    sw: 1.5,
  },
  "chevron-up": { prims: [{ t: "path", d: "M5 12.5L10 7l5 5.5" }], sw: 1.6 },
  "chevron-right": { prims: [{ t: "path", d: "M7.5 4.5L13 10l-5.5 5.5" }], sw: 1.6 },
  "chevrons-up-down": {
    prims: [
      { t: "path", d: "M7.2 8.4L10 5.6l2.8 2.8" },
      { t: "path", d: "M7.2 11.6l2.8 2.8 2.8-2.8" },
    ],
    sw: 1.5,
  },
  circle: { prims: [{ t: "circle", cx: 10, cy: 10, r: 6.6 }], sw: 1.5 },
  "circle-dashed": { prims: [{ t: "circle", cx: 10, cy: 10, r: 6.6 }], sw: 1.5, dash: "2.6 2.4" },
  clock: {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 6.6 },
      { t: "path", d: "M10 6.5V10l2.5 1.5" },
    ],
    sw: 1.5,
  },
  code: {
    prims: [
      { t: "path", d: "M7.4 6.6L4 10l3.4 3.4" },
      { t: "path", d: "M12.6 6.6L16 10l-3.4 3.4" },
    ],
    sw: 1.5,
  },
  "code-xml": {
    prims: [
      { t: "path", d: "M7.4 6.6L4 10l3.4 3.4" },
      { t: "path", d: "M12.6 6.6L16 10l-3.4 3.4" },
      { t: "path", d: "M11.1 5.2l-2.2 9.6" },
    ],
    sw: 1.5,
  },
  coins: {
    prims: [
      { t: "circle", cx: 7.6, cy: 8.4, r: 3.7 },
      { t: "circle", cx: 12.4, cy: 11.6, r: 3.7 },
      { t: "path", d: "M12.4 9.8v3.6" },
      { t: "path", d: "M11.2 11.6h2.4" },
    ],
    sw: 1.5,
  },
  "corner-down-left": {
    prims: [
      { t: "path", d: "M5 5v6.2a2.5 2.5 0 0 0 2.5 2.5H16" },
      { t: "path", d: "M12.8 10.6L16 13.7l-3.2 3.1" },
    ],
    sw: 1.5,
  },
  cpu: {
    prims: [
      { t: "rect", x: 6.8, y: 6.8, w: 6.4, h: 6.4, rx: 1.4 },
      { t: "rect", x: 9, y: 9, w: 2, h: 2, rx: 0.6 },
      { t: "line", x1: 8, y1: 3.3, x2: 8, y2: 6.8 },
      { t: "line", x1: 12, y1: 3.3, x2: 12, y2: 6.8 },
      { t: "line", x1: 8, y1: 13.2, x2: 8, y2: 16.7 },
      { t: "line", x1: 12, y1: 13.2, x2: 12, y2: 16.7 },
      { t: "line", x1: 3.3, y1: 8, x2: 6.8, y2: 8 },
      { t: "line", x1: 3.3, y1: 12, x2: 6.8, y2: 12 },
      { t: "line", x1: 13.2, y1: 8, x2: 16.7, y2: 8 },
      { t: "line", x1: 13.2, y1: 12, x2: 16.7, y2: 12 },
    ],
    sw: 1.5,
  },
  crown: { prims: [{ t: "path", d: "M4.2 6.4l1.6 9.1h8.4l1.6-9.1-3.5 2.8L10 4.6 7.7 9.2z" }], sw: 1.5 },
  dollar: {
    prims: [
      { t: "path", d: "M10 3.4v13.2" },
      { t: "path", d: "M13.4 6.6c-.7-.8-1.9-1.3-3.3-1.3-2.1 0-3.4 1-3.4 2.6 0 1.7 1.4 2.3 3.5 2.8 2.2.5 3.5 1.2 3.5 2.9 0 1.8-1.5 2.9-3.7 2.9-1.6 0-2.9-.5-3.7-1.4" },
    ],
    sw: 1.5,
  },
  "external-link": {
    prims: [
      { t: "path", d: "M12 4.5h3.5V8" },
      { t: "path", d: "M15.5 4.5L10 10" },
      { t: "path", d: "M16 12v3.5A1.5 1.5 0 0 1 14.5 17h-9A1.5 1.5 0 0 1 4 15.5v-9A1.5 1.5 0 0 1 5.5 5H9" },
    ],
    sw: 1.5,
  },
  eye: {
    prims: [
      { t: "path", d: "M3.2 10s2.6-5 6.8-5 6.8 5 6.8 5-2.6 5-6.8 5S3.2 10 3.2 10z" },
      { t: "circle", cx: 10, cy: 10, r: 2.6 },
    ],
    sw: 1.5,
  },
  "eye-off": {
    prims: [
      { t: "path", d: "M3 3l14 14" },
      { t: "path", d: "M8.6 5.2A7.6 7.6 0 0 1 10 5c4.5 0 7 5 7 5a12.6 12.6 0 0 1-2 2.6M12.2 14.5A6.8 6.8 0 0 1 10 15c-4.5 0-7-5-7-5a12.4 12.4 0 0 1 3-3.4" },
      { t: "path", d: "M8.5 8.5a2 2 0 0 0 3 3" },
    ],
    sw: 1.5,
  },
  "file-input": {
    prims: [
      { t: "path", d: "M5 3.8h5.4L14 7.4V16.2H5z" },
      { t: "path", d: "M10.4 3.8v3.6H14" },
      { t: "path", d: "M7.2 11.8h4.4" },
      { t: "path", d: "M9.4 9.6L11.8 11.8l-2.4 2.2" },
    ],
    sw: 1.5,
  },
  flame: {
    prims: [
      { t: "path", d: "M10 3.3c.5 2.9 2.5 3.9 3.6 5.6.75 1.1 1 2.3.5 3.5-.6 1.6-2.5 2.8-4.6 2.8-2.6 0-4.75-1.7-4.75-3.8 0-1.6 1-2.7 2.25-3.6.25 1 1 1.7 1.9 1.7.9 0 1.25-.7 1.4-1.7.25-1.6-.4-3.2-.35-4.5z" },
    ],
    sw: 1.5,
  },
  flask: {
    prims: [
      { t: "path", d: "M8 3.5h4" },
      { t: "path", d: "M9.2 3.5v3.8L5.7 14.6A1.7 1.7 0 0 0 7.2 17h5.6a1.7 1.7 0 0 0 1.5-2.4L10.8 7.3V3.5" },
      { t: "path", d: "M7.2 13.2h5.6" },
    ],
    sw: 1.5,
  },
  gauge: {
    prims: [
      { t: "path", d: "M3 13.4a7 7 0 1 1 14 0" },
      { t: "path", d: "M10 13.4l3.6-4.6" },
      { t: "path", d: "M10 13.4h.01" },
    ],
    sw: 1.5,
  },
  gear: {
    prims: [
      { t: "path", d: "M10 7.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z" },
      { t: "path", d: "M7.85 4.4l.29-1.87a7.7 7.7 0 0 1 3.72 0l.29 1.87a6 6 0 0 1 1.63.94l1.76-.69a7.7 7.7 0 0 1 1.86 3.23l-1.47 1.18a6 6 0 0 1 0 1.88l1.47 1.18a7.7 7.7 0 0 1-1.86 3.23l-1.76-.69a6 6 0 0 1-1.63.94l-.29 1.87a7.7 7.7 0 0 1-3.72 0l-.29-1.87a6 6 0 0 1-1.63-.94l-1.76.69a7.7 7.7 0 0 1-1.86-3.23l1.47-1.18a6 6 0 0 1 0-1.88L2.6 7.88a7.7 7.7 0 0 1 1.86-3.23l1.76.69a6 6 0 0 1 1.63-.94z" },
    ],
    sw: 1.5,
  },
  "git-branch": {
    prims: [
      { t: "circle", cx: 6.4, cy: 5.2, r: 1.8 },
      { t: "circle", cx: 6.4, cy: 14.8, r: 1.8 },
      { t: "circle", cx: 14, cy: 8, r: 1.8 },
      { t: "path", d: "M6.4 7v5.8" },
      { t: "path", d: "M14 9.8c0 2.2-1.7 3.7-4.2 4.2l-1.6.4" },
    ],
    sw: 1.5,
  },
  globe: {
    prims: [
      { t: "path", d: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" },
      { t: "path", d: "M3 10h14" },
      { t: "path", d: "M10 3c2 2.2 2.9 4.5 2.9 7S12 14.8 10 17c-2-2.2-2.9-4.5-2.9-7S8 5.2 10 3z" },
    ],
    sw: 1.5,
  },
  history: {
    prims: [
      { t: "path", d: "M10 4.5a5.6 5.6 0 1 1-5.2 3.5" },
      { t: "path", d: "M4.5 4.6v3.4h3.4" },
      { t: "path", d: "M10 6.6V10l2.4 1.4" },
    ],
    sw: 1.5,
  },
  info: {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 6.6 },
      { t: "path", d: "M10 9.25v4" },
      { t: "path", d: "M10 6.6h.01" },
    ],
    sw: 1.5,
  },
  key: {
    prims: [
      { t: "path", d: "M6.2 9.5a3.2 3.2 0 1 1 0 .01z" },
      { t: "path", d: "M9.3 10.4L15.6 10.4" },
      { t: "path", d: "M13.4 10.4v2.2" },
      { t: "path", d: "M15.4 10.4v1.7" },
    ],
    sw: 1.5,
  },
  layers: {
    prims: [
      { t: "path", d: "M10 3.5l6 3-6 3-6-3z" },
      { t: "path", d: "M4 9.9l6 3 6-3" },
      { t: "path", d: "M4 13.2l6 3 6-3" },
    ],
    sw: 1.5,
  },
  "layout-dashboard": {
    prims: [
      { t: "rect", x: 3.5, y: 3.5, w: 5.2, h: 5.2, rx: 1.2 },
      { t: "rect", x: 11.3, y: 3.5, w: 5.2, h: 5.2, rx: 1.2 },
      { t: "rect", x: 3.5, y: 11.3, w: 5.2, h: 5.2, rx: 1.2 },
      { t: "rect", x: 11.3, y: 11.3, w: 5.2, h: 5.2, rx: 1.2 },
    ],
    sw: 1.6,
  },
  link: {
    prims: [
      { t: "path", d: "M8.5 11.5l3-3" },
      { t: "path", d: "M7 9.5L5.5 11a2.5 2.5 0 0 0 3.5 3.5L10.5 13" },
      { t: "path", d: "M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7" },
    ],
    sw: 1.8,
  },
  "list-checks": {
    prims: [
      { t: "path", d: "M8.4 6h8" },
      { t: "path", d: "M8.4 10h8" },
      { t: "path", d: "M8.4 14h8" },
      { t: "path", d: "M3.4 5.4l1.1 1.1 1.9-2.1" },
      { t: "path", d: "M3.4 9.4l1.1 1.1 1.9-2.1" },
      { t: "path", d: "M3.4 13.4h3" },
    ],
    sw: 1.5,
  },
  "list-todo": {
    prims: [
      { t: "path", d: "M8.4 6h8" },
      { t: "path", d: "M8.4 10h8" },
      { t: "path", d: "M8.4 14h8" },
      { t: "rect", x: 3.4, y: 4.6, w: 2.9, h: 2.9, rx: 0.8 },
      { t: "rect", x: 3.4, y: 8.6, w: 2.9, h: 2.9, rx: 0.8 },
      { t: "rect", x: 3.4, y: 12.6, w: 2.9, h: 2.9, rx: 0.8 },
    ],
    sw: 1.6,
  },
  loader: { prims: [{ t: "path", d: "M10 3.4a6.6 6.6 0 1 1-6.6 6.6" }], sw: 1.6 },
  lock: {
    prims: [
      { t: "path", d: "M6.5 9V7a3.5 3.5 0 0 1 7 0v2" },
      { t: "rect", x: 4.5, y: 9, w: 11, h: 8, rx: 2 },
    ],
    sw: 1.5,
  },
  "sign-out": {
    prims: [
      { t: "path", d: "M8.5 17H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5" },
      { t: "path", d: "M10 10h6.5" },
      { t: "path", d: "M13.5 7l3 3-3 3" },
    ],
    sw: 1.5,
  },
  mail: {
    prims: [
      { t: "rect", x: 3.4, y: 5, w: 13.2, h: 10, rx: 2 },
      { t: "path", d: "M4 6.2l6 4.4 6-4.4" },
    ],
    sw: 1.5,
  },
  minus: { prims: [{ t: "path", d: "M4 10h12" }], sw: 1.6 },
  "minus-circle": {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 6.6 },
      { t: "path", d: "M6.8 10h6.4" },
    ],
    sw: 1.5,
  },
  moon: {
    prims: [{ t: "path", d: "M14.2 3.5a6.9 6.9 0 1 0 2.4 12.1A7.6 7.6 0 0 1 14.2 3.5z", fill: true }],
    sw: 1.5,
  },
  cursor: { prims: [{ t: "path", d: "M6 3.6l10.4 6.4-4.5 1.1-1.8 4.5z" }], sw: 1.5 },
  "cursor-click": {
    prims: [
      { t: "path", d: "M8 6.4l8.2 4.7-3.6.8-1.4 3.6z" },
      { t: "path", d: "M4.4 4.4l1.9 1.9" },
      { t: "path", d: "M3.4 9.6h2.4" },
      { t: "path", d: "M9.4 3.4v2.4" },
    ],
    sw: 1.5,
  },
  palette: {
    prims: [
      { t: "path", d: "M10 4.06a5.94 5.94 0 1 0 0 11.88c1.08 0 1.71-.72 1.71-1.62 0-1.5 1-2.2 2.4-2.2h0.99a2.07 2.07 0 0 0 2.07-2.07c0-3.51-3.15-6.21-6.93-6.21z" },
      { t: "circle", cx: 7.2, cy: 8, r: 0.7, fill: true },
      { t: "circle", cx: 10, cy: 6.9, r: 0.7, fill: true },
      { t: "circle", cx: 12.8, cy: 8.2, r: 0.7, fill: true },
      { t: "circle", cx: 7, cy: 11, r: 0.7, fill: true },
    ],
    sw: 1.5,
  },
  pause: {
    prims: [
      { t: "rect", x: 6.4, y: 4.8, w: 2.7, h: 10.4, rx: 1.1, fill: true },
      { t: "rect", x: 10.9, y: 4.8, w: 2.7, h: 10.4, rx: 1.1, fill: true },
    ],
  },
  play: { prims: [{ t: "path", d: "M7.6 5.2l7.6 4.8-7.6 4.8z", fill: true }] },
  plug: {
    prims: [
      { t: "path", d: "M7 3v4" },
      { t: "path", d: "M13 3v4" },
      { t: "path", d: "M5 7h10v2.5a5 5 0 0 1-10 0z" },
      { t: "path", d: "M10 14.5V17" },
    ],
    sw: 1.5,
  },
  plus: {
    prims: [
      { t: "path", d: "M10 3.5v13" },
      { t: "path", d: "M3.5 10h13" },
    ],
    sw: 1.6,
  },
  power: {
    prims: [
      { t: "path", d: "M10 3.6v6.2" },
      { t: "path", d: "M13.9 6.1a5.6 5.6 0 1 1-7.8 0" },
    ],
    sw: 1.6,
  },
  radio: {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 6.6 },
      { t: "circle", cx: 10, cy: 10, r: 2.2, fill: true },
    ],
    sw: 1.5,
  },
  reload: {
    prims: [
      { t: "path", d: "M15.5 10a5.5 5.5 0 1 1-1.6-3.9" },
      { t: "path", d: "M15.5 3.5v3.5H12" },
    ],
    sw: 1.5,
  },
  "rotate-ccw": {
    prims: [
      { t: "path", d: "M4.5 10a5.5 5.5 0 1 0 1.6-3.9" },
      { t: "path", d: "M4.5 3.5v3.5H8" },
    ],
    sw: 1.5,
  },
  save: {
    prims: [
      { t: "path", d: "M5 4.5h8l2.5 2.5v8.5a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5z" },
      { t: "path", d: "M7.2 4.5v3.6h5.6V4.5" },
      { t: "path", d: "M7.2 16.5v-4.2h5.6v4.2" },
    ],
    sw: 1.5,
  },
  search: {
    prims: [
      { t: "circle", cx: 8.5, cy: 8.5, r: 5.5 },
      { t: "path", d: "M13 13l4 4" },
    ],
    sw: 1.6,
  },
  send: {
    prims: [
      { t: "path", d: "M10 16V4" },
      { t: "path", d: "M5 9l5-5 5 5" },
    ],
    sw: 1.8,
  },
  "server-cog": {
    prims: [
      { t: "rect", x: 3.5, y: 4.5, w: 13, h: 4.6, rx: 1.5 },
      { t: "rect", x: 3.5, y: 10.9, w: 13, h: 4.6, rx: 1.5 },
      { t: "circle", cx: 6.2, cy: 6.8, r: 0.7, fill: true },
      { t: "circle", cx: 6.2, cy: 13.2, r: 0.7, fill: true },
      { t: "path", d: "M12.6 6.8h1.4" },
      { t: "path", d: "M12.6 13.2h1.4" },
    ],
    sw: 1.5,
  },
  shield: {
    prims: [{ t: "path", d: "M10 3.2l6 2.1v4.4c0 3.2-2.2 5.7-6 7.4-3.8-1.7-6-4.2-6-7.4V5.3z" }],
    sw: 1.5,
  },
  "shield-alert": {
    prims: [
      { t: "path", d: "M10 3.2l6 2.1v4.4c0 3.2-2.2 5.7-6 7.4-3.8-1.7-6-4.2-6-7.4V5.3z" },
      { t: "path", d: "M10 7.4v3" },
      { t: "path", d: "M10 12.4h.01" },
    ],
    sw: 1.5,
  },
  "shield-check": {
    prims: [
      { t: "path", d: "M10 3.2l6 2.1v4.4c0 3.2-2.2 5.7-6 7.4-3.8-1.7-6-4.2-6-7.4V5.3z" },
      { t: "path", d: "M7.3 10.1l2 2 3.4-3.9" },
    ],
    sw: 1.5,
  },
  "shield-x": {
    prims: [
      { t: "path", d: "M10 3.2l6 2.1v4.4c0 3.2-2.2 5.7-6 7.4-3.8-1.7-6-4.2-6-7.4V5.3z" },
      { t: "path", d: "M7.9 8.1l4.2 4.2" },
      { t: "path", d: "M12.1 8.1l-4.2 4.2" },
    ],
    sw: 1.5,
  },
  sliders: {
    prims: [
      { t: "path", d: "M4 6.5h5" },
      { t: "path", d: "M12.5 6.5H16" },
      { t: "path", d: "M4 13.5h4" },
      { t: "path", d: "M11.5 13.5H16" },
      { t: "path", d: "M10.5 4.5v4" },
      { t: "path", d: "M9.5 11.5v4" },
    ],
    sw: 1.5,
  },
  sparkles: {
    prims: [
      { t: "path", d: "M9.6 3.4l1.9 4.6 4.6 1.9-4.6 1.9-1.9 4.6-1.9-4.6-4.6-1.9 4.6-1.9z" },
      { t: "path", d: "M14.3 10.8l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" },
    ],
    sw: 1.5,
  },
  sun: {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 3.4 },
      { t: "line", x1: 10, y1: 2.9, x2: 10, y2: 4.6 },
      { t: "line", x1: 10, y1: 15.4, x2: 10, y2: 17.1 },
      { t: "line", x1: 2.9, y1: 10, x2: 4.6, y2: 10 },
      { t: "line", x1: 15.4, y1: 10, x2: 17.1, y2: 10 },
      { t: "line", x1: 4.6, y1: 4.6, x2: 5.8, y2: 5.8 },
      { t: "line", x1: 14.2, y1: 5.8, x2: 15.4, y2: 4.6 },
      { t: "line", x1: 4.6, y1: 15.4, x2: 5.8, y2: 14.2 },
      { t: "line", x1: 14.2, y1: 14.2, x2: 15.4, y2: 15.4 },
    ],
    sw: 1.5,
  },
  timer: {
    prims: [
      { t: "circle", cx: 10, cy: 11, r: 5.6 },
      { t: "path", d: "M8.2 3.4h3.6" },
      { t: "path", d: "M10 5.4V3.4" },
      { t: "path", d: "M10 8v3l2 1.1" },
    ],
    sw: 1.5,
  },
  "trending-up": {
    prims: [
      { t: "path", d: "M3.4 14.6l4.4-4.4 2.9 2.9 5.4-5.8" },
      { t: "path", d: "M12.6 6.5h3.9v3.9" },
    ],
    sw: 1.5,
  },
  user: {
    prims: [
      { t: "circle", cx: 9.9, cy: 7.4, r: 3.1 },
      { t: "path", d: "M3.9 16.6c.7-2.9 2.9-4.6 6-4.6s5.3 1.7 6 4.6" },
    ],
    sw: 1.5,
  },
  "user-plus": {
    prims: [
      { t: "circle", cx: 8.6, cy: 7.5, r: 2.9 },
      { t: "path", d: "M2.6 16.5c.6-2.7 2.7-4.2 5.5-4.2 1 0 1.9.2 2.6.6" },
      { t: "path", d: "M15.5 5.6v5" },
      { t: "path", d: "M13 8.1h5" },
    ],
    sw: 1.5,
  },
  people: {
    prims: [
      { t: "circle", cx: 7.5, cy: 7, r: 3 },
      { t: "path", d: "M2 16.5c.6-2.8 2.8-4.5 5.5-4.5s4.9 1.7 5.5 4.5" },
      { t: "path", d: "M13 4.3a3 3 0 0 1 0 5.4" },
      { t: "path", d: "M15 12.4c1.6.6 2.6 2 3 4.1" },
    ],
    sw: 1.5,
  },
  chats: {
    prims: [
      { t: "path", d: "M3.5 5.5A1.5 1.5 0 0 1 5 4h7a1.5 1.5 0 0 1 1.5 1.5V10A1.5 1.5 0 0 1 12 11.5H8L5 14v-2.5A1.5 1.5 0 0 1 3.5 10z" },
      { t: "path", d: "M13.5 7.5H15A1.5 1.5 0 0 1 16.5 9v4.5A1.5 1.5 0 0 1 15 15v2l-2.5-2h-3A1.5 1.5 0 0 1 8 13.5V13" },
    ],
    sw: 1.5,
  },
  side: {
    prims: [
      { t: "path", d: "M4.5 4h11A1.5 1.5 0 0 1 17 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9L5.5 16v-3h-1A1.5 1.5 0 0 1 3 11.5v-6A1.5 1.5 0 0 1 4.5 4z" },
      { t: "path", d: "M6.5 7h7" },
      { t: "path", d: "M6.5 10h4.5" },
    ],
    sw: 1.5,
  },
  workflow: {
    prims: [
      { t: "circle", cx: 5.2, cy: 5.4, r: 2 },
      { t: "circle", cx: 14.8, cy: 5.4, r: 2 },
      { t: "circle", cx: 10, cy: 14.6, r: 2 },
      { t: "path", d: "M7.2 5.4h5.6" },
      { t: "path", d: "M5.9 7.3l2.9 5.5" },
      { t: "path", d: "M14.1 7.3l-2.9 5.5" },
    ],
    sw: 1.6,
  },
  x: {
    prims: [
      { t: "path", d: "M5 5l10 10" },
      { t: "path", d: "M15 5L5 15" },
    ],
    sw: 1.6,
  },
  wrench: {
    prims: [
      { t: "path", d: "M11.852 6.068a0.76 0.76 0 0 0 0 1.064l1.216 1.216a0.76 0.76 0 0 0 1.064 0l2.865-2.865a4.56 4.56 0 0 1-6.034 6.034l-5.252 5.252a1.611 1.611 0 0 1-2.28-2.28l5.252-5.252a4.56 4.56 0 0 1 6.034-6.034l-2.858 2.858z" },
    ],
    sw: 1.5,
  },
  "x-circle": {
    prims: [
      { t: "circle", cx: 10, cy: 10, r: 6.6 },
      { t: "path", d: "M7.6 7.6l4.8 4.8" },
      { t: "path", d: "M12.4 7.6l-4.8 4.8" },
    ],
    sw: 1.5,
  },
  zap: { prims: [{ t: "path", d: "M11.4 3.4L5.2 11h4.1l-.7 5.6L15.4 9h-4.2z" }], sw: 1.5 },
  copy: {
    prims: [
      { t: "path", d: "M8.5 7h6A1.5 1.5 0 0 1 16 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 14.5v-6A1.5 1.5 0 0 1 8.5 7z" },
      { t: "path", d: "M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4H13" },
    ],
    sw: 1.5,
  },
  trash: {
    prims: [
      { t: "path", d: "M3.5 5.5h13" },
      { t: "path", d: "M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" },
      { t: "path", d: "M5 5.5l.7 10A1.5 1.5 0 0 0 7.2 17h5.6a1.5 1.5 0 0 0 1.5-1.5l.7-10" },
      { t: "path", d: "M8.5 9v4.5" },
      { t: "path", d: "M11.5 9v4.5" },
    ],
    sw: 1.5,
  },
} satisfies Record<string, IconDefinition>

export const ICONS = I

export const ICON_NAMES = Object.keys(I) as IconName[]

export type IconName = keyof typeof I

/** 历史 lucide-react 语义名 → 新图标名。全仓替换只改 import 路径，保留原组件名。 */
export const ICON_COMPONENT_MAP = {
  Activity: "activity",
  AlertCircle: "alert-circle",
  AlertTriangle: "alert-triangle",
  ArrowDown: "arrow-down",
  ArrowDownRight: "arrow-down-right",
  ArrowLeft: "arrow-left",
  ArrowRight: "arrow-right",
  ArrowUpRight: "arrow-up-right",
  Blocks: "blocks",
  Bot: "bot",
  Braces: "braces",
  CalendarClock: "calendar-clock",
  Check: "check",
  CheckCircle2: "check-circle",
  ChevronRight: "chevron-right",
  ChevronUp: "chevron-up",
  ChevronsUpDown: "chevrons-up-down",
  Circle: "circle",
  CircleAlert: "alert-circle",
  CircleDashed: "circle-dashed",
  Clock: "clock",
  Clock3: "clock",
  Code: "code",
  CodeXml: "code-xml",
  Coins: "coins",
  ContactRound: "people",
  Copy: "copy",
  CornerDownLeft: "corner-down-left",
  Cpu: "cpu",
  Crown: "crown",
  DollarSign: "dollar",
  ExternalLink: "external-link",
  Eye: "eye",
  EyeOff: "eye-off",
  FileInput: "file-input",
  Flame: "flame",
  FlaskConical: "flask",
  Gauge: "gauge",
  GitBranch: "git-branch",
  Globe: "globe",
  History: "history",
  Info: "info",
  KeyRound: "key",
  Layers: "layers",
  LayoutDashboard: "layout-dashboard",
  Link2: "link",
  ListChecks: "list-checks",
  ListTodo: "list-todo",
  Loader2: "loader",
  LoaderCircle: "loader",
  Lock: "lock",
  LogOut: "sign-out",
  Mail: "mail",
  MessageCircleMore: "chats",
  MessageSquare: "side",
  MessagesSquare: "chats",
  Minus: "minus",
  MinusCircle: "minus-circle",
  Moon: "moon",
  MousePointer2: "cursor",
  MousePointerClick: "cursor-click",
  Palette: "palette",
  Pause: "pause",
  Play: "play",
  Plus: "plus",
  Power: "power",
  Radio: "radio",
  RefreshCw: "reload",
  RotateCcw: "rotate-ccw",
  Save: "save",
  Search: "search",
  Send: "send",
  ServerCog: "server-cog",
  Settings: "gear",
  Shield: "shield",
  ShieldAlert: "shield-alert",
  ShieldCheck: "shield-check",
  ShieldX: "shield-x",
  SlidersHorizontal: "sliders",
  Sparkles: "sparkles",
  Sun: "sun",
  Timer: "timer",
  Trash2: "trash",
  TrendingUp: "trending-up",
  TriangleAlert: "alert-triangle",
  User: "user",
  UserPlus: "user-plus",
  UserRound: "user",
  Users: "people",
  UsersRound: "people",
  Workflow: "workflow",
  Wrench: "wrench",
  X: "x",
  XCircle: "x-circle",
  Zap: "zap",
} as const satisfies Record<string, IconName>

export type IconComponentName = keyof typeof ICON_COMPONENT_MAP

/** 具名导出包装组件的名字列表（供渲染器与测试共用）。 */
export const ICON_COMPONENT_NAMES = Object.keys(ICON_COMPONENT_MAP) as IconComponentName[]

export function isIconName(value: string): value is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, value)
}
