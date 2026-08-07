# -*- coding: utf-8 -*-
"""Build a single-page HTML reader from docs/PRD.md and docs/prd/*.md."""
from __future__ import annotations

import argparse
import html
import re
from datetime import datetime
from pathlib import Path

import markdown

REPO = Path(__file__).resolve().parents[1]
DOCS = REPO / "docs"
DEFAULT_OUTPUT = REPO / "PRD.html"


def slugify(value: str, separator: str) -> str:
    value = re.sub(r"[^\w\-\u4e00-\u9fff ]", "", value.lower()).strip()
    return re.sub(r"[\s\-]+", separator, value)


def strip_document_title(text: str) -> str:
    """Drop the document's leading '# ' title (the page has its own hero)."""
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if re.match(r"^#\s+\S", line):
            return "".join(lines[i + 1:])
    return text


def demote_headings(text: str) -> str:
    """Shift every ATX heading one level down, skipping fenced code blocks.

    PRD files use '# title' + '## N. section'; demoting makes the title an h2
    and its sections h3 so they group correctly in the sidebar TOC.
    """
    out: list[str] = []
    in_fence = False
    for line in text.splitlines(keepends=True):
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            new_level = min(len(m.group(1)) + 1, 6)
            out.append("#" * new_level + " " + m.group(2) + "\n")
        else:
            out.append(line)
    return "".join(out)


def render_markdown(text: str) -> str:
    return markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
        extension_configs={"toc": {"slugify": slugify}},
    )


def prefix_section_ids(fragment: str, prefix: str) -> str:
    ids = re.findall(r'\sid="([^"]+)"', fragment)
    for index, section_id in enumerate(ids):
        namespaced = prefix if index == 0 else f"{prefix}-{section_id}"
        fragment = fragment.replace(f'id="{section_id}"', f'id="{namespaced}"')
        fragment = fragment.replace(f'href="#{section_id}"', f'href="#{namespaced}"')
    return fragment


def wrap_tables(fragment: str) -> str:
    fragment = re.sub(r"<table>(.*?)</table>", r'<div class="table-wrap"><table>\1</table></div>', fragment, flags=re.S)
    return fragment.replace('<div class="table-wrap"><table>\n<thead>\n<tr>\n<th>改动时间</th>', '<div class="table-wrap changelog"><table>\n<thead>\n<tr>\n<th>改动时间</th>')


def split_main_document(source: str) -> tuple[str, str]:
    marker = "## 后续维护约定"
    if marker not in source:
        return source, ""
    body, maintenance = source.split(marker, 1)
    return body.rstrip(), f"{marker}{maintenance}"


def count_changelog_rows(source: str) -> int:
    m = re.search(
        r"<!-- CHANGELOG:START -->\n(.*?)<!-- CHANGELOG:END -->",
        source, re.DOTALL)
    if not m:
        return 0
    rows = [l for l in m.group(1).splitlines() if l.strip().startswith("|")]
    return max(0, len(rows) - 2)


def rewrite_index_links(fragment: str, prd_files: list[Path]) -> str:
    for path in prd_files:
        anchor = slugify(path.stem, "-")
        fragment = fragment.replace(f'href="prd/{path.name}"', f'href="#{anchor}"')
    return fragment


def collect_headings(fragment: str) -> list[tuple[int, str, str]]:
    headings: list[tuple[int, str, str]] = []
    for level, section_id, title in re.findall(r'<h([23]) id="([^"]+)">(.*?)</h\1>', fragment, flags=re.S):
        clean_title = re.sub(r"<[^>]+>", "", title)
        headings.append((int(level), section_id, html.unescape(clean_title)))
    return headings


def toc_item(section_id: str, title: str, children: list[tuple[str, str]]) -> str:
    link = f'<a href="#{html.escape(section_id)}">{html.escape(title)}</a>'
    if not children:
        return f'<li class="toc-item"><div class="toc-head">{link}</div></li>'
    label = html.escape(f"展开/合并 {title}", quote=True)
    child_html = "".join(
        f'<li class="toc-item"><div class="toc-head"><a href="#{html.escape(child_id)}">{html.escape(child_title)}</a></div></li>'
        for child_id, child_title in children
    )
    return (
        '<li class="toc-item has-children"><div class="toc-head">'
        f'<button class="toc-toggle" type="button" aria-expanded="true" aria-label="{label}">'
        '<span class="chev"></span></button>'
        f'{link}</div><ul class="toc-children">{child_html}</ul></li>'
    )


