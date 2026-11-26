#!/usr/bin/env python3
"""第二批：把「AI 帮你…」这类口语方案名与残留的「省事」改为书面表述。"""
import json
import pathlib

P = pathlib.Path(__file__).resolve().parent.parent / "ui" / "data" / "catalog.json"
d = json.loads(P.read_text(encoding="utf-8"))

NAME = {
    ("shell", "b-shell"): "AI 生成外壳",
    ("data", "b-data"): "AI 生成存储层",
    ("eng-lib", "b-lib"): "AI 从手册生成库",
    ("eng-sch", "b-sch"): "AI 生成第一版原理图",
    ("eng-pcb", "b-pcb"): "AI 评审布局",
    ("eng-drc", "b-drc"): "AI 生成检查规则",
    ("eng-bom", "b-bom"): "AI 校验 BOM",
    ("eng-fab", "b-fab"): "AI 生成交付包",
    ("eng-rtl", "b-rtl"): "AI 生成 RTL",
    ("eng-sim", "b-sim"): "AI 生成 testbench",
    ("eng-synth", "b-synth"): "AI 生成约束与流程",
    ("eng-signoff", "b-sig"): "AI 解读签核报告",
    ("train-data", "b-data"): "AI 搭建数据流水线",
    ("train-run", "b-run"): "AI 生成训练脚本",
    ("train-eval", "b-eval"): "AI 搭建评测台",
    ("train-ckpt", "b-ckpt"): "AI 维护权重台账",
    ("site-space", "b-space"): "AI 排布库位与动线",
    ("site-in", "b-in"): "AI 生成收货台",
    ("site-stock", "b-stock"): "AI 生成效期台账",
    ("site-pick", "b-pick"): "AI 生成拣货复核",
    ("site-count", "b-count"): "AI 生成盘点工具",
    ("site-order", "b-order"): "AI 生成点单台",
    ("site-recipe", "b-recipe"): "AI 计算配方与损耗",
    ("site-channel", "b-channel"): "AI 生成渠道中台",
    ("site-shift", "b-shift"): "AI 生成日结工具",
    ("site-offgrid", "b-offgrid"): "AI 生成离线层",
    ("site-ticket", "b-ticket"): "AI 生成票务台",
    ("site-gate", "b-gate"): "AI 辅助接入闸机",
    ("site-safety", "b-safety"): "AI 生成点检闭环",
    ("site-room", "b-room"): "AI 生成房态台",
    ("site-lock", "b-lock"): "AI 辅助接入门锁与自助入住",
    ("site-duty", "b-duty"): "AI 生成值守工具",
}

NOTE = {
    ("imagegen", "api"): "接入最省事，按张计费；需存下提示词与种子，否则好图无法复现",
    ("pcb", "easyeda"): "元件库与打样打通，入门成本最低；复杂板子不如 KiCad",
    ("serial", "bridge"): "接入最快、最易调试；多一个进程需要守护",
}

NOTE["imagegen", "api"] = "接入最省事，按张计费；需存下提示词与种子，否则好图无法复现"

for m in d["HUB"]:
    for pv in m.get("provs", []):
        k = (m["id"], pv["id"])
        if k in NAME:
            pv["n"] = NAME[k]
        if k in NOTE:
            pv["note"] = NOTE[k]

P.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
print("ok")
