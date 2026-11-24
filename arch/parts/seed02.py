#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第二批：补 2 个模块（联网检索、文档生成）+ 10 个软件。"""
import seed01 as base
from seed01 import C, P, AIB, S

# ---------------- 新增模块 ----------------
C("ai.agent.search", "联网检索", "module", "ai.agent",
  "把外部实时信息拉进来，突破训练截止",
  "判断要不要它：答案需要「今天」的信息就必须有。做法分两类——自带索引的搜索引擎 API（贵但准），"
  "或自己抓（省但脏）。坑：抓回来的网页不截断直接塞上下文，一次就爆；还有去重，同一篇稿子被多家转载会"
  "重复占位。给模型看之前一定要先摘成 3–5 条要点。",
  {"in": "查询词", "out": "带来源的摘要"},
  [
    P("searxng", "SearXNG", "oss", "AGPL-3.0", "searxng/searxng",
      note="自建元搜索，不依赖商业 API，结果要自己清洗"),
    P("tavily", "Tavily / Brave Search API", "commercial", note="专为 LLM 优化，返回已摘好的片段"),
    P("metaso", "秘塔搜索", "commercial", note="中文语境好，有 API"),
    AIB("ai-write", "AI 自己写", "3 天", "约 200 万",
        ["查询改写：把口语问题变成 2–3 个检索式",
         "抓取后正文提取（readability 算法），丢导航与广告",
         "按域名去重 + 按内容相似度去重",
         "每条摘成 80 字要点并保留 URL，供引用"],
        "检索质量八成靠查询改写，不是靠换搜索源"),
  ])

C("ai.media.doc", "文档生成", "module", "ai.media",
  "生成 PPT、Word、表格这类结构化文件",
  "和「生成一段文字」的差别：要套模板、要排版、要素材位置正确。技术路线是「先出结构化大纲，再套模板渲染」，"
  "不要让模型直接吐 HTML/XML——格式必崩。坑：中文字体在服务端渲染经常缺字，必须预装字体；"
  "表格里的数字要能回溯来源，否则没法用。",
  {"in": "主题 + 素材", "out": "pptx / docx 文件"},
  [
    P("python-pptx", "python-pptx / docxtpl", "oss", "MIT", "scanny/python-pptx",
      note="模板占位符替换，最稳，样式由模板控制"),
    P("marp", "Marp", "oss", "MIT", "marp-team/marp",
      note="Markdown 转幻灯片，写起来快，样式受限"),
    P("gamma", "Gamma API", "commercial", note="排版好看，但可控性差、按次收费"),
    AIB("ai-write", "AI 自己写", "4 天", "约 300 万",
        ["第一步只出大纲 JSON：章节、每页标题、要点、需要的图",
         "渲染层用 python-pptx 按模板填，不生成 XML",
         "图片走占位框，尺寸按版式算好再插",
         "导出后回读校验页数与字号，渲染崩了能发现"],
        "大纲与渲染必须分开，混在一起必然返工"),
  ])

# ---------------- 第二批软件 ----------------
S("jimeng", "即梦AI", "app", [
    ("ai.media.image", None, "must"), ("ai.media.video", "jimeng", "must"),
    ("ai.media.voice", None, "optional"), ("ai.media.music", None, "optional"),
    ("ai.flow.canvas", None, "optional"), ("ai.agent.loop", None, "optional"),
], license="闭源", homepage="https://jimeng.jianying.com", tags=["ai", "image", "video", "cn"],
   note="图像视频一体化的国产代表，把一个创意从图做到短片；差异点是中文提示词理解与价格")

S("midjourney", "Midjourney", "app", [
    ("ai.media.image", None, "must"), ("ai.media.video", None, "optional"),
    ("ai.chat.core", None, "must"),
], license="闭源", homepage="https://www.midjourney.com", tags=["ai", "image"],
   note="审美上限的标杆。架构上最值得学的是它早期用 Discord 当交互层——没有前端也能做产品")

