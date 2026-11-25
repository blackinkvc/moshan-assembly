#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第九批：本地模型的三格，加一格「安装包与签名」。

为什么补这三格：

  前面 20 个域里只有 `ai.model.local`（本地推理）一格，它回答的是「在哪跑」。
  但真把模型装到用户机器上，卡住的不是「怎么跑」，是另外三件事：

  1. **跑哪个**。同一台 8G 内存的笔记本，跑 7B-Q4 是 6 token/s、跑 3B-Q4 是 28 token/s、
     跑 1.5B 是 80 token/s。选错档位，用户第一句话就等 20 秒，然后卸载。
     这不是「模型质量」问题，是「预算与档位」问题——所以它得是一格，不能靠感觉。
  2. **权重从哪来**。一个 7B-Q4 是 4.7GB，下载会断、会校验失败、会被镜像限速。
     没有「拉取 + 校验 + 断点续传」，用户卡在 87% 就再也装不上。
  3. **装完怎么发出去**。dmg 未签名会被 Gatekeeper 判「已损坏」，exe 会撞 SmartScreen，
     apk 要放开未知来源。这一格不是「打包脚本」，是「签名与信任链」。

切法还是那把尺子：只切「必须自己决定、选错了要返工」的。
  · 预算档位定了就换不了（换模型要重下 5GB）
  · 权重目录结构定了就换不了（Ollama 的 blobs 与 llama.cpp 的 gguf 目录不通用）
  · 签名身份定了就换不了（换证书＝所有用户重装）
