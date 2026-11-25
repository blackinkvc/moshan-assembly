# x-hub 拆解 · 与墨山对照

> 对象：[github.com/dckxx/x-hub](https://github.com/dckxx/x-hub)（MIT，510 star / 78 fork，v0.9.13，2026-08-01 起）
> 方法：拉 master 源码包静态统计 + 读 AGENTS.md/DESIGN.md/关键模块源码，未运行应用。
> 对照对象：本仓 `arch/`（能力格装配台）与 `ARCHITECTURE.md`（插件体系 L0–L4）。

---

## 一、它到底是什么

一句话：**一个自己把活全干完的单机桌面工作台**——时钟、倒计时、便签、待办、速记、速达（应用启动器）、剪贴板历史、AI 对话 + Agent，全部本地存储，一个 exe 里 328 个宿主命令自己实现。

| 事实 | 数字 |
| --- | --- |
| 自研代码 | Rust 88 文件 / 52,812 行；Vue 86 文件 / 56,537 行；TS 78 文件 / 14,607 行；CSS 2,298 行 → **约 12.6 万行** |
| 宿主命令 | `#[tauri::command]` **328 个**，前端 `api/tauri.ts` 也是 328 处 `invoke`（严格一一对应） |
| 数据 | SQLite WAL，**23 张表**，迁移在 `db.rs` 幂等 ALTER |
| 多窗口 | **10 个 HTML 入口**（`index/chrome/ball/notice/export/pin/recorder/clipboard/search/chat`），每个壳文件约 300 字节 |
| 依赖 | 前端 20 个生产依赖；Rust **48 个** crate |
| 测试 | 30 个 `node:test` 文件（直接加载 `.ts` 源码，Node 24 原生类型剥离） |
| 发布 | **56 个版本**（0.1.0 → 0.9.13），4 个月，约每周 3–4 次 |
| 文档 | `AGENTS.md` 265KB / **85 条编号约定**；`DESIGN.md` 20KB 设计令牌；`RELEASE_NOTES.md` 86KB；`docs/user-guide.md` |

代码重心：`commands.rs` 256KB、`xhub_api.rs` 128KB（扩展桥）、`extension.rs` 88KB、`recorder.rs` 85KB、`clipboard.rs` 77KB、`lib.rs` 72KB、`db.rs` 69KB、`note_io.rs` 63KB、`floating_ball.rs` 63KB。前端重心：`NoteEditor.vue` 164KB、`Suda.vue` 84KB、`ExtensionCenter.vue` 81KB、`ChatPanel.vue` 79KB。

---

## 二、六层拆解

| 层 | 做法 | 关键取舍 |
| --- | --- | --- |
| ① 窗口层 | 10 个 HTML 入口 + 一份 Vue 应用；`App.vue` 只按 `window.label` 路由（`main`/`sticky-{id}`/`countdown-{id}`/`clipboard`/`ext-{id}`…），零业务逻辑 | 浮窗不用路由，用真窗口。轻量壳（悬浮球/通知/贴图）单独 chunk，不加载 1.25MB 的 Milkdown |
| ② 视图层 | 86 个组件，**无 Vue Router、无 Pinia**，`reactive()` + `readonly()` 自建 store | 体量小时省事；86 个组件后状态边界全靠人守 |
| ③ 契约层 | `api/tauri.ts` 328 个类型安全封装，与 Rust 命令 1:1 | 手写维护，靠 CI 的 `vue-tsc` 兜底 |
| ④ 命令层 | `commands.rs` 一个文件 256KB | **最重的技术债**：没有按域拆分，冲突与编译都吃亏 |
| ⑤ 领域层 | `repo/`（数据访问）、`agent/`（4,611 行）、`extension/`、`sync/`、`recorder/`、`clipboard/` | 按功能切目录，边界清楚 |
| ⑥ 平台层 | `tray` `shortcut` `autostart` `notify`（自绘右下角通知窗）`float_window` `app_icon`（`IShellItemImageFactory` 原生取 256px 图标）`webview_mem` | Windows 优先；22 个文件有 `cfg(target_os="windows")` 专用路径，18 个有非 Windows 降级分支 |

构建侧有两个值得记的手法（`vite.config.ts`）：把 Univer 的 77 份连字词典（约 4.4MB）和 KaTeX 的 woff/ttf（约 0.78MB）在打包阶段剔除——Tauri 会把整个 `dist` 嵌进 exe，省下的是安装包体积。

---

## 三、四个真正值得抄的设计

### 1. 扩展系统 = 一张能力注册表（不是一堆 case）

`xhub_api.rs` 不再手写 `match` 分发，而是集中一张 `CAPABILITIES` 静态表，每项 `namespace` / `method` / `permission` / `handler`。**新增能力 = 表里加一行 + 写 handler**，`runtime.info` 把清单返回给扩展自检。

manifest 声明五类关系，扫描器求值后直接标状态并**拦截打开**：

| 字段 | 含义 | 缺失后果 |
| --- | --- | --- |
| `permissions` | 要用户授权的能力 | 按项授权 |
| `requires` | 依赖宿主能力（`namespace.method`） | 标 `missing_capabilities` |
| `dependsOn` | 依赖其它扩展 id | 标 `missing_dependencies` |
| `disabled` | 条件禁用（如 `{platform}`） | 标「已禁用」 |
| `expose` | 跨扩展调用白名单 | 不能互调 |

四种形态 `module` / `view` / `window` / `drawer`，两个运行时 `web` / `service`（Node 托管按需下载）。市场走 Ed25519 验签 + 安装计数。桥接方法共 50+ 个，按 `notes.*` / `todos.*` / `resources.*` / `snippets.*` / `tags.*` / `stickies.*` 命名空间分。

### 2. AI 工具注册表 + 权限三档（这是全仓最成熟的 Agent 底座）

- **34 个内置工具**：读 15 / 写 14 / 危险 5（`agent/builtin.rs` 文件头写得很清楚）。
- **三档权限**：`readonly` / `ask` / `full`；`ask` 档在对话流里给内联卡片三选一（本次 / 本会话这类操作不再问 / 拒绝），拒绝时**把「被拒」当工具结果回给模型**，让它换路而不是崩掉。
- **两套权限绝不混用**：`approval.rs` 开头明说「这是用户对 AI 的授权，与扩展 manifest 权限是两套独立体系，不可共用存储」。
- **上下文控制点在 `turn.rs`**：列表类最多 20 条（超出提示「还有 N 条」）、正文回填模型最多 2000 字（硬截断），UI 拿全文、模型拿截断版。
- **防溢出当安全边界**：参数里的时间戳限定 2000–2100 年，倒计时分钟上限 10 年，「LLM 输出是不可信输入，`i64::MAX` 会让 `end-now` 溢出 panic」——这句注释比代码值钱。

### 3. 多窗口的纪律：主线程绝不 build WebView

`AGENTS.md` 约定 41 记了一次事故：主线程同步 `WebviewWindowBuilder::build()` 与悬浮球菜单收拢交错，controller 创建挂起 → 整窗未响应，踩了两次。结论从「一切启动预创建」演进到「**主线程绝不 build** + 低频窗按需创建 + 隐藏常驻复用」，理由量化过：每个隐藏 renderer 实测 20–100MB。

### 4. 约定即事故档案

`AGENTS.md` 265KB、85 条编号约定，每条都是「历史 bug + 根因 + 修法 + 为什么不能改回去」。两条例子：

- 约定 8：窗口状态落盘单位必须转逻辑像素——`inner_size()` 返回物理像素，恢复侧按 `LogicalSize` 解释，125% 缩放下每关开一轮 ×1.25 膨胀、位置右下漂移（100% 缩放时两者相等，开发机从未暴露）。
- 约定 31：新增浮窗必须同步 4 处 label 配置，且启动页白名单判定——写成黑名单漏加一个就复现「欢迎回来」启动页。

测试也是这个风格：`shortcutKeys.test.mjs` 开头写的不是「测试快捷键解析」，而是「中文输入法开着按 Ctrl+空格，Chromium 上报 `key="Process"` / `keyCode=229`，旧实现把它录成 `Ctrl+Process`，用户只看到一句英文报错」。

---

## 四、它的短板（要看清才谈得上对照）

| 短板 | 证据 |
| --- | --- |
| 单体命令文件 | `commands.rs` 256KB 一个文件；`xhub_api.rs` 128KB |
| 不能复用 | 每个能力都绑死自己的 UI 组件、数据表和 store，离开这个宿主立刻失效 |
| 平台绑死 Windows | 图标提取走 IShellLink/COM、提权走 UAC、自启动写 Run 键；macOS 只保留降级分支 |
| 没有类型化接口 | 扩展桥靠 JSON + 命名约定，宿主与扩展都是自家写的，所以不需要「能不能接上」的校验 |
| 测试偏科 | 30 个测试基本在 `utils/`，Rust 侧几乎没有单测，靠「出一次事故补一条约定」兜底 |
| 无按需装配 | 全量编译发货；唯一「用多少加载多少」是前端 chunk 拆分，粒度不是制品 |

---

## 五、与墨山对照

先分清墨山的两半，它们和 x-hub 的对应关系不一样：

- **A. 能力格装配台**（`arch/`）：105 格（16 域 / 81 模块 / 8 子模块）、316 个候选方案、14 类型接口基板、断点/出口/顺序三检查、`app.html` 七屏原型。
- **B. 插件体系**（`ARCHITECTURE.md` + `catalog/` + `registry/`）：54 能力词表 / 22 标签 / 8 品类 / 63 条目 / 99 模块；`moshan.json` 清单 + `wires` 连线 + `plan` 算下载集 + 零后端 registry。

| 维度 | x-hub | 墨山 A（能力格） | 墨山 B（插件体系） |
| --- | --- | --- | --- |
| 定位 | 一个产品，自己实现 | 决定「要做哪些格」 | 决定「装哪些软件、怎么接」 |
| 接口形态 | 字符串约定（`namespace.method`） | **14 种类型**（T/D/C/V/R/F/E/S/X/Q + M/P/W/B） | 54 条受控能力词（`media.stream`） |
| 能否校验连通 | 不校验（都是自己写的） | **断点 / 出口 / 顺序**三项可算 | 连线 `carrier` 区分 env / volume，拒绝给文件型注 URL |
| 复用粒度 | 全量一个 exe | 一格一个职能，实现可换（316 方案） | 一模块一个制品，`plan` 算下载集 |
| 扩展机制 | manifest + 四形态 + 56 个桥方法 + 市场验签 | 无（还没做到这层） | registry 零后端、可并列多商店 |
| AI 的角色 | 宿主内 Agent：34 工具、三档权限、34 工具留痕 | 需求→格子的反推器 | 画布推荐（不知道要什么时） |
| 交付物 | 安装包 | 目录骨架 + `wire.ts` + 施工顺序 | `compose.yaml` / `run.sh` / `install.sh` |
| 规模 | 12.6 万行代码 | 105 格 / 316 方案（数据） | 63 条目 / 99 模块（数据） |

**一句话差异：x-hub 是「我把活干完」，墨山是「决定让谁把活干完、以及它们能不能接上」。**

由此得出一条结构性结论：**单体内做集成，接口可以只靠约定；跨项目做集成，接口必须是可校验的类型。** 这就是为什么 x-hub 用 `"notes.create"` 这样的字符串就够，而墨山必须有 `wires.py` 那 14 个类型和断点检查——两者不是水平差距，是问题不同。

---

## 六、可以直接搬进方案库的 6 个真实样本

墨山的「方案」现在多是名字 + 一句简介 + 未核的许可。x-hub 的这 6 块是**已验证可用的实现**，可以直接挂成对应格的候选，并带上真实代价：

| 墨山格 | 从 x-hub 抄什么 | 真实代价 |
| --- | --- | --- |
| `ai.agent.tool` | 能力注册表 + 三档权限 + 拒绝回传 + 截断口径 | 4,611 行 Rust（`agent/`） |
| `app.plugin` | manifest 五类关系 + 四形态 + 桥 API 表 | `xhub_api.rs` 128KB + `extension.rs` 88KB |
| `app.plugin`（市场那半） | Ed25519 验签 + 安装计数 + 一键更新 | `market.rs` 45KB |
| `app.update` | 跳级保护 `minimumUpgradable` + 流式下载 + sha256 + 自替换回滚 | `updater.rs` 49KB |
| `app.window` | 10 入口壳 + label 路由 + 轻窗分 chunk | `App.vue` 9KB + `vite.config.ts` 6KB |
| `app.sync` | scrypt 派生 + chacha20poly1305 + 跨端测试向量 | `sync/` + 小程序侧对等实现 |

> 注：`app.plugin` / `app.update` / `app.sync` 这三格在写这份对照时库里还没有（原有 app 域只有 data / auth / ui / file / edge），
> 已于随后的「第 7 批」补齐（连同 `app.window` / `app.todo` / `app.clip` / `app.launch`，共 7 格 93 个方案）。

补充一个更软的用法：**x-hub 的 85 条约定就是 85 条「顺序/选型错了会返工什么」的真实数据**。墨山 `seed06.py` 里硬件格已经有「选错要返工什么」这个字段，软件格基本空着——这 85 条正好是填充材料。

---

## 七、三条给墨山的结论

1. **格的成本被严重低估。** 墨山 316 个方案里，一个中等的格（如 `ai.agent.tools`）做到产品级是 4,611 行 Rust；`NoteEditor` 一个编辑器是 164KB Vue。装配台现在只标「自研代价：中/高」，缺数量级。建议在方案里加一列「参考实现体量」，x-hub 这 6 块先做锚点。
2. **装配台的施工顺序可以被真实验证。** x-hub 的 85 条约定全部是「顺序或边界判断错了」的代价记录，正好用来检验墨山算出的施工顺序是不是把高风险项排前面（现在硬件域做到了「先定主控」，软件域还比较粗）。
3. **别学它的单体。** `commands.rs` 256KB 就是「没有格边界」的下场：所有职能长在一个文件里，改一处要读全篇。这恰好反证了墨山「一个域一个包、格与格之间只走 `wire.ts`」的边界设计是对的——只是还缺一个真落地的样板。

---

*统计口径：均取自 master 分支源码包静态计数（2026-11-25），未运行应用；行数含注释与空行。*
