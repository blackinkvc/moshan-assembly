#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""需求 → 架构：一句需求推出要哪些格子、每格用哪款；同时给「买现成」的对照。

用法：
  python3 arch/match.py "我要做一个 X，能……，还要……"
  python3 arch/match.py --buy "同一个需求"    只找现成软件
  python3 arch/match.py --json "需求"         出 JSON，供前端吃

设计约束（和 seed04 的拆解规则不是一回事，别混）：
  · 拆解是「已知软件 → 拼了哪几格」，本文件是「只给需求 → 该拼哪几格」，方向相反。
  · 词表只在判据明确时写。宁可漏一格让人手动加，不要为一句话硬凑十格。
  · 强词决定 must，弱词只在强词全空时降级为 optional，永不升级（上次 59 个全中「长期记忆」的教训）。
  · 否定词要认：「不用登录」不能命中账号权限，「不要联网」不能命中联网检索。
  · 库里没有的东西不假装有，直接进「缺口」清单——缺口是结论，不是失败。
"""
import json
import os
import re
import sys
import unicodedata
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "arch.json")

# ── 域输出顺序：从「用户碰得到的」往「地基」排 ──────────────────────────
DOM_ORDER = ["ai.chat", "ai.office", "ai.text", "kb", "ai.agent", "ai.media",
             "ai.search", "ai.design", "ai.flow", "ai.model", "ai.deliver",
             "ai.detect", "ai.prompt", "dev.code", "eng", "app", "site", "hw"]
DOM_CN = {"ai.chat": "对话交互", "ai.office": "办公产出", "ai.text": "文本创作",
          "kb": "知识库", "ai.agent": "智能体", "ai.media": "内容生成",
          "ai.search": "检索", "ai.design": "视觉设计", "ai.flow": "流程编排",
          "ai.model": "模型供给", "ai.deliver": "交付接入", "ai.detect": "内容检测",
          "ai.prompt": "提示词", "dev.code": "编程辅助", "app": "应用底座（要自己搭）",
        "hw": "硬件（自己做一台真机）",
        "eng": "工程研发（芯片与板级）",
        "site": "线下现场（仓 / 店 / 场 / 宿）"}

# ── 模块触发面：cid -> (强词, 弱词) ──────────────────────────────────────
# 强词＝说出这个词，这格基本就跑不掉（对象/产物/专有动作）。
# 弱词＝沾边，只在同格强词全不中时给 optional。
TRIG = {
    # 对话
    "ai.chat.core": (["聊天", "对话", "问答", "问它", "跟它说", "助手", "机器人", "客服口吻"], ["交互", "提问"]),
    "ai.chat.memory": (["记住我", "记得我", "长期记忆", "个人偏好", "历史对话", "上次说"], ["记住", "偏好"]),
    "ai.chat.multimodal": (["发图片", "拍张照", "拍照", "上传图片", "语音输入", "说句话"], ["图片", "语音", "附件"]),
    "ai.chat.persona": (["人设", "角色扮演", "虚拟伴侣", "陪聊", "女友", "男友", "性格设定"], ["陪伴", "人格"]),
    # 智能体
    "ai.agent.loop": (["自动完成", "自己去做", "多步", "直到完成", "自主"], ["自动", "执行"]),
    "ai.agent.plan": (["拆成步骤", "做计划", "任务分解", "先规划"], ["规划", "步骤"]),
    "ai.agent.tool": (["调用接口", "调 api", "执行操作", "改数据库", "发请求"], ["接口", "调用"]),
    "ai.agent.mcp": (["mcp", "接我的", "接公司系统", "挂外部工具"], ["外部系统", "插件"]),
    "ai.agent.skill": (["固定流程", "一键跑完", "沉淀成技能", "复用流程"], ["模板化", "重复做"]),
    "ai.agent.search": (["联网", "搜网上", "实时信息", "最新消息", "查一下网上", "搜集资料", "抓取新闻", "收集新闻"], ["搜索", "检索资料"]),
    "ai.agent.multi": (["多个角色", "多个专家", "分工", "会审", "多方讨论"], ["协同", "辩论"]),
    "ai.agent.browser": (["自动打开网页", "登录后台", "网页上点", "爬网页", "浏览器"], ["网页操作", "采集"]),
    "ai.agent.computer": (["操作电脑", "点鼠标", "控制桌面", "没有接口的软件", "rpa", "远程桌面"],
                          ["截图操作"]),
    "ai.agent.support": (["客服", "工单", "转人工", "售后", "坐席"], ["咨询", "问答机器人"]),
    "ai.agent.research": (["行业研究", "深度研究", "调研报告", "竞品分析", "写研报", "交叉验证", "带引用"], ["研究", "分析报告"]),
    # 模型
    "ai.model.gateway": (["多家模型", "换模型", "api key", "openai", "通义", "deepseek", "claude", "大模型"], ["模型", "接入"]),
    "ai.model.local": (["本地部署模型", "离线跑", "不联网", "私有化部署", "本地大模型", "数据不出"], ["本地", "离线"]),
    "ai.model.route": (["省成本", "便宜模型", "按难度", "分流", "降级"], ["成本", "路由"]),
    "ai.model.finetune": (["微调", "训练自己的模型", "lora", "sft", "行业模型"], ["训练", "调优"]),
    "ai.model.host": (["并发", "限流", "对外提供模型", "推理服务", "显存"], ["部署", "服务化"]),
    # 知识库
    "kb.ingest": (["文档入库", "导入文档", "批量导入", "资料入库", "文档解析", "收集研报", "收集公告"], ["文档", "导入"]),
    "kb.parse": (["解析 pdf", "扫描件", "复杂版式", "表格提取", "公式"], ["格式", "解析"]),
    "kb.chunk": (["切块", "分段", "长文档切"], ["切片"]),
    "kb.rag": (["知识库", "语义搜索", "问答库", "rag", "向量", "相似度", "找相关内容"], ["检索", "问答"]),
    "kb.embed": (["嵌入", "向量化", "embedding"], ["向量"]),
    "kb.recall": (["召回", "候选片段"], []),
    "kb.rerank": (["重排", "排序不准", "提高准确率"], ["排序"]),
    "kb.fulltext": (["关键词搜索", "精确匹配", "法条", "条款号", "按编号查"], ["全文检索", "搜索"]),
    "kb.manage": (["多知识库", "知识库管理", "多个资料库", "重建索引", "权限隔离"], ["删库重建", "增删改查"]),
    # 内容生成
    "ai.media.image": (["生成图片", "画图", "出图", "文生图", "配图", "海报图"], ["插画", "配图需求"]),
    "ai.media.video": (["生成视频", "文生视频", "图生视频", "做短视频"], ["视频片段"]),
    "ai.media.voice": (["语音播报", "配音", "tts", "文字转语音", "合成声音"], ["朗读", "声音"]),
    "ai.media.music": (["背景音乐", "配乐", "生成音乐", "bgm"], ["音乐"]),
    "ai.media.doc": (["生成ppt", "生成 word", "生成docx", "出报告文档", "生成表格文件", "excel 导出"], ["文档", "导出"]),
    "ai.media.edit": (["抠图", "去水印", "消除", "修复老照片", "扩图", "超分", "修图"], ["图片处理"]),
    "ai.media.portrait": (["写真", "证件照", "换脸", "形象照", "职业照"], ["人像"]),
    "ai.media.avatar": (["数字人", "口播视频", "虚拟主播"], ["虚拟形象"]),
    "ai.media.clip": (["自动剪辑", "去静音", "加字幕", "切片", "混剪"], ["剪辑"]),
    "ai.media.transcribe": (["录音转文字", "会议录音", "语音转写", "字幕生成", "音频转文字"], ["转写", "录音"]),
    "ai.media.clone": (["声音克隆", "复刻音色", "模仿我的声音"], ["音色"]),
    "ai.media.clean": (["降噪", "去混响", "人声分离", "去背景音"], ["音频处理"]),
    "ai.media.3d": (["3d 模型", "建模", "网格模型", "白模"], ["三维"]),
    # 编程
    "dev.code.index": (["代码库", "仓库理解", "代码检索", "代码索引"], ["代码"]),
    "dev.code.complete": (["代码补全", "自动补全", "写代码提示"], ["补全"]),
    "dev.code.edit": (["批量改代码", "重构", "跨文件修改", "自动改代码"], ["改代码"]),
    "dev.code.review": (["代码审查", "code review", "找出 bug", "质量检查"], ["审查"]),
    # 流程
    "ai.flow.canvas": (["拖拽", "可视化编排", "画流程图", "工作流画布", "节点连线"], ["编排", "流程设计"]),
    "ai.flow.node": (["连数据库", "连企业微信", "连飞书", "连钉钉", "连 excel", "连第三方", "集成"], ["连接器", "节点"]),
    "ai.flow.trigger": (["定时", "每天自动", "每周自动", "触发", "webhook", "有新消息就"], ["定期", "自动跑"]),
    "ai.flow.run": (["跑工作流", "批量跑", "一次处理很多", "并发执行"], ["执行", "调度"]),
    # 交付
    "ai.deliver.channel": (["微信推送", "飞书", "钉钉", "企业微信", "发消息给", "公众号", "telegram", "短信", "提醒我", "叫我"], ["通知", "推送"]),
    "ai.deliver.publish": (["做成网站", "上线", "分享链接", "给别人用", "小程序", "app", "接口给外部"], ["发布", "部署"]),
    "ai.deliver.ops": (["看用量", "花了多少钱", "日志", "报错排查", "监控", "成本统计"], ["运维", "统计"]),
    # 文本创作
    "ai.text.copy": (["文案", "种草", "小红书笔记", "电商详情", "标题党", "朋友圈文案"], ["宣传", "卖点"]),
    "ai.text.long": (["长文", "报告正文", "论文", "白皮书", "方案书", "写文章", "章节", "分析报告"], ["写作", "正文"]),
    "ai.text.fiction": (["小说", "剧本", "故事", "分镜", "网文", "短剧"], ["情节", "人物"]),
    "ai.text.rewrite": (["改写", "降重", "换说法", "润色", "降 aigc", "去 ai 味", "口语化"], ["修改", "语气"]),
    "ai.text.translate": (["翻译", "中英", "多语言", "双语", "本地化"], ["英文", "外语"]),
    "ai.text.summary": (["总结", "摘要", "提炼", "要点", "周报", "月报", "概括", "结构化字段", "抽取字段", "识别金额"], ["归纳", "简报"]),
    # 办公
    "ai.office.sheet": (["表格", "excel", "账本", "记账", "台账", "库存表", "收支", "统计图表", "数据表", "报表", "明细"], ["数据", "汇总"]),
    "ai.office.meeting": (["会议纪要", "开会记录", "会议记录", "录音整理", "待办事项提取"], ["会议", "纪要"]),
    "ai.office.mindmap": (["思维导图", "脑图", "大纲"], ["结构图"]),
    "ai.office.resume": (["简历", "求职", "招聘筛选", "面试"], ["履历"]),
    "ai.office.note": (["笔记", "随手记", "日记", "收藏", "个人知识", "记录每天"], ["记录", "备忘"]),
    "ai.office.ocr": (["ocr", "识别图片文字", "拍张照识别", "扫描件识别", "识别发票", "识别小票", "识别身份证", "识别表格图片", "拍一张", "拍照识别"], ["识图", "文字识别"]),
    # 设计
    "ai.design.layout": (["海报", "版式", "封面", "排版", "长图"], ["设计", "样式"]),
    "ai.design.brand": (["logo", "品牌", "配色", "vi", "标识"], ["视觉"]),
    # 提示词
    "ai.prompt.lib": (["提示词管理", "prompt 模板", "提示词库", "可复用提示词"], ["提示词", "模板"]),
    "ai.prompt.optimize": (["优化提示词", "提示词评测", "调 prompt"], ["评测"]),
    # 检测
    "ai.detect.aigc": (["ai 检测", "判断是不是ai写的", "降 ai 率", "过检测"], ["ai 味", "ai 痕迹"]),
    # 检索
    "ai.search.engine": (["聚合搜索", "多个搜索引擎", "站内搜索", "信息源", "新闻聚合"], ["搜索", "找资料"]),
    # 应用底座
    "app.data": (["数据库", "存数据", "数据存", "历史记录", "账本", "台账", "库存明细", "保存下来", "留档"], ["存储", "保存"]),
    "app.auth": (["登录", "注册", "账号", "权限", "多用户", "角色", "同事各自", "会员"], ["账户", "身份"]),
    "app.ui": (["界面", "网页", "小程序", "手机能", "电脑上", "页面", "客户端", "控制台", "后台"],
               ["显示", "操作界面"]),
    "app.file": (["上传文件", "附件", "文件管理", "网盘", "图片存", "存图"], ["资料存放"]),
    "app.edge": (["扫码枪", "扫条码", "扫商品码", "打小票", "称重", "串口", "收银机"], ["硬件设备"]),
    # 硬件：注意几个泛词（网关/认证/芯片/显示）在软件语境里另有含义，只做弱词
    "hw.mcu": (["单片机", "主控", "esp32", "stm32", "nrf52", "开发板", "arduino", "模组选型"],
               ["芯片", "算力"]),
    "hw.sense": (["温湿度", "测温", "湿度传感", "传感器", "光照传感", "pm2.5", "气压计"],
                 ["测量", "监测"]),
    "hw.display": (["墨水屏", "水墨屏", "电子墨水", "eink", "e-ink", "电子价签",
                    "带屏幕", "带屏", "一块屏", "小屏"], ["显示屏", "屏幕"]),
    "hw.power": (["电池", "续航", "换电", "充电", "低功耗", "省电", "供电", "插电", "usb供电"], ["耗电"]),
    "hw.wireless": (["蓝牙", "wifi", "zigbee", "matter", "配网", "无线连接"], ["联网", "无线"]),
    "hw.firmware": (["固件", "烧录", "ota", "刷机", "嵌入式"], ["设备端程序"]),
    "hw.pcb": (["pcb", "电路板", "原理图", "打样", "画板", "贴片"], ["电路"]),
    "hw.enclosure": (["外壳", "壳体", "3d打印", "开模", "注塑", "结构件", "挂墙"], ["外观件"]),
    "hw.gateway": (["mqtt", "homeassistant", "home assistant", "米家", "涂鸦", "上报到", "数据网关",
                    "连手机", "手机看", "手机上", "同步到后台", "库存同步"],
                   ["网关", "数据落地"]),
    "hw.cert": (["srrc", "型号核准", "ce认证", "fcc", "量产", "3c认证", "认证费用",
                 "过认证", "做认证", "要认证", "批量生产", "批量出货"], ["合规", "认证"]),
}

# ── 场景规则：一句需求里的「行话」直接定几个格子 ─────────────────────────
# 为什么需要：光靠词面，「记账」能命中表格，但「票据→识别→入账→月度汇总」这条链是业务常识，
# 词表推不出来。宁可写 20 条场景，也不要给每个模块塞 20 个同义词。
SCEN = [
    ("记账/个人账本", ["记账", "账本", "收支", "花了多少", "消费记录", "报销", "对账"],
     ["ai.office.ocr", "ai.chat.core", "app.data", "app.ui", "ai.text.summary"],
     "票据→识别→入账→月度汇总→对话查账"),
    ("库存/仓储", ["库存", "仓库", "入库", "出库", "盘点", "补货", "sku", "物料", "进销存"],
     ["app.data", "ai.office.sheet"], "库存台账是主数据，AI 只做查询与预警"),
    ("行业研究", ["行业研究", "研报", "竞品", "调研", "情报", "行研"],
     ["kb.ingest", "kb.rag", "ai.agent.research", "ai.agent.search", "ai.text.long"], "收集→入库→检索→带引用成文"),
    ("个人生活", ["生活助手", "生活助力", "个人助理", "习惯养成", "健康记录", "饮食", "睡眠", "心情"],
     ["ai.office.note", "ai.chat.memory", "app.data", "app.ui", "ai.text.summary"], "记录→记住→定期回看"),
    ("提醒/推送", ["提醒", "叫我", "通知我", "每天发", "推送", "闹钟"],
     ["ai.flow.trigger", "ai.deliver.channel"], "定时器 + 一个能落到人身上的通道"),
    ("团队共用", ["团队", "同事", "多人", "共享", "协作", "权限", "部门", "内部", "员工"],
     ["app.auth", "app.ui", "ai.deliver.publish"], "多人就要账号、要界面、要能访问"),
    ("音视频入库", ["培训视频", "视频资料", "课程视频", "播客", "会议录像", "音频资料"],
     ["ai.media.transcribe", "kb.ingest"], "先转写成文本，才谈得上检索"),
    ("文档产出", ["出报告", "写方案", "生成文档", "周报", "月报", "总结报告"],
     ["ai.text.long", "ai.media.doc"], "先成文，再落成 docx/pptx"),
    ("要能给人用", ["给别人用", "上线", "发布", "分享给", "对外"],
     ["app.ui", "ai.deliver.publish"], "能打开的东西才叫交付"),
    ("自制硬件", ["温湿度计", "传感器", "墨水屏", "水墨屏", "单片机", "pcb", "打样", "外壳", "固件",
              "电路板", "开发板", "做个设备", "做一台", "iot",
              "摆件", "样机", "原型机", "元器件", "带屏幕", "焊", "电池"],
     ["hw.mcu", "hw.sense", "hw.power", "hw.firmware", "hw.pcb", "hw.enclosure"],
     "选主控 → 点传感 → 供电 → 写固件 → 打板 → 装壳 → 数据接出来"
     "（顺序不能反：先开发板飞线，再画板；壳按板子尺寸做）"),
    ("看历史数据", ["历史曲线", "趋势图", "历史数据", "看记录", "走势"], 
     ["app.data", "app.ui"], "数据得先存下来，才谈得上看趋势"),
]

# ── 依赖闭包：选了 key，必须拉上 value ───────────────────────────────────
REQ = {
    "ai.agent.loop": ["ai.model.gateway", "ai.agent.tool"],
    "ai.agent.plan": ["ai.model.gateway"],
    "ai.agent.research": ["ai.agent.search", "kb.rag", "ai.text.long"],
    "ai.agent.multi": ["ai.model.gateway"],
    "ai.agent.support": ["kb.rag", "ai.model.gateway"],
    "kb.rag": ["kb.ingest"],
    "kb.rerank": ["kb.rag"],
    "kb.embed": ["kb.rag"],
    "kb.parse": ["kb.ingest"],
    "kb.chunk": ["kb.ingest"],
    "ai.office.ocr": ["ai.text.summary"],
    "ai.office.meeting": ["ai.media.transcribe", "ai.office.note"],
    "ai.text.long": ["ai.model.gateway"],
    "ai.text.summary": ["ai.model.gateway"],
    "ai.media.doc": ["ai.model.gateway"],
    "ai.media.image": ["ai.model.gateway"],
    "ai.media.video": ["ai.model.gateway"],
    "ai.flow.canvas": ["ai.flow.run"],
    "ai.flow.node": ["ai.flow.run"],
    "ai.flow.trigger": ["ai.flow.run"],
    "dev.code.edit": ["dev.code.index"],
    "app.auth": ["app.data"],
    "app.file": ["app.data"],
    "app.ui": ["app.data"],
    # 硬件：选了后面的一定要前面那几格，方向不能反
    # 有主控就得有跑在它上面的程序；有传感器就得有主控来读它——否则读数是悬空的
    "hw.mcu": ["hw.pcb", "hw.power", "hw.firmware"],
    "hw.sense": ["hw.pcb", "hw.power", "hw.mcu"],
    "hw.display": ["hw.mcu", "hw.power"],
    "hw.wireless": ["hw.mcu", "hw.power"],
    "hw.firmware": ["hw.mcu"],
    "hw.gateway": ["hw.wireless"],
    "hw.enclosure": ["hw.pcb"],
    "hw.cert": ["hw.pcb", "hw.firmware"],
}

# ── 缺口：需求里常见、但库里明确没有的东西 ───────────────────────────────
# 不补进 components 是因为它们不是「AI 能力」，硬塞会让整个库变味。
# 但它们足以让一个方案跑不起来，所以必须显式吐出来。
GAP = [
    (["支付", "收费", "订阅", "下单", "退款"],
     "支付与计费", "接微信/支付宝，涉及资质，不要自研"),
    (["看板", "大屏", "仪表盘", "可视化图表", "统计图表"],
     "可视化图表", "ECharts / 前端 BI；表格模块只到「出图」不到「看板」"),
    (["审批", "流程流转", "工单流转", "电子签", "合同签署"],
     "业务流转与审批引擎", "这部分是 ERP/OA 的活，接现成的比自建便宜"),
    (["传文件", "传输", "局域网", "大文件", "断点续传", "互传"],
     "文件传输与局域网发现", "WebRTC / LocalSend 式直连；不在 AI 能力范围内"),
    (["推送到达", "必达", "群发", "模板消息"],
     "消息必达与模板报备", "微信模板消息要审核；自建推送通道容易被封"),
    (["医疗器械", "nmpa", "药监", "二类器械", "医疗级"],
     "医疗器械注册", "二类器械注册 6–12 个月，别按软件项目排期"),
    (["ip67", "ip68", "防水", "防尘等级", "跌落测试"],
     "防护等级与可靠性送检", "IP 等级要送第三方实验室；自己能做的只有密封圈与灌胶设计"),
]

# ── 约束词：不选模块，只改方案的挑法 ────────────────────────────────────
CONS = {
    "local": ["本地", "离线", "私有化", "内网", "数据不出", "自部署", "自己机器"],
    "free": ["免费", "零成本", "不要钱", "开源", "尽量不花钱", "预算低", "白嫖"],
    "cheap": ["便宜", "省成本", "成本低", "省钱"],
    "team": ["团队", "多人", "同事", "公司", "部门", "协作"],
    "big": ["百万", "海量", "大规模", "高并发", "千万"],
}

NEG = ("不", "无需", "免", "别", "没有", "不用")

KIND_ORDER = {"oss": 0, "pattern": 1, "commercial": 2, "build": 3}
KIND_CN = {"oss": "开源", "pattern": "做法", "commercial": "闭源", "build": "自研"}
MAXC = 14          # 一句需求的格子上限：再多就是需求本身没想清


def norm(s):
    s = s.lower()
    s = re.sub(r"[\s,，。；;、！!？?（）()【】\[\]「」“”\"'—\-]+", "", s)
    return s


def width(s):
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in s)


def pad(s, n):
    """按终端显示宽度补空格；超宽则截断加省略，避免串行。"""
    if width(s) > n:
        out, acc = "", 0
        for ch in s:
            w = 2 if unicodedata.east_asian_width(ch) in "WF" else 1
            if acc + w > n - 1:
                break
            out += ch
            acc += w
        return out + " "
    return s + " " * (n - width(s))


def hit(t, w):
    """词在文本里出现且不被否定。否定只看命中位置前 3 个字。"""
    w = norm(w)
    start = 0
    while True:
        i = t.find(w, start)
        if i < 0:
            return False
        if not any(n in t[max(0, i - 3):i] for n in NEG):
            return True
        start = i + 1


class Arch:
    def __init__(self, path=SRC):
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        self.d = d
        self.idx = {c["id"]: c for c in d["components"]}
        self.products = d["products"]

    def dom_of(self, cid):
        cur, hop = cid, 0
        while cur and hop < 6:
            c = self.idx.get(cur)
            if not c:
                return None
            if c["kind"] == "domain":
                return cur
            cur, hop = c["parent"], hop + 1
        return None

    # ── 需求 → 模块 ────────────────────────────────────────────────
    def build(self, need):
        t = norm(need)
        prefs = {k: [w for w in ws if hit(t, w)] for k, ws in CONS.items()}
        prefs = {k: v for k, v in prefs.items() if v}

        hits = OrderedDict()

        def add(cid, w, why):
            if cid not in self.idx or self.idx[cid]["kind"] == "domain":
                return
            h = hits.setdefault(cid, {"score": 0, "why": []})
            h["score"] += w
            h["why"].append(why)

        # 1) 词表
        for cid, (strong, weak) in TRIG.items():
            ns = [w for w in strong if hit(t, w)]
            if ns:
                add(cid, 3 * min(len(ns), 3), "命中「%s」" % "、".join(ns[:3]))
                continue
            nw = [w for w in weak if hit(t, w)]
            if nw:
                add(cid, 1, "沾到「%s」" % "、".join(nw[:2]))

        # 2) 场景规则（权重高于单个词：它代表一句业务常识）
        scen_hit = []
        for label, words, mods, why in SCEN:
            ns = [w for w in words if hit(t, w)]
            if not ns:
                continue
            scen_hit.append((label, ns, why))
            for cid in mods:
                add(cid, 5, "场景「%s」" % label)

        # 3) 定档
        must, opt = [], []
        for cid, h in hits.items():
            (must if h["score"] >= 3 else opt).append(cid)

        # 4) 依赖闭包
        pulled = OrderedDict()
        queue = list(must)
        while queue:
            cid = queue.pop(0)
            for dep in REQ.get(cid, []):
                if dep in must:
                    continue
                must.append(dep)
                pulled[dep] = cid
                queue.append(dep)

        # 5) 只要选了 AI 域的东西，兜底补网关（没有模型就没有 AI 方案）
        if any(self.dom_of(c) not in ("ai.deliver", "ai.model", "app", "hw") for c in must):
            if "ai.model.gateway" not in must:
                must.append("ai.model.gateway")
                pulled["ai.model.gateway"] = "AI 域兜底"

        # 6) 上限
        opt = [c for c in opt if c not in must]
        opt.sort(key=lambda c: -hits[c]["score"])
        if len(must) > MAXC:
            must.sort(key=lambda c: -hits[c]["score"])
            keep = set(must[:MAXC])
            must = [c for c in must if c in keep]
        opt = opt[: max(0, MAXC - len(must))]

        # 7) 缺口
        gaps = []
        for words, name, how in GAP:
            ns = [w for w in words if hit(t, w)]
            if ns:
                gaps.append({"name": name, "how": how, "why": "需求提到「%s」" % "、".join(ns[:3])})

        return {"need": need, "prefs": prefs, "must": must, "opt": opt,
                "hits": hits, "pulled": pulled, "gaps": gaps, "scen": scen_hit}

    # ── 每格挑方案 ────────────────────────────────────────────────
    def pick(self, cid, prefs, n=2):
        c = self.idx[cid]
        ps = list(c.get("providers") or [])
        if "free" in prefs or "local" in prefs:
            ps = [p for p in ps if p["kind"] != "commercial"] or ps
        ps.sort(key=lambda p: KIND_ORDER.get(p["kind"], 9))
        return ps[:n], len(c.get("providers") or [])

    # ── 需求 → 现成软件 ──────────────────────────────────────────
    def buy(self, need, cover, topn=5, pool="trusted"):
        """按「该有的格子被这个软件覆盖了多少」排序，只做候选排序，不代表能用。

        三条校准（跑真实需求时发现的）：
          · 排除 app 域：买 SaaS 不用你自建数据库和账号，那是自建才要的格。
          · 网关权重压到 1：200 个产品里 92 个都有网关，它没有区分度，算重了会把写作工具排到记账需求第一。
          · 主域加权：需求的主战场（命中最多 must 的域）权 4，其余 3，被带出的底座权 1。
        """
        from collections import Counter
        cand = [c for c in cover["must"] if self.dom_of(c) != "app"]
        if not cand:
            return [], 0
        core = [c for c in cand if c not in cover["pulled"]]
        main = Counter(self.dom_of(c) for c in core or cand).most_common(1)[0][0]

        def w(c):
            if c in cover["pulled"] or c == "ai.model.gateway":
                return 1
            return 4 if self.dom_of(c) == main else 3

        wsum = sum(w(c) for c in cand)
        rows = []
        prods = self.products if pool == "all" else [x for x in self.products
                                                     if not x["id"].startswith("ab")]
        for p in prods:
            have = {x["component"] for x in p.get("composes", [])}
            got = [c for c in cand if c in have]
            rows.append({"id": p["id"], "name": p["name"], "cat": p["category"],
                         "rate": round(100.0 * sum(w(c) for c in got) / wsum),
                         "hit": len(got),
                         "miss": [self.idx[c]["name"] for c in cand if c not in have],
                         "guessed": p["id"].startswith("ab"),   # ab* = 规则推的组合，未人工核
                         "note": p.get("note", "")})
        # 手拆的组合比规则推的可信，同分时排前（+3 只影响并列，不改排序结论）
        rows.sort(key=lambda r: (-(r["rate"] + (0 if r["guessed"] else 3)), r["id"]))
        rows = [r for r in rows if r["rate"] >= 30][:topn] or rows[:1]
        return rows, len(cand)


def card(a, need, show_opt=True):
    cov = a.build(need)
    out = ["", "需求：" + need]
    pf = "、".join("%s=%s" % (k, "/".join(v)) for k, v in cov["prefs"].items())
    out.append("约束：" + (pf or "无"))
    if cov["scen"]:
        out.append("场景：" + "；".join("%s →%s" % (l, w) for l, w, _ in cov["scen"]))
    out.append("必选 %d 格 / 可选 %d 格 / 库外缺口 %d" % (
        len(cov["must"]), len(cov["opt"]), len(cov["gaps"])))
    out.append("")

    order = {d: i for i, d in enumerate(DOM_ORDER)}
    must = sorted(cov["must"], key=lambda c: (order.get(a.dom_of(c), 99),
                                              -cov["hits"].get(c, {"score": 9})["score"]))
    parts = {}
    for c in a.d["components"]:
        if c["kind"] == "part":
            parts.setdefault(c["parent"], []).append(c["name"])
    cur = None
    for cid in must:
        d = a.dom_of(cid)
        if d != cur:
            cur = d
            out.append("〔%s〕" % DOM_CN.get(d, d))
        c = a.idx[cid]
        ps, total = a.pick(cid, cov["prefs"])
        pstr = "｜".join("%s（%s）" % (p["name"], KIND_CN.get(p["kind"], p["kind"])) for p in ps) or "—"
        if total > len(ps):
            pstr += " 等 %d 款" % total
        why = cov["hits"].get(cid, {}).get("why")
        wstr = why[0] if why else ("←%s 带出" % cov["pulled"][cid] if cid in cov["pulled"] else "")
        out.append("  ● " + pad(c["name"], 16) + pad(cid, 24) + wstr)
        out.append("      → " + pstr)
        if cid in parts:
            out.append("      └ 内含子模块：" + "、".join(parts[cid]))
    if show_opt and cov["opt"]:
        out.append("〔可选〕" + "、".join(a.idx[c]["name"] for c in cov["opt"]))
    for g in cov["gaps"]:
        out.append("〔库外〕%s —— %s" % (g["name"], g["how"]))
    if not cov["must"]:
        out.append("！0 格命中：这句需求不在本库能力范围内（本库只管 AI 软件）")
    return "\n".join(out)


def buy_card(a, need, topn=5, pool="trusted"):
    cov = a.build(need)
    rows, n = a.buy(need, cov, topn, pool)
    scope = "全部 200 个" if pool == "all" else "30 个手拆产品"
    out = ["", "买现成（%s，按覆盖 %d 个 AI 必选格算）：" % (scope, n)]
    if not rows:
        out.append("  没有能覆盖一半的现成产品 —— 这条路走不通，回上面自建")
        return "\n".join(out)
    for r in rows:
        miss = "、".join(r["miss"][:3]) + ("…" if len(r["miss"]) > 3 else "") if r["miss"] else "无"
        out.append("  %3d%%  %s %s%s 缺：%s" % (
            r["rate"], pad(r["name"], 16), pad(r["id"], 12),
            "推断" if r["guessed"] else "手拆", miss))
    return "\n".join(out)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)
    mode = "both"
    pool = "trusted"
    if args and args[0] == "--all":
        pool, args = "all", args[1:]
    if args and args[0] in ("--buy", "--build", "--json"):
        mode, args = args[0][2:], args[1:]
    need = " ".join(args)
    if not need:
        print("需要一个需求文本")
        sys.exit(1)
    a = Arch()
    if mode == "json":
        cov = a.build(need)
        cov["must"] = [{"id": c, "name": a.idx[c]["name"], "dom": a.dom_of(c),
                        "pulled": cov["pulled"].get(c)} for c in cov["must"]]
        cov["opt"] = [{"id": c, "name": a.idx[c]["name"]} for c in cov["opt"]]
        cov["hits"] = {k: v["why"] for k, v in cov["hits"].items()}
        print(json.dumps(cov, ensure_ascii=False, indent=1))
    elif mode == "build":
        print(card(a, need))
    elif mode == "buy":
        print(buy_card(a, need, pool=pool))
    else:
        print(card(a, need))
        print(buy_card(a, need, pool=pool))