"""
from seed01 import P, C, AIB

# ============================================================ 模型供给（补三格）
C("ai.model.fit", "模型选型与预算", "module", "ai.model",
  "给定内存/显存，算出能跑哪个参数的哪个量化，以及大概多少 token/s",
  "这一格存在的唯一理由：**参数量不是选型依据，预算是**。"
  "一个 7B 模型 Q4 量化约 4.7GB 权重，跑起来还要 KV cache（上下文 4k 时另占 0.5–1.5GB）"
  "和运行时开销（0.3–0.8GB）。所以「8G 内存能跑 7B」这句话是错的——"
  "要留 2G 给系统与你的程序，实际可用的只有 6G，7B-Q4 刚好卡在边界上，一开长上下文就 OOM。"
  "正确做法是先算三笔账：权重 + KV cache + 运行时，再看剩下的余量；余量不足就降一档量化（Q4→Q3）"
  "或降一档参数（7B→3B）。"
  "坑：拿「模型文件大小」当「内存占用」——真实占用通常是文件大小的 1.3–1.6 倍；"
  "只看显存不看内存——显存不够会自动 offload 到内存，速度掉一个量级而不是报错，用户以为「就是慢」。",
  {"in": "硬件预算（内存/显存/是否有独显）", "out": "结构化记录（档位表：模型、量化、占用、预估速度）"},
  [
      P("fit-self", "一张预算表（自研）", "pattern", license="—",
        note="把「参数 × 量化 → 权重 GB」和「上下文 → KV cache GB」两张小表写进配置，"
             "选型就是查表 + 比较余量。约 80 行代码，比接任何库都直接。"
             "表要按实际机型标定过一次，别抄别人的博客数字"),
      P("ollama-show", "ollama show / ps 读实际占用", "oss", license="MIT", repo="ollama/ollama",
        note="跑起来以后 `ollama ps` 会给出真实的内存占用与是否 offload 到 CPU。"
             "用它校准自己的估算表，比自己猜准得多"),
      P("llamacpp-gguf", "按 gguf 元数据算", "oss", license="MIT", repo="ggerganov/llama.cpp",
        note="gguf 头里就有参数量、量化类型、张量形状，能精确算出权重体积；"
             "再按 n_ctx 估 KV cache（层数 × 头数 × 维度 × 2 字节 × 上下文）"),
      AIB("ai-fit-write", "AI 帮你写选型器", "1 天", "约 15 万",
          ["三笔账：权重 / KV cache / 运行时", "预算 → 档位表（模型 + 量化 + 预估 tps）",
           "超预算时的降级建议（先降量化，再降参数）"]),
  ])

C("ai.model.pull", "权重拉取与校验", "module", "ai.model",
  "把几 GB 的权重完整、可断点、可校验地弄到本地，失败能续上",
  "下载一个 4.7GB 的文件，中间断一次的概率不是「万一」而是「大概率」——"
  "家用宽带、公司代理、镜像限速，都会让长连接断在半路。"
  "所以它不是「fetch 一下就完事」，要三件事一起做：**分块 + 断点续传、sha256 校验、失败可重试**。"
  "第二件事是目录约定：Ollama 用 `~/.ollama/models/blobs`（内容寻址），llama.cpp 用裸 gguf 文件，"
  "LM Studio 又一套。目录一旦定下来，用户下次换工具就得重下 5GB——所以要在第一次就选对。"
  "坑：只写「下载完成」不写校验，用户拿到半个文件，加载时报一个看不懂的错。",
  {"in": "结构化记录（选型表：要哪个模型哪个量化）", "out": "原始文件（本地权重）"},
  [
      P("ollama-pull", "ollama pull", "oss", license="MIT", repo="ollama/ollama",
        note="自带分块、断点续传、内容寻址与校验，一条命令搞定；"
             "代价是权重进它自己的 blobs 目录，别的工具读不到（只能走 API）"),
      P("hf-cli", "hf / huggingface-cli download", "oss", license="Apache-2.0",
        repo="huggingface/huggingface_hub",
        note="支持 resume、多线程、镜像（HF_ENDPOINT）；拿到的是裸 gguf/safetensors，"
             "任何推理器都能用。国内要配镜像，否则很慢"),
      P("pull-self", "自己写分块下载 + sha256（自研）", "pattern", license="—",
        note="HTTP Range 分块、每块记 offset、完成后整体 sha256 对比清单。"
             "约 200 行，换来完全可控的进度条与镜像切换；适合要嵌进自己安装器里的情况"),
      AIB("ai-pull-write", "AI 帮你写拉取器", "1 天", "约 18 万",
          ["Range 分块与断点续传", "sha256 校验与坏块重下", "镜像回退与限速提示"]),
  ])

# ============================================================ 应用外壳（补一格）
C("app.pkg", "安装包与签名", "module", "app",
  "把产物打成用户能双击安装的东西：dmg / exe / AppImage / apk，并解决「系统不信任你」",
  "这一格的难点不在打包命令，在**信任链**。"
  "macOS 上没签名的 dmg 打开会说「已损坏，移到废纸篓」——不是文件坏了，是 Gatekeeper 的隔离属性；"
  "Windows 上没签名的 exe 会弹 SmartScreen「Windows 已保护你的电脑」；"
  "Android 装 apk 要用户手点「允许未知来源」。"
  "三条路可选：① 买证书签名（Apple 开发者 99 美元/年 + 公证，Windows 代码签名证书约 2000 元/年）；"
  "② 不签名，写清绕过方法（右键打开 / 更多信息 → 仍要运行 / `xattr -dr com.apple.quarantine`）；"
  "③ **发源码或单文件**——用户自己 `git clone && npm i && npm run dev`，"
  "产物是他本机编译的，没有 quarantine 属性、没经过别人的签名，所以不会被拦。"
  "第三种的代价是要装工具链，但它是唯一「零成本 + 零信任问题」的路子，适合自用与小圈子。"
  "坑：以为「本地能跑就能发」——同一份代码在别人机器上缺运行时、缺动态库、缺权限，报的错还不一样。",
  {"in": "界面（要发出去的那个程序）", "out": "产物文件（安装包）+ 外部动作（发布）"},
  [
      P("pkg-tauri", "Tauri bundler", "oss", license="MIT", repo="tauri-apps/tauri",
        note="一条命令出 dmg/msi/AppImage/apk；签名与公证要自己配环境变量。"
             "包体最小（10MB 级），mac 上要 `--target universal-apple-darwin` 才同时支持 Intel 与 Apple Silicon"),
      P("pkg-electron", "electron-builder", "oss", license="MIT", repo="electron-userland/electron-builder",
        note="dmg/exe/AppImage/deb 全支持，自动更新与签名钩子齐全；"
             "代价是包体 100MB 起，且 macOS 公证要额外配 notarize"),
      P("pkg-single", "单文件 / 源码分发（不签名路线）", "pattern", license="—",
        note="一个 index.html 双击即开，或给一个 zip 让人自己 `npm i && npm run dev`。"
             "完全绕开签名与公证：文件没有 quarantine 标记，也没人可以「不信任」一段源码。"
             "适合自用、内网、小圈子；不适合要用户「双击就装好」的场合"),
      P("pkg-sign", "签名 + 公证（买证书路线）", "commercial", license="商业",
        note="Apple Developer 99 美元/年（Developer ID + notarytool），Windows 代码签名证书约 2000 元/年。"
             "签完 Gatekeeper 与 SmartScreen 都不再拦，是唯一「发给陌生人不被吓到」的做法"),
      AIB("app-pkg-write", "AI 帮你写打包脚本", "1 天", "约 20 万",
          ["三平台构建矩阵与产物命名", "签名/公证的环境变量与失败回退", "安装说明与升级通道"]),
  ])
