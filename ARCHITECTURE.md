# 墨山插件体系 · 总体方案与架构

> 一句话：**把「几个开源软件 + 一点胶水 + 一个统一入口」变成一个可在市场里点一下装上的包，并且只下载你真正要用的那部分。**
>
> 本文是总纲。协议细节见 `MOSHAN-PLUGIN-SPEC.md`，可执行产物在同目录 `schema/`、`catalog/`、`examples/`、`tools/`、`market.html`、`canvas.html`。

---

## 0. 一页总览

```
            ┌──────────── 三条入口，同一套数据 ────────────┐
            │                                              │
  ① 市场（知道要什么）      ② 画布（不知道要什么）      ③ 收编（已有 GitHub 项目）
     market.html              canvas.html                  moshan init
     搜 → 勾模块 → 生成命令     填能力 → AI 推荐 → 勾模块      读 README/compose/openapi → 判定形态
            │                        │                            │
            └───────────┬────────────┴────────────────────────────┘
                        ▼
              ┌─────────────────────┐
              │  L0 能力词表 + 目录   │  39 条能力 / 22 个标签 / 51 个条目 / 70 个模块（含 35 个只登记）
              └─────────┬───────────┘
                        ▼
              ┌─────────────────────┐
              │  L1 包清单 moshan.json│  single / stack / adapter；components + wires
              └─────────┬───────────┘
                        ▼
              ┌─────────────────────┐
              │  L2 仓库 registry.json│  静态 JSON，零后端，可并列多个商店
              └─────────┬───────────┘
                        ▼
              ┌─────────────────────┐
              │  L3 安装 plan → 落地  │  算下载集 → compose.yaml + run.sh → 起
              └─────────┬───────────┘
                        ▼
              ┌─────────────────────┐
              │  L4 运行 卡片/健康/日志│  中台只认一种 Card 形状
              └─────────────────────┘
```

四层各管一件事，**不许互相越界**：目录不执行、清单不下载、仓库不安装、安装不渲染。

---

## 1. 需求与边界

### 要做的

| # | 需求 | 落地物 |
| --- | --- | --- |
| 1 | 插件市场：找到、点一下、装上 | `market.html` + `registry.json` + `moshan install` |
| 2 | 把多个开源软件 + 胶水打成一个包 | `kind: stack` + `components[]` + `wires[]` |
| 3 | 连线可视化说明 | `wires` 渲染成 mermaid 拓扑 + 说明表（唯一真源） |
| 4 | 不知道用什么时能推荐 | `canvas.html` + 能力词表 + 解析器 |
| 5 | **知道要什么时不用推荐**（本次补） | 市场直选 / `--use "comp:mod,mod"` |
| 6 | **开源软件预先拆好模块，用多少下多少**（本次补） | `artifact` 声明 + `plan` 计算下载集 |
| 7 | 已有开源项目能低成本收编 | 四类适配器 + 目录 entry 粒度规则 |

### 明确不做

- **不做容器编排器**。有容器就编译成标准 `compose.yaml` 交给 docker compose，不自研调度。
- **不做运行时沙箱**。manifest 里的 `entry/args` 本质是「在你机器上执行」，靠来源与校验和管，不靠沙箱假装安全。
- **不做在线后端**。仓库是一个 URL，索引是一个静态 JSON，包在 GitHub Release 或本机目录。
- **不改中台前端**。`dash.html` 一行不动，用派生层对接（见 §8）。

---

## 2. 分层架构

### L0 · 能力词表与目录（知识的唯一来源）

`catalog/moshan-catalog.json` 做两件事：

1. **受控词表**：39 条能力（`media.download`、`note.store`、`search.fulltext`、`ai.usage`、`dev.runtime`、`dev.build`、`ai.protocol`、`ai.model`、`ai.inference`、`os.distro`…）。格子只能填词表里的词，填错直接报错，**不让模型猜一个最像的**。
2. **拆解知识**：16 个可装软件，每个拆成若干模块（51 个条目合计 70 个模块），每个模块声明三件事：
   - 提供什么能力（`capability`）
   - 接受什么（`accepts`，能力 → 环境变量名，连线据此自动推导）
   - **要下载什么（`artifact`，见 §3）**
