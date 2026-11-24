# 墨山插件协议 · 设计方案 v2.1

> 目标一句话：**任何一套「几个开源软件 + 一点胶水 + 一个可视界面」的组合，都能被打成一个包，在墨山中台里点一下装上，并且自动画出它们怎么连。**
>
> v2.1 增加的不是功能，是**入口**：不只让人「装」别人的包，还能自己「搭」一个——在画布上填格子（填能力，不填软件名），解析器推荐软件、挑模块、推导连线，最后吐出上一条那种可直接安装的包。
>
> 本文档对应可执行产物：`schema/*.schema.json`、`catalog/`、`examples/*.json`、`tools/validate.py`、`tools/blueprint.py`、`canvas.html`（校验 **10/10 通过**）。

---

## 1. 先说选型：抄谁，为什么

「点一下装上」不是 UI 问题，是**分发结构**问题。四个标杆的真实做法：

| 标杆 | 索引放哪 | 包放哪 | 服务端 | 可借鉴 | 不可借鉴 |
| --- | --- | --- | --- | --- | --- |
| **Obsidian** | `obsidian-releases` 仓库里一个 `community-plugins.json` | 各插件自己的 **GitHub Release** | **零** | 全套。索引一条只 6 字段，客户端拉 manifest 拿版本号，再按同名 tag 下 Release 资产 | 它只支持 JS 三个文件，我们要支持任意进程与容器 |
| **VS Code / Open VSX** | 中心化市场 API | 市场 CDN 存 `.vsix` | 重（Open VSX 是 Java + Postgres，2077★） | 权限模型、评分/下载量、企业内私有市场 | 服务端。你一个人用，不值得先背这套 |
| **CasaOS** | 商店 = 一个 `store-config.json` URL（字段只有 `store_id/name/description/maintainer/url`） | docker-compose + `x-casaos` 段 | 零（静态托管） | 「商店本身只是一个 URL」，可挂多源；`port_map`/多语言文案/图标 | compose 只覆盖容器，覆盖不了「胶水脚本」和「本机进程」 |
| **Steam 创意工坊** | 平台 | 平台 | 重 | 订阅/更新/合集（collection） | 平台封闭，无法自建 |

**结论：走 Obsidian 的结构 + CasaOS 的多商店 + Umbrel 的权限声明，服务端完全不做。**

- 索引是一个静态 `moshan-plugins.json`，扔 GitHub Pages 就有市场（你已有 Pages 经验）。
- 包本体躺在各插件的 GitHub Release 里，中台只存地址与 sha256。
- 于是：**加一个插件 = 加一条 JSON + 发一个 Release**，不需要服务器、不需要数据库、不需要审核后台。

---

## 2. 六个对象（协议的全部）

```
   ┌─────────────┐        ┌──────────────────────────────┐
   │  Registry   │  索引  │  moshan-plugins.json          │
   │  (商店)      │───────▶│  id/name/version/repo/kind    │
   └─────────────┘        │  sha256 + permissions         │
                          └──────────────┬───────────────┘
                                         │ 点「安装」
                                         ▼
   ┌──────────────────────────────────────────────────────┐
   │  Package  = 一个目录 + moshan.json                    │
   │   kind: single | stack | adapter                      │
   │                                                       │
   │   stack 形态内部：                                     │
   │     ┌───────────┐   wire    ┌───────────┐             │
   │     │ Component │──────────▶│ Component │             │
   │     │ (上游软件) │           │ (胶水/上游)│             │
   │     └───────────┘           └───────────┘             │
   │        wire = 图上的边 + 文档的一句说明 + 一个 env 注入  │
   └──────────────────────────────────────────────────────┘
```

