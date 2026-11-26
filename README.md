# 发布分支（pub）

这个分支**只有构建产物**，没有源码。

- `index.html` —— 单文件应用本体，是源码仓库 `main` 分支里 `python3 arch/app.py` 的产物拷贝
- `.nojekyll` —— 让 GitHub Pages 跳过 Jekyll，原样发出单文件

## 别在这里手改

改这里的东西下一次发布会全部覆盖。要改功能请去 `main` 分支的 `arch/app.template.html`。

## 怎么发新版本

在源码目录（`main` 分支）执行：

```bash
python3 arch/app.py                              # 重建单文件产物
cp arch/app.html ../moshan-pub/index.html        # 拷进发布工作树
cd ../moshan-pub && git add -A && git commit -m "release: $(date +%F)"
git push origin pub
```

GitHub Pages 与本仓库的在线站点都从这一个分支的根目录出。