3. **只登记条目**（`kind: existing`，共 35 个）：技术基座与协议 11 个（Electron / Tauri / Chromium / Rust / Node.js、MCP / A2A / ACP / AG-UI / A2UI / AP2）、
   桌面与系统工具 14 个（Git / WhatCable / RustDesk / 按键显示Pro / Ubuntu / LibreOffice / ezNTFS / LocalSend / Tailscale / Dropover / RunCat / Cherry Studio / OpenWorker / Organic Maps）、
   开放权重模型 10 个（DeepSeek V4.1 Flash、Kimi K3.1 Pro、GLM-5.3 Flash、Qwen3.8 27B、Gemma 4、MiniMax M3.1 Flash、MiMo-V2.6-Pro、Kimi K2.7 Code、ERNIE 5.5 Flash Base、混元 Hy4）。
   都是 `artifact.kind = none`，**不进下载集、不可装**，作用是「先知道有这个东西、它占哪一段」。闭源条目不拆模块细节，只在 `notes` 里说清为什么值得看。
4. **标签词表**：22 个标签，分两组——**领域**（`ui` 界面、`frontend` 前端、`backend` 后端、`dev` 开发、`network` 网络、`download` 下载、`media` 媒体、`data` 数据、`search` 检索、`ai`、`model` 模型、`security` 安全、`ops` 运维、`geo` 地理、`office` 办公）与**技术栈**（`desktop` 桌面、`web`、`cli` 命令行、`protocol` 协议、`native` 原生、`selfhost` 可自建、`skill` 技能）。

### 能力与标签是两套维度，不要合并

| | 能力 `capabilities` | 标签 `tags` |
| --- | --- | --- |
| 回答 | 「能供给什么」 | 「属于哪一类」 |
| 谁用 | 转换器（蓝图格子、连线推导） | 人（筛选、浏览、找同类） |
| 粒度 | 一条能力可被机器精确匹配 | 一个条目可打多个，交叉描述 |
| 校验 | 模块 `capability` 必须在词表 | 条目 `tags` 必须在词表，且**至少一个** |

**为什么必须分开**：能力要能唯一确定一条连线（`media.download` 只能有一个来源），一旦允许「一个模块随便挂五个能力」，连线推导就失去唯一解。标签则相反，天生该是多个——Electron 同时是「桌面 / 界面 / 前端 / 原生」，这四句都对，但一句都不能拿来连管线。

标签是**跨页签共用**的：插件（`registry.json` 的 `tags`）与软件条目用同一套词表，所以市场页一个筛选器能同时管两个页签。插件标签的来源有优先级：
1. 清单里自己写 `tags`（作者说了算，词表外的词构建时告警）；
2. 没写 → 由它装的各组件的目录条目标签**并集**推导，按词表序取前 5 个；
3. 没有组件（`single` / `adapter`）→ 按插件 id 认领同名目录条目。


### L1 · 包清单（一个可安装单元）

`moshan.json` 三种形态共用一套结构：

```jsonc
{
  "spec": "2.1", "id": "media-auto", "version": "0.1.0", "kind": "stack",
  "port": 8790,                      // 插件自己的统一入口
  "components": [                    // 上游软件或胶水
    { "id": "qbittorrent", "kind": "container", "image": "...", "expose": 8791 },
    { "id": "jellyfin",    "kind": "container", "image": "...", "expose": 8792 },
    { "id": "hub",         "kind": "process",  "runtime": { "entry": "hub/main.py" } }
  ],
  "wires": [                         // 唯一真源：拓扑/说明/注入都由它渲染
    { "from": {"component":"qbittorrent"}, "to": {"component":"jellyfin","path":"/media"},
      "carrier": "volume", "note": "共享下载目录" },
    { "from": {"component":"qbittorrent","port":"webui"}, "to": {"component":"hub","env":"QBIT_URL"} }
  ]
}
```