| 对象 | 文件 | 职责 | 谁写 |
| --- | --- | --- | --- |
| **Catalog** | `catalog/moshan-catalog.json` | 能力词表 + 开源软件的功能模块（谁能提供什么、需要谁给什么） | 你（可持续维护） |
| **Blueprint** | `<名>.json` | 一张流程图：格子 = 能力，连线 = 谁给谁 | 你（在画布上点出来） |
| **Registry** | `moshan-plugins.json` | 市场列表：有什么、多新、多重、什么权限 | 你（或第三方商店） |
| **Package** | `<包根>/moshan.json` | 一个可安装单元，含运行时与界面 | 插件作者 / **解析器生成** |
| **Component** | 写在 `moshan.json` 的 `components[]` | 一个上游软件或一段胶水 | 包作者 / 解析器生成 |
| **Wire** | 写在 `moshan.json` 的 `wires[]` | 组件之间怎么连 | 包作者 / 解析器推导 |
| **Card** | `/api/cards` 返回 | 中台左栏那一格显示什么 | 插件运行时 |

前两个对象是 v2.1 新增的「上游」，它们不参与安装，只负责**把包生成出来**：`Catalog + Blueprint →(解析)→ Package`。所以同一份协议既能「点一下装」，也能「从零搭」。

`Card` 形状单独固定（`schema/card.schema.json`），**中台只渲染这一种形状**。这是「以后加插件不用改 `dash.html`」的前提——你现在 `cards_api` 零命中，根因就是形状没定死。

---

## 3. 点一下装的完整链路（9 步，可回滚）

```
点击安装
 1 resolve    从 registry 取条目，确认 requires.moshan 兼容、依赖插件已装
 2 download   GET pack（GitHub Release 直链），记临时文件
 3 verify     sha256 必须相等，不等即中止（不做"警告后继续"）
 4 extract    解到 _插件/<id>.tmp/，不许出现 .. 或绝对路径（zip slip）
 5 validate   validate.py 校验 moshan.json；不过即删
 6 plan       端口分配（8790-8799 池）→ 冲突则拒绝；按 wires 算 env 注入表
 7 apply      原子换名 _插件/<id>；起进程或 docker compose up -d
 8 probe      GET health.path，超时 / 非 2xx 即回滚
 9 register   写 _工作台/plugins.json（旧格式，dash.html 不用改）+ 记 worklog
```

失败处理：任一步失败 → 停掉已起组件 → `_插件/<id>` 回退到 `.tmp` 之前的版本 → 在市场上标 `error` 并给出具体步骤。**不允许留下半装状态**（半装是自研插件系统最常见的坑）。

命令行的等价入口（P2 交付）：`moshan plug install <id>` / `moshan plug init <github-url>`。

---

## 4. 核心设计决定（每条都有理由）

**① 索引极简，包信息放包里。** 索引只写「够用来列表和校验」的字段（id/name/version/repo/kind/sha256/permissions），描述与依赖细节留在 `moshan.json`。抄 Obsidian：索引一旦变胖，每次发版都要改中心文件，冲突不断。

**② 版本不可变：Release tag 必须等于 `version`。** 这是 Obsidian 的硬约定，好处是任何历史版本都能被复现安装，回滚只要指定 tag。禁止 `latest`（校验器已强制镜像必须带 tag）。

**③ wires 是唯一真源，一份数据三用。** 作者写一遍 `wires`，同时得到：拓扑图（mermaid）、Markdown 说明表、安装时的环境变量注入。**这就是你说的「可视化的链接方式说明」——它不是手写文档，是 `wires` 的渲染产物**，所以永远不会和实际连接脱节。

```
"wires": [
  { "from": {"component": "qbit", "port": "webui"},
    "to":   {"component": "glue",  "env": "QBIT_URL"},
    "protocol": "http",
    "note": "胶水每 30 秒查一次种子列表，挑出已完成但未改名的条目" }
]
```
渲染结果（`python3 tools/validate.py --topology examples/media-stack.moshan.json` 实测）：
```
qbit  -->|胶水每 30 秒查一次种子列表…| glue
jelly -->|改名落盘后调 /Library/Refresh…| glue
qbit  -.->|隐式依赖：同一份下载目录| jelly
```
注入计划：`glue: QBIT_URL=http://127.0.0.1:8791`（取宿主 `expose` 端口，不是容器内端口——校验器已按此实现）。