S("xfyun-spark", "讯飞星火", "app", [
    ("ai.chat.core", None, "must"), ("ai.media.voice", None, "must"),
    ("ai.media.doc", None, "must"), ("kb.ingest", None, "optional"),
    ("ai.chat.memory", None, "optional"), ("ai.agent.search", None, "optional"),
], license="闭源", homepage="https://xinghuo.xfyun.cn", tags=["ai", "chat", "cn", "voice"],
   note="语音是它的护城河——国内少数把 ASR/TTS 做到能直接商用的团队，其它功能属跟随")

S("gamma", "Gamma", "app", [
    ("ai.media.doc", "gamma", "must"), ("ai.media.image", None, "optional"),
    ("ai.model.gateway", None, "optional"), ("ai.deliver.publish", None, "must"),
], license="闭源", homepage="https://gamma.app", tags=["ai", "ppt"],
   note="PPT 生成里排版最像人的一个。它的做法是「先定版式再填内容」，不是让模型自由发挥")

S("metaso", "秘塔搜索", "app", [
    ("ai.agent.search", "metaso", "must"), ("kb.fulltext", None, "must"),
    ("kb.rerank", None, "optional"), ("ai.chat.core", None, "must"),
    ("ai.agent.loop", None, "optional"),
], license="闭源", homepage="https://metaso.cn", tags=["ai", "search", "cn"],
   note="中文检索增强的代表，差异点是「给来源」而不是给结论——这一点比多数产品诚实")

S("coze", "扣子 Coze", "platform", [
    ("ai.flow.canvas", None, "must"), ("ai.flow.run", None, "must"),
    ("ai.agent.tool", None, "must"), ("kb.rag", None, "optional"),
    ("ai.deliver.publish", None, "must"), ("ai.model.gateway", None, "must"),
], license="闭源", homepage="https://www.coze.cn", tags=["ai", "agent", "cn"],
   note="把做 Bot 的门槛降到零的代表：拖几个节点就能发到微信。代价是深度受平台限制")

S("fastgpt", "FastGPT", "platform", [
    ("kb.rag", None, "must"), ("kb.ingest", "docling", "must"),
    ("ai.flow.canvas", None, "must"), ("ai.agent.loop", None, "must"),
    ("ai.model.gateway", "litellm", "must"), ("kb.manage", None, "optional"),
], license="其他（需核，有商用限制）", homepage="https://fastgpt.io", tags=["ai", "rag", "selfhost"],
   note="国产知识库 + 工作流的常见组合，比 Dify 轻，落地案例多")

S("flowise", "Flowise", "platform", [
    ("ai.flow.canvas", "flowise", "must"), ("ai.flow.node", None, "must"),
    ("ai.agent.loop", None, "must"), ("ai.model.gateway", None, "must"),
    ("kb.rag", "chroma", "optional"),
], license="Apache-2.0", homepage="https://flowiseai.com", tags=["ai", "workflow", "selfhost"],
   note="LLM 场景的画布，节点偏「模型与提示词」而不是「API 集成」，适合做原型")

S("ollama", "Ollama", "model", [
    ("ai.model.local", "ollama", "must"), ("ai.model.gateway", None, "optional"),
    ("ai.deliver.ops", None, "optional"),
], license="MIT", homepage="https://ollama.com", tags=["ai", "local"],
   note="本地跑模型的事实标准。真正让它赢的不是性能而是「一条命令」——降低门槛本身就是产品力")

S("comfyui", "ComfyUI", "app", [
    ("ai.media.image", "comfyui", "must"), ("ai.flow.canvas", None, "must"),
    ("ai.flow.run", None, "must"), ("ai.flow.node", None, "optional"),
], license="GPL-3.0", homepage="https://github.com/comfyanonymous/ComfyUI", tags=["ai", "image", "local"],
   note="把图像生成做成节点图，可控性天花板。它的存在证明「工作流画布」不只服务文本")