`carrier` 必须区分 `env`（地址型）与 `volume`（文件型）。**给文件型连线注入 URL 是自研编排最常见的撒谎方式**，校验器直接拒绝这种写法。

### L2 · 仓库（零后端）

`registry/registry.json` 是一个数组 + 元信息。客户端只需这一个文件就能列出全部插件；包本体按 `manifest`/`repo` 去取，装前校验 `sha256`。

商店本身只是一个 URL（借 CasaOS `store-config.json` 的思路），因此可以并列：自用商店、团队商店、某作者自建商店，互不干扰。

### L3 · 安装（算，不猜）

`moshan plan` 算出四件事，`moshan install` 落地成三种文件：

| 输出 | 内容 | 谁执行 |
| --- | --- | --- |
| `compose.yaml` | 只含**被勾选**的容器服务 | docker compose |
| `run.sh` | 宿主机进程（带端口与注入的 env） | 直接跑 |
| `install.sh` | 先 `docker pull` 精确 tag，再 `up -d` | 你确认后跑 |

### L4 · 运行（中台对接）

插件暴露 `/api/ping` 与 `/api/cards`，中台只渲染**一种** Card 形状（`schema/card.schema.json`）。形状固定后，卡片区只写一次，新插件零改动。这是现有 `cards_api` 无人消费的根因，也是必须补的一层。

---

## 3. 核心机制：拆解与下载分离

这是本次新增的关键，直接对应「**软件里面本来就要已经完成模块拆解，但是没有下载，需要的话再下载就是了**」。

### 3.1 拆解分两级，粒度由「制品」决定

| 级别 | 什么时候用 | 例子 |
| --- | --- | --- |
| **entry 级**（跨制品） | 功能由**另一个镜像/进程**交付 | Immich 的人脸模型是独立服务 → 拆成 `immich` + `immich-ml` 两个 entry，用能力连线组合 |
| **module 级**（制品内） | 同一镜像内的开关、变体、可选依赖 | Jellyfin 的 `transcode` 只是换镜像变体 + 透传 `/dev/dri` |

**治理铁律：一个 entry = 一个制品。** 一旦发现某模块需要另一个镜像，就不该硬塞进模块，而应拆成新 entry。这条规则让"拆解"永远不需要改安装器。

### 3.2 模块的制品声明（五种）

```jsonc
"modules": [
  { "id": "stream", "capability": "media.stream",
    "artifact": { "kind": "image", "ref": "jellyfin/jellyfin:10.10.3",
                  "variants": { "vaapi": "jellyfin/jellyfin:10.10.3-vaapi" },
                  "size_mb": 260 } },
  { "id": "transcode", "capability": "media.transcode", "default": false,
    "artifact": { "kind": "none", "variant": "vaapi", "size_mb": 490 } },
  { "id": "feed", "capability": "news.fetch",
    "artifact": { "kind": "asset", "repo": "osnsyc/Wechat-Scholar",
                  "match": "*.zip", "size_mb": 4.2 } }
]
```

| kind | 含义 | 拉取方式 |
| --- | --- | --- |
| `image` | 容器镜像（可带 `variants`） | `docker pull <ref>` |
| `asset` | Release 资产 / 数据仓库 zip | `curl -fL <ref>` |
| `package` | 语言包（`pip extra` 等） | `pip install name[extra]` |
| `build` | 需本地构建 | `docker build --target` |
| `none` | 同一制品内的开关 | 不下载，只改配置/变体 |

`none + variant` 是"换镜像但不叠加"的表达：启用硬件转码时，镜像从 `10.10.3` 换成 `10.10.3-vaapi`，体积按替换算（490MB），**不是 260+490**。这个细节错了，安装计划就会虚报一倍体积。

### 3.3 下载集算法（`moshan plan` 的实现）