def build_toc(fragment: str, prd_prefixes: set[str]) -> str:
    headings = collect_headings(fragment)
    items: list[str] = []
    index = 0
    group_inserted = False
    while index < len(headings):
        level, section_id, title = headings[index]
        if level != 2:
            index += 1
            continue
        if section_id in prd_prefixes and not group_inserted:
            items.append('<li class="toc-group"><span>PRD 文档</span></li>')
            group_inserted = True
        children: list[tuple[str, str]] = []
        cursor = index + 1
        while cursor < len(headings) and headings[cursor][0] == 3:
            children.append((headings[cursor][1], headings[cursor][2]))
            cursor += 1
        items.append(toc_item(section_id, title, children))
        index = cursor
    return f'<nav class="toc" aria-label="目录"><ul class="toc-root">{"".join(items)}</ul></nav>'


def extract_shell(existing: str) -> tuple[str, str]:
    style_match = re.search(r"<style>.*?</style>", existing, flags=re.S)
    script_match = re.search(r"<script>.*?</script>", existing, flags=re.S)
    if not style_match or not script_match:
        raise ValueError("现有 HTML 缺少可复用的 style 或 script 区块")
    return style_match.group(0), script_match.group(0)


BRAND = (
    '<div class="brand"><div class="brand-mark">AC</div><div>'
    '<div class="brand-name">Agent Console</div>'
    '<div class="brand-sub">PRD 文档</div></div></div>'
)

SIDEBAR_CSS = """
.sidebar-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 4px 8px 12px; margin-bottom: 12px;
  border-bottom: 1px solid var(--rule);
}
.sidebar-head .brand { padding: 0; margin: 0; border-bottom: none; }
.sidebar-head .theme-toggle { width: auto; margin: 0; padding: 6px 10px; font-size: 12px; }
"""


def build(output: Path) -> None:
    if not output.exists():
        legacy_output = DOCS / "PRD.html"
        if legacy_output.exists():
            output = legacy_output
        else:
            raise FileNotFoundError(f"找不到用于复用样式的 HTML 文件：{output}")
    existing = output.read_text(encoding="utf-8")
    style, script = extract_shell(existing)
    if ".sidebar-head" not in style:
        style = style.replace("</style>", SIDEBAR_CSS + "\n</style>")
    brand = BRAND
    main_source = (DOCS / "PRD.md").read_text(encoding="utf-8")
    main_body, maintenance = split_main_document(main_source)
    main_body = strip_document_title(main_body)
    prd_files = sorted((DOCS / "prd").glob("PRD-*.md"), key=lambda path: path.name.casefold())
    prd_prefixes = {slugify(path.stem, "-") for path in prd_files}

    fragments = [rewrite_index_links(render_markdown(main_body), prd_files)]
    for path in prd_files:
        prefix = slugify(path.stem, "-")
        fragments.append(prefix_section_ids(
            render_markdown(demote_headings(path.read_text(encoding="utf-8"))), prefix))
    if maintenance:
        fragments.append(render_markdown(maintenance))
    article = wrap_tables("\n".join(fragments))
    toc = build_toc(article, prd_prefixes)

    change_count = count_changelog_rows(main_source)
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    document = f'''<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Agent Console 产品需求文档 · 变更追踪 · 全量阅读版">
<title>Agent Console · PRD 文档</title>
{style}
</head>
<body>
<button class="menu-toggle" id="menu-toggle" aria-label="打开目录">☰</button>
<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-head">
      {brand}
      <button class="theme-toggle" id="theme-toggle" type="button">切换深浅主题</button>
    </div>
    {toc}
  </aside>
  <main class="content">
    <header class="hero">
      <div class="kicker">Agent Console · 需求文档</div>
      <h1>PRD 文档</h1>
      <p class="sub">产品需求文档 · 变更追踪 · 全量阅读版</p>
      <div class="stats">
        <span>需求文档 <b>{len(prd_files)}</b> 份</span>
        <span>变更记录 <b>{change_count}</b> 条</span>
        <span>生成于 {generated_at}</span>
      </div>
    </header>
    <article class="markdown-body">
{article}
    </article>
    <footer class="content-foot">
      <span>由 <code>docs/build_prd_html.py</code> 生成</span>
      <span>源文件：docs/PRD.md · docs/prd/*.md</span>
    </footer>
  </main>
</div>
{script}
</body>
</html>
'''
    output.write_text(document, encoding="utf-8")
    print(f"Generated {output} from {len(prd_files)} PRDs and {change_count} change records")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.output.resolve())


if __name__ == "__main__":
    main()