**④ 组合栈不自己造编排器，编译成 compose。** 当 `components[].kind=container` 存在时，中台把 manifest 编译成标准 `compose.yaml`（注入 `x-moshan` 段保留回读信息），交给 `docker compose` 执行。`depends_on`/`healthcheck`/`networks` 全部复用 Compose 规范。**自己实现编排 = 重造一个不成熟的 Docker。**

**⑤ 端口分池，安装时分配。** 8790–8799 留给插件；`port` 留空即自动分配。你现在的 8776–8782 已满，8778 还撞过一次车——校验器已加入「expose 重复占用」与「镜像未固定 tag」检查。

**⑥ 权限声明 + 逐项确认。** 抄 Umbrel（`permissions: [STORAGE_DOWNLOADS, GPU]`）与 VS Code。写法固定前缀：`fs:<用途>` / `net:<域名|协议>` / `exec:<程序>` / `docker` / `cron`。校验器拒绝无法归类的权限字符串。本地插件的真实风险是「读到不该读的目录、连通不该连的网」，声明比沙箱便宜且有效。

**⑦ manifest 演进，`plugins.json` 冻结。** 插件自己的 `moshan.json` 可以随协议升级；中台读完后**派生**出 `_工作台/plugins.json`（现有 7 字段格式），`dash.html` 一行不改。这条是「新协议不破坏老页面」的唯一保证。

**⑧ 客户端私有字段一律进 `extensions`。** 抄 Agent Plugins 1.0.0：未知字段必须「报告 + 忽略 + 继续加载」，且 `cn.moshan.*` 之外的命名空间不得解释。将来别人把你的包拿去给别的客户端用，也不会因为你加的字段而装不上。

---

## 5. 三种形态，正好覆盖「你会在 GitHub 上看到的项目」

| 形态 | 用于 | 代码量 | 例子 |
| --- | --- | --- | --- |
| `single` | 自己一个进程，配一个页面 | 写插件本身 | `examples/llmcost.moshan.json`（8776 真实迁移） |
| `stack` | **几个开源软件 + 胶水 + 一个统一界面** | 只写胶水与 manifest | `examples/media-stack.moshan.json`（qBittorrent + 改名胶水 + Jellyfin） |
| `adapter` | 软件早已在别处跑（另一台机、CasaOS 容器），只想接进来看 | 一个 20 行探活代理 | `examples/siyuan-remote.moshan.json`（接盒子上 192.168.0.102 的思源） |

对应四类 GitHub 项目的适配路径（这是「看到一个项目就能变插件」的判定表）：

| 上游形态 | 判据 | 适配手段 | 工作量 |
| --- | --- | --- | --- |
| 有 Web UI 的自托管应用 | README 里有 docker run / compose 段 | `stack` 里写一个 `container` 组件，`provides` 声明端口，`ui.embed=iframe` | **只写 JSON，零代码** |
| 有 CLI | 有 `bin/` 或 `--help` | `components[].kind=binary` + 输出解析成 Card | 30 行左右 |
| 有 REST API | 有 `openapi.json` / Swagger 页 | 用 OpenAPI 自动生成 Card 与 actions（参考 `mcp-openapi-server`） | 半天，可模板化 |
| 纯库 / 无接口 | 只有 import | 只能在包内 `process` 里包一层，或放弃 | 视情况 |

`moshan plug init <github-url>` 的判定顺序就是上表：先看 compose/镜像 → 再看 CLI → 再看 openapi → 都不行则报「需手工适配」。判定完直接生成 `moshan.json` 骨架 + `tools/validate.py` 自检。

---

## 6. 搭建层：格子里填能力，不填软件名（v2.1 新增）

