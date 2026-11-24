# AGENTS.md — 这个空间里所有 Agent 的规矩

本目录是一个**本地 git 仓库**（没有远端）。它存在的意义就三条：给并行任务留退路、
支撑 WorkBuddy 的 Worktree 开关（要求工作区本身是 git 仓库且有提交）、让多个窗口的改动
有分界线。下面的规矩对任何 Agent（WorkBuddy / Codex / Claude / DeepSeek harness / 人）都成立。

## 一、提交纪律：谁改谁提交

- **收尾前必须 `git status` 看一眼。** 你改过的文件不能以「未提交」状态留给下一个窗口——
  下一个窗口不知道那是谁的活，可能 `reset --hard` 抹掉，也可能误当成自己的改动一起提交。
- 只 `git add <具体路径>`，**不要 `git add -A` / `git add .`**。同一份工作区里可能有别的窗口
  正在写的东西，`-A` 会把别人的半成品卷进你的提交。
- 提交信息写清「谁、做了什么」，一行标题够用。
- `git status` 里出现你**不认识**的改动 → 那不是你的。别提交、别回滚，在回复里提一句就行。

## 二、禁止的动作

| 禁止 | 为什么 |
|---|---|
| `git reset --hard` | 连带抹掉同目录别人未提交的改动，不可逆（reflog 只能救已提交的） |
| `git clean -fd` | untracked 文件直接删，救不回来 |
| `git checkout -- .` / `git restore .` | 同上 |
| `git push --force` | 本仓库没有远端，出现即误操作 |
| `git commit --amend` 已经可能被别人拉过的提交 | 制造分叉 |

撤销自己的改动用 `git restore <具体文件>`，不要用 `.`。

## 三、多人并行写同一份工作区

- **不要切分支**。`git checkout -b` 会把别人未提交的改动一起带走。需要隔离就开 worktree：

  ```bash
  bash ~/Documents/cuntu/new-worktree.sh <任务名>            # 本空间 → ~/WorkBuddy/worktrees/2026_11_24_16-30-17/<任务名>
  bash ~/Documents/cuntu/new-worktree.sh --rm <任务名>        # 用完删掉
  ```

- 要动公共文件（`.gitignore`、`schema/`、共享模板）之前说一声，别让两个窗口同时改同一个。

## 四、这个空间是什么

「墨山插件体系」的设计与可执行产物：总纲 `ARCHITECTURE.md`、协议 `MOSHAN-PLUGIN-SPEC.md`、
数据 `registry/registry.json` + `catalog/`、校验器 `schema/registry.schema.json`、
工具 `tools/`、两个入口页 `market.html` 与 `canvas.html`。

**关键：`market.html` 是生成物，不要手改。** 它由模板 + 数据内嵌而成：

```
market.template.html  +  registry/registry.json  +  catalog/moshan-catalog.json
        └────────────────── tools/build_market.py ──────────────────┘
                                    ▼
                               market.html
```

要改市场页面就改 `market.template.html`，然后重新生成；要改数据就改 `registry/` 与
`catalog/`。直接编辑 `market.html` 的结果是下次重建时被覆盖掉。

## 五、提交前的最小检查

```bash
python3 tools/validate.py                  # 校验 registry 与 catalog，必须全绿
python3 tools/build_market.py              # 改过模板/数据后重建 market.html
python3 -m py_compile tools/*.py           # 改过脚本
# 改了 HTML：浏览器打开一次，看控制台有没有报错
git status                                 # 确认没把别人的东西加进来
```
