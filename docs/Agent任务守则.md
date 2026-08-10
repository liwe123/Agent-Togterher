# Agent 任务守则（Agent Console 项目）

> 本守则适用于**所有在本项目执行开发 / 文档 / 运维任务的 Agent**。
> 目标：让每一次改动都可追溯、可验收、可回滚，且文档与代码始终同步。

---

## 核心原则

1. **改动可追溯**：任何改动都必须进入《改动表》，且改动内容用中文描述。
2. **类型先判后做**：动手前先判定 Requirement / Bug / Optimization，决定要不要写 PRD。
3. **测试与验收不可省**：A/B 测试 + 冒烟测试必做，最后由子 Agent 独立验收。
4. **先对齐再推送**：一切无误、验收通过后才提交并推送到远端。

---

## 守则 1 ｜ 所有改动必须上《改动表》

- **文件**：`docs/Agent_Console_变更追踪.xlsx`
- **格式**：与表中现有列完全一致，**表头在第 2 行，数据从第 3 行起**。14 列顺序固定：

  | 列 | 字段 | 说明 |
  |---|---|---|
  | A | 改动时间 | `YYYY-MM-DD HH:MM` |
  | B | ID | `C-XXX`（与 PRD.md / HTML 中一致） |
  | C | 状态 | 如 `已完成` / `进行中` |
  | D | Git 提交 | 7 位 short sha（带超链接） |
  | E | 作者 | 如 `LI` |
  | F | 改动类型 | `Requirement` / `Bug` / `Optimization` |
  | G | 影响范围 | 如 `前端`、`后端、数据库、前端` |
  | H | 改动内容 | **必须中文** |
  | I | 前端技术 | 改动涉及的前端文件 / 方案 |
  | J | 后端技术 | 改动涉及的后端文件 / 方案 |
  | K | 是否有数据库 | `是` / `否` |
  | L | 破坏性变更 | `是` / `否` |
  | M | 验证结果 | 测试结论 / 数字 |
  | N | 备注 | PRD 链接、注意事项等 |

- **改动内容（H 列）一律写中文**，描述「做了什么、为什么」。
- 《改动表》由 `docs/generate_change_log.py` 从 git 历史**自动生成**；若自动生成遗漏某次改动，按上表手动补一行，格式务必与自动生成一致。
- ⚠️ **改动类型字面量注意**：Excel 配色按 `"BUG"`（全大写）匹配，登记 Bug 类时 type 写 `BUG` 而非 `Bug`，保持单元格配色一致（PRD.md 与 PRD.html 同理）。

---

## 守则 2 ｜ 任务类型判断与 PRD 同步

每个任务**先判断类型**，再决定产出：

| 类型 | 判定信号 | 是否写 PRD |
|---|---|---|
| **Requirement** | 新增功能 / 新能力 / 新页面 / 新需求定义 | **必须写** |
| **Bug** | 修复缺陷 / `修复` / `fix` 实际坏行为 | 不写 |
| **Optimization** | 重构 / 文档改写 / 翻译 / 排版 / 流程工具 / 同步合并 | 不写 |

**若为 Requirement，必须写 PRD，并同步到以下三处：**

1. **DOC 文件夹**：`docs/prd/PRD-<功能名>.md`（命名统一 `PRD-` 前缀）
2. **PRD.html**（根目录单页阅读器）：由脚本从 PRD.md + `docs/prd/*.md` 生成，无需手改
3. **PRD.md 索引**：在 `## PRD 文档索引` 表中登记该行（源文件 = `docs/PRD.md`）

> Bug / Optimization 不写 PRD，但仍须遵守守则 1 上《改动表》。

**同步命令（改完 PRD 或提交后必跑，使改动表 / HTML 与 git 对齐）：**
```bash
python docs/generate_change_log.py   # 重生 PRD.md 的 CHANGELOG + xlsx
python docs/build_prd_html.py        # 重生根目录 PRD.html（9+ 份 PRD + 77 条变更）
```
> 依赖：`openpyxl`（生成 xlsx）、`markdown`（生成 html），均装在隔离 venv
> `~/.workbuddy/binaries/python/envs/default`。

---

## 守则 3 ｜ 测试、协同与验收

- **A/B 测试 + 冒烟测试（smoke test）必做**：任何改动（含纯文档 / 配置）都至少完成冒烟验证；功能 / 视觉类改动必须做 A/B 对比并记录结论。
- **子 Agent 协同**：改动涉及多文件、跨前后端、或需要并行分析时，**可派发多个子 Agent 协作**（如：一个分析脚本结构、一个改前端、一个改后端），主 Agent 负责汇总与最终落地。
- **子 Agent 独立完成验收（acceptance）**：所有改动做完后，**必须再派一个子 Agent 做独立验收**，至少核对：
  - 《改动表》已记录且格式 / 中文无误；
  - Requirement 的 PRD 已在 `docs/prd/`、`PRD.html`、`PRD.md` 索引三处同步；
  - A/B 测试与冒烟测试结果无回归；
  - 重跑两个生成脚本后，《改动表》与 `PRD.html` 与 git 历史一致（无失同步）。
  - 验收子 Agent 只校验、不修改；发现问题反馈主 Agent 修复后复验。

---

## 守则 4 ｜ 推送 Git 与远端

- **前置条件**：守则 1–3 全部完成、子 Agent 验收**无问题**后，才推送。
- **提交**：先 `git add` 相关文件（含代码、文档、`docs/prd/*.md`、`PRD.md`、`Agent_Console_变更追踪.xlsx`、`PRD.html`、`generate_change_log.py` 等生成脚本如有改动），再 `git commit`。
- **远端**：
  ```
  https://github.com/liwe123/Agent-Togterher.git
  ```
  - 首次或需确认远端：`git remote -v`（应为上述地址；若缺失 `git remote add origin <url>`）。
  - 推送：`git push`（或 `git push origin <branch>`）。
- 推送前再次确认《改动表》与 `PRD.html` 已用守则 2 命令重跑对齐，避免把未同步的文档推上去。

---

## 快速检查清单（每次改动收尾前过一遍）

- [ ] 改动已上《改动表》（中文改动内容，14 列格式一致）
- [ ] 改动类型已判定：Requirement / Bug / Optimization
- [ ] 若为 Requirement：PRD 已写，`docs/prd/` + `PRD.html` + `PRD.md` 索引三处已同步
- [ ] 已完成 A/B 测试与冒烟测试，结论有记录
- [ ] 已派子 Agent 独立完成验收且通过
- [ ] 已重跑 `generate_change_log.py` 与 `build_prd_html.py`，文档与 git 对齐
- [ ] `git commit` 完成，`git push` 至 `liwe123/Agent-Togterher` 远端

---

*本守则由 2026-08-10 的文档同步梳理沉淀而来；如有流程更新，同步修订本文件并补一行《改动表》。*