三个动作，一套协议：

| 动作 | 输入 | 谁在决定 | 输出 |
| --- | --- | --- | --- |
| **装** | 市场里的一条 JSON | 你点一下 | 装好的插件 |
| **搭** | 一张画布（格子 + 连线） | 你定结构，解析器填内容 | 可直接安装的 `moshan.json` |
| **拆** | 一个开源软件 | 你勾选功能模块 | 只取其中一部分能力 |

三者共用同一个 `moshan.json`。所以「装别人的」和「自己搭的」在中台里长得一模一样，一行前端代码不用分叉。

### 6.1 为什么必须填能力，不能填软件名

如果画布上直接写「这里放 Jellyfin」，推荐这件事就没有发生——选择在你点之前已经做完了，系统只剩一个空壳。填能力之后，四件事同时成立：

- **可打分**：格子要 `media.library + media.stream`，Jellyfin 覆盖 2/2，Navidrome 覆盖 0/2。覆盖率是算出来的，不是感觉出来的。
- **可解释**：不只给答案，给理由——「同覆盖，省 270MB 内存」（这是 `wechat-scholar` 赢过 `rsshub` 的真实理由）。
- **可校验**：能力必须来自受控词表。填了 `media.subtitle`（词表里没有）就直接报错，**不让模型猜一个最像的**。
- **可推导**：连线的两端都认识同一套能力，连线才能自动生成。这是下一节的关键。

反过来说，这也是给 AI 画的一条线：**AI 只负责词表之外的模糊需求**（"我想让下载完的东西自动出现在播放器里"），一旦落到词表上，匹配与校验就是确定性的脚本。推荐结果因此可以被复现、被 diff、被回滚。

### 6.2 能力词表是这套东西的宪法

现有 18 条，按域分组（媒体 / 知识 / 基础 / 采集 / AI / 自定义）。新增一条能力的判据只有三条：

1. **至少有两个软件能提供，或一个软件加一段自研胶水**——否则它是某个软件的私有功能，不该进公共词表；
2. **必须能被验收**——能说清「怎么算提供了它」，说不清就还是软件名换了个马甲；
3. **不许是软件名**（`jellyfin` 不是能力，`media.stream` 才是）。

词表越大，推荐越准；但也越容易退化成「软件清单的别名」。宁可少，不要脏。

### 6.3 拆模块：一个软件 = 若干能力 + 若干代价

Jellyfin 在目录里被拆成三块，就是这个样子：

```json
{ "id": "jellyfin", "kind": "container", "image": "jellyfin/jellyfin", "sample_tag": "10.10.3",
  "modules": [
    { "id": "stream",    "capability": "media.stream",    "port": {"name":"webui","port":8096} },
    { "id": "library",   "capability": "media.library" },
    { "id": "transcode", "capability": "media.transcode", "default": false,
      "requires": ["media.library"], "cost": {"ram_mb": 300, "gpu": true},
      "config": {"JELLYFIN_HWACCEL": "vaapi"} }
  ] }
```

三条规矩，缺一条就不是模块、只是配置项：

- **能独立开关**：只要你想要播放、不想要硬转码，就能只取 `stream`。转码默认关闭，因为要 `/dev/dri` 且有内存代价。
- **必须声明代价**：`ram_mb` / `gpu` / 端口。不然「省内存」这种推荐理由就是编的。
- **不许改上游行为**：模块只做三件事——配环境变量、挂卷、接线。要改代码就是 fork，那就不是同一个软件了，得单独立条目。

顺带解决一个真实痛点：**同一个软件在不同项目里只要一部分**。Immich 你只要它的相册，不要它自带的人脸模型；Meilisearch 你只要索引，不要它的 dashboard。模块化以后，这些取舍是勾选框，不是 fork。

### 6.4 连线为什么敢自动推导

因为每个模块都声明了两件反向的事：`capability`（我给谁）和 `accepts`（我读哪个环境变量来接别人）。

