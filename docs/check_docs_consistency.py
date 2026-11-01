"""检查 PRD 索引与 docs/prd 文件的一致性（轻量文档门禁）。

检查项：
1. docs/prd/PRD-*.md 的每个文件都在 docs/PRD.md 的「PRD 文档索引」中有链接；
2. 索引中的 PRD 行数等于文件数（防止未登记/重复登记）。

用法：python docs/check_docs_consistency.py（不一致时退出码 1）。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PRD_DIR = REPO / "docs" / "prd"
INDEX = REPO / "docs" / "PRD.md"


def main() -> int:
    files = sorted(path.name for path in PRD_DIR.glob("PRD-*.md"))
    text = INDEX.read_text(encoding="utf-8")
    linked = re.findall(r"\]\(prd/(PRD-[^)]+\.md)\)", text)
    linked_set = set(linked)
    missing = [name for name in files if name not in linked_set]
    ghost = sorted(linked_set - set(files))
    problems: list[str] = []
    if missing:
        problems.append(f"未登记到 PRD.md 索引：{missing}")
    if ghost:
        problems.append(f"索引指向不存在的 PRD 文件：{ghost}")
    if len(linked) != len(files):
        problems.append(
            f"索引 PRD 行数 {len(linked)} != docs/prd 文件数 {len(files)}"
        )
    if problems:
        print("DOCS_CONSISTENCY_FAILED")
        for item in problems:
            print(" -", item)
        return 1
    print(f"DOCS_CONSISTENCY_OK prds={len(files)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
