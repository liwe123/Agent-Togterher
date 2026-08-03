# -*- coding: utf-8 -*-
"""Crawl git history and generate the Agent Console change-tracking table.

Usage:
    python docs/generate_change_log.py

Outputs:
    - docs/PRD.md          (table section rewritten between markers)
    - docs/Agent_Console_变更追踪.xlsx

How it works:
    - Walks `git log` on the current branch after BASELINE_SHA, plus any
      EXTRA_SHAS (commits on other lineages worth tracking).
    - Assigns C-XXX work-order IDs in chronological commit order.
    - Infers columns from conventional-commit prefixes, changed file paths,
      and the git author. Applies CURATED overrides (keyed by commit sha) or
      CURATED_BY_SUBJECT where a human has written rich detail.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

BASELINE_SHA = "64887a4"

# Commits on other lineages (e.g. the pre-existing origin/main line that was
# overwritten by a force-push) that should still appear in the change log.
EXTRA_SHAS = ["9c2dd0e"]

REPO = Path(__file__).resolve().parents[1]  # repo root
PRD = REPO / "docs" / "PRD.md"
XLSX = REPO / "docs" / "Agent_Console_变更追踪.xlsx"

REPO_URL = "https://github.com/liwe123/Agent-Togterher"

HEADERS = [
    "改动时间", "ID", "状态", "Git 提交", "作者", "改动类型", "影响范围",
    "改动内容", "前端技术", "后端技术", "是否有数据库", "破坏性变更",
    "验证结果", "备注",
]

# Row layout (0-based) used by helpers.
SHA_COL = 3  # "Git 提交" column index in the row tuple

PREFIX_TYPE = {
    "feat": "Requirement", "feat!": "Requirement", "fix": "BUG",
    "refactor": "Optimization", "optimize": "Optimization", "perf": "Optimization",
    "style": "Optimization", "docs": "Docs", "chore": "Docs", "test": "Docs",
    "build": "Docs", "ci": "Docs",
}

# Curated rows: keyed by short commit sha. Fields override git inference.
CURATED = {
    "08ed038": {
        "type": "Optimization",
        "content": "全站优化：消除前端 4 处重复 WebSocket 逻辑与死代码，统一连接/任务工具/常量，增加 ErrorBoundary；后端事件契约规范化、记录模型成本、限制并发",
        "frontend": "提取共用 useWorkspaceSocket；删除死代码(SystemStatus/SoftwareDock/selectConsoleAgents)；新增 ErrorBoundary；常量集中 constants.ts；任务工具去重 task-utils.ts；fetchedRef 防护",
        "backend": "TaskStepEventPayload Schema 替代手写 dict；LiteLLM 响应提取成本；并发控制(max 3, 429)；receipt 标注预留",
        "db": "否", "breaking": "否", "verify": "前端测试 2→28；净减 237 行",
        "notes": "仅前端组件 + 后端工具函数改动，无外部 API 变化",
    },
    "8ab4834": {"type": "Docs", "content": "README 更新本轮优化详情", "frontend": "README 章节补充", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "测试数 37/28"},
    "5f3b6a1": {"type": "Docs", "content": "README 全文中文化", "frontend": "README 全量翻译", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "全量翻译"},
    "3a99015": {"type": "Docs", "content": "README 风格重写，加入架构图与关键决策记录", "frontend": "README 结构重排、徽章、ASCII 架构图", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "资深工程师口吻"},
    "19d4dca": {
        "type": "Requirement",
        "content": "新增「设置 → API Key 管理」：用户可在前端填入/删除各 Provider 密钥，存库优先于环境变量",
        "frontend": "设置页 API Key 管理 UI(密码框+眼睛+保存/删除)；use-settings 扩展",
        "backend": "ProviderCredential 模型；GET/PUT/DELETE /api/provider-keys；Key 解析优先级 DB>env",
        "db": "是(provider_credentials)", "breaking": "是",
        "verify": "后端 37→40", "notes": "Key 永不在列表回传；新增表",
    },
    "fb94fb2": {"type": "Requirement", "content": "新增 Windows 一键启动脚本", "frontend": "start.bat / start.ps1", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "Docker Compose 封装；自动复制 .env + 等健康"},
    "f6ac2e8": {"type": "BUG", "content": "修复开发服务器端口无法访问（next.config standalone 配置与 dev 冲突）", "frontend": "output:standalone 改为 NEXT_BUILD_STANDALONE env 按需启用", "backend": "-", "db": "否", "breaking": "否", "verify": "build pass", "notes": "仅生产 Docker 构建启用"},
    "48b3c47": {
        "type": "Requirement",
        "content": "新增自定义模型接入（任意 provider/model + fallback 降级）；修复 API Key 眼睛图标切换失效",
        "frontend": "自定义模型添加/删除 UI +「自定义」徽章；眼睛图标切换修复(undefined 与 React 批处理冲突)",
        "backend": "CustomModelConfig 模型；/api/custom-models；chat_completion 自定义解析；修按 name 查 PK bug",
        "db": "是(custom_model_configs)", "breaking": "是",
        "verify": "后端 37→40", "notes": "新增表；含眼睛 BUG 修复",
    },
    "5b5e5d9": {"type": "Docs", "content": "README 补充「模型与密钥管理」章节，更新测试数", "frontend": "README 章节补充", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "测试数 40/28"},
    "4396cad": {"type": "BUG", "content": "修复一键启动脚本中文乱码（UTF-8 被 cmd/PowerShell 按 ANSI 解析）", "frontend": "脚本消息改纯 ASCII", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "跨代码页安全"},
    "a138831": {"type": "BUG", "content": "修复设置页自定义模型表单 / API Key 输入框黑底黑字无法阅读", "frontend": "text-foreground 修复", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "-"},
    "c8d1f72": {"type": "BUG", "content": "设置页表单字段文字改纯白，提升可读性", "frontend": "text-white / white/90 / 占位符 white/40", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "-"},
    "c374465": {
        "type": "BUG",
        "content": "修复点击眼睛无法显示已保存 API Key（保存后清空 + Key 不回传，value 恒空）",
        "frontend": "眼睛点击时拉取真实 Key 填充输入框再切换可见性",
        "backend": "新增 GET /api/provider-keys/{provider} 按需返回 Key；get_api_key_value()",
        "db": "否", "breaking": "否", "verify": "后端 42 passed",
        "notes": "显式操作才返回 Key，列表仍不回传",
    },
    "abbb336": {
        "type": "Requirement",
        "content": "API Key 管理收敛为仅 DeepSeek 预设，用户可自行添加任意厂商的 API",
        "frontend": "「添加厂商」表单(任意厂商名+Key)；厂商名 title-case；移除其余预设",
        "backend": "移除 Provider 白名单；/models/providers/status 只显示 deepseek+DB 厂商",
        "db": "否(复用 provider_credentials)", "breaking": "是",
        "verify": "后端 40→42", "notes": "API 行为变化：PUT 接受任意厂商名",
    },
    "6289107": {"type": "Docs", "content": "新增 docs/PRD.md 变更追踪表", "frontend": "表格 + 维护约定", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "建立本表，后续由脚本实时生成"},
    "fc35e0b": {"type": "Docs", "content": "新增 Excel 变更追踪工作簿", "frontend": "openpyxl 生成脚本", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "表结构含颜色/冻结/筛选"},
    "2ba41fc": {"type": "Docs", "content": "变更追踪表新增「改动内容」列，明确记录每次改了什么", "frontend": "表结构更新(PRD.md + Excel)", "backend": "-", "db": "否", "breaking": "否", "verify": "-", "notes": "业务描述与前后端技术分离"},
    "9c2dd0e": {
        "type": "Requirement",
        "content": "前端视觉与响应式优化，新增通讯录 /contacts 页面与 Agent 头像组件",
        "frontend": "新增 agent-portrait.tsx、contacts-page.tsx(/contacts 路由)；agent-gallery/status-panel/app-sidebar/chat 组件重构；globals.css 视觉令牌与响应式优化",
        "backend": "-", "db": "否", "breaking": "否",
        "verify": "-", "notes": "1203 插入/471 删除，21 文件；经 C-021 并入当前分支",
    },
}

# Curated by exact commit subject (so docs/script commits render cleanly even
# before their sha is known). Applied when the sha lookup misses.
CURATED_BY_SUBJECT = {
    "docs: auto-generate change log from git history": {
        "type": "Docs", "content": "变更追踪表改为从 git history 自动生成",
        "frontend": "generate_change_log.py（爬取 git log + 自动推断列 + CURATED 人工覆盖 + 生成 PRD/Excel）",
        "backend": "-", "db": "否", "breaking": "否", "verify": "-",
        "notes": "新提交自动生成行；已知提交按 sha 覆盖",
    },
    "docs: add visual-aesthetics commit C-005 to change log": {
        "type": "Docs", "content": "变更追踪表收录独立主线的视觉重构提交（C-005）",
        "frontend": "generate_change_log.py 支持 EXTRA_SHAS + 按 subject 覆盖",
        "backend": "-", "db": "否", "breaking": "否", "verify": "-",
        "notes": "9c2dd0e 强推覆盖后归位",
    },
    "merge: A/B test visual-aesthetics commit 9c2dd0e": {
        "type": "Requirement",
        "content": "合并视觉重构提交 9c2dd0e（A/B 测试通过）：新增 /contacts 通讯录页、agent-portrait 头像组件、恢复 software-dock；globals.css 视觉与响应式优化；设置页与 API Key/自定义模型功能共存",
        "frontend": "合并 settings-page.tsx（保留 API Key 管理 + 自定义模型功能并采用视觉样式）；新增 contacts 路由、agent-portrait.tsx、software-dock.tsx 恢复；agent-gallery/status-panel/app-sidebar/chat 视觉重构",
        "backend": "-", "db": "否", "breaking": "否",
        "verify": "lint/test/build/pytest 全过(42)",
        "notes": "仅 settings-page.tsx 1 处文本冲突手工合并",
    },
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


def infer_breaking(files: list[str]) -> str:
    # API contract or DB schema change => breaking.
    joined = " ".join(files).replace("\\", "/")
    if "backend/app/models/" in joined or "backend/app/schemas/" in joined:
        return "是"
    return "否"


def infer_scope(files: list[str]) -> str:
    parts: list[str] = []
    for f in files:
        f = f.replace("\\", "/")
        if f.startswith("frontend/"):
            scope = "前端"
        elif f.startswith("backend/app/models/"):
            scope = "数据库"
        elif f.startswith("backend/"):
            scope = "后端"
        elif f.startswith("docs/") or f.endswith(".md"):
            scope = "文档"
        elif f in ("start.bat", "start.ps1", "docker-compose.yml", "Dockerfile"):
            scope = "部署"
        elif f.startswith(".impeccable") or f.startswith("config/"):
            scope = "配置"
        else:
            scope = "其他"
        if scope not in parts:
            parts.append(scope)
    return "、".join(parts) if parts else "其他"


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
        return PREFIX_TYPE.get(m.group(1) + (m.group(3) or ""), "Docs")
    return "Docs"


def _commit_info(sha: str) -> tuple[str, str, str, str]:
    out = run_git([
        "log", "-1", sha, "--pretty=format:%h|%ad|%an|%s",
        "--date=format:%Y-%m-%d %H:%M",
    ])
    h, when, author, subject = out.strip().split("|", 3)
    return h, when, author, subject


def git_rows():
    out = run_git([
        "log", "--reverse", f"{BASELINE_SHA}..HEAD",
        "--pretty=format:%h|%ad|%an|%s", "--date=format:%Y-%m-%d %H:%M",
    ])
    commits: list[tuple[str, str, str, str]] = []
    seen: set[str] = set()
    for line in out.splitlines():
        h, when, author, subject = line.split("|", 3)
        commits.append((h, when, author, subject))
        seen.add(h)
    for sha in EXTRA_SHAS:
        if sha[:7] not in seen:
            commits.append(_commit_info(sha))
            seen.add(sha[:7])
    commits.sort(key=lambda c: (c[1], c[0]))

    rows = []
    for i, (sha, when, author, subject) in enumerate(commits, start=1):
        files = changed_files(sha)
        curated = CURATED.get(sha) or CURATED_BY_SUBJECT.get(subject)
        if curated:
            ctype = curated.get("type", type_from_subject(subject))
            content = curated.get("content", subject)
            fe = curated.get("frontend", infer_frontend(files))
            be = curated.get("backend", infer_backend(files))
            db = curated.get("db", infer_db(files))
            breaking = curated.get("breaking", infer_breaking(files))
            verify = curated.get("verify", "-")
            notes = curated.get("notes", "-")
        else:
            ctype = type_from_subject(subject)
            content = subject
            fe = infer_frontend(files)
            be = infer_backend(files)
            db = infer_db(files)
            breaking = infer_breaking(files)
            verify = "-"
            notes = "-"
        status = curated.get("status", "已完成") if curated else "已完成"
        scope = infer_scope(files)
        rows.append((when, f"C-{i:03d}", status, sha, author, ctype, scope,
                     content, fe, be, db, breaking, verify, notes))
    return rows


def commit_link(sha: str) -> str:
    return f"[{sha}]({REPO_URL}/commit/{sha})"


def md_table(rows) -> str:
    head = "| " + " | ".join(HEADERS) + " |\n"
    sep = "|" + "|".join(["---"] * len(HEADERS)) + "|\n"
    body = []
    for r in rows:
        cells = [str(v).replace("|", "/") for v in r]
        # Render the Git 提交 column as a clickable link.
        cells[SHA_COL] = commit_link(r[SHA_COL])
        body.append("| " + " | ".join(cells) + " |")
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

    # Excel 1-based column of the Git 提交 field (row tuple index SHA_COL).
    sha_excel_col = SHA_COL + 1
    type_excel_col = HEADERS.index("改动类型") + 1
    center_cols = {1, 2, 3, sha_excel_col, type_excel_col,
                   HEADERS.index("是否有数据库") + 1, HEADERS.index("破坏性变更") + 1}

    for r, row in enumerate(rows, start=3):
        for col, val in enumerate(row, start=1):
            cell = ws.cell(row=r, column=col, value=val)
            cell.alignment = Alignment(
                vertical="center", wrap_text=True,
                horizontal="center" if col in center_cols else "left",
            )
            cell.border = border
            if col == type_excel_col:
                cell.fill = type_fill.get(val, PatternFill())
            if col == sha_excel_col:
                cell.hyperlink = f"{REPO_URL}/commit/{val}"
                cell.style = "Hyperlink"
            cell.font = Font(size=10)

    widths = [18, 8, 9, 10, 14, 13, 14, 38, 44, 42, 20, 11, 18, 22]
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
