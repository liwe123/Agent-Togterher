# -*- coding: utf-8 -*-
"""Crawl git history and generate the Agent Console change-tracking table.

Usage:
    python docs/generate_change_log.py

Outputs:
    - docs/PRD.md          (table section rewritten between markers)
    - docs/Agent_Console_变更追踪.xlsx

How it works:
    - Walks `git log` on the current branch after BASELINE_SHA.
    - Assigns C-XXX work-order IDs in chronological commit order.
    - Infers columns from conventional-commit prefixes and changed file paths.
    - Applies CURATED overrides (keyed by short commit sha) where a human has
      written rich frontend/backend/db/note detail; new commits fall back to
      inference and should be curated later if desired.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

# Change this when starting a new tracked era. Commits before it are ignored.
BASELINE_SHA = "64887a4"

REPO = Path(__file__).resolve().parents[1]  # repo root
PRD = REPO / "docs" / "PRD.md"
XLSX = REPO / "docs" / "Agent_Console_变更追踪.xlsx"

HEADERS = ["改动时间", "ID", "改动类型", "改动内容", "前端技术", "后端技术", "是否有数据库", "备注"]

# Conventional-commit prefix -> change type.
PREFIX_TYPE = {
    "feat": "Requirement",
    "feat!": "Requirement",
    "fix": "BUG",
    "refactor": "Optimization",
    "optimize": "Optimization",
    "perf": "Optimization",
    "style": "Optimization",
    "docs": "Docs",
    "chore": "Docs",
    "test": "Docs",
    "build": "Docs",
    "ci": "Docs",
}

# Curated rows: keyed by short commit sha. Each value is the "rich" override.
# Columns: (type, content, frontend, backend, db, notes). ID/time/ID come from git.
CURATED = {
    "08ed038": (
        "Optimization",
        "全站优化：消除前端 4 处重复 WebSocket 逻辑与死代码，统一连接/任务工具/常量，增加 ErrorBoundary；后端事件契约规范化、记录模型成本、限制并发",
        "提取共用 useWorkspaceSocket；删除死代码(SystemStatus/SoftwareDock/selectConsoleAgents)；新增 ErrorBoundary；常量集中 constants.ts；任务工具去重 task-utils.ts；fetchedRef 防护",
        "TaskStepEventPayload Schema 替代手写 dict；LiteLLM 响应提取成本；并发控制(max 3, 429)；receipt 标注预留",
        "否",
        "前端测试 2→28；净减 237 行",
    ),
    "8ab4834": (
        "Docs", "README 更新本轮优化详情", "README 章节补充", "-", "否", "测试数 37/28",
    ),
    "5f3b6a1": (
        "Docs", "README 全文中文化", "README 全量翻译", "-", "否", "全量翻译",
    ),
    "3a99015": (
        "Docs", "README 风格重写，加入架构图与关键决策记录",
        "README 结构重排、徽章、ASCII 架构图", "-", "否", "资深工程师口吻",
    ),
    "19d4dca": (
        "Requirement",
        "新增「设置 → API Key 管理」：用户可在前端填入/删除各 Provider 密钥，存库优先于环境变量",
        "设置页 API Key 管理 UI(密码框+眼睛+保存/删除)；use-settings 扩展",
        "ProviderCredential 模型；GET/PUT/DELETE /api/provider-keys；Key 解析优先级 DB>env",
        "是(provider_credentials)", "Key 永不在列表回传",
    ),
    "fb94fb2": (
        "Requirement", "新增 Windows 一键启动脚本", "start.bat / start.ps1", "-", "否",
        "Docker Compose 封装；自动复制 .env + 等健康",
    ),
    "f6ac2e8": (
        "BUG", "修复开发服务器端口无法访问（next.config standalone 配置与 dev 冲突）",
        "output:standalone 改为 NEXT_BUILD_STANDALONE env 按需启用", "-", "否",
        "仅生产 Docker 构建启用",
    ),
    "48b3c47": (
        "Requirement",
        "新增自定义模型接入（任意 provider/model + fallback 降级）；修复 API Key 眼睛图标切换失效",
        "自定义模型添加/删除 UI +「自定义」徽章；眼睛图标切换修复(undefined 与 React 批处理冲突)",
        "CustomModelConfig 模型；/api/custom-models；chat_completion 自定义解析；修按 name 查 PK bug",
        "是(custom_model_configs)", "后端 37→40",
    ),
    "5b5e5d9": (
        "Docs", "README 补充「模型与密钥管理」章节，更新测试数", "README 章节补充", "-", "否",
        "测试数 40/28",
    ),
    "4396cad": (
        "BUG", "修复一键启动脚本中文乱码（UTF-8 被 cmd/PowerShell 按 ANSI 解析）",
        "脚本消息改纯 ASCII", "-", "否", "跨代码页安全",
    ),
    "a138831": (
        "BUG", "修复设置页自定义模型表单 / API Key 输入框黑底黑字无法阅读",
        "text-foreground 修复", "-", "否", "-",
    ),
    "c8d1f72": (
        "BUG", "设置页表单字段文字改纯白，提升可读性",
        "text-white / white/90 / 占位符 white/40", "-", "否", "-",
    ),
    "c374465": (
        "BUG", "修复点击眼睛无法显示已保存 API Key（保存后清空 + Key 不回传，value 恒空）",
        "眼睛点击时拉取真实 Key 填充输入框再切换可见性",
        "新增 GET /api/provider-keys/{provider} 按需返回 Key；get_api_key_value()",
        "否", "显式操作才返回 Key，列表仍不回传",
    ),
    "abbb336": (
        "Requirement",
        "API Key 管理收敛为仅 DeepSeek 预设，用户可自行添加任意厂商的 API",
        "「添加厂商」表单(任意厂商名+Key)；厂商名 title-case；移除其余预设",
        "移除 Provider 白名单；/models/providers/status 只显示 deepseek+DB 厂商",
        "否(复用 provider_credentials)", "后端 40→42",
    ),
    "6289107": (
        "Docs", "新增 docs/PRD.md 变更追踪表", "表格 + 维护约定", "-", "否",
        "建立本表，后续改动由脚本实时生成",
    ),
    "fc35e0b": (
        "Docs", "新增 Excel 变更追踪工作簿", "openpyxl 生成脚本", "-", "否",
        "表结构含颜色/冻结/筛选",
    ),
    "2ba41fc": (
        "Docs", "变更追踪表新增「改动内容」列，明确记录每次改了什么",
        "表结构更新(PRD.md + Excel)", "-", "否", "业务描述与前后端技术分离",
    ),
}

MODEL_FILES = ("app/models/", "provider_credentials", "custom_model_configs")


def run_git(args: list[str]) -> str:
    return subprocess.run(
        ["git", "-C", str(REPO), *args],
        capture_output=True, text=True, check=True,
    ).stdout


def changed_files(sha: str) -> list[str]:
    out = run_git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
    return [l for l in out.splitlines() if l.strip()]


def infer_db(files: list[str]) -> str:
    names = []
    for f in files:
        if "app/models/" in f.replace("\\", "/"):
            base = os.path.basename(f)
            if base in ("__init__.py", "base.py", "enums.py"):
                continue
            names.append(base.replace(".py", ""))
    if names:
        return "是(" + ", ".join(sorted(set(names))) + ")"
    if any(m in " ".join(files) for m in MODEL_FILES):
        return "是"
    return "否"


def infer_frontend(files: list[str]) -> str:
    hits = [f for f in files if f.startswith("frontend/")]
    if not hits:
        return "-"
    parts = sorted({"/".join(f.split("/")[:3]) for f in hits})
    return "；".join(parts)


def infer_backend(files: list[str]) -> str:
    hits = [f for f in files if f.startswith("backend/")]
    if not hits:
        return "-"
    parts = sorted({"/".join(f.split("/")[:3]) for f in hits})
    return "；".join(parts)


def type_from_subject(subject: str) -> str:
    m = re.match(r"^([a-z]+)(\([^)]*\))?(!)?:", subject)
    if m:
        prefix = m.group(1) + (m.group(3) or "")
        return PREFIX_TYPE.get(prefix, "Docs")
    return "Docs"


def git_rows() -> list[tuple[str, str, str, str, str, str, str, str]]:
    out = run_git([
        "log", "--reverse", f"{BASELINE_SHA}..HEAD",
        "--pretty=format:%h|%ad|%s", "--date=format:%Y-%m-%d %H:%M",
    ])
    rows = []
    for i, line in enumerate(out.splitlines(), start=1):
        sha, when, subject = line.split("|", 2)
        files = changed_files(sha)
        curated = CURATED.get(sha)
        if curated:
            ctype, content, fe, be, db, notes = curated
        else:
            ctype = type_from_subject(subject)
            content = subject
            fe = infer_frontend(files)
            be = infer_backend(files)
            db = infer_db(files)
            notes = sha
        rows.append((when, f"C-{i:03d}", ctype, content, fe, be, db, notes))
    return rows


def md_table(rows) -> str:
    head = "| " + " | ".join(HEADERS) + " |\n"
    sep = "|" + "|".join(["---"] * len(HEADERS)) + "|\n"
    body = []
    for r in rows:
        body.append("| " + " | ".join(v.replace("|", "/") for v in r) + " |")
    return head + sep + "\n".join(body) + "\n"


def write_prd(rows) -> None:
    marker_start = "<!-- CHANGELOG:START -->"
    marker_end = "<!-- CHANGELOG:END -->"
    table = md_table(rows)
    text = PRD.read_text(encoding="utf-8")
    if marker_start in text:
        head, _, _ = text.partition(marker_start)
        _, _, tail = text.partition(marker_end)
        new = f"{head}{marker_start}\n{table}{marker_end}{tail}"
    else:
        # Append table with markers after the conventions block.
        new = text + f"\n{marker_start}\n{table}{marker_end}\n"
    PRD.write_text(new, encoding="utf-8")


def write_xlsx(rows) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    type_fill = {
        "Requirement": PatternFill("solid", fgColor="FFFDE7"),
        "Optimization": PatternFill("solid", fgColor="E8F5E9"),
        "BUG": PatternFill("solid", fgColor="FFEBEE"),
        "Docs": PatternFill("solid", fgColor="E3F2FD"),
    }
    wb = Workbook()
    ws = wb.active
    ws.title = "变更追踪"

    ws.merge_cells(f"A1:{get_column_letter(len(HEADERS))}1")
    c = ws["A1"]
    c.value = "Agent Console · 变更追踪表"
    c.font = Font(size=14, bold=True)
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 28

    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for col, h in enumerate(HEADERS, start=1):
        cell = ws.cell(row=2, column=col, value=h)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="37474F")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
    ws.row_dimensions[2].height = 22

    for r, row in enumerate(rows, start=3):
        for col, val in enumerate(row, start=1):
            cell = ws.cell(row=r, column=col, value=val)
            cell.alignment = Alignment(
                vertical="center", wrap_text=True,
                horizontal="center" if col in (1, 2, 3, 7) else "left",
            )
            cell.border = border
            if col == 3:
                cell.fill = type_fill.get(val, PatternFill())
            cell.font = Font(size=10)

    widths = [18, 8, 13, 40, 46, 44, 20, 24]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A3"
    ws.auto_filter.ref = f"A2:{get_column_letter(len(HEADERS))}{len(rows)+2}"
    wb.save(XLSX)


def main() -> None:
    rows = git_rows()
    write_prd(rows)
    write_xlsx(rows)
    print(f"generated {len(rows)} rows -> {PRD.name}, {XLSX.name}")


if __name__ == "__main__":
    sys.exit(main())