```
模块 A.capability = media.library        →  A 提供 media.library
模块 B.accepts    = {"media.library": "LIBRARY_URL"}  →  B 用 LIBRARY_URL 接它
⇒ wire: A:webui → B.LIBRARY_URL
```

匹配规则只有两条，加一条兜底：

1. **地址型**（provides ∩ accepts）→ 注入环境变量；
2. **文件型**（`shared`）→ 两个容器挂同一宿主目录，**不注入 URL**；
3. 都匹配不上 → **报错**，并指出「需要一格胶水，或改用共享卷」。

第 2 条是这次改协议的唯一实质变更（`spec 2.1` 的 `wires[].carrier`）。原因很直接：qBittorrent 和 Jellyfin 之间共享的是**文件**，不是 URL。旧模型强行注入一个 `LIBRARY_URL` 会生成一份看着通、实际不通的注入表——**这是自研编排最常见的撒谎方式**。现在校验器会直接拒绝「volume 连线带 env」的写法。

实测一条（`examples/generated-media-auto.moshan.json`）：

| 从 | 到 | 载体 | 目标 | 说明 |
| --- | --- | --- | --- | --- |
| qbittorrent | jellyfin | volume | 挂载 `/media` | 两个容器挂同一宿主目录 |
| qbittorrent | hub | env | `QBIT_URL` | 胶水每 30 秒查一次种子列表 |
| jellyfin | hub | env | `JELLYFIN_URL` | 改名落盘后调 `/Library/Refresh` |

### 6.5 实测输出

```bash
python3 tools/blueprint.py examples/blueprint-knowledge.json \
        --out examples/generated-daily-digest.moshan.json --topology
```

| 格子 | 需要能力 | 选中 | 模块 | 端口 | 内存 |
| --- | --- | --- | --- | --- | --- |
| 采集 | fetch | wechat-scholar | feed | 8791 | 30MB |
| 知识库 | store、edit | siyuan | store、edit | 8792 | 200MB |
| 检索 | fulltext | meilisearch | index | 8793 | 180MB |
| 算价 | usage | llmcost | usage | 8794 | 40MB |
| 摘要胶水 | digest | **手写胶水** | — | 8790 | — |

四格填能力，四家软件被推荐出来，四条连线自动推导，端口从池里顺序分配（`8790` 留给插件入口，普通格子不许抢——这是实测踩到的 bug，已修）。最后一格没人能填，于是如实标成 `custom`：解析器只生成 `hub/main.py` 骨架、探活与注入表，逻辑留给人写。

`examples/blueprint-gap.json` 是反向验证：故意写两个填不上的格子，结果是——`media.subtitle` 不在词表 → 硬报错不生成；`media.download + media.transcode` 无单一软件覆盖 → 报缺口并给三条处置建议。**解析器不凑数**，这是它能被信任的原因。

### 6.6 画布（`canvas.html`）

单文件、离线可用（能力目录与默认蓝图内嵌，不用起服务）。操作路径就是你说的那套：

1. 左侧点能力按钮 → 画布上多一个格子（填的是 `media.download`，不是 qBittorrent）；
2. 点格子 → 右侧给出候选软件，带覆盖率、内存、得分三条依据；
3. 点候选 → 这台软件被钉死；下面列出它的模块，**勾掉不想要的**（勾掉承载所需能力的模块，卡片立刻变「缺 N 条能力」，不偷偷补回来）；
4. 选「连到…」加连线，选 `env` 或 `共享卷`；
5. 导出蓝图 → 复制页面给的命令 → 跑 CLI 生成 `moshan.json` → 走第 3 节的 9 步安装。

画布里的打分公式与 `tools/blueprint.py` 同构，但**以 CLI 为准**（画布是预览，Python 是裁决）。同理，画布不直接生成 `moshan.json`——生成逻辑只有一份，避免两套实现慢慢走偏。

### 6.7 四个诚实的边界

