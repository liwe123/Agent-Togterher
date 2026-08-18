"""Generate a dark-theme architecture diagram PNG for the Agent Console project.

Run: python docs/generate_arch_diagram.py
Output: docs/architecture-dark.png + docs/architecture-dark.svg
"""
from __future__ import annotations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.font_manager import FontProperties, findfont
from pathlib import Path
import warnings

warnings.filterwarnings("ignore")

# Resolve CJK font (Microsoft YaHei on Windows)
_yahei = findfont(FontProperties(family="Microsoft YaHei"))
FP = FontProperties(fname=_yahei)
FP_B = FontProperties(fname=_yahei, weight="bold")
FP_I = FontProperties(fname=_yahei, style="italic")

# ── Color palette ────────────────────────────────────────────────────────────
BG          = "#0D0F14"
CARD_BG     = "#151821"
CARD_BORDER = "#334155"
TEXT_MAIN   = "#E2E8F0"
TEXT_DIM    = "#94A3B8"
ACCENT_BLUE = "#3B82F6"
ACCENT_GOLD = "#F59E0B"
ACCENT_GRN  = "#10B981"
ACCENT_PURP = "#8B5CF6"
ACCENT_RED  = "#EF4444"

C_CLIENT = "#1B2A4A"
C_ACCESS = "#1A2332"
C_BRIDGE = "#2A1F3D"
C_CORE   = "#1F2D1A"
C_DATA   = "#2D2418"

# ── Figure ───────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(20, 12.5), facecolor=BG)
ax.set_facecolor(BG)
ax.set_xlim(0, 160)
ax.set_ylim(0, 100)
ax.axis("off")

# ── Helpers ──────────────────────────────────────────────────────────────────

def draw_card(x, y, w, h, title, subtitle="", color=CARD_BG, border=CARD_BORDER,
              tc=TEXT_MAIN, sc=TEXT_DIM, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4",
                 facecolor=color, edgecolor=border, linewidth=1.5, zorder=2))
    ty = y + h * 0.62 if subtitle else y + h / 2
    fp = FP_B if bold else FP
    ax.text(x + w / 2, ty, title, ha="center", va="center", fontsize=9.5,
            color=tc, fontproperties=fp, zorder=3)
    if subtitle:
        ax.text(x + w / 2, y + h * 0.28, subtitle, ha="center", va="center",
                fontsize=7.5, color=sc, fontproperties=FP, zorder=3)

def draw_layer(x, y, w, h, label, color, icon=""):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.5",
                 facecolor=color, edgecolor=CARD_BORDER, linewidth=0.8,
                 alpha=0.35, linestyle="--", zorder=1))
    ax.text(x + 1.5, y + h - 2, f"{icon} {label}", ha="left", va="top",
            fontsize=11, color=TEXT_DIM, fontproperties=FP_B, zorder=3)

def draw_arrow(x1, y1, x2, y2, label="", color=TEXT_DIM, dashed=False):
    ls = "--" if dashed else "-"
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="->",
                 mutation_scale=12, color=color, linewidth=1.2,
                 linestyle=ls, zorder=4))
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(mx, my + 1.2, label, ha="center", va="bottom", fontsize=7,
                color=TEXT_DIM, fontproperties=FP, zorder=5)

# ── Title ───────────────────────────────────────────────────────────────────
ax.text(80, 97, "Agent Console · 系统架构图", ha="center", va="center",
        fontsize=22, color=TEXT_MAIN, fontproperties=FP_B)
ax.text(80, 93.5, "本地优先的多智能体协同运行台 · FastAPI + Next.js + LiteLLM + Redis",
        ha="center", va="center", fontsize=11, color=TEXT_DIM, fontproperties=FP)

# ── Layer backgrounds ────────────────────────────────────────────────────────
draw_layer(2, 75, 36, 16, "客户端与外部节点", C_CLIENT, "[Client]")
draw_layer(42, 75, 38, 16, "接入层 · FastAPI :8000", C_ACCESS, "[API]")
draw_layer(84, 75, 36, 16, "Bridge 适配层", C_BRIDGE, "[Bridge]")
draw_layer(42, 42, 78, 28, "任务编排核心", C_CORE, "[Core]")
draw_layer(2, 5, 118, 30, "运行与数据层", C_DATA, "[Data]")

# ── Client cards ─────────────────────────────────────────────────────────────
draw_card(5, 78, 14, 9, "Web Console", "Next.js 16 · :3000", C_CLIENT, ACCENT_BLUE)
draw_card(22, 78, 14, 9, "外部 Agent", "Cursor · Codex CLI\nTrae · Antigravity", C_CLIENT, ACCENT_GOLD)

# ── Access cards ────────────────────────────────────────────────────────────
draw_card(44, 78, 11, 9, "REST API", "/api/v1\nJWT · RBAC", C_ACCESS, ACCENT_BLUE)
draw_card(57, 78, 11, 9, "WebSocket", "实时事件推送", C_ACCESS, ACCENT_PURP)
draw_card(70, 78, 8.5, 9, "Integration\nService", "派发 · 回写", C_ACCESS, ACCENT_GRN)

