#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第四批：从 ai-bot.cn 分层抽样 170 个，先补 39 格（6 个新域 + 33 个模块），再逐个推组合。

数据两条线：
  模块与方案 —— 手写，粒度对齐已有 45 格（这决定库的形状）
  软件组合   —— 由 data/aibot-200.json 的功能清单按关键词规则推，可复算（这决定库的宽度）

为什么组合用规则推而不是逐条手写：170 个 × 6 格 = 1000 条关系，手写必然不一致；
规则可读、可改、可复算，改一条词就全库重算。但规则推不出的（语义反向、行业特例）允许
在 OVERRIDE 里点名修正——规则是基线，人工只处理例外。
"""
import json
import os
import re

import seed01 as base  # noqa: F401  COMPS / PRODS 挂在 seed01 上
from seed01 import AIB, C, P, S

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # arch/
DATA = os.path.join(HERE, "data", "aibot-200.json")

# ============================================================ 新域
C("ai.text", "文本创作", "domain", None,
  "把「写」拆成六种写法：文案、长文、虚构、改写、翻译、摘要",
  "写作类产品表面都在「生成文字」，实际要的东西完全不同：文案要模板与平台调性，长文要大纲与引用，"
  "小说要人设一致性，改写要句式操控，翻译要术语表，摘要要压缩率。合成一格，用户就没法按需求选，"
  "库也就失去了匹配能力。")

C("ai.office", "办公产出", "domain", None,
  "表格、会议、导图、简历、笔记、扫描件——办公室里被接手的那几件事",
  "共同点：输入不是「一段话」而是「一份已有的文件或一场会」，难点在解析与结构化，不在生成。"
  "和 kb.ingest 的区别在目的：那边是为检索入库，这边是把原始材料改造成能交付的东西。")

C("ai.design", "视觉设计", "domain", None,
  "版式与品牌：把内容排成能发出去的图",
  "设计工具分两半：一半是生成素材（归 ai.media.image），一半是把素材排到版上（这一域）。"
  "后者看着简单，其实决定成品是否专业：栅格、留白、字号层级、品牌色一致性。")

C("ai.prompt", "提示词工程", "domain", None,
  "提示词的存、管、改、评",
  "多条产品线并行时提示词会膨胀到几百条，散在代码里改一次要发版、改坏了无法回滚。这一域解决的是"
  "「提示词作为资产」的问题，不是「怎么写得更好」——后者是模型能力，不是工程模块。")

C("ai.detect", "内容检测", "domain", None,
  "判断一段内容是不是机器写的，以及把它改得像人写的",
  "两类需求方向相反：平台要检测，作者要规避。技术上是一件事的两面——都吃「机器文本的统计特征」"
  "（困惑度、句长方差、连接词密度），所以这域必须成对看，只做检测而不懂改写就是在追一个总在变的靶。")

C("ai.search", "检索", "domain", None,
  "从「找得到」到「答得出」",
  "和 kb 的分界：kb 搜的是自己灌进去的文档，这一域搜的是开放世界。和 ai.agent.search 的分界："
  "那边是 Agent 手里的一件工具，这边是可以独立成产品的检索能力（索引、排序、去重、垂直库）。")

# ============================================================ 文本创作
C("ai.text.copy", "营销文案", "module", "ai.text",
  "卖点 + 平台调性 → 可直接发布的种草/测评/电商文案",
  "关键不在「写得好看」，在「符合平台规则」：小红书要口语和分段，亚马逊要关键词密度，公众号要结构。"
  "通常做法是「表单模板 + 平台片段 + 少量爆款样例」，样例比提示词有效得多。"
  "坑：同一套提示词喂所有平台，出来全是一个味，用户一眼看出是批量货。不需要它的场合：只要一篇通用介绍。",
  {"in": "品牌 + 人群 + 卖点 + 平台", "out": "多平台文案"},
  [P("prompt-template", "表单模板 + 平台片段", "pattern",
     note="填表式输入，平台调性写成片段库，最省且可控；样例质量决定上限"),
   P("jasper", "Jasper / Copy.ai", "commercial", note="模板与工作流成熟，按坐席收费"),
   AIB("ai-write", "AI 自己写", "3 天", "约 250 万",
       ["表单 schema 化：品牌、人群、卖点、平台、禁用词",
        "每个平台一个片段库 + 2 条爆款样例，拼进系统提示",
        "批量生成后做相似度去重（>0.9 的重写）",
        "接禁用词与合规检查，否则文案会被平台限流"],
       "难的是平台调性库，不是生成")])

C("ai.text.long", "长文与论文", "module", "ai.text",
  "大纲 → 分章 → 引用，一次生成整篇必然跑偏",
  "正确姿势是「先出大纲，人确认后再逐章写」，每章带上文摘要保持连贯。论文类还要处理引用：模型编造"
  "参考文献是常态，必须回外部检索核。坑：不分章直接要 8000 字，前后会自相矛盾，中途也没法纠正方向。"
  "不需要它的场合：800 字以内的短文，直接对话更快。",
  {"in": "主题 + 素材 + 篇幅", "out": "分章长文 / 带引用的报告"},
  [P("langchain-long", "LangChain 长文链", "oss", "MIT", "langchain-ai/langchain",
     note="map-reduce / refine 现成，省得自己拼上下文"),
   P("notion-ai", "Notion AI / 秘塔写作猫", "commercial", note="改稿体验好，长文结构偏弱"),
   AIB("ai-write", "AI 自己写", "4 天", "约 300 万",
       ["大纲 JSON：章节、每章要点、需要的数据",
        "逐章生成，上下文只带大纲 + 上一章末尾 500 字",
        "引用走检索：每处引用必须有 URL，没检索到就标注「待补」",
        "全文一致性检查：术语表与人物/事实表比对"],
       "分章 + 引用核对是全部工作量，生成本身不难")])

C("ai.text.fiction", "小说与剧本", "module", "ai.text",
  "人设、世界观、章节、分镜——长篇最怕前后不一致",
  "技术难点不是生成，是「记住」：角色关系、已发生事件、埋下的伏笔。做法是维护结构化设定表"
  "（人物卡 / 时间线 / 世界书），每次生成前把相关条目检索出来注入上下文。"
  "短篇可以不管；超过三万字不建设定表，必然崩人设。剧本还要多一层分镜：一场戏拆成镜号、景别、台词。",
  {"in": "设定 + 前情 + 本章目标", "out": "章节正文 / 分镜脚本"},
  [P("lorebook", "设定表 + 检索注入", "pattern",
     note="人物卡与时间线存 JSON，按出场角色召回，零依赖"),
   P("sillytavern", "SillyTavern", "oss", "AGPL-3.0", "SillyTavern/SillyTavern",
     note="角色卡与世界书已是事实标准，可直接借数据结构"),
   P("novelai", "NovelAI / 彩云小梦", "commercial", note="续写顺手，长篇一致性仍要自己管"),
   AIB("ai-write", "AI 自己写", "5 天", "约 400 万",
       ["设定表三张：人物卡、时间线、世界规则",
        "写前检索：本章出场角色 + 相关地点 + 未回收伏笔",
        "写完回写：新增事实追加进设定表，标记伏笔状态",
        "一致性检查：让另一个模型只挑前后矛盾"],
       "崩人设是这类产品唯一的死因，别指望靠提示词解决")])

C("ai.text.rewrite", "改写与降重", "module", "ai.text",
  "换句式、换词、调语气——包括「降 AIGC 率」",
  "降 AI 率本质是打乱机器文本的统计特征，常用手法是同义替换 + 句序调整 + 插入口语。"
  "代价是可读性下降，过度处理会变成病句；检测方也在升级，所以这是持续对抗，不能承诺「必过」。"
  "真正需要的是「改写但不改意思」，这要求逐段处理并锁定术语。不需要它的场合：一句话不顺，直接让模型改。",
  {"in": "原文 + 改写强度 + 保留术语", "out": "改写文本 + 改动对照"},
  [P("rewrite-prompt", "分段改写 + 术语保护", "pattern",
     note="逐段处理、术语表锁定、温度调低，最稳且可解释"),
   P("quillbot", "QuillBot / 茅茅虫", "commercial", note="现成产品，批量与查重一体"),
   AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
       ["先切段（按标点与语义），段间不互相看，避免整篇同质",
        "每段给三个改写强度，用户可选；强档允许拆句合句",
        "术语表与专有名词用占位符抽出，改写后回填",
        "输出 diff 视图，让用户看见改了什么——不然不敢用"],
       "降 AI 率是副产物，主产品价值是「可对照的改写」")])

C("ai.text.translate", "翻译", "module", "ai.text",
  "术语一致、双语对照、长文档分块",
  "LLM 直译质量已够用，真正的问题是三件：术语表（同一份文档里 API 不能一会叫接口一会叫 API）、"
  "分块后的指代（代词跨块就丢）、格式保留（Markdown 与字幕时间轴不能被打乱）。"
  "做产品必须支持上传术语表。不需要它的场合：单个短句，直接问模型。",
  {"in": "原文 + 术语表 + 目标语言", "out": "译文 + 对照"},
  [P("llm-glossary", "LLM + 术语表", "pattern",
     note="分块翻译 + 术语强制替换 + 上下文摘要向前传"),
   P("libretranslate", "LibreTranslate", "oss", "AGPL-3.0", "LibreTranslate/LibreTranslate",
     note="可自部署，离线场景必须；质量弱于商用模型"),
   P("deepl", "DeepL API", "commercial", note="欧语最准，中文一般"),
   AIB("ai-write", "AI 自己写", "4 天", "约 300 万",
       ["按段落切块，保留原始顺序号",
        "每块带上「上一块译文末尾 200 字」作为上下文",
        "术语命中先替换成占位符，译完回填",
        "字幕/表格走专用路径：只译文本字段，时间轴与列结构不动"],
       "难点全在格式与术语，翻译本身已经被模型解决了")])

C("ai.text.summary", "摘要与抽取", "module", "ai.text",
  "长文压缩成要点，或抽成结构化字段",
  "两条路：抽取式（挑原句，不会编但生硬）与生成式（通顺但会编）。合同、财报这类不容错的场景要抽取式"
  "并保留原文位置；读论文、听播客用生成式。坑：一次塞十万字进去，模型只看开头和结尾——必须分段摘要"
  "再归并，且保留段号以便回溯。",
  {"in": "长文 / 转写稿", "out": "要点 + 原文位置"},
  [P("map-reduce", "分段摘要 + 归并", "pattern",
     note="map 出每段要点，reduce 合并去重；带段号可回溯"),
   P("langchain-sum", "LangChain summarize chain", "oss", "MIT", "langchain-ai/langchain",
     note="现成链，适合先跑通再改"),
   AIB("ai-write", "AI 自己写", "2 天", "约 150 万",
       ["按标题或固定长度切段，每段带 index",
        "map：每段出 3 条要点 + 关键数字，保留 index",
        "reduce：合并同义要点，冲突的标出来而不是二选一",
        "输出每条要点回链到段 index，界面可跳原文"],
       "冲突处理是这类产品被信任的关键")])

# ============================================================ 办公产出
C("ai.office.sheet", "表格与数据", "module", "ai.office",
  "自然语言建表、写公式、出图",
  "卖点不是「生成表格」，是「把脏数据变成能看的东西」。链路：解析上传的 xlsx/csv → 推断列类型 → "
  "生成公式或透视 → 出图。坑：模型写 Excel 公式经常用错区域引用，必须实际算一遍再返回；"
  "还要防注入（CSV 里以 = 开头的单元格会被 Excel 当公式执行）。不需要它的场合：数据小到能直接看一眼。",
  {"in": "表格文件 + 自然语言指令", "out": "改好的表 / 图表"},
  [P("univer", "Univer / Luckysheet", "oss", "Apache-2.0", "dream-num/univer",
     note="网页表格内核，公式引擎现成，别自己写"),
   P("excel-copilot", "Excel Copilot / XCell", "commercial", note="与 Office 深度绑定，导出最省心"),
   AIB("ai-write", "AI 自己写", "6 天", "约 400 万",
       ["读表：只取表头 + 前 200 行做类型推断，别整表塞模型",
        "生成计划而非代码：先出「选哪些列、怎么算」的步骤",
        "按步骤调表格引擎 API 执行，公式由引擎算，模型不碰数值",
        "结果回显并保留撤销；导入时过滤以 = + - @ 开头的单元格"],
       "别让模型算数，让它出计划——算错一次用户就不信了")])

C("ai.office.meeting", "会议记录", "module", "ai.office",
  "录音 → 转写 → 分段纪要 → 待办",
  "链路固定：转写（ASR）→ 说话人分离 → 按议题切段 → 每段出摘要与决议 → 抽待办（谁、做什么、何时）。"
  "坑：多人抢话时分离错乱，纪要会张冠李戴；专有名词识别差，必须支持上传热词表。"
  "真正的价值在待办抽取，逐字稿只是副产品——只给逐字稿的产品没人用第二次。",
  {"in": "录音 / 会议音频", "out": "纪要 + 待办列表"},
  [P("whisper-pyannote", "Whisper + pyannote", "oss", "MIT", "openai/whisper",
     note="转写与说话人分离都能自建，中文用 FunASR 更准"),
   P("feishu-minutes", "飞书妙记 / 讯飞会议", "commercial", note="开箱可用，热词与协作成熟"),
   AIB("ai-write", "AI 自己写", "5 天", "约 350 万",
       ["转写带词级时间戳，保留说话人标签",
        "按语义切段：换人 + 长停顿 + 话题词变化",
        "每段抽「结论 / 分歧 / 待办」，待办必须能落到人",
        "输出回链到时间点，点一下跳到录音对应位置"],
       "待办抽取的质量决定复购，纪要只是及格线")])

C("ai.office.mindmap", "导图与大纲", "module", "ai.office",
  "文字 ↔ 树结构，双向可编辑",
  "难点不在生成树，在「双向」：用户改节点要能回写成文本，文本改了要重排树。做法是只存一棵 JSON 树，"
  "文本视图由树渲染，避免两份数据打架。输出要考虑 XMind / Markdown 兼容，否则用户拿不走。"
  "不需要它的场合：一次性梳理思路，用大纲列表就够。",
  {"in": "主题 / 长文", "out": "导图（可导出）"},
  [P("markmap", "markmap / mind-elixir", "oss", "MIT", "markmap/markmap",
     note="Markdown 与脑图互转，前端直接跑"),
   P("xmind-ai", "XMind AI / AmyMind", "commercial", note="导出格式最全"),
   AIB("ai-write", "AI 自己写", "3 天", "约 250 万",
       ["单一数据源：{id, text, children[]}，其余都是视图",
        "生成时限制层级 3–4 层、每层 ≤7 个，否则没法看",
        "编辑走命令式操作（加/删/移），便于撤销重做",
        "导出 Markdown / OPML / xmind，别自造格式"],
       "视图与数据分离是唯一要点，做反了就是无尽 bug")])

C("ai.office.resume", "简历与求职", "module", "ai.office",
  "结构化履历 + 岗位对齐 + 版式导出",
  "真正的需求是「按 JD 改」：把岗位描述抽成关键词与硬性条件，再逐条对照履历做匹配度，指出缺什么。"
  "铁律：只做重写与排序，不许新增事实——让模型编经历会毁掉求职者。导出要兼容 ATS（纯文本可解析），"
  "花哨排版反而减分。不需要它的场合：投一个熟人内推的岗位，人工改两句更快。",
  {"in": "履历 + 岗位描述", "out": "对齐后的简历"},
  [P("jd-match", "JD 关键词对齐", "pattern",
     note="抽 JD 要求 → 逐条映射履历 → 出匹配度与缺口，不编造"),
   P("resume-tpl", "LaTeX / docx 模板", "pattern", note="模板渲染，版式稳定且 ATS 友好"),
   AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
       ["履历结构化：时间、公司、角色、动作、量化结果",
        "JD 抽硬条件（年限/技能/证书）与软要求",
        "逐条映射，输出「命中 / 部分命中 / 缺失」三态",
        "只允许改写措辞与调整顺序，新增事实需用户确认"],
       "缺什么比写什么更有用，别把它做成美化工具")])

C("ai.office.note", "笔记与个人知识", "module", "ai.office",
  "随手记 → 自动整理 → 可被问",
  "和 kb 的分界：kb 是灌进来的文档，这一层是自己写的东西，需要双链、标签、每日回顾这些组织手段。"
  "AI 的介入点有三处：自动摘要、自动打标与互链、对全库提问。坑：自动打标一旦不准，用户就不再信任"
  "标签体系，宁可让他手动确认——准确率不到八成时，建议比自动更合适。",
  {"in": "笔记内容", "out": "标签 / 链接 / 摘要"},
  [P("siyuan", "思源笔记 / Obsidian", "oss", "AGPL-3.0", "siyuan-note/siyuan",
     note="本地优先、双链与块引用成熟，可直接嵌"),
   P("notion-ai", "Notion AI", "commercial", note="协作强，数据在云上"),
   AIB("ai-write", "AI 自己写", "5 天", "约 300 万",
       ["正文存 Markdown，元数据（标签/链接）单独存",
        "写入时异步跑摘要与关键词，不阻塞输入",
        "互链建议用向量相似度召回，只给 3 条候选",
        "检索走全文 + 向量混合，中文要配分词"],
       "笔记产品的胜负在输入体验，AI 只能加速整理")])

C("ai.office.ocr", "文档识别", "module", "ai.office",
  "扫描件、公式、表格、手写——把图变成结构化文本",
  "三档难度：印刷体（成熟）、表格（要还原行列合并）、公式与手写（仍在进步）。关键决定是「要不要保留"
  "版面坐标」：只出纯文本，后面没法做对照高亮；保留坐标才能点原文定位。"
  "坑：低质量扫描先做去噪与纠偏，否则识别率暴跌。",
  {"in": "图片 / PDF 扫描件", "out": "结构化文本 + 坐标"},
  [P("paddleocr", "PaddleOCR", "oss", "Apache-2.0", "PaddlePaddle/PaddleOCR",
     note="中文与表格最实用，可离线"),
   P("docling-ocr", "Docling", "oss", "MIT", "docling-project/docling",
     note="版面还原好，能出 Markdown 与坐标"),
   P("mathpix", "Mathpix", "commercial", note="公式识别最强，按页收费"),
   AIB("ai-write", "AI 自己写", "6 天", "约 400 万",
       ["预处理：灰度、二值化、透视矫正、去噪",
        "版面分析先切块（段落/表格/图），别整页硬识别",
        "表格单独走单元格检测 + 行列还原",
        "输出带 bbox，前端用坐标做「点文字高亮原图」"],
       "不保留坐标就没有产品价值，只是又一个复制粘贴")])

# ============================================================ 视觉设计
C("ai.design.layout", "版式与海报", "module", "ai.design",
  "模板 + 素材位 + 自适应排版",
  "核心是「约束」：文字长度不定、图片比例不定，排版要自适应而不是靠模型想象坐标。做法是模板里定义"
  "弹性容器，AI 只负责选模板与填内容。坑：让模型直接输出绝对坐标，换个字号就全糊在一起。"
  "不需要它的场合：发朋友圈的一张图，用现成模板改字即可。",
  {"in": "文案 + 素材 + 场景", "out": "可编辑的版式"},
  [P("penpot", "Penpot", "oss", "MPL-2.0", "penpot/penpot",
     note="开源设计工具，模板与组件体系可直接用"),
   P("canva", "Canva / 稿定", "commercial", note="模板海量，商用授权清楚"),
   AIB("ai-write", "AI 自己写", "7 天", "约 500 万",
       ["模板 DSL：绝对定位 + 弹性容器两种节点",
        "AI 只输出「选哪个模板 + 每格填什么」，不输出坐标",
        "渲染后按文本实际高度回流，超出则缩字号或换模板",
        "导出 PNG / PDF，字体预置，缺字要显式报错"],
       "让模型碰坐标的设计工具，最终都死在换行上")])

C("ai.design.brand", "品牌与标识", "module", "ai.design",
  "Logo、配色、字体、VI 规范",
  "生成 Logo 只是第一步，真正的交付是「一套能落地的规范」：主色/辅色/禁用组合、最小尺寸、深浅底版本。"
  "技术上要出矢量（SVG）而不是位图，否则放大会糊。坑：生成结果常撞已有商标，商用前必须查重，"
  "产品里要明确提示——这既是法律风险也是口碑风险。",
  {"in": "品牌名 + 行业 + 气质", "out": "SVG 标识 + 配色规范"},
  [P("svg-mark", "SVG 生成 + 字体轮廓", "pattern",
     note="模型出构图描述，SVG 模板渲染，可无损缩放"),
   P("looka", "Looka / Logoai", "commercial", note="打包输出 VI 与商用授权"),
   AIB("ai-write", "AI 自己写", "5 天", "约 400 万",
       ["先定三件事：气质关键词、行业禁忌、名字长度",
        "生成构图描述（几何/字母/图形），不直接出图",
        "用 SVG 基本图形拼装，字体转轮廓，输出可编辑矢量",
        "自动衍生：横版/竖版/单色/深底，附最小尺寸与留白规范"],
       "交付规范比交付图形值钱，这是和出图工具的分界")])

# ============================================================ 智能体扩展
C("ai.agent.multi", "多智能体协同", "module", "ai.agent",
  "角色分工、消息传递、汇总收敛",
  "大多数「多智能体」只是把一件事拆给几个角色轮流说，收益远小于宣传。真有用的场景是「互相审」："
  "一个写、一个挑错、一个裁决，比单模型自检有效。坑：轮数不设上限会无限互夸，必须给终止条件与预算；"
  "消息全量广播会让上下文爆炸，要按角色裁剪。不需要它的场合：任务能一次做完。",
  {"in": "任务 + 角色定义", "out": "收敛后的产物"},
  [P("autogen", "AutoGen / CrewAI", "oss", "MIT", "microsoft/autogen",
     note="现成编排框架，先跑通再谈优化"),
   P("role-loop", "角色轮转 + 裁决", "pattern",
     note="三角色 + 最大轮数 + token 预算，最省且可控"),
   AIB("ai-write", "AI 自己写", "5 天", "约 350 万",
       ["角色 = 系统提示 + 可见消息范围，不是新模型",
        "消息按角色裁剪：审稿人只看稿，不看过程",
        "终止条件三选一：轮数上限 / 预算上限 / 裁决通过",
        "全过程落盘可回放，否则出问题无法定位"],
       "多智能体的价值在审，不在分工")])

C("ai.agent.browser", "浏览器自动化", "module", "ai.agent",
  "打开网页、点、填、读——让 Agent 操作真实浏览器",
  "两条路线：选择器驱动（稳但每个站要写适配）与视觉驱动（通用但慢且贵）。生产上通常混合：先走 DOM，"
  "找不到再截图给多模态模型判断。坑：登录态与验证码是绕不过的墙，产品要留人工接管；页面一改脚本就废，"
  "必须能自愈或至少能告警。",
  {"in": "目标 + 起始 URL", "out": "抓到的数据 / 办完的事"},
  [P("playwright", "Playwright", "oss", "Apache-2.0", "microsoft/playwright",
     note="最稳的底层，可录制回放，调试友好"),
   P("browser-use", "browser-use", "oss", "MIT", "browser-use/browser-use",
     note="LLM 驱动，省适配；慢且贵，适合长尾站点"),
   AIB("ai-write", "AI 自己写", "8 天", "约 600 万",
       ["先抽 DOM 结构给模型看（精简后），不给截图",
        "动作空间限定：click / type / scroll / extract",
        "每步执行后校验页面是否变化，无变化则重试或换选择器",
        "登录态用持久化 profile，遇验证码暂停等人工"],
       "最贵的不是识别，是页面改版后的运维")])

C("ai.agent.computer", "桌面操作", "module", "ai.agent",
  "看屏幕、动鼠标键盘——操作没有 API 的软件",
  "比浏览器自动化更脆：分辨率、缩放、弹窗都会影响识别。做法是「截图 → 定位元素 → 执行 → 再截图校验」，"
  "每步都能回退。坑：误点会造成真实损失（删文件、转账），必须设高危操作确认与沙箱；速度也慢，"
  "不适合高频任务。不需要它的场合：目标软件有 API 或命令行。",
  {"in": "任务描述", "out": "操作序列 + 结果截图"},
  [P("pyautogui", "pyautogui + 截图", "oss", "BSD-3-Clause", "asweigart/pyautogui",
     note="最原始但够用，校验逻辑要自己写"),
   P("open-interpreter", "Open Interpreter", "oss", "AGPL-3.0", "OpenInterpreter/open-interpreter",
     note="自然语言驱动本机，方便与风险同源"),
   P("yingdao", "影刀 RPA", "commercial", note="企业级，流程录制与异常处理成熟"),
   AIB("ai-write", "AI 自己写", "10 天", "约 800 万",
       ["截图 → 用视觉模型输出可点区域（带坐标与文字）",
        "动作前二次确认：高危操作（删除/支付/发送）必须人工点",
        "每步执行后截图比对，失败回退到上一步",
        "全程录屏留证，出事能复盘"],
       "这类产品的成本不在模型，在异常处理与责任边界")])

C("ai.agent.support", "客服与坐席", "module", "ai.agent",
  "多渠道接入、知识回答、转人工",
  "技术上不难，难在「不知道就得转」：答错的成本远高于不答。必须做三件事：置信度阈值、知识缺口回收"
  "（把没答上的问题聚成工单）、人工接管时的上下文传递。坑：一上来就全自动，客户被绕三圈会投诉；"
  "先做「草稿建议」让坐席确认，效果好得多。",
  {"in": "用户消息 + 知识库", "out": "回复 / 转人工"},
  [P("chatwoot", "Chatwoot + RAG", "oss", "MIT", "chatwoot/chatwoot",
     note="开源客服台，接知识库与多渠道"),
   P("zendesk-ai", "Zendesk AI / 网易七鱼", "commercial", note="坐席体系成熟，按坐席收费"),
   AIB("ai-write", "AI 自己写", "7 天", "约 500 万",
       ["先算检索置信度，低于阈值直接转人工，不硬答",
        "答必带出处，坐席可一键引用或改写",
        "没答上的问题落库聚类，每周出知识缺口清单",
        "接管时把历史与用户画像一并递给坐席"],
       "「不会就说不会」是唯一能上线的策略")])

C("ai.agent.research", "深度研究", "module", "ai.agent",
  "多轮检索 → 交叉验证 → 带引用的报告",
  "和普通问答的差别是「先规划再搜」：拆子问题、每个子问题独立检索、按来源可信度加权、最后组织成报告。"
  "坑：不去重会反复引用同一篇稿子的多个转载；不做时间过滤会把旧闻当新闻。引用的每条都要能点回原文，"
  "否则没人信。不需要它的场合：一个问题一两段能答完。",
  {"in": "研究问题", "out": "带引用的报告"},
  [P("open-deep-research", "open_deep_research", "oss", "MIT",
     "langchain-ai/open_deep_research", note="开源实现，含计划-检索-写作三段"),
   P("deep-research-api", "OpenAI / Gemini Deep Research", "commercial",
     note="开箱效果好，按次收费且过程不可控"),
   AIB("ai-write", "AI 自己写", "8 天", "约 600 万",
       ["拆子问题：3–6 个可独立检索的问句",
        "每问独立检索，按域名去重 + 按时间过滤",
        "交叉验证：同一结论需 ≥2 个独立来源，否则标「单一来源」",
        "写作阶段只允许用检索到的片段，引用编号回链"],
       "可信度全靠「单一来源」敢不敢标出来")])

# ============================================================ 模型侧
C("ai.model.finetune", "微调训练", "module", "ai.model",
  "LoRA / SFT：让小模型在特定任务上超过大模型",
  "先问「提示词够不够」——八成需求靠 few-shot 就解决了，微调是最后一招。真要做，LoRA 是默认选择"
  "（单卡可跑、多套适配器可热切）。坑：数据质量决定一切，500 条干净样本胜过 5 万条脏数据；"
  "必须留评测集，否则不知道是变好还是过拟合。",
  {"in": "样本集 + 基座模型", "out": "适配器权重 + 评测报告"},
  [P("llamafactory", "LLaMA-Factory", "oss", "Apache-2.0", "hiyouga/LLaMA-Factory",
     note="一条命令跑 LoRA，覆盖主流开源模型"),
   P("openai-ft", "OpenAI 微调 API", "commercial", note="不用管显卡，按 token 计费"),
   AIB("ai-write", "AI 自己写", "6 天", "约 400 万",
       ["样本清洗：去重、去模板化、统一格式（JSONL）",
        "切分训练/验证/测试，测试集全程不参与调参",
        "LoRA 超参从小开始（r=8），先跑 1 epoch 看曲线",
        "上线前做 A/B：微调模型 vs 提示词方案，同题同评"],
       "没有评测集就不要微调，那是在赌")])

C("ai.model.host", "模型托管", "module", "ai.model",
  "把模型变成稳定的 HTTP 服务：并发、限流、计费",
  "和 ai.model.local 的分界：那边是「在我机器上跑起来」，这边是「对外提供不崩的服务」。要处理并发批处理、"
  "显存不足时排队、多模型热切换、按 key 计费。坑：单卡跑多个模型会互相挤显存，必须做模型驱逐策略，"
  "否则第一个请求就把服务打崩。",
  {"in": "模型权重 + 请求", "out": "OpenAI 兼容响应"},
  [P("vllm-host", "vLLM", "oss", "Apache-2.0", "vllm-project/vllm",
     note="吞吐最高，OpenAI 兼容接口，生产首选"),
   P("ollama-host", "Ollama", "oss", "MIT", "ollama/ollama",
     note="部署最省事，并发弱，适合个人与小团队"),
   P("openrouter", "OpenRouter / 阿里云百炼", "commercial", note="不用运维，按量付费"),
   AIB("ai-write", "AI 自己写", "5 天", "约 300 万",
       ["统一入口：/v1/chat/completions，多后端按名字路由",
        "排队与超时：按显存预留做准入，满了返回 429 而非排队",
        "流式转发要处理中断，客户端断开要立刻释放显存",
        "按 key 记账 token，日结；无记账就没法定价"],
       "别自研推理引擎，包一层调度就够")])

# ============================================================ 图像/视频/音频扩展
C("ai.media.edit", "图像编辑", "module", "ai.media",
  "抠图、消除、修复、扩图、超分",
  "这类需求的共同点是「局部改、其余不动」，所以技术上走 inpainting / matting 而不是整图重绘。"
  "抠图看边缘发丝，消除看接缝，超分看文字是否糊。坑：一键处理链式叠加会让画质雪崩，"
  "每步都要保留原图可回退。不需要它的场合：整张换风格，那归 ai.media.image。",
  {"in": "原图 + 蒙版 + 指令", "out": "改好的图"},
  [P("iopaint", "IOPaint", "oss", "Apache-2.0", "Sanster/IOPaint",
     note="消除与修复一体，可本地跑"),
   P("comfy-edit", "ComfyUI 工作流", "oss", "GPL-3.0", "comfyanonymous/ComfyUI",
     note="复杂编辑用节点拼，灵活但门槛高"),
   P("ps-genfill", "Photoshop 生成式填充", "commercial", note="接缝最自然，按订阅"),
   AIB("ai-write", "AI 自己写", "6 天", "约 450 万",
       ["蒙版交互先行：画笔/自动分割/文字定位",
        "编辑只处理蒙版区域，边缘做羽化融合",
        "每步存历史，支持回到任意一步（无损）",
        "导出前做一次整体观感检查，避免拼接痕"],
       "编辑类产品七成体验在蒙版，不在模型")])

C("ai.media.portrait", "人像与写真", "module", "ai.media",
  "换脸、写真、证件照、修复老照片",
  "技术上靠「身份保持」：把参考脸编码进生成过程。产品上必须处理两件事：肖像权提示（未经同意换脸是侵权）、"
  "以及「像不像」的预期管理——太像会恐怖谷，不像则没用。证件照还要满足尺寸与背景规范，"
  "这是能落地的差异点。",
  {"in": "人脸参考图 + 风格", "out": "人像图"},
  [P("instantid", "InstantID / PuLID", "oss", "Apache-2.0", "instantX-research/InstantID",
     note="单图保身份，效果稳，可本地跑"),
   P("remini", "Remini / 美图", "commercial", note="修复与增强效果最好，闭源"),
   AIB("ai-write", "AI 自己写", "7 天", "约 500 万",
       ["人脸检测 + 对齐，取身份 embedding",
        "生成时按身份向量约束，风格另走 LoRA",
        "修老照片先做划痕/噪点修复，再做人脸增强",
        "证件照按规范裁切换底，输出多尺寸"],
       "合规提示不是免责声明，是产品的一部分")])

C("ai.media.avatar", "数字人", "module", "ai.media",
  "一张照片 + 一段音频 → 会说话的视频",
  "三条路线：唇形同步（便宜、只动嘴）、半身驱动（要视频素材）、全生成（贵）。选型看用途：口播课程用"
  "唇形同步就够，品牌代言才需要全生成。坑：中文口型对齐比英文难；长音频要分段渲染再拼接，"
  "否则口型越到后面越漂。",
  {"in": "人像/视频 + 音频", "out": "口播视频"},
  [P("sadtalker", "SadTalker", "oss", "Apache-2.0", "OpenTalker/SadTalker",
     note="照片驱动，开源可跑，质量中等"),
   P("heygen", "HeyGen / 硅基智能", "commercial", note="商用质量，按分钟计费"),
   AIB("ai-write", "AI 自己写", "10 天", "约 700 万",
       ["音频先切句，逐句渲染再拼，抵消累积漂移",
        "口型以音素为单位对齐，中文需拼音-音素映射表",
        "头部姿态做随机微动，否则像遗像",
        "合成后统一色彩与锐度，避免拼接处跳变"],
       "分段渲染是必须的，整段渲染必漂")])

C("ai.media.clip", "视频剪辑", "module", "ai.media",
  "自动切片、去静音、加字幕、配乐对轴",
  "短视频的核心需求是「从长素材里挑高光」：靠语音转写 + 画面变化 + 音量峰值出候选，再让模型按主题排序。"
  "坑：最容易毁在字幕时间轴上——ASR 时间戳有偏差，必须做对齐校正，否则字幕越到后面越飘。"
  "不需要它的场合：只是裁头去尾，用剪映手拖更快。",
  {"in": "长视频 + 目标时长", "out": "成片 + 字幕"},
  [P("ffmpeg", "FFmpeg + auto-editor", "oss", "LGPL-2.1", "FFmpeg/FFmpeg",
     note="切、拼、压全包，静音检测现成"),
   P("jianying", "剪映 / Descript", "commercial", note="字幕与模板成熟，编辑体验好"),
   AIB("ai-write", "AI 自己写", "8 天", "约 550 万",
       ["转写拿词级时间戳，作为所有切点的基准",
        "候选片段：静音切除 + 语义完整句 + 情绪峰值",
        "字幕用词级时间戳做行级重排，逐行校正偏移",
        "渲染走 FFmpeg 滤镜链，别用逐帧合成（太慢）"],
       "字幕对不齐是用户流失的第一原因")])

C("ai.media.transcribe", "语音转写", "module", "ai.media",
  "音频 → 带时间戳与说话人的文字",
  "中文场景优先 FunASR 或 Whisper 微调版。真正影响可用性的是三件事：时间戳精度（决定字幕能不能用）、"
  "标点与断句（决定可读性）、热词表（人名、型号）。坑：背景音乐与人声重叠时识别率骤降，"
  "先做分离再转写。",
  {"in": "音频 / 视频", "out": "带时间戳的文本"},
  [P("whisper", "Whisper", "oss", "MIT", "openai/whisper",
     note="多语种，时间戳准；中文用 large-v3"),
   P("funasr", "FunASR", "oss", "MIT", "modelscope/FunASR",
     note="中文标点与热词更好，可离线"),
   P("xfyun-asr", "讯飞听见", "commercial", note="中文行业词识别强"),
   AIB("ai-write", "AI 自己写", "5 天", "约 350 万",
       ["先做 VAD 切句，长音频按静音切块并行识别",
        "热词表注入：解码时给偏置，比事后纠错有效",
        "标点用独立模型补，不要指望 ASR 自带",
        "输出 SRT 前做一次时间轴单调性校验"],
       "时间戳不准，后面所有功能都白做")])

C("ai.media.clone", "声音克隆", "module", "ai.media",
  "几秒样本复刻音色，再让它说任何话",
  "门槛已经很低（GPT-SoVITS 几分钟出效果），所以产品风险主要在合规：必须做声纹授权确认与生成内容标识。"
  "技术上的取舍是「像」与「稳」：少样本更像但会破音，多样本更稳但要几分钟素材。"
  "不需要它的场合：只要一个好听的声音，用现成音色库。",
  {"in": "参考音频 + 文本", "out": "合成语音"},
  [P("gpt-sovits", "GPT-SoVITS", "oss", "MIT", "RVC-Boss/GPT-SoVITS",
     note="少样本效果好，社区活跃"),
   P("cosyvoice", "CosyVoice", "oss", "Apache-2.0", "FunAudioLLM/CosyVoice",
     note="中文自然度高，支持指令控制"),
   P("elevenlabs", "ElevenLabs", "commercial", note="多语种最自然，按字符计费"),
   AIB("ai-write", "AI 自己写", "8 天", "约 600 万",
       ["参考音频做降噪与切片，取 3–10 秒干净片段",
        "训练/推理分离：先出音色 embedding，再合成",
        "长文本按句切，保持韵律连贯（带上一句末尾）",
        "输出加不可听水印，用于追溯生成内容"],
       "合规比技术难，别把声纹授权做成勾选框")])

C("ai.media.clean", "音频修复", "module", "ai.media",
  "降噪、去混响、分离人声与伴奏",
  "三类问题三套算法：稳态噪声（风扇、电流）用谱减法，混响用去卷积，人声/伴奏分离用源分离模型。"
  "产品上常见错误是「一键增强」把齿音也放大，听感更差——应该给强度档位并允许 A/B 对比。"
  "不需要它的场合：录音本来就干净。",
  {"in": "音频", "out": "干净音频 / 分离音轨"},
  [P("demucs", "Demucs", "oss", "MIT", "facebookresearch/demucs",
     note="人声分离效果好，可离线"),
   P("adobe-enhance", "Adobe Podcast Enhance", "commercial", note="一键惊艳，但不可细调"),
   AIB("ai-write", "AI 自己写", "5 天", "约 300 万",
       ["先判类型：稳态噪声 / 混响 / 重叠人声，走不同分支",
        "分离用预训练源分离模型，别自己训",
        "处理前后做波形与频谱对比，让用户听得见差别",
        "给强度档位，默认中档，避免过度处理"],
       "过度降噪比不降噪更难听")])

C("ai.media.3d", "三维生成", "module", "ai.media",
  "文字/图片 → 网格模型，可直接进引擎",
  "现在的输出多是不带骨骼的静态网格，贴图靠烘焙。落地要检查两件事：拓扑是否可编辑（三角面乱到没法改）、"
  "是否带 UV。坑：生成速度与质量强相关，几十秒出的模型只能当草模；商用还要看训练数据授权。"
  "不需要它的场合：只需要一个示意模型，去素材站下更快。",
  {"in": "图 / 文字描述", "out": "glb 网格"},
  [P("triposr", "TripoSR", "oss", "MIT", "VAST-AI-Research/TripoSR",
     note="单图出网格，几秒，适合草模"),
   P("tripo", "Tripo / Meshy", "commercial", note="质量高，有 API，按次收费"),
   AIB("ai-write", "AI 自己写", "12 天", "约 900 万",
       ["图像先做前景分割，背景会污染重建",
        "走隐式场重建再提网格（marching cubes）",
        "减面 + 重拓扑，否则三角面没法编辑",
        "自动 UV 展开 + 烘焙贴图，导出 glb"],
       "重拓扑决定模型能不能进生产管线")])

# ============================================================ 提示词
C("ai.prompt.lib", "提示词库", "module", "ai.prompt",
  "模板、变量、版本、复用",
  "最小可用形态是「YAML 文件 + 变量占位 + git 版本」，比任何平台都可靠。上平台的价值在多环境、灰度回滚、"
  "以及非工程师也能改。坑：提示词存数据库却没做版本，改坏了无法回退，线上效果会莫名漂移——"
  "这类事故排查起来极慢，因为代码没变。",
  {"in": "提示词文本 + 变量", "out": "渲染后的 prompt"},
  [P("yaml-git", "YAML + git", "pattern",
     note="零依赖，可 review 可回滚，小团队最省"),
   P("langfuse", "Langfuse", "oss", "MIT", "langfuse/langfuse",
     note="提示词版本 + 调用追踪一体"),
   AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
       ["一条提示词一个文件，frontmatter 存变量与模型参数",
        "渲染器：变量缺失直接抛错，别用空串兜底",
        "版本 = git commit，生产引用 tag 而非分支",
        "每次调用记录 prompt 版本号，出问题能追到具体版本"],
       "核心是版本，不是编辑界面")])

C("ai.prompt.optimize", "提示词优化", "module", "ai.prompt",
  "让模型改写提示词，并用评测集验证是否真的更好",
  "只改不测等于玄学。正确链路：准备 20–50 条带期望输出的样例 → 自动改写候选 → 逐条跑分 → 只保留提升的版本。"
  "坑：优化目标写成「更详细」会把提示词膨胀到几千字，成本上升而效果不变；必须同时约束长度。"
  "不需要它的场合：只写一条提示词，手工试几版更快。",
  {"in": "原提示词 + 评测集", "out": "更优提示词 + 分数"},
  [P("dspy", "DSPy", "oss", "MIT", "stanfordnlp/dspy",
     note="把提示词当参数自动搜，前提是有评测集"),
   P("optimize-loop", "改写 + 跑分 + 保留最优", "pattern",
     note="不引框架，一个脚本就能跑"),
   AIB("ai-write", "AI 自己写", "4 天", "约 250 万",
       ["评测集先行：输入 + 期望输出 + 评分方式（规则或 LLM 评）",
        "每次只改一处（结构/示例/措辞），便于归因",
        "同集跑分，保留提升且长度增幅 <20% 的版本",
        "记录失败案例，作为下一轮改写的输入"],
       "没有评测集的「优化」只是换了个说法")])

# ============================================================ 检测
C("ai.detect.aigc", "AIGC 检测与降 AI", "module", "ai.detect",
  "判断机器文本，或把机器文本改得像人写",
  "检测靠统计特征（困惑度、句长方差、词频分布），所以改写确实能降分，但这是对抗而非真伪判断——"
  "同一段话换个模型重写，分数就变。产品上不能承诺「必过」，也不该把检测结果当学术不端证据。"
  "真正可持续的用法是「辅助自查」：给出可疑段落，让人判断。",
  {"in": "文本", "out": "可疑度评分 + 段落定位"},
  [P("binoculars", "Binoculars", "oss", "MIT", "ahans30/Binoculars",
     note="开源检测，需本地模型，可复现"),
   P("gptzero", "GPTZero / 睿信", "commercial", note="商用 API，各机构采信度不一"),
   AIB("ai-write", "AI 自己写", "5 天", "约 300 万",
       ["按段落打分而不是整篇，整篇分数没有指导意义",
        "特征：困惑度、句长分布、连接词密度、重复 n-gram",
        "给「可疑段落」并解释依据，不直接下结论",
        "降 AI 走独立链路：改写 + 人工确认，明确告知不可保证"],
       "把「不确定」说清楚，比给一个 98% 更专业")])

# ============================================================ 检索
C("ai.search.engine", "搜索聚合", "module", "ai.search",
  "元搜索、垂直检索、结果去重与排序",
  "三种做法：聚合别人的结果（快但受制于人）、自建索引（准但要养爬虫）、调商用 API（省事但贵）。"
  "产品上真正的差异在排序与去重：同一篇稿被十家转载，不合并等于只有一条结果。"
  "坑：中文不做分词与同义词，召回率会很难看。不需要它的场合：站内几百条内容，数据库 LIKE 就够。",
  {"in": "查询", "out": "排序后的结果 + 来源"},
  [P("searxng", "SearXNG", "oss", "AGPL-3.0", "searxng/searxng",
     note="元搜索，不依赖商业 API，结果要自己清洗"),
   P("meilisearch", "Meilisearch", "oss", "MIT", "meilisearch/meilisearch",
     note="自建索引，中文需配分词器"),
   P("exa", "Exa / AlphaSense", "commercial", note="语义检索质量高，按次计费"),
   AIB("ai-write", "AI 自己写", "7 天", "约 500 万",
       ["抓取 → 正文提取 → 去重（SimHash）→ 建倒排",
        "查询侧：分词 + 同义词扩展 + 拼写纠正",
        "排序融合：BM25 + 向量 + 站点权重（RRF 合并）",
        "聚合页做「同事件归并」，别让十条转载占满首屏"],
       "去重与排序决定体感，抓取只是体力活")])

# ============================================================ 角色陪伴
C("ai.chat.persona", "角色与陪伴", "module", "ai.chat",
  "人设、语气、长期关系记忆",
  "和普通对话的差别是「不能出戏」：要稳定口吻、有边界（不越界、不崩人设）、跨会话记得关系进展。"
  "技术上靠系统提示 + 人设卡 + 记忆检索三件套。坑：过度顺从会让角色变成应声虫，必须写「拒绝与分歧」"
  "的规则，否则聊三天就腻。不需要它的场合：工具型对话，别加人设。",
  {"in": "用户消息 + 人设 + 关系记忆", "out": "符合人设的回复"},
  [P("sillytavern-persona", "SillyTavern 角色卡", "oss", "AGPL-3.0", "SillyTavern/SillyTavern",
     note="人设卡格式已成事实标准，可直接兼容"),
   P("replika", "Replika / 星野", "commercial", note="产品化最成熟，含情感设计"),
   AIB("ai-write", "AI 自己写", "5 天", "约 350 万",
       ["人设卡结构化：身份、语气、禁忌、关系阶段",
        "记忆分三层：事实、事件、情绪，分别检索",
        "每轮取最相关的 3–5 条记忆，别全塞",
        "写「拒绝与分歧」规则，避免变成应声虫"],
       "人设能不能立住，取决于它敢不敢说不")])

# ============================================================ 组合规则
# 分类 → 基线模块（这些几乎必然存在）
BASE = {
    "ai-writing-tools": ["ai.model.gateway"],
    "ai-image-tools": [],
    "ai-video-tools": ["ai.media.video"],
    "ai-office-tools": [],
    "ai-agent": ["ai.agent.loop", "ai.agent.tool", "ai.model.gateway"],
    "ai-chatbots": ["ai.chat.core", "ai.model.gateway"],
    "ai-programming-tools": ["ai.agent.loop", "ai.model.gateway"],
    "ai-design-tools": ["ai.design.layout"],
    "ai-audio-tools": [],
    "ai-search-engines": ["ai.search.engine"],
    "ai-frameworks": ["ai.model.gateway"],
    "ai-models": ["ai.model.host"],
    "ai-content-detection-and-optimization-tools": ["ai.detect.aigc"],
    "ai-prompt-tools": ["ai.prompt.lib"],
}

# 兜底：规则一个都没命中时按分类给一格，保证 composes ≥ 2
FALLBACK = {
    "ai-writing-tools": "ai.text.long",
    "ai-image-tools": "ai.media.image",
    "ai-video-tools": "ai.media.video",
    "ai-office-tools": "ai.media.doc",
    "ai-agent": "ai.agent.plan",
    "ai-chatbots": "ai.chat.persona",
    "ai-programming-tools": "dev.code.edit",
    "ai-design-tools": "ai.media.image",
    "ai-audio-tools": "ai.media.voice",
    "ai-search-engines": "ai.agent.research",
    "ai-frameworks": "kb.rag",
    "ai-models": "ai.model.gateway",
    "ai-content-detection-and-optimization-tools": "ai.text.rewrite",
    "ai-prompt-tools": "ai.prompt.optimize",
}

# 关键词 → 模块。强词命中即定案，弱词要凑够两个才算——「品牌」出现在任何文案里，
# 「品牌设计」才说明它真做标识；不分两级，规则会把整库涂成同一片。
RULES = [
    ("ai.text.fiction", ["小说", "网文", "短剧", "剧本创作", "分镜", "人物设定", "章节生成", "故事创作"],
     ["剧本", "故事", "人设", "角色设定"]),
    ("ai.text.long", ["论文写作", "论文生成", "长文写作", "万字", "学术写作", "文献综述", "开题报告"],
     ["论文", "学术", "长文", "文章生成"]),
    ("ai.text.copy", ["营销文案", "种草", "电商文案", "广告文案", "小红书文案", "卖点", "商品描述"],
     ["文案", "标题", "营销"]),
    ("ai.text.translate", ["翻译", "同传", "双语对照", "译制", "术语表"],
     ["多语言", "本地化"]),
    ("ai.text.rewrite", ["降AI", "降 AIGC", "降重", "查重", "润色", "改写", "语法检查", "拼写检查"],
     ["语法纠错", "句子重写"]),
    ("ai.text.summary", ["摘要", "纪要", "提炼要点", "信息抽取"],
     ["总结", "要点"]),
    ("ai.media.edit", ["抠图", "消除", "去水印", "超分", "变清晰", "扩图", "擦除", "换背景", "老照片修复"],
     ["修复", "修图", "美化"]),
    ("ai.media.portrait", ["写真", "换脸", "证件照", "形象照"],
     ["人像"]),
    ("ai.media.image", ["文生图", "绘画生成", "图像生成", "生成图片", "插画生成", "出图"],
     ["绘图", "画图", "插画"]),
    ("ai.media.video", ["文生视频", "图生视频", "视频生成", "生成视频"],
     ["短视频"]),
    ("ai.media.clip", ["剪辑", "切片", "混剪", "卡点", "去静音", "加字幕"],
     ["成片"]),
    ("ai.media.avatar", ["数字人", "口播", "虚拟主播", "唇形"],
     ["虚拟形象"]),
    ("ai.media.transcribe", ["转写", "转录", "语音识别", "听写", "录音转文字", "字幕生成"],
     ["扒谱"]),
    ("ai.media.voice", ["配音", "语音合成", "TTS", "声音克隆", "声音复刻", "变声"],
     ["朗读"]),
    ("ai.media.music", ["作曲", "编曲", "音乐生成", "配乐", "作词"],
     ["BGM"]),
    ("ai.media.clean", ["降噪", "去混响", "人声分离", "伴奏分离", "音频修复"],
     ["音质"]),
    ("ai.media.3d", ["3D 建模", "三维建模", "文生3D", "图生3D", "三维生成", "3D模型生成"],
     ["3D", "建模", "贴图"]),
    ("ai.media.doc", ["PPT生成", "演示文稿", "幻灯片", "Word 文档", "报告生成", "文档生成"],
     ["PPT"]),
    ("ai.office.sheet", ["表格", "Excel", "数据透视", "公式生成", "数据分析", "CSV"],
     ["图表"]),
    ("ai.office.meeting", ["会议记录", "会议纪要", "录音整理", "待办"],
     ["会议", "访谈"]),
    ("ai.office.mindmap", ["思维导图", "脑图", "大纲生成"],
     ["知识图谱"]),
    ("ai.office.resume", ["简历", "求职", "面试", "招聘"],
     ["JD"]),
    ("ai.office.note", ["笔记", "双链", "剪藏", "知识管理"],
     ["收藏"]),
    ("ai.office.ocr", ["OCR", "文字识别", "公式识别", "扫描件", "手写识别"],
     ["扫描"]),
    ("ai.design.layout", ["海报", "Banner", "版式", "排版", "主图", "商品图", "电商设计"],
     []),
    ("ai.design.brand", ["Logo", "标志设计", "VI 设计", "品牌设计", "品牌视觉"],
     []),
    ("ai.agent.multi", ["多智能体", "多 Agent", "智能体协作", "多角色协作"],
     ["团队协作"]),
    ("ai.agent.browser", ["浏览器自动化", "网页操作", "自动点击", "网页抓取", "爬虫"],
     ["浏览器"]),
    ("ai.agent.computer", ["桌面操作", "操作电脑", "鼠标键盘", "RPA", "本机操作"],
     ["桌面"]),
    ("ai.agent.support", ["客服", "坐席", "工单", "售后"],
     ["客户支持"]),
    ("ai.agent.research", ["深度研究", "研报", "行业研究", "竞品分析", "研究报告"],
     ["调研"]),
    ("ai.agent.search", ["联网搜索", "搜索增强", "实时信息", "网页检索"],
     ["联网"]),
    ("ai.agent.mcp", ["MCP"], []),
    ("ai.agent.plan", ["任务规划", "任务分解", "自动规划", "步骤拆解"], []),
    ("ai.agent.skill", ["技能", "插件市场", "自定义技能"], []),
    ("ai.model.finetune", ["微调", "LoRA", "SFT", "模型定制", "训练模型"], []),
    ("ai.model.local", ["本地部署", "离线运行", "私有化部署", "本地模型", "显存"], []),
    ("ai.model.gateway", ["多模型", "模型切换", "API 聚合", "模型路由"],
     ["统一接口", "网关"]),
    ("kb.rag", ["知识库", "RAG", "检索增强", "文档问答", "企业知识库"],
     ["问答"]),
    ("kb.ingest", ["文档上传", "导入文档", "解析 PDF", "批量导入"], []),
    ("ai.flow.canvas", ["工作流编排", "可视化编排", "拖拽节点", "画布"],
     ["工作流"]),
    ("ai.flow.trigger", ["定时任务", "触发器", "Webhook", "定时触发"],
     ["自动运行"]),
    ("dev.code.complete", ["代码补全", "行内补全"], []),
    ("dev.code.edit", ["代码生成", "自然语言建站", "重构代码", "写代码"],
     ["重构"]),
    ("dev.code.index", ["代码库索引", "仓库索引", "代码检索", "上下文工程"], []),
    ("ai.prompt.lib", ["提示词库", "提示词模板", "提示词管理", "提示词市场"], []),
    ("ai.prompt.optimize", ["提示词优化", "提示词自动优化"], []),
    ("ai.chat.persona", ["角色扮演", "虚拟伴侣", "情感陪伴", "人设"],
     ["陪伴"]),
    ("ai.chat.memory", ["长期记忆", "记忆功能", "记住用户", "跨会话记忆"], []),
    ("ai.chat.multimodal", ["多模态", "识图", "图片理解", "看图说话", "文件解析"],
     ["文件上传"]),
    ("ai.deliver.channel", ["微信公众号", "企业微信", "钉钉", "飞书", "多渠道接入"],
     ["微信", "公众号"]),
    ("ai.deliver.publish", ["一键发布", "分享链接", "上线部署", "应用托管"],
     []),
]

CAT2PROD = {
    "ai-writing-tools": "app", "ai-image-tools": "app", "ai-video-tools": "app",
    "ai-audio-tools": "app", "ai-office-tools": "app", "ai-design-tools": "app",
    "ai-agent": "agent", "ai-chatbots": "app", "ai-programming-tools": "devtool",
    "ai-search-engines": "app", "ai-frameworks": "platform", "ai-models": "model",
    "ai-content-detection-and-optimization-tools": "app", "ai-prompt-tools": "tool",
}

MAXC = 8  # 一个软件最多挂 8 格：再多就不是拆解，是堆砌


def blob(it):
    """只喂功能清单与站方一句话。正文里的导航与「相关工具」会污染判断。"""
    return it["desc"] + " " + " ".join(it["feats"]) + " " + it["tip"]


# 分类 → 允许挂哪些域。没有这道闸，企业搜索会挂上「角色与陪伴」「小说与剧本」——
# 词面能对上，语义完全无关。规则只在自己的域里生效，跨域必须显式放行（EXTRA）。
CAT2DOM = {
    "ai-writing-tools": {"ai.text", "ai.chat", "ai.model", "ai.prompt", "kb", "ai.detect"},
    "ai-image-tools": {"ai.media", "ai.design", "ai.model"},
    "ai-video-tools": {"ai.media", "ai.text", "ai.model", "ai.deliver"},
    "ai-audio-tools": {"ai.media", "ai.text", "ai.model"},
    "ai-office-tools": {"ai.office", "ai.text", "kb", "ai.model", "ai.flow"},
    "ai-agent": {"ai.agent", "ai.flow", "ai.model", "kb", "ai.deliver"},
    "ai-chatbots": {"ai.chat", "ai.model", "kb", "ai.agent"},
    "ai-programming-tools": {"dev.code", "ai.agent", "ai.model", "ai.flow"},
    "ai-design-tools": {"ai.design", "ai.media", "ai.model"},
    "ai-search-engines": {"ai.search", "ai.agent", "kb", "ai.model"},
    "ai-frameworks": {"ai.model", "ai.flow", "ai.agent", "kb"},
    "ai-models": {"ai.model", "ai.agent"},
    "ai-content-detection-and-optimization-tools": {"ai.detect", "ai.text", "ai.model"},
    "ai-prompt-tools": {"ai.prompt", "ai.model", "ai.chat"},
}
# 跨域放行：办公产品会生成 PPT（属 ai.media）
EXTRA = {"ai-office-tools": {"ai.media.doc"}}


def domain_of(cid, idx):
    cur, hop = cid, 0
    while cur and hop < 6:
        p = idx.get(cur, {}).get("parent")
        if not p:
            return cur
        cur, hop = p, hop + 1
    return cid


DOMIDX = {c["id"]: c for c in base.COMPS}


def allowed(cid, cat):
    doms = CAT2DOM.get(cat, set())
    return domain_of(cid, DOMIDX) in doms or cid in EXTRA.get(cat, set())


def compose_of(it):
    text = blob(it)
    pick = [(cid, "must") for cid in BASE.get(it["cats"][0], [])]
    have = {c for c, _ in pick}
    hits = []
    cat = it["cats"][0]
    for cid, strong, weak in RULES:
        if cid in have or not allowed(cid, cat):
            continue
        ns = [w for w in strong if w in text]
        nw = [w for w in weak if w in text]
        if ns:
            hits.append((cid, "must", len(ns) * 2 + len(nw), len(ns)))
        elif nw:
            hits.append((cid, "optional", len(nw), 0))
    # 弱词只做补充，不升级：一个词出现在一段功能描述里，说明不了它真做了这格
    hits.sort(key=lambda x: (-x[3], -x[2], x[0]))
    n_opt = 0
    for cid, role, score, ns_n in hits:
        if role == "optional":
            if n_opt >= 2:
                continue
            n_opt += 1
        pick.append((cid, role))
        have.add(cid)
    # 剪到 MAXC：先保 must，再按顺序补 optional
    if len(pick) > MAXC:
        must = [x for x in pick if x[1] == "must"][:MAXC]
        rest = [x for x in pick if x[1] == "optional"][:max(0, MAXC - len(must))]
        pick = must + rest
    # 兜底两条：一条按分类，一条「这类产品必然调模型」——只有一格的东西不该进库
    for fb in (FALLBACK[it["cats"][0]], "ai.model.gateway"):
        if len(pick) >= 2:
            break
        if fb not in {c for c, _ in pick}:
            pick.append((fb, "must"))
    return pick


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    used = {p["id"] for p in base.PRODS} | {p["name"].lower() for p in base.PRODS}
    n = 0
    for it in data["items"]:
        pid = "ab" + it["id"]
        if pid in used or it["name"].lower() in used:
            continue
        composes = [(c, None, r) for c, r in compose_of(it)]
        cat = CAT2PROD.get(it["cats"][0], "app")
        S(pid, it["name"], cat, composes,
          license="未核", homepage=it["url"],
          tags=["aibot", it["cats"][0].replace("ai-", "").replace("-tools", "")],
          note=it["desc"] + "（模块按站方功能清单推断，未核源码与许可；来源 ai-bot.cn）")
        n += 1
    print("seed04：新增软件 %d" % n)


main()