1. **`sample_tag` 只是示例值**，不是「当前稳定版」。安装时必须用 registry API 查当期 tag 再写死（协议禁止 `latest` 漂移）。目录里写死版本号本来就是自欺。
2. **目录质量决定推荐质量**。拆 13 个软件、18 条能力是手工活，得有人读上游文档。想让推荐覆盖更多领域，投入在目录上，不在算法上。
3. **推荐是排序 + 理由，不是选型结论**。它会把「40MB 的胶水」排在「300MB 的全能框架」前面，这是对的；但你是否需要那个全能框架的功能，只有你知道。
4. **`custom` 格是常态，不是失败**。你最初那句判断——「很多插件就是把几个开源软件组合起来 + 自动化胶水」——反过来说也成立：胶水本身就是那部分没人开源的代码。协议能做的是把骨架、端口、注入表、探活生成好，让胶水只写业务那 30 行。

---

## 7. 市场长什么样（三级演进，不必一步到位）

**L1 · 现在就能做（零后端）**
`moshan-plugins.json` 放在 `pamphile.github.io/moshan-registry/`，中台「插件市场」弹窗读它 → 搜索（`name/summary/keywords`）→ 详情页（拉 `moshan.json` + README）→ 安装。约 200 行前端 + 安装器。

**L2 · 多商店（也零后端）**
抄 CasaOS：设置里可加任意 `store_url`。于是「我的商店」「团队的商店」「某个作者自建商店」并列，互不干扰。每个商店就是一个 JSON，可各自挂 Pages。

**L3 · 真开放投稿时才上服务端**
只有在「外部作者投稿、需要账号/评分/下载量统计」时才需要。现成选择是自部署 **Open VSX**（`eclipse-openvsx/openvsx`，2077★，Java + Postgres），或者用 FastAPI 自写 300 行。**在那之前不要做。**

---

## 8. 提交一个插件的门槛（决定生态能不能长起来）

想让人愿意写插件，门槛必须低到「三个文件 + 一个 PR」：

```
my-plugin/                 # 插件仓库根
├── moshan.json            # 清单（唯一必需）
├── icon.png               # 可选
├── README.md              # 可选，详情页展示
└── （你的代码）
```
1. 本地 `python3 tools/validate.py .` 通过；
2. 打 tag `1.0.0`，把整个目录压成 `my-plugin-1.0.0.moshanpack` 上传 Release；
3. 往商店仓库提 PR，加一条 6 字段 JSON（`sha256` 由发布脚本算）。

与 Obsidian 完全同构，任何写过 Obsidian 插件的人零学习成本。

---

## 9. 兼容与迁移（不动现有 5 个插件）

| 阶段 | 动作 | 风险 |
| --- | --- | --- |
| **M0** | 落 `schema/` + `tools/validate.py`；给现有 5 个插件补 `moshan.json`（保留原 `plugin.json`） | 零。中台不读，纯并存 |
| **M1** | 中台加「清单读取层」：优先 `moshan.json`，缺失回落 `plugin.json`；派生 `plugins.json` | 低。`dash.html` 不改 |
| **M2** | 加「插件市场」弹窗 + 安装器（9 步）+ Card 通用渲染区 | 中。安装器必须带完整回滚 |
| **M3** | `moshan plug init` 脚手架 + 三种形态模板 | 低 |
| **M4** | 静态 registry 上线；把 `llmcost` 作为第一个「一键装」样板 | 低 |

验收（M2 完成时应当成立）：
- 从市场点安装 `llmcost` → 40 秒内出现在左栏、卡片有数、`plugins.json` 多一行；
- 故意改坏 sha256 → 安装中止且无残留目录；
- 故意占用 8776 → 安装时提示「端口被 X 占用」，不静默改端口；
- 卸载 → 进程停、目录进 `_回收站`、`plugins.json` 该行消失。

---

## 10. 风险与边界（提前说清）