```
对每个组件：
  1. 定模块     显式 --use  >  清单里的蓝图记录  >  目录默认(default!=false)
  2. 闭包       requires 里要求的能力，若本组件有模块供给则一并打开
  3. 制品       image→按 ref 入集；变体→替换基础镜像；asset/package/build 各入一条
  4. 去重       同一 (kind, ref) 只算一次
汇总：合计体积 + 未勾模块"省下多少" + 端口 + 注入 + 缺口
```

实测（媒体栈，勾掉转码）：

```
$ python3 tools/moshan.py plan examples/generated-media-auto.moshan.json
| qbittorrent | image | linuxserver/qbittorrent:4.6.7  | 190 MB |
| jellyfin    | image | jellyfin/jellyfin:10.10.3      | 260 MB |
合计 450 MB

$ ... --use "jellyfin:stream,transcode;qbittorrent:torrent"
| qbittorrent | image | linuxserver/qbittorrent:4.6.7        | 190 MB |
| jellyfin    | image | jellyfin/jellyfin:10.10.3-vaapi      | 490 MB |
合计 680 MB
```

同一份清单，勾不勾转码，下载集与生成的 compose 都不同——**这就是"需要的话再下载"的实现**，不是文案。

### 3.4 显式即准（不与你抢方向盘）

用户勾掉某个模块，**解析器不许偷偷补回**，哪怕它承载了格子所需的能力。此时：

- 画布上该格立刻变「缺 N 条能力」（红字），不自动纠错；
- `plan` 照你说的算，只在「缺口」区提示；
- 想要推荐就走另一条入口。

这条规则是"知道要什么就不用 AI 推荐"能成立的前提：**推荐和指定是两条路，不互相污染**。

---

## 4. 三种包形态

| kind | 是什么 | 谁写代码 | 例子 |
| --- | --- | --- | --- |
| `single` | 自己的一个进程 + 页面 | 插件本身 | `llmcost`（8776 在跑） |
| `stack` | 几个开源软件 + 胶水 + 统一入口 | 只写胶水 | `media-auto`（qBittorrent + hub + Jellyfin） |
| `adapter` | 服务早在别处跑（盒子/另一台机），只接进来 | 约 20 行探活代理 | `siyuan-remote`（接 192.168.0.102） |

`adapter` 不能省。家里的 CasaOS 盒子、群晖、公司内网服务都属这一类；没有它，用户只能被迫重装一份。

---

## 5. 仓库层

### 5.1 索引长什么样

```jsonc
{ "spec": "2.0", "store_id": "local", "name": "本机仓库", "updated_at": "...",
  "plugins": [
    { "id": "media-auto", "name": "影视自动入库", "version": "0.1.0", "kind": "stack",
      "summary": "下载完成自动改名，Jellyfin 立刻能播，中台一页看全",
      "keywords": ["automation","media"], "aliases": ["下载","媒体库","改名胶水"],
      "manifest": "examples/generated-media-auto.moshan.json",
      "sha256": "…", "size": 8123,
      "permissions": ["docker"], "requires": {"docker": true}, "tier": "community" }
  ] }
```

- **必填只有 id/name/version/kind**，外加 `repo` 或 `manifest` 之一（否则无从安装）。
- `sha256` 必校验：索引被篡改就等于任意代码执行。
- `aliases` 解决中文可搜性：`keywords` 是英文的 `media`，用户搜的是「媒体」。别名自动从蓝图格子的中文标签派生。

### 5.2 上架门槛（决定生态能不能长）

| tier | 要求 | 谁批 |
| --- | --- | --- |
| `official` | 本机维护，锁 tag，有校验和，`validate.py` 全绿 | 你 |
| `verified` | 第三方，`repo` 公开 + Release 有包 + 权限声明齐全 | 你抽查 |
| `community` | 只有 `manifest`，能装上就算 | 自动 |
| `experimental` | 有已知缺口（如无健康检查、tag 用 latest） | 自动，市场标黄 |

### 5.3 实测

