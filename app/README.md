# 墨山 · 装配台（桌面版）

Tauri 2 外壳 + 原生 ES module 前端。旧的单文件网页版在 `../arch/`，作为历史保留。

## 跑起来

```bash
# 桌面应用（开发模式：改前端后按 ⌘R 重载，改 Rust 会重新编译）
cd app/src-tauri && cargo run

# 打正式包（产出 .app 与 .dmg）
cd app/src-tauri && cargo tauri build

# 只想看界面（浏览器，无需 Rust；Electron 的 IPC 会自动降级到 localStorage）
cd app/ui && python3 -m http.server 8901
```

设计规范陈列页：<http://127.0.0.1:8901/design.html>

## 结构

```
app/
├── ui/                     ← 前端，没有任何构建步骤
│   ├── index.html
│   ├── design.html         ← 设计规范活样例（组件与状态一次看全）
│   ├── styles/
│   │   ├── tokens.css      ← 所有取值的唯一来源
│   │   ├── base.css        ← 重置、排版基线、「不像网页」的细节
│   │   ├── components.css  ← 按钮/输入/卡片/徽章/模态/Toast…
│   │   └── app.css         ← 外壳与页面布局
│   ├── js/
│   │   ├── main.js         ← 外壳、路由、命令面板、菜单、快捷键
│   │   ├── store.js        ← 单一状态源 + 落盘
│   │   ├── router.js       ← hash 路由
│   │   ├── components.js   ← 构造器（只拼 DOM，不含业务）
│   │   ├── icons.js        ← 24×24 线框图标
│   │   ├── lib/dom.js      ← h() 渲染助手
│   │   ├── lib/bridge.js   ← 与 Tauri 的唯一通道（浏览器自动降级）
│   │   ├── views/          ← 页面
│   │   └── data/           ← catalog.json / catalog.js（数据）
│   └── data/
├── src-tauri/              ← Rust 壳：窗口、原生菜单、本地状态
└── tools/gen-catalog.py    ← JSON → ES module 包装
```

**没有打包器。** 前端是浏览器原生 ES modules，Tauri 直接读 `ui/` 目录。
好处是改一行 CSS 刷新就见效、没有 500 行构建配置；代价是没法用 npm 生态的组件库——
这套界面本来也不需要。

## 数据从哪来

`ui/data/catalog.json` 是**从旧版运行时导出的**（18 场景 / 24 包 / 104 模块 / 160 能力格），
不是手抄的。改动数据结构要去 `../arch/` 那边改，再重新导出：

```bash
python3 tools/gen-catalog.py   # catalog.json → catalog.js（前端可直接 import）
```

## 迁移进度

| 页面 | 状态 |
|---|---|
| 应用外壳（顶栏/侧栏/菜单/命令面板/主题） | ✅ |
| 工作台首页 | ✅ |
| 场景选择（18 场景 / 6 类 / 键盘导航） | ✅ |
| 草稿箱 | ✅（列表与空状态，存取待在装配流程接上后联调） |
| 一句话需求 | ⏳ |
| 形态 / 包 / 方案 / 连线 / 确认 / 组装 / 交付 | ⏳ |

未迁移的页面会进 `views/wip.js`，**明确说「还没迁移」并给出退路**，不做假界面。

## 几个刻意的决定

- **不用虚拟 DOM。** 一屏几百个节点，`replaceChildren` 够快，也少一层要调试的东西。
- **壳只做网页做不到的事。** 菜单、状态落盘、数据目录在 Rust 侧；业务与界面全在前端，
  所以浏览器预览能跑完整界面，不必为了看一眼 UI 去编译 Rust。
- **状态先写临时文件再改名。** 写到一半被杀掉，不会留下半个 JSON 把草稿全废掉。
- **图标全是线框。** 63 个沿用旧版 ART，界面专用的补在 `icons.js` 的 `EXTRA` 里，
  避免两套风格混着用。

## 验证过什么

- `cargo build` 通过（Rust 1.98 / tauri 2.12），启动后原生菜单与红绿灯正常，界面无白屏。
- 浏览器端：零控制台错误；18 张场景卡、7 个分类 chip、筛选计数、键盘方向键、
  ⌘K 命令面板、深浅色切换均实测通过。