1. **供应链**：manifest 里的 `runtime.entry` / `image` 就是「在你机器上执行」。协议层面只能做到 sha256 + 固定 tag + 权限声明；真正的信任靠 `tier`（official/verified/community/experimental）与「只从你自己的商店装」。Agent Plugins 规范也明确不解决这一层。
2. **端口**：8790–8799 只有 10 个。stack 类插件同时占 3–4 个，跑满两个栈就挤。若长期要做，得改成「逻辑端口 + 反向代理子路径」，那是下一版的事。
3. **跨形态一致性**：`single` 与 `stack` 的日志、健康、卡片来源不同（进程 stdout vs `docker logs`），中台需要有统一的采集适配层，否则卡片状态会不准。
4. **不做的事**：不做镜像仓库、不做评分系统、不做付费、不做跨机调度（那是 nest/虫巢 的职责，插件协议只管单机安装与连接）。

---

## 11. 本次产出的文件

```
schema/moshan.schema.json       包清单（single/stack/adapter 三分支，spec 2.1 加 carrier）
schema/registry.schema.json     市场索引
schema/card.schema.json         卡片（固定形状，中台只渲染这一种）
schema/blueprint.schema.json    搭建蓝图：格子 + 连线 + 约束            ← v2.1
schema/catalog.schema.json      能力词表 + 软件模块目录                ← v2.1

catalog/moshan-catalog.json     18 条能力、13 个软件、按模块拆开        ← v2.1

examples/llmcost.moshan.json       单体型（8776 真实字段迁移）
examples/media-stack.moshan.json   组合栈型（手写 wires 的老样本）
examples/siyuan-remote.moshan.json 适配器型（接盒子上已在跑的服务）
examples/moshan-plugins.json       市场索引样例（含三种形态）
examples/blueprint-media.json        蓝图：影视自动入库              ← v2.1
examples/blueprint-knowledge.json    蓝图：每日信息摘要              ← v2.1
examples/blueprint-gap.json          蓝图：故意留缺口，验证不硬凑     ← v2.1
examples/generated-*.moshan.json  解析器产物（证明链路通，不作手改）  ← v2.1

tools/validate.py      校验 + 拓扑推导（manifest / registry / cards / blueprint / catalog）
tools/blueprint.py     蓝图解析：推荐 → 选模块 → 推导连线 → 生成清单    ← v2.1
tools/build_canvas.py  把目录与蓝图内嵌进画布，产出单文件 HTML          ← v2.1
canvas.html            可视化搭建画布（离线可用）
canvas.template.html   画布模板（改 UI 改这个，再重跑 build_canvas.py）
```

已实测：

```bash
python3 tools/validate.py examples/*.json catalog/moshan-catalog.json   # 10/10 通过
python3 tools/validate.py --topology examples/generated-media-auto.moshan.json
python3 tools/blueprint.py examples/blueprint-knowledge.json --out ... --topology
```

链路状态：**画布 → 蓝图 → 解析 → 清单 → 校验** 全部跑通，且清单里的端口、卷、env 注入表互不矛盾。

---

## 12. 下一步只需你定一件事

三条路，按「多快看到结果」排序：

- **A · 装**：做 M2 的市场弹窗 + 9 步安装器，拿 `llmcost` 当第一个样板。半天到一天，能真点一下装上。
- **B · 搭**：把 `canvas.html` 接进中台（当 iframe 面板），格子直接落成 `moshan.json`。画布已经可用，缺的只是中台里那个入口。
- **C · 拆**：扩能力目录（现在 13 个软件，覆盖媒体/知识两条线），让更多领域的格子推荐得出来。这是纯数据活，收益随条数线性增长。

我的建议：**A 先做**。因为「装」的链路是「搭」的下游——画布导出的清单，最终还是要靠同一个安装器落地。装不通，搭得再漂亮也验证不了。A 通了以后，B 只是把画布塞进面板的一天工。