```
$ python3 tools/moshan.py registry "examples/*.moshan.json"
✓ 已生成 registry/registry.json（4 个插件）
   daily-digest  0.1.0  stack    公众号与 RSS 自动进笔记库，可检索，顺带记 token 账
   media-auto    0.1.0  stack    下载完成自动改名，Jellyfin 立刻能播，中台一页看全
   llmcost       1.1.0  single   模型 API / 套餐 / 本地部署成本
   siyuan-remote 0.1.0  adapter  把 CasaOS 盒子里的思源接进中台，只登记不安装

$ python3 tools/moshan.py search 媒体
media-auto  0.1.0  stack  下载完成自动改名，Jellyfin 立刻能播，中台一页看全
```

---

## 6. 安装流水线

```
1. 选中插件        market.html / search / 直接给 manifest 路径
2. 勾模块          知道要什么就直接勾；不知道就让画布推荐
3. plan            算下载集、端口、注入、缺口；用户看清体积再决定
4. 端口预检        宿主端口被占则改分配（8790–8799 段）
5. 生成产物        compose.yaml / run.sh / install.sh / README.md
6. 执行            docker pull 精确 tag → compose up -d → 跑进程
7. 探活            /api/ping 2xx 且 body 含 ok；失败回退上一版
8. 登记            派生 plugins.json（中台读的那份）
```

幂等约定：**同一份 manifest + 同一组勾选，重复 install 结果必须一致**。生成物顶部写明「改这里会被覆盖」，持久化配置只能改 `moshan.json`。

---

## 7. 运行层

| 关注点 | 约定 | 为什么 |
| --- | --- | --- |
| 探活 | `GET /api/ping`，2xx 且 body 含 `ok` | 比"端口能连"可靠 |
| 卡片 | `GET /api/cards` 返回固定形状数组 | 中台只写一次渲染 |
| 日志 | stdout 按行收，写进 `10-系统记录` | 与现有 worklog 同模型 |
| 退出 | SIGTERM，宽限 5s 再 KILL | 让 sqlite/索引能收尾 |
| 端口 | 8790–8799 专段，manifest 必须声明，装前探测 | 现有 8778 已被「智能设备」占用 |
| 权限 | `permissions` 最小化（`net:https`、`fs:newsclips`、`docker`） | 本地服务出问题就在文件与网络越界 |

---

## 8. 中台适配（零改动）

`dash.html` 只读 `_工作台/plugins.json` 的七个字段：`id/name/url/port/cmd/glyph/note/group`。

所以：

```
moshan.json（自由演进）──派生──> plugins.json（七字段，字段名不许改）──> dash.html（一行不动）
```

派生逻辑是单向的：协议怎么改都不影响页面；哪天想给页面加卡片区，只加消费 `/api/cards` 的一段，插件侧不用动。

---

## 9. 仓库目录结构

```
.
├── MOSHAN-PLUGIN-SPEC.md        协议规范（对象、字段、校验规则）
├── ARCHITECTURE.md              本文：总纲与架构
├── schema/
│   ├── moshan.schema.json       包清单（single/stack/adapter，spec 2.1）
│   ├── registry.schema.json     商店索引
│   ├── catalog.schema.json      能力词表 + 标签词表 + 软件拆解（含 artifact）
│   ├── blueprint.schema.json    画布蓝图
│   └── card.schema.json         卡片（中台唯一认识的形状）
├── catalog/moshan-catalog.json  51 个条目 / 70 个模块 / 39 条能力 / 22 个标签（其中 35 个只登记）
├── registry/registry.json       生成的商店索引
├── examples/                    4 个可安装包 + 3 个蓝图 + 2 个生成清单
├── tools/
│   ├── validate.py              校验 + 拓扑推导（11/11 通过）
│   ├── blueprint.py             蓝图 → 推荐 → 清单
│   ├── moshan.py                仓库 / 定向计划 / 安装（本次新增）
│   ├── build_canvas.py          画布构建
│   └── build_market.py          市场构建
├── canvas.html                  画布：不知道要什么时用
└── market.html                  市场：知道要什么时用
```