# ── Bridge cards ────────────────────────────────────────────────────────────
draw_card(86, 78, 14, 9, "BaseBridge", "目录契约\n4 文件落盘", C_BRIDGE, ACCENT_PURP)
draw_card(102, 78.5, 7.5, 3.8, "CursorBridge", "文件系统", C_BRIDGE, "#6366F1")
draw_card(102, 82.5, 7.5, 3.8, "CodexBridge", "CLI 子进程", C_BRIDGE, "#EC4899")

# ── Core cards ───────────────────────────────────────────────────────────────
draw_card(44, 58, 15, 8, "MessageHub", "消息接收 · @Agent 路由", color=C_CORE, border=ACCENT_BLUE)
draw_card(61, 58, 15, 8, "TaskService", "任务状态机 · 入队", color=C_CORE, border=ACCENT_BLUE)
draw_card(78, 58, 15, 8, "AgentOrchestrator", "Manager→Worker\n→QA→Final", color=C_CORE, border=ACCENT_GOLD)
draw_card(95, 58, 11, 8, "ExecutionTrace", "Tools · Plugins", color=C_CORE, border=ACCENT_GRN)
draw_card(108, 58, 10, 8, "LiteLLM 网关", "多 Provider\nFallback", color=C_CORE, border=ACCENT_RED)
draw_card(61, 46, 24, 8, "独立 Worker", "领取 · 执行 · 回写", color=C_CORE, border=ACCENT_GOLD)

# ── Data cards ───────────────────────────────────────────────────────────────
draw_card(5, 18, 18, 8, "task_queue_items", "持久化任务队列", color=C_DATA, border=ACCENT_GOLD)
draw_card(26, 18, 20, 8, "SQLite / PostgreSQL", "19 张领域表\nintegration_nodes", color=C_DATA, border=ACCENT_BLUE)
draw_card(49, 18, 14, 8, "Redis", "Pub/Sub", color=C_DATA, border=ACCENT_RED)
draw_card(66, 18, 20, 8, "模型服务", "OpenAI · Anthropic\nGemini · DeepSeek", color=C_DATA, border=ACCENT_PURP)
draw_card(89, 18, 28, 8, "Bridge 工作目录", "data/bridges/workspace-<id>/\nPROMPT.md · task.json\noutput.md · events.jsonl", color=C_DATA, border=ACCENT_GRN)

# ── Arrows ──────────────────────────────────────────────────────────────────
draw_arrow(19, 78, 49.5, 87, "REST", ACCENT_BLUE)
draw_arrow(12, 78, 62.5, 78, "WebSocket", ACCENT_PURP, dashed=True)
draw_arrow(29, 80, 78, 80, "Bridge", ACCENT_GOLD, dashed=True)
draw_arrow(49.5, 78, 51.5, 66, "", ACCENT_BLUE)
draw_arrow(74, 78, 93, 66, "/dispatch", ACCENT_GRN)
draw_arrow(59, 62, 61, 62, "", ACCENT_BLUE)
draw_arrow(76, 62, 78, 62, "", ACCENT_BLUE)
draw_arrow(93, 62, 95, 62, "", ACCENT_GOLD)
draw_arrow(106, 62, 108, 62, "", ACCENT_RED)
draw_arrow(68, 58, 36, 26, "", ACCENT_BLUE)
draw_arrow(85, 58, 85, 26, "TaskStep\n回写", ACCENT_GOLD)
draw_arrow(73, 46, 23, 26, "claim", ACCENT_GOLD)
draw_arrow(23, 18, 61, 18, "", TEXT_DIM, dashed=True)
draw_arrow(63, 18, 73, 18, "", TEXT_DIM, dashed=True)
draw_arrow(103, 78, 103, 26, "落盘", ACCENT_GRN)
draw_arrow(62.5, 78, 56, 26, "", ACCENT_RED, dashed=True)

# ── Legend ───────────────────────────────────────────────────────────────────
ax.text(125, 88, "图例", fontsize=10, color=TEXT_MAIN, fontproperties=FP_B)
legend_items = [
    (ACCENT_BLUE,  "REST / API 调用"),
    (ACCENT_PURP,  "WebSocket 实时"),
    (ACCENT_GOLD,  "任务调度 / 派发"),
    (ACCENT_GRN,   "Bridge 执行 / 落盘"),
    (ACCENT_RED,   "模型调用 / Redis"),
]
for i, (c, label) in enumerate(legend_items):
    y = 84 - i * 3
    ax.plot([124, 127], [y, y], color=c, linewidth=2.5)
    ax.text(128, y, label, fontsize=8, color=TEXT_DIM, va="center", fontproperties=FP)

# ── Footer ──────────────────────────────────────────────────────────────────
ax.text(80, 2, "控制面统一 · 节点面开放 · 调度面可替换 · 执行面可观测 · 结果面可回放",
        ha="center", va="center", fontsize=9, color=TEXT_DIM, fontproperties=FP_I)

# ── Save ────────────────────────────────────────────────────────────────────
out = Path(__file__).parent / "architecture-dark.png"
fig.savefig(out, dpi=150, facecolor=BG, bbox_inches="tight", pad_inches=0.3)
fig.savefig(Path(__file__).parent / "architecture-dark.svg", facecolor=BG,
            bbox_inches="tight", pad_inches=0.3)
print(f"Generated {out} ({out.stat().st_size // 1024} KB)")
plt.close()
