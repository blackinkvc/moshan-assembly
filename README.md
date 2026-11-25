# 墨山 · 装配台

一句话需求 → 一套能装起来的中台。不是一个「配置生成器」，而是一份**能看懂、能验收的装配方案**。

在线试用：**https://blackinkvc.github.io/moshan-assembly/**

## 它解决什么

想给自己搭一套东西（个人中台、店里的小系统、SaaS、带硬件的小设备），真正的难处不是写代码，
而是**不知道要哪几个模块、它们之间接不接得上、装的时候顺序对不对**。

这里把这件事拆成八步，每一步只让你做一个决定：

`场景 → 形态 → 包 → 方案 → 连线 → 确认 → 组装 → 交付`

- **连线**是最关键的一步：把所有模块摊成 130 格能力图，谁吃什么、谁吐什么一目了然；
  进页面就自动跑一遍连通性自检，**断点**（要的东西没人产出）标红、**死端**（做出来没人用）标黄。
- **组装**把方案演给你看：一块块模块插上主板，跑完自检才算装好。
- **交付**给出安装说明、最小可用包、内存占用模拟 —— 不是「去装吧」，是「装这个版本的这台机器，占了这么多」。

## 本地打开

构建产物是**一个 HTML 文件**，离线可用，不需要服务器：

```bash
python3 arch/app.py            # arch/app.template.html + 数据 → arch/app.html
open arch/app.html
```

## 仓库结构

| 路径 | 是什么 |
|---|---|
| `arch/` | 装配台本体：模板 + 生成脚本 + 130 格能力库 + 12 场景定义。做法笔记见 [`arch/README.md`](arch/README.md) |
| `docs/` | GitHub Pages 发布目录（`docs/index.html` = 构建产物的一份拷贝） |
| `ARCHITECTURE.md` | 整体设计：数据模型、判定规则、为什么这么切 |
| `MOSHAN-PLUGIN-SPEC.md` | 模块与插件的规格约定 |
| `XHUB-VS-MOSHAN.md` / `arch/MATCH.md` | 与既有产品/方案的对照与取舍 |
| `canvas.*` / `market.*` | 能力地图与模块市场两个独立的单页工具 |
| `schema/` `registry/` `catalog/` | 数据结构、登记表、条目数据 |

## 发布

```bash
python3 arch/app.py
cp arch/app.html docs/index.html     # GitHub Pages（main 分支 /docs）
cp arch/app.html publish/index.html  # 另一份线上托管
```

## 已知的不足

- 130 格里只有一部分挂到了真实模块，其余是能力描述，不能直接当依赖用。
- 模块组合来自公开功能清单，可能漏掉产品内部的实现方式（比如自研了向量库）。
- 「组装」「试用」是模拟演示，**不会真的给你装东西**——它保证的是方案站得住，不是替你施工。

细节与踩过的坑都在 [`arch/README.md`](arch/README.md)。