---

## 10. 演进路线

| 阶段 | 内容 | 验收标准 |
| --- | --- | --- |
| **M0 ✅** | 协议 + schema + 校验器 + 三种形态示例 | `validate.py` 全绿，拓扑/注入可导出 |
| **M1 ✅** | 能力目录 + 蓝图解析 + 画布 | 3 个蓝图跑通，缺口演示硬报错 |
| **M2 ✅** | 拆解/下载分离 + `artifact` | `plan` 能算出最小下载集，变体不叠加 |
| **M3 ✅** | 仓库索引 + 市场页 + 搜索 | 4 个插件可搜可看，中文可搜 |
| **M4 ⬜** | `moshan install` 真跑（拿 llmcost 当样板） | 一条命令装完并能打开页面 |
| **M5 ⬜** | `moshan init <github-url>` 收编脚手架 | 随机取一个自托管项目，10 分钟内出可用 manifest |
| **M6 ⬜** | 卡片区 + 派生层接入中台 | `dash.html` 零改动下显示插件卡片 |

M4 是当前最短的验证闭环：llmcost 的清单已写好，装通即等于全链路验收。

---

## 11. 硬约束与风险

| 风险 | 现实情况 | 应对 |
| --- | --- | --- |
| **端口耗尽** | 8790–8799 只有 10 个，一个 stack 吃 3–4 个 | 短期够；长期改「逻辑端口 + 反代子路径」 |
| **镜像 tag 漂移** | 文档里 `sample_tag` 只是示例值 | 安装时查 registry API 取当期稳定版写死，**禁止 latest**（已修掉一个 `postgresql-latest`） |
| **manifest 即代码** | `entry/args` 能在你机器上执行 | 要求 `repo` + 版本锁定 + `sha256`；不假装沙箱 |
| **无 docker 的机器** | 本机开发机就没装 docker（实测） | `install` 只生成产物；真装到盒子上跑 |
| **上游镜像体积误报** | 变体镜像是替换不是叠加 | 已按替换计算，并在 plan 里写明原因 |
| **许可证** | 打包上游软件不改其许可，但分发要合规 | 目录带 `license`，市场展示；不打包二进制进 Release，只引用官方镜像 |
| **目录会腐化** | 上游改名/换仓库/停更 | `tier` 标级 + `updated` 时间戳 + 校验时探测镜像是否存在 |

---

## 12. 命令速查

```bash
# 看拆解知识（不下载任何东西）
python3 tools/moshan.py catalog
python3 tools/moshan.py catalog --cap media.transcode
python3 tools/moshan.py catalog --tag protocol      # 只看协议类
python3 tools/moshan.py tags --entries              # 标签词表 + 用量 + 各自挂了哪些条目

# 定向安装：知道要什么，直接指定（不走推荐）
python3 tools/moshan.py plan  examples/generated-media-auto.moshan.json \
        --use "jellyfin:stream,transcode;qbittorrent:torrent"
python3 tools/moshan.py install examples/generated-media-auto.moshan.json \
        --out build/media            # 只生成产物；加 --yes 才真拉真起

# 仓库
python3 tools/moshan.py registry "examples/*.moshan.json" --out registry/registry.json
python3 tools/moshan.py search 媒体
python3 tools/moshan.py show media-auto

# 不知道要什么：走画布 → 导出清单 → 再回到上面
open canvas.html

# 校验一切
python3 tools/validate.py examples/*.json catalog/moshan-catalog.json registry/registry.json
```

---

## 附：三句话总结

1. **拆解是静态知识，下载是安装时才算的东西** —— 所以"预先拆好、用多少下多少"是可计算的事实，不是承诺。
2. **推荐与指定是两条路** —— 有 AI 的时候给你理由，没有的时候听你的，两条路共用同一份数据与同一个安装器。
3. **连线只有一个真源** —— 拓扑图、说明表、环境变量注入全部由 `wires` 渲染，因此可视化说明永远不会与真实配置脱节。
