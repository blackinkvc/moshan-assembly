#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第三批：补 10 个软件，凑满 30。基本只做组合，不再新增模块——这是复用率的检验。"""
import seed02  # noqa: F401  确保前两批已注册
from seed01 import S

S("lmstudio", "LM Studio", "model", [
    ("ai.model.local", None, "must"), ("ai.chat.core", "ollama-webui", "must"),
    ("ai.model.gateway", None, "optional"),
], license="闭源（免费）", homepage="https://lmstudio.ai", tags=["ai", "local", "desktop"],
   note="把本地模型做成消费级软件的样板：图形界面、模型市场、一键下载。闭源但免费，靠生态站位")

S("cline", "Cline", "devtool", [
    ("dev.code.edit", "cline", "must"), ("dev.code.index", "tree-sitter", "must"),
    ("ai.agent.tool", None, "must"), ("ai.agent.mcp", "mcp-servers", "must"),
    ("ai.agent.plan", None, "optional"),
], license="Apache-2.0", homepage="https://cline.bot", tags=["ai", "coding", "vscode"],
   note="IDE 里的开源编程 Agent。差异点是「每一步都摊开给你看」，比黑箱式 Agent 更适合学")

S("opencode", "OpenCode", "devtool", [
    ("dev.code.index", "tree-sitter", "must"), ("dev.code.complete", None, "optional"),
    ("ai.agent.loop", None, "must"), ("ai.model.gateway", "litellm", "must"),
    ("ai.agent.tool", None, "optional"),
], license="MIT(需核)", homepage="https://opencode.ai", tags=["ai", "coding", "cli"],
   note="Claude Code 的开源平替，卖点是「用哪家模型都行」——把模型选择权还给用户")

S("lobe-chat", "LobeChat", "app", [
    ("ai.chat.core", None, "must"), ("ai.model.gateway", None, "must"),
    ("kb.rag", None, "optional"), ("ai.agent.mcp", "mcp-servers", "must"),
    ("ai.media.voice", "whisper", "optional"),
], license="Apache-2.0(需核)", homepage="https://lobehub.com", tags=["ai", "chat", "selfhost"],
   note="开源聊天客户端里最像产品的一个：插件、MCP、知识库、语音都有，前端体验接近商业品")

S("open-webui", "Open WebUI", "app", [
    ("ai.chat.core", "ollama-webui", "must"), ("ai.model.gateway", None, "must"),
    ("kb.rag", "chroma", "must"), ("ai.agent.tool", None, "optional"),
    ("ai.deliver.ops", None, "optional"),
], license="BSD-3-Clause(需核)", homepage="https://openwebui.com", tags=["ai", "chat", "selfhost"],
   note="本地模型的通用前台。它的定位很聪明：自己不做模型，只做最好用的那一层壳")

S("maxkb", "MaxKB", "platform", [
    ("kb.rag", None, "must"), ("kb.ingest", "docling", "must"),
    ("ai.flow.canvas", None, "optional"), ("ai.deliver.channel", None, "optional"),
    ("ai.model.gateway", "litellm", "must"), ("ai.agent.loop", None, "must"),
], license="GPL-3.0(需核)", homepage="https://maxkb.cn", tags=["ai", "rag", "cn", "selfhost"],
   note="国产知识库问答的开箱方案，强项是「嵌到已有系统里」——企业微信、钉钉都能挂")

S("sd-webui", "Stable Diffusion WebUI", "app", [
    ("ai.media.image", "sd-webui", "must"),
    ("ai.flow.node", None, "optional"), ("ai.deliver.publish", None, "optional"),
], license="AGPL-3.0", homepage="https://github.com/AUTOMATIC1111/stable-diffusion-webui",
   tags=["ai", "image", "local"],
   note="本地出图的开山之作。它的遗产不是界面，是 ControlNet / LoRA 这套插件范式")

S("trae", "Trae", "devtool", [
    ("dev.code.complete", None, "must"), ("dev.code.index", None, "must"),
    ("dev.code.edit", None, "must"), ("ai.agent.loop", None, "must"),
    ("ai.agent.mcp", "mcp-servers", "optional"),
], license="闭源", homepage="https://www.trae.ai", tags=["ai", "coding", "ide"],
   note="国产 AI IDE 的代表，走「IDE 内建 Agent」路线，与 Cursor 同构但更依赖国产模型")

S("vllm", "vLLM", "model", [
    ("ai.model.local", "vllm", "must"), ("ai.model.gateway", None, "must"),
    ("ai.deliver.ops", "otel", "optional"),
], license="Apache-2.0", homepage="https://docs.vllm.ai", tags=["ai", "inference", "selfhost"],
   note="自建推理服务的工业标准。PagedAttention 让它能扛并发，代价是比 llama.cpp 重")

S("langflow", "Langflow", "platform", [
    ("ai.flow.canvas", "langflow", "must"), ("ai.flow.run", None, "must"),
    ("ai.agent.loop", None, "must"), ("ai.agent.tool", None, "must"),
    ("ai.model.gateway", "litellm", "must"), ("kb.rag", None, "optional"),
], license="MIT", homepage="https://langflow.org", tags=["ai", "workflow", "selfhost"],
   note="把 LangChain 的积木摊到画布上。适合调流程，不适合直接当生产平台——状态管理偏弱")
