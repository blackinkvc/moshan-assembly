#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 arch/arch.json。数据写在这里，产物是 JSON + SQLite，便于 review 和小步改。

设计约定：
  域(domain) → 模块(module) → 子模块(part)，能再拆就继续往 part 挂，不封顶但别超过 5 层
  每格 providers 至少一个「拿得到」的方案：oss（能自部署）或 build（AI 自己写）
  全闭源必须补 build，否则用户走到这格就断头
"""
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # arch/，不是 parts/
COMPS = []
PRODS = []


def C(cid, name, kind, parent, abstract, note, io=None, provs=None):
    COMPS.append({
        "id": cid, "name": name, "kind": kind, "parent": parent,
        "abstract": abstract, "note": note,
        **({"io": io} if io else {}),
        "providers": provs or [],
    })


def P(pid, name, kind, license=None, repo=None, home=None, note=None,
      effort=None, tokens=None, outline=None):
    d = {"id": pid, "name": name, "kind": kind}
    for k, v in (("license", license), ("repo", repo), ("homepage", home),
                 ("note", note), ("effort", effort), ("tokens", tokens),
                 ("outline", outline)):
        if v:
            d[k] = v
    return d


def AIB(pid, name, effort, tokens, outline, note=None):
    """AI 自研方案。tokens 按实测 267 万/条深拆工作量折算。"""
    return P(pid, name, "build", effort=effort, tokens=tokens,
             outline=outline, note=note)


# ============================================================ 1 对话交互
C("ai.chat", "对话交互", "domain", None,
  "用户直接说话的那一层：输入、上下文、输出",
  "这是最容易被低估的一层。看起来只是「把消息发给模型」，实际上难在多轮上下文怎么裁、流式输出怎么断点续传、"
  "会话状态存哪。做小工具时可以直接调 API 不建这层；一旦要支持多轮、要能中断、要能回看历史，就必须单独抽出来，"
  "否则每个功能都会各写一套上下文拼接，最后对话一长就互相污染。")

C("ai.chat.core", "对话内核", "module", "ai.chat",
  "多轮上下文管理 + 流式输出 + 会话状态",
  "解决三件事：历史怎么裁（超长时丢头还是摘要）、流怎么推（SSE/WebSocket）、状态存哪（内存/Redis/SQLite）。"
  "常见坑：把整个历史每轮全量重发，token 成本随轮次平方涨——实测跑到第 30 轮，单轮成本是第 1 轮的 12 倍；"
  "正确做法是滑动窗口 + 关键事实摘要，或者干脆按任务切新会话。不需要它的场合：单轮问答、批处理脚本。",
  {"in": "用户消息 + 会话 id", "out": "流式增量文本 + 消息落库"},
  [
    P("ollama-webui", "Open WebUI", "oss", "BSD-3-Clause(需核)", "open-webui/open-webui",
      note="自带完整对话层，可直接当外壳用"),
    P("vercel-ai-sdk", "Vercel AI SDK", "oss", "Apache-2.0", "vercel/ai",
      note="只做流式与状态编排，UI 自己写；TypeScript 生态最省事"),
    P("litellm", "LiteLLM", "oss", "MIT(需核)", "BerriAI/litellm",
      note="入口统一，但会话层要自己补"),
    AIB("ai-write", "AI 自己写", "3–5 天", "约 300 万",
        ["Message 表 + 会话表，SQLite 存，按会话 id 取历史",
         "上下文裁剪：保留最近 N 轮 + 早期摘要，摘要用便宜模型生成",
         "输出走 SSE，前端用 ReadableStream 接；断线用 messageId 续传",
         "加 usage 记账（token 与耗时），否则没法优化成本"],
        "轮子不复杂，难的是裁剪策略，适合自己写并沉淀成自己的风格"),
  ])

C("ai.chat.memory", "长期记忆", "module", "ai.chat",
  "跨会话记住用户偏好与事实",
  "和「对话历史」不是一回事：历史是原始流水，记忆是提炼后的结论。需要它的场景：用户反复说「我不吃香菜」"
  "却每次都要重说。不需要的场景：一次性任务。坑在于写入时机——每轮都写会污染，只在用户明确表达偏好时写又漏。"
  "主流做法是先抽取候选事实再让用户确认，或者设阈值只在重复出现时固化。",
  {"in": "会话内容", "out": "可检索的事实条目"},
  [
    P("mem0", "Mem0", "oss", "Apache-2.0(需核)", "mem0ai/mem0",
      note="专门做记忆层，抽取+去重+检索一条龙"),
    P("letta", "Letta (MemGPT)", "oss", "Apache-2.0(需核)", "letta-ai/letta",
      note="把记忆做成可编辑的内存块，思路值得抄"),
    AIB("ai-write", "AI 自己写", "2–3 天", "约 150 万",
        ["事实表：subject / predicate / object / 来源消息 / 时间",
         "抽取：每轮结束让便宜模型抽「值得记的事实」，宁少勿多",
         "写入前查重，冲突时以时间新的为准并保留旧的",
         "检索：按当前对话做向量召回，拼进 system prompt 前 300 字"],
        "逻辑简单，关键在「什么时候不该记」"),
  ])

C("ai.chat.multimodal", "多模态输入", "module", "ai.chat",
  "图片、文件、语音进入对话",
  "不是「支持上传」这么简单，核心是分流：图片走视觉模型还是先 OCR、PDF 先解析还是直塞、语音先转录还是原样喂给"
  "支持音频的模型。选错分流，成本差十倍（一张图直接喂视觉模型约 1000+ token，OCR 后可能只有 200）。"
  "不需要的场合：纯文本工具。坑：大文件不切块直接塞上下文，一次就爆窗口。",
  {"in": "文件/图片/音频", "out": "结构化文本或视觉 token"},
  [
    P("docling", "Docling", "oss", "MIT", "docling-project/docling",
      note="PDF/Office 解析，版面与表格都保得住"),
    P("markitdown", "MarkItDown", "oss", "MIT", "microsoft/markitdown",
      note="最轻的转 Markdown，复杂版式会丢结构"),
    P("tesseract", "Tesseract", "oss", "Apache-2.0", "tesseract-ocr/tesseract",
      note="纯图 PDF 的兜底 OCR"),
    AIB("ai-write", "AI 自己写", "2 天", "约 120 万",
        ["按 MIME 分流：文本直读、PDF 走解析、图片走 OCR 或视觉模型",
         "超过阈值先摘要再入上下文，原文落盘保留引用",
         "统一成 [{type, content, source}] 的结构，后面接什么都行"],
        "分流规则比代码重要，先写一张判定表"),
  ])

# ============================================================ 2 智能体执行
C("ai.agent", "智能体执行", "domain", None,
  "模型自己决定下一步做什么，并把事做成",
  "区和「对话」划开：对话是一问一答，智能体是要多步、要用工具、要能失败重试。这一域是当前所有 AI 产品的"
  "主战场，也是最容易做成玩具的地方——大部分「Agent」其实只是加了工具调用的对话，真正的差别在失败恢复和"
  "上下文管理，不在循环本身。")

C("ai.agent.loop", "执行主循环", "module", "ai.agent",
  "想—做—看，直到完成或放弃",
  "整个 Agent 的心脏。必须有的三件：最大步数（防死循环）、每步的结果回灌（否则模型不知道成没成）、"
  "失败的重试与放弃判定。实测最常见的坑是没有步数上限，遇到工具一直报错就无限重试烧 token。"
  "另一个坑是把所有工具结果原样塞回上下文，几轮就把窗口撑满——要做摘要或截断。",
  {"in": "目标 + 可用工具", "out": "执行轨迹 + 最终结果"},
  [
    P("langgraph", "LangGraph", "oss", "MIT", "langchain-ai/langgraph",
      note="图式编排，状态与分支显式，适合复杂流程"),
    P("pydantic-ai", "PydanticAI", "oss", "MIT(需核)", "pydantic/pydantic-ai",
      note="类型安全，循环逻辑藏在框架里，改起来快"),
    AIB("ai-write", "AI 自己写", "4–6 天", "约 350 万",
        ["定义 Step{thought, tool, args, observation} 与最大步数",
         "循环：调模型 → 解析工具调用 → 执行 → 结果截断后回灌",
         "失败处理：同工具连续失败 2 次换策略，3 次则终止并报告",
         "轨迹落库，便于回放与调参（这一步不做，后面无法优化）"],
        "两百行能跑通，但要做好失败恢复和轨迹记录才可用"),
  ])

C("ai.agent.plan", "任务规划", "module", "ai.agent",
  "把一句话需求拆成可执行步骤",
  "规划与执行分开做的好处：可以先让人确认计划再动手，避免跑偏烧钱。需要它的场合：跨多文件、跨多系统的任务。"
  "不需要：单步能完成的事，硬加规划只是多花一次调用。坑是规划粒度过细——拆成 20 步反而每步都在丢上下文；"
  "经验是 3–7 步最稳。",
  {"in": "自然语言目标", "out": "有序步骤清单"},
  [
    P("llm-planner", "直接提示词规划", "pattern", note="不引依赖：让强模型输出 JSON 步骤数组，最省"),
    AIB("ai-write", "AI 自己写", "2–3 天", "约 180 万",
        ["先用强模型出计划（JSON：steps[{goal, done_when}]）",
         "人工确认环节可选，命令行里按 y 继续",
         "执行中每步回报实际结果，允许重规划（最多 2 次）",
         "计划与偏差都落库，用于后面调提示词"],
        "核心不是拆得细，是「完成判据」写清楚"),
  ])

C("ai.agent.tool", "工具调用", "module", "ai.agent",
  "把外部能力包成模型能调的接口",
  "本质是「函数签名 + 参数校验 + 结果裁剪」三件事。坑极多：参数不做类型校验，模型传个字符串数字就崩；"
  "结果不做裁剪，一次 grep 返回 5000 行直接爆窗口；错误信息不回传，模型不知道错在哪只能瞎试。"
  "不需要的场合：模型只用来生成文本。",
  {"in": "工具描述 + 模型意图", "out": "结构化结果"},
  [
    P("mcp", "MCP 标准", "oss", "MIT", "modelcontextprotocol/servers",
      note="协议层已标准化，现成 server 最多"),
    P("openai-fc", "OpenAI Function Calling", "pattern",
      note="事实标准，各家模型都兼容这种 schema"),
    AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
        ["工具注册表：name / 描述 / JSON Schema 参数 / 执行函数",
         "参数先过 pydantic 校验，失败把错误原文回给模型让它改",
         "结果统一截断到 N 字符，超出部分落盘给路径",
         "加超时与并发上限，防止某个工具把进程挂住"],
        "协议用现成的，执行层自己写更可控"),
  ])

C("ai.agent.mcp", "MCP 接入", "module", "ai.agent",
  "按统一协议挂外部工具与数据源",
  "MCP 的价值在于「一次实现，所有客户端能用」。选型判断：只在自家产品里用的工具，自己写工具调用更省；"
  "要被 Claude Code / Cursor / 自家客户端同时用，就值得包成 MCP server。坑：server 的生命周期管理"
  "（stdio 还是 SSE）、权限边界（给了文件系统就等于给了全部）。",
  {"in": "MCP server 配置", "out": "可调用工具列表"},
  [
    P("mcp-python", "MCP Python SDK", "oss", "MIT", "modelcontextprotocol/python-sdk",
      note="写 server 最直接"),
    P("mcp-servers", "官方 servers 合集", "oss", "MIT", "modelcontextprotocol/servers",
      note="文件/数据库/搜索都有现成的，别重写"),
    AIB("ai-write", "AI 自己写", "2 天", "约 130 万",
        ["先定 server 的 3–5 个工具，别一上来铺开",
         "stdio 传输最简单，远程再考虑 SSE",
         "每个工具加白名单与路径校验，禁止越界读",
         "写一份 tools 清单文档，客户端才能正确路由"],
        "协议实现别自己写，用 SDK"),
  ])

C("ai.agent.skill", "技能沉淀", "module", "ai.agent",
  "把一次做成的流程固定成可复用的技能",
  "这是「越用越顺手」的关键：同样的活做第二次不该从头教。形态可以是提示词模板、脚本、或带前置条件的说明文件。"
  "坑：技能没有触发条件就永远不会被用上；没有版本就会互相覆盖。需要它的场合：重复性任务（周报、发布、"
  "数据清洗）。不需要：一次性探索。",
  {"in": "成功的执行轨迹", "out": "可复用的技能条目"},
  [
    P("claude-skills", "Claude Skills 格式", "oss", None, "anthropics/skills",
      note="目录约定 + SKILL.md，跨客户端通用（该仓无 LICENSE，需留意）"),
    AIB("ai-write", "AI 自己写", "2 天", "约 110 万",
        ["技能目录：name / 何时用 / 步骤 / 依赖 / 示例",
         "触发条件写成可判断的描述，别写「需要时」",
         "从成功轨迹里自动抽取初稿，人再删改",
         "加版本号，改了就升版，避免静默失效"],
        "格式很简单，难在写得让人（和模型）都能读懂触发条件"),
  ])

# ============================================================ 3 模型供给
C("ai.model", "模型供给", "domain", None,
  "谁来算、算什么、算不起时怎么办",
  "所有 AI 产品最终都要落到「调哪个模型」。这一域决定成本结构：同一个任务换模型能差 10 倍价格，"
  "本地跑和云调用差的是隐私与延迟。别把它当配置项，它是架构的一部分。")

C("ai.model.gateway", "模型网关", "module", "ai.model",
  "一个入口对接多家，屏蔽协议差异",
  "需要它的信号：代码里出现第二个 `if provider ==`。网关做三件事：协议转换（OpenAI/Anthropic/Gemini 格式互转）、"
  "密钥与配额管理、用量记账。坑：流式输出的格式各家不同，转换时最容易丢 tool_call 分片；"
  "还有重试策略，一个供应商 429 要能自动切下一个。",
  {"in": "统一格式请求", "out": "统一格式响应 + 用量"},
  [
    P("litellm", "LiteLLM", "oss", "MIT", "BerriAI/litellm",
      note="100+ 供应商统一成 OpenAI 格式，事实标准"),
    P("one-api", "One API / New API", "oss", "MIT", "songquanpeng/one-api",
      note="带配额和渠道管理，适合多人共用"),
    P("openrouter", "OpenRouter", "commercial", note="省事但要抽成，数据出境需评估"),
    AIB("ai-write", "AI 自己写", "4 天", "约 280 万",
        ["统一请求/响应模型，先把 OpenAI 格式当基准",
         "适配器模式：每供应商一个 adapter，只做格式转换",
         "流式转发按 chunk 透传，不要攒完整再发",
         "记账：token、耗时、失败原因，按 task 聚合"],
        "两家以内不用写网关，直接 if/else 更省"),
  ])

C("ai.model.local", "本地推理", "module", "ai.model",
  "在自己机器上跑权重，不联网",
  "选它的理由只有三个：数据不出门、无按量费用、离线可用。代价是显存/内存与速度。判断标准：模型参数量 × 量化位数"
  "要能塞进显存，塞不进就吃内存、速度掉一个量级。坑：以为装了 Ollama 就能跑一切——大模型在 8G 显存上"
  "基本只能跑 7B 量化版。",
  {"in": "模型文件 + 提示", "out": "推理结果"},
  [
    P("ollama", "Ollama", "oss", "MIT", "ollama/ollama",
      note="一条命令跑起来，生态最全"),
    P("llamacpp", "llama.cpp", "oss", "MIT", "ggml-org/llama.cpp",
      note="底层引擎，量化格式多，适合嵌进自己的程序"),
    P("vllm", "vLLM", "oss", "Apache-2.0", "vllm-project/vllm",
      note="要并发吞吐时用它，单机交互反而重"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["推理引擎不要自研，量化与 kernel 优化是专业活",
         "自己写只做「启动/停止/健康检查」的进程管理壳"],
        "这一格自研没有意义，用它包一层管理界面就够"),
  ])

C("ai.model.route", "路由与降级", "module", "ai.model",
  "按任务难度选模型，贵的只在难的地方用",
  "省钱的最大杠杆，比任何提示词优化都有效。做法：先按任务类型分档（分类/摘要用小模型，写代码/推理用大模型），"
  "再按失败升级（小模型答不出来或格式不对就换大的）。坑：级联重试会让延迟翻倍，交互场景要设总超时；"
  "还有缓存，相同前缀的请求命中缓存能省 10 倍——实测缓存命中 99% 时，一亿 token 只花 60 积分。",
  {"in": "任务类型 + 预算", "out": "选定模型 + 调用结果"},
  [
    P("litellm-router", "LiteLLM Router", "oss", "MIT", "BerriAI/litellm",
      note="自带 fallback 与负载均衡"),
    P("route-llm", "RouteLLM", "oss", "Apache-2.0", "lm-sys/RouteLLM",
      note="按难度自动分流，学术实现的工程版"),
    AIB("ai-write", "AI 自己写", "2 天", "约 120 万",
        ["任务分类器：规则优先（长度、是否含代码、是否要推理），规则不行再上小模型判",
         "价目表配置化，别硬编码在代码里",
         "失败升级链：小 → 中 → 大，最多两次",
         "打日志记录每次选择与结果质量，否则无法调参"],
        "规则分类比模型分类更稳，先写规则"),
  ])

# ============================================================ 4 知识库
C("kb", "知识库", "domain", None,
  "让模型答得出它没训练过的东西",
  "几乎所有「企业 AI」最终都落到这一域。核心不是向量库选哪个，而是「切得对不对」——切片错了，"
  "再好的检索也召回不到。这也是为什么解析层比检索层更值得投入。")

C("kb.ingest", "文档入库", "module", "kb",
  "把各种格式变成干净的、可切片的文本",
  "流水线的第一段，也是决定上限的一段。质量差的表现：双栏 PDF 读成一行、表格变成乱码、扫描件直接空白。"
  "需要它的场合：资料以 PDF/Office 为主。不需要：纯网页或纯 Markdown 语料。坑：以为解析是小事，"
  "实际 60% 的问答失败追根溯源都在这。",
  {"in": "原始文件", "out": "结构化文本 + 元数据"},
  [
    P("docling", "Docling", "oss", "MIT", "docling-project/docling",
      note="版面、表格、阅读顺序都处理得最好，速度一般"),
    P("unstructured", "Unstructured", "oss", "Apache-2.0", "Unstructured-IO/unstructured",
      note="格式覆盖最广，复杂版式精度不如 Docling"),
    P("mineru", "MinerU", "oss", "AGPL-3.0(需核)", "opendatalab/MinerU",
      note="中文 PDF 与公式识别强"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["解析器不要自研：PDF 的坑是十年积累出来的",
         "自己写只做「格式判定 + 调用哪个解析器 + 结果规范化」的调度层"],
        "调度层可以自己写，解析内核必须用现成的"),
  ])

C("kb.parse", "格式解析", "part", "kb.ingest",
  "把 PDF/Word/网页拆成阅读顺序正确的文本",
  "子模块存在的意义：它是最常被单独替换的一环。判断解析好不好，看三件事——双栏有没有串行、表格有没有散架、"
  "页眉页脚有没有混进正文。三者都过才叫能用。",
  {"in": "文件字节流", "out": "带页码/坐标的文本块"},
  [
    P("docling", "Docling", "oss", "MIT", "docling-project/docling", note="首选"),
    P("pymupdf", "PyMuPDF", "oss", "AGPL-3.0", "pymupdf/PyMuPDF",
      note="快，但商业闭源项目要买授权——AGPL 是最容易踩的坑"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["解析内核别自研", "自己写只做格式嗅探与结果校验（比如检测乱序）"],
        "只写校验不写解析"),
  ])

C("kb.chunk", "切块", "part", "kb.ingest",
  "把长文本切成适合检索的片段",
  "最被低估的一环。切太大：召回一段里一半是废话，浪费上下文还干扰判断；切太小：语义不完整，答非所问。"
  "经验值 300–800 token，按结构切（章节/段落）优于按字数切。坑：中文按字符数切会把句子拦腰截断；"
  "要按句子边界做。",
  {"in": "结构化文本", "out": "带元数据的切片"},
  [
    P("langchain-splitter", "LangChain Splitter", "oss", "MIT", "langchain-ai/langchain",
      note="各种切法都有，按标题切最实用"),
    P("chonkie", "Chonkie", "oss", "Apache-2.0(需核)", "chonkie-inc/chonkie",
      note="轻量专用，语义切块效果好"),
    AIB("ai-write", "AI 自己写", "1–2 天", "约 80 万",
        ["先按结构切（Markdown 标题 / PDF 段落），保留层级路径",
         "超长段落再按句子边界二次切，目标 500 token、重叠 50",
         "每片带上「来自哪个文件、第几节」，供引用回溯",
         "切完抽样人看 10 条，切歪了立刻能发现"],
        "结构切 + 句子边界就够了，语义切块收益有限"),
  ])

C("kb.rag", "向量检索", "module", "kb",
  "按语义找相关片段，换个说法也能搜到",
  "它的长处在「模糊匹配」，短处恰恰也是——型号、编号、专有名词这些精确串经常搜不准。所以真实系统几乎都是"
  "向量 + 关键词混检。需要它的场合：语料超过几十页、问题用词与原文不一致。不需要：库小到能整篇塞上下文，"
  "或者问题就是要精确匹配。",
  {"in": "查询文本", "out": "相关片段 + 相似度"},
  [
    P("chroma", "Chroma", "oss", "Apache-2.0", "chroma-core/chroma",
      note="原型期最省事，单机一把梭"),
    P("qdrant", "Qdrant", "oss", "Apache-2.0", "qdrant/qdrant",
      note="过滤条件强的场景更合适"),
    P("lancedb", "LanceDB", "oss", "Apache-2.0", "lancedb/lancedb",
      note="列存，多模态数据一起存"),
    P("pgvector", "pgvector", "oss", "PostgreSQL", "pgvector/pgvector",
      note="已有 Postgres 就别再引一个库"),
    P("sqlite-vec", "sqlite-vec", "oss", "Apache-2.0", "asg017/sqlite-vec",
      note="单文件零服务，桌面端首选"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["向量索引与 ANN 算法不要自研", "自己写只做「选库 + 建索引 + 查询封装」"],
        "自己写会得到一个又慢又不准的索引"),
  ])

C("kb.embed", "嵌入", "part", "kb.rag",
  "把一段文字压成固定长度的向量",
  "选嵌入模型的第一原则：换了就要全量重建索引，所以一开始就要选稳的。中文场景别直接用英文模型。"
  "坑：同一个库混用两个嵌入模型（比如中途升级），向量空间不一致，检索结果会莫名其妙地差。",
  {"in": "文本", "out": "定长向量"},
  [
    P("bge-m3", "BGE-M3", "oss", "MIT", "FlagOpen/FlagEmbedding",
      note="中文强，支持多语言与长文本"),
    P("nomic-embed", "Nomic Embed", "oss", "Apache-2.0", "nomic-ai/nomic-embed-text-v1.5",
      note="英文场景性价比高"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["嵌入模型不要自己训，直接用现成权重",
         "自己写只做「批量调用 + 缓存 + 维度校验」的封装"],
        "训模型不在这个任务范围内"),
  ])

C("kb.recall", "召回", "part", "kb.rag",
  "从索引里取出候选片段",
  "注意它是「取候选」不是「定结果」——召回要给得多一点（top 20），后面再靠重排收敛。"
  "坑：只取 top 3 又不重排，答错率很高；相似度阈值设太高会完全没有召回，模型就开始编。",
  {"in": "查询向量", "out": "候选片段列表"},
  [
    P("hybrid", "向量 + BM25 混检", "pattern",
      note="不引额外依赖：两路各取 10 条按倒数排名融合"),
    AIB("ai-write", "AI 自己写", "1 天", "约 60 万",
        ["向量召回 top 15 + 关键词召回 top 15",
         "用 RRF（倒数排名融合）合并，不用调权重",
         "去重后交给重排", "记录每次召回了什么，便于事后归因"],
        "RRF 融合二十行代码，效果稳定"),
  ])

C("kb.rerank", "重排", "part", "kb.rag",
  "把真正相关的那条顶到最前",
  "投入产出比最高的一环：加个重排，问答准确率常有明显提升，代价只是一次小模型推理。"
  "不需要的场合：召回本身就很准、或者延迟极敏感。坑：把重排模型跑在 CPU 上，一次几百毫秒，交互体验直接崩。",
  {"in": "候选片段 + 查询", "out": "排好序的片段"},
  [
    P("bge-reranker", "BGE Reranker", "oss", "MIT", "FlagOpen/FlagEmbedding",
      note="中文场景首选，小模型也能跑"),
    P("cohere-rerank", "Cohere Rerank", "commercial", note="效果稳，但是按次收费且数据出境"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["重排模型不要自研", "自己写只做「批大小调节 + 超时降级（超时就不重排）」"],
        "只写降级逻辑"),
  ])

C("kb.fulltext", "关键词检索", "module", "kb",
  "精确串匹配：型号、编号、法规条号",
  "向量检索的死角由它补。需要它的信号：用户搜「RTX4090」「GB/T 1234」这类词，向量给出的是「语义相近」的"
  "废话。中文要分词，分词器选错会把专有名词拆碎。坑：只上向量不上全文，用户搜精确编号永远搜不到。",
  {"in": "查询串", "out": "匹配片段 + BM25 分"},
  [
    P("meilisearch", "Meilisearch", "oss", "MIT", "meilisearch/meilisearch",
      note="开箱即用，中文分词需配"),
    P("tantivy", "Tantivy", "oss", "MIT", "quickwit-oss/tantivy",
      note="Rust 的 Lucene，嵌进程序里"),
    P("sqlite-fts", "SQLite FTS5", "oss", "Public Domain", "sqlite/sqlite",
      note="零依赖，小库够用；中文要自己接分词"),
    AIB("ai-write", "AI 自己写", "2 天", "约 90 万",
        ["建倒排：词 → 片段 id 列表，中文先过分词",
         "BM25 打分，参数用默认值起步",
         "与向量结果做 RRF 融合", "高频词做停用，否则全被「的」占满"],
        "FTS5 + 分词器最省，自己写 BM25 也不难"),
  ])

C("kb.manage", "库管理", "module", "kb",
  "多库隔离、增删改、重建索引",
  "看着无聊但必踩：文档一更新，旧的切片还在库里，检索就会召回过期内容。要处理的是增量与版本，"
  "不是简单的 insert。坑：改了嵌入模型却没重建，库就半废了；删文档只删了原文没删切片。",
  {"in": "文档变更事件", "out": "一致的索引状态"},
  [
    P("ragflow-manage", "RAGFlow 的管理层", "oss", "Apache-2.0", "infiniflow/ragflow",
      note="切片可视化并可手工改，这点比多数产品实在"),
    P("anythingllm-ws", "AnythingLLM 工作区", "oss", "MIT", "Mintplex-Labs/anything-llm",
      note="一工作区一库，隔离干净"),
    AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
        ["文档表 + 切片表，切片带 doc_id 与版本号",
         "更新走「先标旧版本失效，再插新版本」，不做原地改",
         "换嵌入模型时全库重建，用任务队列跑",
         "提供切片浏览界面，能看能删——这是排障的命门"],
        "切片可视化界面比算法更值得先做"),
  ])

# ============================================================ 5 内容生成
C("ai.media", "内容生成", "domain", None,
  "图、视频、声音、音乐这些非文本产物",
  "和文本生成的根本差别：产物大、要存储与转码、要版本管理。架构上必须有对象存储，不能塞数据库。"
  "另外这一域的商业 API 基本全闭源，成本按次计，必须做配额。")

C("ai.media.image", "图像生成", "module", "ai.media",
  "文字或参考图变成图片",
  "两条路：调商业 API（质量稳、按张收费）或本地跑（免费但要显卡、要调参）。判断标准：出图量。"
  "月出图几百张用 API 更划算；上千张且要批量试，本地更省。坑：本地模型的显存要求比宣传高，"
  "SDXL 至少 8G，Flux 建议 16G 起。",
  {"in": "提示词 / 参考图", "out": "图片文件 + 元数据"},
  [
    P("comfyui", "ComfyUI", "oss", "GPL-3.0", "comfyanonymous/ComfyUI",
      note="节点式，可控性最强，学习曲线陡"),
    P("sd-webui", "SD WebUI", "oss", "AGPL-3.0", "AUTOMATIC1111/stable-diffusion-webui",
      note="上手最快，插件生态老"),
    P("fal", "Fal / Replicate", "commercial", note="按张付费，免运维，适合先验证"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["生成模型不训，只做调用与编排",
         "自己写的是「提示词模板 + 批量队列 + 结果归档」这一层"],
        "自研=写调度与归档，不是写模型"),
  ])

C("ai.media.video", "视频生成", "module", "ai.media",
  "文字或图变成视频片段",
  "目前全部依赖闭源模型（可灵、即梦、Runway、Veo），没有可用的开源权重能本地跑出可用质量。"
  "工程重点是「编排」：分镜、逐段生成、拼接、配音、字幕。坑：成本按秒计且很贵，一个 30 秒片试十次就是"
  "几百块；必须做预演和分镜确认。",
  {"in": "脚本 / 分镜", "out": "视频片段"},
  [
    P("kling", "可灵 API", "commercial", note="国内可用，按秒计费"),
    P("jimeng", "即梦 API", "commercial", note="与字节生态打通"),
    P("veo", "Veo / Runway", "commercial", note="质量好，需处理数据出境"),
    AIB("ai-write", "AI 自己写（编排层）", "5–8 天", "约 400 万",
        ["模型本身无开源可用，必须买 API——这里自研的是编排",
         "分镜结构：scene[{prompt, duration, ref_image}]",
         "逐段生成后 ffmpeg 拼接，音轨对齐",
         "失败段单独重试，不要整片重跑（成本差十倍）"],
        "自研边界：编排、重试、拼接、字幕；生成靠 API"),
  ])

C("ai.media.voice", "语音合成", "module", "ai.media",
  "文字变人声，或人声转文字",
  "TTS 与 ASR 常被混为一谈，其实是两个方向。选型看：要不要克隆音色（要则商业为主）、要不要离线（要则本地）。"
  "坑：中文多音字与英文混读，本地模型经常读错；ASR 对环境噪声极敏感，先降噪再说。",
  {"in": "文本 / 音频", "out": "音频 / 文本"},
  [
    P("gpt-sovits", "GPT-SoVITS", "oss", "MIT", "RVC-Boss/GPT-SoVITS",
      note="少样本克隆音色，中文效果好"),
    P("whisper", "Whisper", "oss", "MIT", "openai/whisper",
      note="ASR 事实标准，本地可跑"),
    P("faster-whisper", "faster-whisper", "oss", "MIT", "SYSTRAN/faster-whisper",
      note="同质量快 4 倍，工程上更实用"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["语音模型不训", "自己写只做「分段、静音切分、并发转录、结果合并」"],
        "ASR 用 faster-whisper，TTS 用现成模型"),
  ])

C("ai.media.music", "音乐生成", "module", "ai.media",
  "按风格描述生成一段配乐",
  "需求集中在短视频与游戏。开源权重（MusicGen 系）质量可用但节奏感一般；商业 API 明显更好。"
  "坑：版权——生成音乐的商用授权各家条款不同，做产品前必须先看条款。",
  {"in": "风格描述 / 时长", "out": "音频文件"},
  [
    P("musicgen", "MusicGen", "oss", "MIT", "facebookresearch/audiocraft",
      note="本地可跑，30 秒片段质量够用"),
    P("suno", "Suno", "commercial", note="质量最好，商用授权需细读"),
    AIB("ai-write", "AI 自己写", "不建议", "—",
        ["模型不训", "自己写只做「按场景选风格 + 批量生成 + 淡入淡出裁剪」"],
        "编排层为主"),
  ])

# ============================================================ 6 编程辅助
C("dev.code", "编程辅助", "domain", None,
  "让 AI 参与写代码的各个环节",
  "这一域的产品形态差异极大（IDE、CLI、网页），但内部拆开是同一套：索引 → 补全 → 改写 → 审查。"
  "难的不是生成，是「知道该改哪」——这全靠索引质量。")

C("dev.code.index", "代码索引", "module", "dev.code",
  "让模型知道这个仓库里有什么、在哪",
  "所有代码 Agent 的地基。做不好就表现为「改了不相关的文件」或「重复实现已有函数」。两种做法："
  "全文 grep（简单、准、但上下文占得多）与向量索引（省 token、但会漏）。实测两者结合最好："
  "先用结构信息（文件树、符号表）定位，再按需读片段。坑：大仓不做增量索引，每次全量 embed 要几十分钟。",
  {"in": "仓库文件", "out": "可检索的代码表示"},
  [
    P("tree-sitter", "tree-sitter", "oss", "MIT", "tree-sitter/tree-sitter",
      note="按语法解析，符号与调用关系都拿得到"),
    P("ctags", "universal-ctags", "oss", "GPL-2.0", "universal-ctags/ctags",
      note="最轻，几秒建完符号表"),
    P("sourcegraph", "Sourcegraph / Zoekt", "oss", "Apache-2.0", "sourcegraph/zoekt",
      note="大仓搜索的工业级方案"),
    AIB("ai-write", "AI 自己写", "5 天", "约 400 万",
        ["先建符号表：文件 → 函数/类 + 起止行（ctags 或 tree-sitter）",
         "检索分两步：先按关键词/符号名定位文件，再按行范围读",
         "需要语义时才对函数级 embed，别整仓 embed",
         "增量：按文件 mtime + hash 判断是否重解析"],
        "「先定位再读」比整仓向量化省一个数量级"),
  ])

C("dev.code.complete", "行内补全", "module", "dev.code",
  "光标处的下几个 token",
  "要求延迟极低（<300ms），所以用小模型、本地优先。坑：上下文给太多反而慢且不准——给前后各 50 行 + "
  "相关符号就够。另一个坑是「接受率」：补全太啰嗦会被忽略，宁可短而准。",
  {"in": "光标上下文", "out": "补全片段"},
  [
    P("continue", "Continue", "oss", "Apache-2.0", "continuedev/continue",
      note="开源补全插件，可换模型"),
    P("fim", "FIM 小模型（如 Qwen2.5-Coder）", "pattern",
      note="专用 fill-in-middle 模型，本地跑得快"),
    AIB("ai-write", "AI 自己写", "3 天", "约 220 万",
        ["上下文组装：前 50 行 + 后 20 行 + 同文件符号",
         "请求做防抖（150ms）+ 取消旧请求，否则打字时全是废请求",
         "输出截断到单行或单块，多了没人看",
         "记录接受率，用来调上下文长度"],
        "防抖与取消比模型选择更影响体验"),
  ])

C("dev.code.edit", "批量改写", "module", "dev.code",
  "按需求跨文件修改并自验",
  "和补全的区别：要规划、要读写多文件、要能验证。核心是「改完怎么知道对」——必须跑测试或类型检查，"
  "否则只是在猜。坑：直接覆盖整文件会丢掉用户未提交的改动；应该用精确 patch。",
  {"in": "需求描述", "out": "补丁 + 验证结果"},
  [
    P("aider", "Aider", "oss", "Apache-2.0", "Aider-AI/aider",
      note="diff 式改写 + git 提交，工程上最成熟"),
    P("cline", "Cline", "oss", "Apache-2.0", "cline/cline",
      note="IDE 内的编辑 Agent，能看到每一步"),
    AIB("ai-write", "AI 自己写", "5 天", "约 380 万",
        ["先让模型输出 unified diff，不要整文件重写",
         "应用 patch 前先 dry-run，冲突就回退并要求重出",
         "改完立刻跑 lint/test，把结果回灌给模型",
         "每步落 git stash 或分支，方便人对比与回滚"],
        "diff + 验证闭环是这一格的全部价值"),
  ])

C("dev.code.review", "代码审查", "module", "dev.code",
  "找出改动里的问题",
  "价值在于「只看 diff 不看全仓」，否则上下文费用爆炸。坑：泛泛地说「建议加注释」毫无价值；"
  "有效的审查要绑定具体行号与具体风险（空指针、并发、SQL 注入）。",
  {"in": "diff + 上下文", "out": "带行号的问题清单"},
  [
    P("reviewdog", "reviewdog", "oss", "MIT", "reviewdog/reviewdog",
      note="把结果写回 PR，工程流水线用"),
    AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
        ["输入只给 diff + 被改函数的完整定义",
         "提示词要求「每条必须带行号 + 风险类型 + 修复建议」",
         "按严重度分级，只报高置信的",
         "接 CI，输出统一 JSON 便于 reviewdog 消费"],
        "约束输出格式比换模型更有效"),
  ])

# ============================================================ 7 流程编排
C("ai.flow", "流程编排", "domain", None,
  "把多个步骤连成一条能自动跑的流水线",
  "从「聊天」到「系统」的分水岭。有了它，用户不用写代码就能把模型、工具、判断串起来。"
  "难点在状态与错误处理，不在画布好不好看。")

C("ai.flow.canvas", "可视化画布", "module", "ai.flow",
  "拖节点、连线、试跑",
  "它解决的是「让非程序员也能改流程」。坑：画布好做、调试难做——没有单步执行与节点级日志，"
  "用户只能整条重跑，体验极差。做产品时优先做「单节点试跑 + 看输入输出」，比动画炫酷重要得多。",
  {"in": "节点定义", "out": "可执行图"},
  [
    P("reactflow", "React Flow", "oss", "MIT", "xyflow/xyflow",
      note="前端画布事实标准，自己接后端"),
    P("langflow", "Langflow", "oss", "MIT", "langflow-ai/langflow",
      note="画布 + 执行一体，可直接当产品壳"),
    P("flowise", "Flowise", "oss", "Apache-2.0", "FlowiseAI/Flowise",
      note="偏 LLM 场景，开箱节点多"),
    AIB("ai-write", "AI 自己写", "7–10 天", "约 600 万",
        ["图结构：nodes[] / edges[]，节点带 inputSchema",
         "前端用 React Flow，后端只存 JSON 图",
         "执行器把图拓扑排序后逐节点跑，节点间传 JSON",
         "必须做单节点试跑与断点，否则调试等于盲跑"],
        "画布本身一周，值得花的是调试体验"),
  ])

C("ai.flow.node", "节点与连接器", "module", "ai.flow",
  "预置的集成：数据库、HTTP、各家 SaaS",
  "节点数量决定「能接什么」，是这类产品最重的运营工作。判断标准：常见 20 个够用，剩下靠自定义 HTTP。"
  "坑：每个节点都写一套认证，重复且易泄露密钥；应统一凭证管理。",
  {"in": "节点配置", "out": "可复用的集成"},
  [
    P("n8n-nodes", "n8n 节点生态", "oss", "Sustainable-Use(非OSI)", "n8n-io/n8n",
      note="400+ 集成，注意它不是真开源，商用托管受限"),
    P("activepieces", "Activepieces", "oss", "MIT(需核)", "activepieces/activepieces",
      note="节点开源且许可更宽松，可作替代"),
    AIB("ai-write", "AI 自己写", "按节点数递增", "每节点约 60 万",
        ["统一节点规范：认证、输入 schema、执行、输出 schema",
         "先做 5 个最常用的（HTTP / 数据库 / 文件 / 邮件 / Webhook）",
         "凭证统一进 vault，节点里只引用 id",
         "每个节点配一个最小可跑示例，否则用户不会用"],
        "节点是体力活，按需长，别一次铺满"),
  ])

C("ai.flow.trigger", "触发", "module", "ai.flow",
  "什么时候开始跑：定时、事件、Webhook",
  "没有它，流程只能手动点。三类触发各有坑：定时要考虑时区与错过补跑；事件要幂等（重复通知会跑两遍）；"
  "Webhook 要验签（否则谁都能触发你的流程）。",
  {"in": "触发配置", "out": "执行请求"},
  [
    P("cron", "系统 cron / APScheduler", "oss", "MIT", "agronholm/apscheduler",
      note="单机最省，复杂调度再上队列"),
    P("webhook", "Webhook + HMAC 验签", "pattern",
      note="自己实现十行，必须验签"),
    AIB("ai-write", "AI 自己写", "2 天", "约 120 万",
        ["触发器表：类型、表达式、下次执行时间、上次结果",
         "定时用轮询而非常驻定时器，重启不丢",
         "事件加幂等键，同键 5 分钟内只跑一次",
         "Webhook 校验签名与时间戳，防重放"],
        "轮询式调度最皮实"),
  ])

C("ai.flow.run", "执行引擎", "module", "ai.flow",
  "真正把图跑起来：并发、重试、状态",
  "这类系统出问题九成在这里：并发跑同一流程导致数据错乱、失败没有重试、跑到一半重启就丢状态。"
  "最低要求：执行实例有 id 与状态机，每步落库，能从中断处续跑。",
  {"in": "可执行图 + 触发", "out": "执行记录"},
  [
    P("temporal", "Temporal", "oss", "MIT", "temporalio/temporal",
      note="持久化工作流，崩了能续，工业级但重"),
    P("bullmq", "BullMQ", "oss", "MIT", "taskforcesh/bullmq",
      note="Redis 队列，中小规模够用"),
    AIB("ai-write", "AI 自己写", "6 天", "约 450 万",
        ["执行表：run_id / 节点 / 状态 / 输入 / 输出 / 错误",
         "每节点跑完立即落库，重启按 status=running 续跑",
         "失败重试带退避，同节点最多 3 次",
         "加并发锁：同一流程同一 key 不并行"],
        "状态落库是核心，队列用现成的"),
  ])

# ============================================================ 8 交付与接入
C("ai.deliver", "交付与接入", "domain", None,
  "把做好的东西送到用户手上、看得见、管得住",
  "最容易被忽略但决定产品能不能用：没有通道，Agent 只能待在终端里；没有可观测，出了问题无从查起。")

C("ai.deliver.channel", "消息通道", "module", "ai.deliver",
  "从微信/飞书/钉钉/Telegram 收发消息",
  "让 Agent 长在用户已有的沟通工具里，而不是要求用户打开一个新 App。各家协议差异大：企业微信要自建应用、"
  "飞书有事件订阅、Telegram 最开放。坑：消息去重（平台会重推）、长任务超时（要分片回）、"
  "权限（谁能唤起 bot）。",
  {"in": "平台事件", "out": "统一消息 + 回复"},
  [
    P("openclaw-gw", "OpenClaw 网关", "oss", "MIT", "openclaw/openclaw",
      note="现成的多平台网关，直接复用"),
    P("chatgpt-on-wechat", "chatgpt-on-wechat", "oss", "MIT(需核)", "zhayujie/chatgpt-on-wechat",
      note="微信生态最成熟，注意合规风险"),
    AIB("ai-write", "AI 自己写", "4 天/平台", "约 300 万",
        ["统一 Message 结构：平台、会话、发送者、内容、原始事件",
         "每平台一个 adapter，只做收发与签名",
         "幂等：按平台消息 id 去重",
         "长任务先回「收到」，完成后主动推送"],
        "adapter 模式，先在 Telegram 上跑通再扩"),
  ])

C("ai.deliver.publish", "发布托管", "module", "ai.deliver",
  "把应用变成别人能打开的链接或 API",
  "从「本机能跑」到「别人能用」的那一步。需要处理：鉴权（不能裸奔）、配额（防被刷）、HTTPS、域名。"
  "坑：把 API Key 写进前端；没有限流，被爬一次就破产。",
  {"in": "应用 / 构建产物", "out": "可访问的 URL"},
  [
    P("docker", "Docker + Caddy 反代", "pattern",
      note="自托管最标准，配 Caddy 自动 HTTPS"),
    P("vercel", "Vercel / Cloudflare", "commercial", note="静态与边缘函数最省事"),
    AIB("ai-write", "AI 自己写", "2–3 天", "约 150 万",
        ["容器化：一个 Dockerfile，环境变量注入密钥",
         "反代用 Caddy，自动证书",
         "加鉴权中间件（token 或 basic auth）与限流",
         "部署脚本一键化，别手敲命令"],
        "发布本身不难，难在别把密钥漏出去"),
  ])

C("ai.deliver.ops", "可观测", "module", "ai.deliver",
  "日志、用量、错误、成本",
  "AI 应用的特点是「同样的输入不同输出」，所以传统日志不够，要记下每次调用的输入摘要、模型、token、耗时、"
  "结果质量。没有这层，优化成本和质量都是瞎猜——实测里积分失控的根因几乎都能在这里找到。",
  {"in": "调用事件", "out": "指标与告警"},
  [
    P("langfuse", "Langfuse", "oss", "MIT(需核)", "langfuse/langfuse",
      note="专为 LLM 应用做的追踪，能看到完整链路"),
    P("otel", "OpenTelemetry", "oss", "Apache-2.0", "open-telemetry/opentelemetry-python",
      note="通用标准，接 Grafana 生态"),
    AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
        ["每次调用记一行：task / model / in_tokens / out_tokens / 耗时 / 状态",
         "按 task 聚合出成本表，这是优化的入口",
         "记录输入摘要与输出摘要，便于抽样评估质量",
         "设阈值告警：单任务超预算、失败率突增"],
        "先做记账，追踪框架后面再上"),
  ])

# ============================================================ 软件：30 个
def S(pid, name, category, composes, license=None, homepage=None, tags=None, note=None):
    PRODS.append({"id": pid, "name": name, "category": category,
                  **({"homepage": homepage} if homepage else {}),
                  **({"license": license} if license else {}),
                  **({"tags": tags} if tags else {}),
                  **({"note": note} if note else {}),
                  "composes": [{"component": c, "provider": p, "role": r} for c, p, r in composes]})


S("dify", "Dify", "platform", [
    ("ai.flow.canvas", "reactflow", "must"), ("ai.flow.run", None, "must"),
    ("ai.agent.loop", None, "must"), ("ai.agent.tool", None, "must"),
    ("kb.ingest", "docling", "must"), ("kb.rag", "chroma", "must"),
    ("ai.model.gateway", "litellm", "must"), ("ai.deliver.publish", None, "optional"),
], license="Other（Apache-2.0 加附加条款）", homepage="https://dify.ai", tags=["ai", "selfhost"],
   note="开源应用平台的代表：把「编排、Agent、RAG、发布」四件事装进一个界面。差异点是它真的能自部署且功能齐，代价是重")

S("n8n", "n8n", "platform", [
    ("ai.flow.canvas", "reactflow", "must"), ("ai.flow.node", "n8n-nodes", "must"),
    ("ai.flow.trigger", None, "must"), ("ai.flow.run", None, "must"),
    ("ai.model.gateway", None, "optional"),
], license="Sustainable Use（非 OSI 开源）", homepage="https://n8n.io", tags=["automation", "selfhost"],
   note="自动化工作流的标杆。注意它的许可限制商业托管，看着开源实则不是；节点生态是它真正的护城河")

S("ragflow", "RAGFlow", "app", [
    ("kb.parse", "docling", "alt"), ("kb.ingest", None, "must"),
    ("kb.rag", None, "must"), ("kb.fulltext", None, "must"),
    ("kb.rerank", None, "optional"), ("kb.manage", "ragflow-manage", "must"),
    ("ai.model.gateway", None, "optional"),
], license="Apache-2.0", homepage="https://ragflow.io", tags=["ai", "rag", "selfhost"],
   note="知识库的重工业版：力气全在解析与混检，还能看见切片长什么样。2C 内存起步，装它等于上个完整服务")

S("openclaw", "OpenClaw", "agent", [
    ("ai.deliver.channel", "openclaw-gw", "must"), ("ai.agent.loop", None, "must"),
    ("ai.agent.tool", None, "must"), ("ai.agent.skill", None, "must"),
    ("ai.chat.memory", None, "must"), ("ai.model.gateway", None, "optional"),
], license="MIT", homepage="https://clawd.bot", tags=["ai", "agent", "local"],
   note="真开源的本地 Agent，把「聊天软件当入口 + 本机执行 + 持久记忆」做通了。风险点是它与你同级权限")

S("anythingllm", "AnythingLLM", "app", [
    ("kb.rag", "lancedb", "must"), ("kb.manage", "anythingllm-ws", "must"),
    ("ai.agent.tool", None, "optional"), ("ai.agent.mcp", "mcp-servers", "optional"),
    ("ai.model.gateway", None, "must"),
], license="MIT", homepage="https://anythingllm.com", tags=["ai", "rag", "desktop"],
   note="桌面一键装好的知识库全家桶，价值在「四段全接通还能换件」，当对照组最省事")

S("cherry-studio", "Cherry Studio", "app", [
    ("ai.chat.core", None, "must"), ("ai.model.gateway", None, "must"),
    ("kb.rag", None, "optional"), ("ai.agent.mcp", "mcp-servers", "must"),
], license="Apache-2.0(需核)", homepage="https://cherry-ai.com", tags=["ai", "desktop", "mcp"],
   note="多模型桌面客户端，差异点是 MCP 与知识库都有，适合当日常前台")

S("cursor", "Cursor", "devtool", [
    ("dev.code.index", None, "must"), ("dev.code.complete", None, "must"),
    ("dev.code.edit", None, "must"), ("ai.agent.loop", None, "must"),
], license="闭源", homepage="https://cursor.com", tags=["ai", "coding"],
   note="闭源商业 IDE 的标杆，护城河在自研补全模型与索引速度，不在功能列表")

S("claude-code", "Claude Code", "devtool", [
    ("dev.code.index", "tree-sitter", "must"), ("ai.agent.plan", None, "must"),
    ("ai.agent.tool", None, "must"), ("ai.agent.mcp", "mcp-python", "must"),
    ("ai.agent.loop", None, "must"), ("ai.agent.skill", "claude-skills", "optional"),
], license="闭源", homepage="https://www.anthropic.com/claude-code", tags=["ai", "coding", "cli"],
   note="CLI 形态的编程 Agent，把「技能与 MCP」做成了生态，是最值得抄结构的闭源产品")

S("chatgpt", "ChatGPT", "app", [
    ("ai.chat.core", None, "must"), ("ai.chat.multimodal", None, "must"),
    ("ai.chat.memory", "mem0", "must"), ("ai.agent.tool", None, "must"),
    ("ai.media.image", None, "optional"), ("ai.model.gateway", None, "must"),
], license="闭源", homepage="https://chatgpt.com", tags=["ai", "chat"],
   note="对话产品的事实标准：多模态、记忆、工具在一轮里做完，其它产品基本都在对标它的功能表")

S("doubao", "豆包", "app", [
    ("ai.chat.core", None, "must"), ("ai.media.image", None, "must"),
    ("ai.media.music", None, "optional"), ("kb.parse", None, "must"),
    ("ai.agent.loop", None, "optional"), ("ai.chat.memory", None, "optional"),
], license="闭源", homepage="https://www.doubao.com", tags=["ai", "chat", "cn"],
   note="国内助手代表：把写作、生图、音乐、文档阅读全塞进一个入口，差异点是中文语境与免费额度")

# ============================================================ 输出
def main():
    d = {
        "spec": "moshan-arch/1",
        "updated": "2026-11-24",
        "note": "本体 → 模块 → 子模块。层级靠 parent 串，level 由脚本推。providers 里必须有拿得到的方案。",
        "components": COMPS,
        "products": PRODS,
    }
    out = os.path.join(HERE, "arch.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("写出 %s：模块 %d / 软件 %d" % (out, len(COMPS), len(PRODS)))


if __name__ == "__main__":
    main()
