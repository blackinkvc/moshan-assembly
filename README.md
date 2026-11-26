# 发布分支（pub）

这个分支**只有构建产物**，没有源码。它检出在源码仓库的 `publish/` 目录里
（一个 `git worktree`，主干上看不到它，也被 `.gitignore` 挡着）。

- `index.html` —— 单文件应用本体，是 `main` 分支里 `python3 arch/app.py` 的产物拷贝
- `.nojekyll` —— 让 GitHub Pages 跳过 Jekyll，原样发出单文件

## 别在这里手改

改这里的东西下一次发布会全部覆盖。要改功能请去 `main` 分支的 `arch/app.template.html`。

## 怎么发新版本

在源码目录（`main` 分支）执行：

```bash
python3 arch/app.py                 # 重建单文件产物
cp arch/app.html publish/index.html # 拷进发布工作树
git -C publish add -A
git -C publish commit -m "release: $(date +%F)"
git -C publish push origin pub
```

GitHub Pages 与本仓库的线上站点都从这一个分支的根目录出。

## 新机器上怎么恢复

`clone` 不会带上 worktree，需要手动挂一次（目录必须叫 `publish`，线上托管按路径认应用）：

```bash
git worktree add publish pub
```
