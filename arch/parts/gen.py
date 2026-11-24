#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把所有 parts/seed*.py 合并成 arch/arch.json。加批次只需在这里多 import 一个。"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import seed01  # noqa: E402
import seed02  # noqa: E402
import seed03  # noqa: E402
import seed04  # noqa: E402

COMPS = seed01.COMPS
PRODS = seed01.PRODS
OUT = os.path.join(os.path.dirname(HERE), "arch.json")


def main():
    ids = [c["id"] for c in COMPS]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        print("重复模块 id：%s" % ", ".join(sorted(dup)))
        return 1
    pids = [p["id"] for p in PRODS]
    pdup = {i for i in pids if pids.count(i) > 1}
    if pdup:
        print("重复软件 id：%s" % ", ".join(sorted(pdup)))
        return 1
    d = {
        "spec": "moshan-arch/1",
        "updated": "2026-11-24",
        "note": "本体 → 模块 → 子模块。层级靠 parent 串，level 由脚本推。providers 里必须有拿得到的方案。",
        "components": COMPS,
        "products": PRODS,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("写出 %s：模块 %d / 软件 %d" % (OUT, len(COMPS), len(PRODS)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
