#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""万能基板：把 91 格全部翻译成「吃什么 / 吐什么」。

为什么要这东西：光有格子清单，没人能判断「这九格拼起来能不能跑」。有了这层，
连通性就变成一句可计算的话——**每一格要的输入，勾选里必须有人产出**。断在哪一格、
该补哪一格，都不用猜。

只定 10 个接口类型，不多不少：类型太细，格子之间永远接不上；太粗，等于没定。
T 文本  D 原始文件（图片/PDF/音视频/网页）  C 片段（带来源的文本块）  V 向量
R 记录（结构化行）  F 产物文件（docx/pptx/png/mp4）  E 事件  S 会话  X 界面  Q 动作（对系统有副作用）

needs 写成「与或式」：[[A,B],[C]] = 需要 (A 或 B) 且 C。空列表 = 不需要输入（源头格）。
不写「拿不准的」：拿不准就按最常见的接法写，并在 note 里留一句，别假装精确。
"""

TYPE_CN = {
    "T": "文本", "D": "原始文件", "C": "文本片段", "V": "向量", "R": "结构化记录",
    "F": "产物文件", "E": "事件", "S": "会话", "X": "界面", "Q": "外部动作",
}

# 用户与系统天然提供的东西，不需要任何格子产出
EXT = {"T": "用户输入的话", "D": "用户上传的文件", "E": "系统时钟/外部事件"}

# cid -> (needs, gives)
WIRE = {
    # 对话
    "ai.chat.core": ([[ "T" ]], ["T", "S"]),
    "ai.chat.memory": ([[ "T", "S" ]], ["S"]),
    "ai.chat.multimodal": ([["D"]], ["T"]),
    "ai.chat.persona": ([["S", "T"]], ["T"]),
    # 智能体
    "ai.agent.loop": ([["T"]], ["T", "Q"]),
    "ai.agent.plan": ([["T"]], ["R"]),
    "ai.agent.tool": ([["R", "T"]], ["Q"]),
    "ai.agent.mcp": ([], ["Q"]),
    "ai.agent.skill": ([["T"]], ["Q"]),
    "ai.agent.search": ([["T"]], ["T"]),
    "ai.agent.multi": ([["T"]], ["T"]),
    "ai.agent.browser": ([["T"]], ["D", "T"]),
    "ai.agent.computer": ([["T"]], ["Q", "D"]),
    "ai.agent.support": ([["C"], ["T"]], ["T"]),   # 答案要落在知识片段上，否则就是胡说
    "ai.agent.research": ([["C"], ["T"]], ["T"]),   # 内部调检索：片段没就绪就只是「凭空写」
    # 模型
    "ai.model.gateway": ([["T"]], ["T"]),
    "ai.model.local": ([["T"]], ["T"]),
    "ai.model.route": ([["T"]], ["T"]),
    "ai.model.finetune": ([["R"]], ["Q"]),
    "ai.model.host": ([], ["T"]),
    # 知识库
    "kb.ingest": ([["D"]], ["C"]),
    "kb.parse": ([["D"]], ["T"]),
    "kb.chunk": ([["T"]], ["C"]),
    "kb.rag": ([["C"], ["T"]], ["C"]),
    "kb.embed": ([["C"]], ["V"]),
    "kb.recall": ([["V"], ["T"]], ["C"]),
    "kb.rerank": ([["C"], ["T"]], ["C"]),
    "kb.fulltext": ([["C"], ["T"]], ["C"]),
    "kb.manage": ([["C"]], ["C"]),
    # 内容生成
    "ai.media.image": ([["T"]], ["F"]),
    "ai.media.video": ([["T"]], ["F"]),
    "ai.media.voice": ([["T"]], ["F"]),
    "ai.media.music": ([["T"]], ["F"]),
    "ai.media.doc": ([["T", "R"]], ["F"]),
    "ai.media.edit": ([["D"]], ["F"]),
    "ai.media.portrait": ([["D"]], ["F"]),
    "ai.media.avatar": ([["D"], ["T"]], ["F"]),
    "ai.media.clip": ([["D"]], ["F"]),
    "ai.media.transcribe": ([["D"]], ["T"]),
    "ai.media.clone": ([["D"]], ["Q"]),
    "ai.media.clean": ([["D"]], ["F"]),
    "ai.media.3d": ([["T", "D"]], ["F"]),
    # 编程
    "dev.code.index": ([["D"]], ["C"]),
    "dev.code.complete": ([["T"]], ["T"]),
    "dev.code.edit": ([["T", "C"]], ["F", "Q"]),
    "dev.code.review": ([["T", "F"]], ["R"]),
    # 流程
    "ai.flow.canvas": ([["R"]], ["R"]),
    "ai.flow.node": ([["R"]], ["Q"]),
    "ai.flow.trigger": ([], ["E"]),
    "ai.flow.run": ([["R"], ["E"]], ["Q", "E"]),
    # 交付
    "ai.deliver.channel": ([["E"], ["T"]], []),
    "ai.deliver.publish": ([["X"]], ["X"]),
    "ai.deliver.ops": ([["Q"]], ["R"]),
    # 文本创作
    "ai.text.copy": ([["T"]], ["T", "F"]),
    "ai.text.long": ([["T"], ["C"]], ["T", "F"]),
    "ai.text.fiction": ([["T"]], ["T", "F"]),
    "ai.text.rewrite": ([["T"]], ["T"]),
    "ai.text.translate": ([["T"]], ["T"]),
    "ai.text.summary": ([["T", "C"]], ["T", "R"]),
    # 办公
    "ai.office.sheet": ([["T", "R"]], ["R", "F"]),
    "ai.office.meeting": ([["D"]], ["T", "R"]),
    "ai.office.mindmap": ([["T"]], ["T", "F"]),
    "ai.office.resume": ([["T", "R"]], ["F"]),
    "ai.office.note": ([["T"]], ["R", "T"]),
    "ai.office.ocr": ([["D"]], ["T", "R"]),
    # 设计
    "ai.design.layout": ([["T"], ["F", "T"]], ["F"]),
    "ai.design.brand": ([["T"]], ["F"]),
    # 提示词
    "ai.prompt.lib": ([["T"]], ["T"]),
    "ai.prompt.optimize": ([["T"]], ["T"]),
    # 检测
    "ai.detect.aigc": ([["T"]], ["R", "T"]),
    # 检索
    "ai.search.engine": ([["T"]], ["T"]),
    # 应用底座
    "app.data": ([["R", "T"]], ["R"]),
    "app.auth": ([], ["S"]),
    "app.ui": ([["T", "R", "F"], ["X"]], ["X"]),
    "app.file": ([["D", "F"]], ["F"]),
    "app.edge": ([], ["R", "T"]),   # 扫码枪给的是「读到的码」，不是文件
}

# app.ui 的「要 X 也给 X」是刻意的：界面既可以凭空长出来（自己就是入口），
# 也可以承接别的界面（多页应用）。写成 [[T,R,F],[X]] 就成了死循环，所以单独备注：
# 检查时 app.ui 视为不依赖输入。
UI_FREE = {"app.ui"}

# 断点时的补法建议：缺什么类型 → 去找哪些格
PATCH = {
    "C": ["kb.ingest", "kb.chunk", "kb.fulltext"],
    "T": ["ai.model.gateway", "ai.text.summary", "ai.chat.core"],
    "R": ["ai.office.ocr", "ai.text.summary", "app.data", "ai.office.sheet"],
    "V": ["kb.embed"],
    "F": ["ai.media.doc", "ai.media.image"],
    "E": ["ai.flow.trigger"],
    "X": ["app.ui"],
    "S": ["app.auth", "ai.chat.core"],
    "D": ["app.file", "ai.agent.browser"],
    "Q": ["ai.agent.tool"],
}
