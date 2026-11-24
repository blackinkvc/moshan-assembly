#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第五批：应用底座（app）。

为什么补这一批：拿 5 个真实需求跑匹配时，「记账」「库存」「行业研究」「生活助手」四个都推到了
「有 AI 能力、但没有地方存数据、没有账号、没有界面」——库里 85 格全是 AI 能力，一格地基都没有。
这不是词表问题，是库的形状缺了一块。缺了它，「输入需求 → 挑方案」走不通：用户拿到 9 格架构，
却不知道账本存在哪。

切法说明：只切「必须自己决定、选错了要返工」的四件半：
  app.data 存哪          —— 选错（先 Excel 后迁移）要重做数据模型
  app.auth 谁能进        —— 后期补权限等于给每张表回填 user_id
  app.ui   长什么样      —— 占整个项目一半工程量，最容易低估
  app.file 文件放哪      —— 小体量不用管，一旦共享就必须对象存储
  app.edge 接什么硬件    —— 扫码枪、小票机、串口，只在特定需求出现
不切 CRUD、不切「后端框架」：那些是写法差异，不是架构决策。
"""
from seed01 import AIB, P, C

# ============================================================ 域
C("app", "应用底座", "domain", None,
  "任何「要长期用」的软件都绕不开的四件事：数据存哪、谁能进、界面长什么样、文件放哪",
  "这一域不属于 AI，但缺了它，前面所有 AI 模块都只是演示。判断一个需求要不要这一域很简单："
  "数据只活在一次对话里（如翻译、改名）→ 不要；数据要跨天留存、要多人看、要被检索 → 全都要。"
  "坑：把业务数据塞进向量库或 Excel，三个月后必然迁移；先做功能后加权限，等于给每张表补字段并回填。")

# ============================================================ 数据存储
C("app.data", "数据存储", "module", "app",
  "业务数据的家：一条记录怎么存、怎么查、怎么保证不丢",
  "选型只看三件事：几个人用、要不要实时同步、数据多大。一个人一台机器、几万条以内 → SQLite 单文件，"
  "零运维、备份就是拷文件；多人同时写 → Postgres，别犹豫；要手机和电脑同步又不想写后端 → Supabase。"
  "坑一：拿 Excel/CSV 当库，两个人同时改就丢数据。坑二：为了「以后要扩展」上分布式库，结果三个月没人维护。"
  "不需要它的场合：纯计算、纯生成、不留历史。",
  {"in": "实体与字段", "out": "可查询、可备份的持久层"},
  [
      P("sqlite", "SQLite", "oss", license="Public Domain", repo="sqlite/sqlite",
        note="单文件、零服务，单机应用的首选；备份就是复制那一个文件"),
      P("postgres", "PostgreSQL", "oss", license="PostgreSQL", repo="postgres/postgres",
        note="多人同时写、要做统计与约束时的默认答案"),
      P("supabase", "Supabase", "oss", license="Apache-2.0", repo="supabase/supabase",
        note="Postgres + 认证 + 存储 + 实时，省掉整个后端；托管版免费额度够小团队"),
      P("mysql", "MySQL / MariaDB", "oss", license="GPL-2.0", repo="MariaDB/server",
        note="已有运维习惯或要接老系统时才选，新项目没有理由优先"),
      P("drizzle", "Drizzle / Prisma（ORM）", "pattern", license="Apache-2.0",
        repo="drizzle-team/drizzle-orm",
        note="不是数据库，是「表结构即代码」的做法：迁移有版本、字段有类型，比手写 SQL 少一半事故"),
      AIB("app-data-write", "AI 自己写一套存储", "不建议", "—",
          ["存储层不要自研，直接用 SQLite/Postgres",
           "自研的部分只做：实体建模、索引设计、迁移脚本"],
          note="自己写 KV 或文件格式，最后都会在并发与查询上翻车"),
  ])

# ============================================================ 账号与权限
C("app.auth", "账号与权限", "module", "app",
  "谁能进来、能看到谁的：登录、会话、角色、数据隔离",
  "触发条件很明确：需求里出现「同事」「团队」「各自登录」「权限」就必须有这一格。"
  "做法上不要自己写密码哈希与会话管理——现成方案已经把所有坑踩过（限流、验证码、找回密码、第三方登录、"
  "token 过期与刷新）。真正要自己设计的是「谁能看到哪些行」，这是业务问题，不是技术问题："
  "最简单可靠的是每条记录带 owner_id，查询永远带这个条件，别指望前端藏按钮。",
  {"in": "用户身份", "out": "会话 + 角色 + 行级可见范围"},
  [
      P("supabase-auth", "Supabase Auth", "oss", license="Apache-2.0",
        repo="supabase/auth", note="和 app.data 同一套，行级权限（RLS）直接写进数据库"),
      P("authjs", "Auth.js (NextAuth)", "oss", license="ISC", repo="nextauthjs/next-auth",
        note="Next.js 项目最省事，微信/邮箱/SSO 都有现成 provider"),
      P("keycloak", "Keycloak", "oss", license="Apache-2.0", repo="keycloak/keycloak",
        note="企业内网、要接 LDAP/AD 时的标准答案，重但全"),
      P("casdoor", "Casdoor", "oss", license="Apache-2.0", repo="casdoor/casdoor",
        note="带管理界面的轻量选择，中文文档友好"),
      AIB("app-auth-write", "AI 自己写鉴权", "2 天", "约 60 万",
          ["会话用现成库签发，不要自己设计 token 格式",
           "密码只存 argon2/bcrypt 哈希；登录接口必须限流",
           "权限判断写在查询条件里（owner_id），不要写在前端"],
          note="能写，但不该写：漏一个限流或一个越权判断就是事故"),
  ])

# ============================================================ 界面
C("app.ui", "界面呈现", "module", "app",
  "用户实际看到的那一层：网页、手机、小程序、还是一个本地窗口",
  "这是最容易被低估的一格，通常占整个项目一半以上工程量。判断标准很简单："
  "只有自己用 → Gradio/Streamlit 半天出活；要给同事用 → 正经前端，要处理登录态、空状态、错误提示、"
  "移动端适配；要进微信 → 小程序是独立的开发与审核流程，不是「把网页包一层」。"
  "坑：先按桌面宽度做，最后发现用户 80% 在手机上打开。",
  {"in": "页面与交互", "out": "可访问的界面"},
  [
      P("nextjs", "Next.js + shadcn/ui", "oss", license="MIT", repo="vercel/next.js",
        note="网页端的默认组合：路由、服务端渲染、组件库一次到位"),
      P("streamlit", "Gradio / Streamlit", "oss", license="Apache-2.0", repo="streamlit/streamlit",
        note="内部工具与原型的最快路径，一天能出可用界面，别拿它做对外产品"),
      P("uniapp", "uni-app", "oss", license="Apache-2.0", repo="dcloudio/uni-app",
        note="一套代码出小程序 + H5 + App，国内生态最顺"),
      P("taro", "Taro", "oss", license="MIT", repo="NervJS/taro",
        note="React 技术栈做小程序时选它，团队已会 React 就别换 uni-app"),
      AIB("app-ui-write", "AI 自己写前端", "按页算", "约 8 万/页",
          ["先定组件库与设计 token（间距、字号、色），否则每页都不一样",
           "状态管理只在跨页共享时才引，局部状态用组件内 state",
           "移动端优先：先按 375px 画，再放大"],
          note="能写，但「能看」和「能用」差在空态、加载态、错误态这三处"),
  ])

# ============================================================ 文件
C("app.file", "文件与对象存储", "module", "app",
  "图片、附件、导入的原始文件放哪、怎么取",
  "分界线很清楚：只有自己用、几十个文件 → 本地目录 + 静态服务足够；一旦要多人共享、要外链、"
  "要被 CDN 加速、文件上到 GB 级 → 必须对象存储。坑：把图片存进数据库（备份变巨大、查询变慢）；"
  "把用户上传的原文件直接放到代码仓库旁边的目录里（部署一次全丢）。",
  {"in": "文件字节", "out": "可访问的 URL + 元数据"},
  [
      P("minio", "MinIO", "oss", license="AGPL-3.0", repo="minio/minio",
        note="自建 S3 兼容存储，内网部署首选"),
      P("s3", "S3 / 阿里云 OSS", "commercial", home="https://aws.amazon.com/s3/",
        note="不想运维就买，按量付费；出口流量费要算进成本"),
      P("supabase-storage", "Supabase Storage", "oss", license="Apache-2.0",
        repo="supabase/storage", note="已经用 Supabase 就顺手，权限直接复用 RLS"),
      AIB("app-file-write", "AI 自己写文件服务", "1 天", "约 25 万",
          ["本地目录 + 哈希命名 + 静态路由，够用到几百 GB",
           "必须做：类型白名单、大小上限、路径穿越防护"],
          note="上传服务本身不难，难的是鉴权与防盗链，别自己发明签名算法"),
  ])

# ============================================================ 硬件
C("app.edge", "硬件与设备接入", "module", "app",
  "扫码枪、小票机、称重秤、串口设备：让软件碰得到现实世界",
  "这类需求的坑在于「看着像软件问题，其实是权限问题」：扫码枪大多伪装成键盘，插上就能用；"
  "但浏览器拿不到串口和 USB，所以要么做桌面端（Electron/Tauri），要么在本地跑一个小代理转成 HTTP。"
  "判断：需求里出现「扫码枪」「打小票」「称重」「读卡」就必须先问清楚——是浏览器还是桌面端。",
  {"in": "设备事件", "out": "结构化数据"},
  [
      P("keyboard-wedge", "键盘模拟直读", "pattern", license="—",
        note="扫码枪默认就是键盘输入 + 回车；用一个隐藏输入框接即可，零依赖，先试这个"),
      P("webhid", "WebHID / WebSerial", "pattern", license="—",
        note="Chrome 系可用，需要用户手动授权一次；能覆盖大部分 USB/串口设备"),
      P("tauri", "Tauri / Electron 本地代理", "oss", license="MIT", repo="tauri-apps/tauri",
        note="浏览器拿不到的设备权限，交给本地壳去拿，再转成本地 HTTP 给页面用"),
      AIB("app-edge-write", "AI 自己写设备对接", "3 天", "约 90 万",
          ["先确认设备协议（HID / 串口 / 厂商 SDK），拿不到协议就别接",
           "统一抽象成「设备事件 → 标准 JSON」，业务层不感知厂商差异"],
          note="协议文档是唯一门槛，代码本身不难"),
  ])
