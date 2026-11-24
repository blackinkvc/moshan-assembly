#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 arch/app.html —— 产品原型：完整按钮 + 页面跳转 + 确认后模拟组装。

与 planner.html 的区别：planner 只有一屏（卡片 + 检查），这里是产品形态的
多屏应用（工作台 / 需求 / 选型 / 确认 / 组装 / 完成 / 模块库），后面接真
实的组装流水线时，前端只需要把 build 那一段换成真调用。

用法：python3 arch/app.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import match                                                # noqa: E402
import wires                                                # noqa: E402
from base import io_cn                                      # noqa: E402


def payload(a):
    comps = []
    for c in a.d["components"]:
        if c["kind"] == "domain":
            continue
        ins, outs = io_cn(c["id"])
        provs = []
        for p in c.get("providers", []):
            provs.append({
                "id": p.get("id", p["name"]), "n": p["name"], "k": p["kind"],
                "lic": p.get("license", ""), "repo": p.get("repo") or p.get("homepage", ""),
                "note": p.get("note", ""),
                "effort": p.get("effort", ""), "tokens": p.get("tokens", ""),
                "outline": p.get("outline", []),
            })
        comps.append({
            "id": c["id"], "name": c["name"], "kind": c["kind"], "dom": a.dom_of(c["id"]),
            "abstract": c["abstract"], "note": c.get("note", ""),
            "ins": ins, "outs": outs, "pv": provs,
        })
    return {
        "comps": comps,
        "wire": wires.WIRE, "typeCn": wires.TYPE_CN, "ext": list(wires.EXT),
        "patch": wires.PATCH,
        "doms": match.DOM_CN, "domOrder": match.DOM_ORDER, "kindCn": match.KIND_CN,
        "trig": match.TRIG, "scen": match.SCEN, "req": match.REQ,
        "gap": match.GAP, "cons": match.CONS, "neg": list(match.NEG),
    }


def main():
    a = match.Arch()
    tpl_path = os.path.join(HERE, "app.template.html")
    if not os.path.exists(tpl_path):
        print("缺模板：%s" % tpl_path, file=sys.stderr)
        return 1
    tpl = open(tpl_path, encoding="utf-8").read()
    if "/*__DATA__*/null" not in tpl:
        print("模板里找不到数据占位符", file=sys.stderr)
        return 1
    js = json.dumps(payload(a), ensure_ascii=False, separators=(",", ":"))
    html = tpl.replace("/*__DATA__*/null", js)
    dst = os.path.join(HERE, "app.html")
    open(dst, "w", encoding="utf-8").write(html)
    print("→ %s  %.0f KB（数据 %.0f KB / %d 格）"
          % (dst, len(html.encode()) / 1024, len(js.encode()) / 1024,
             len([c for c in a.d["components"] if c["kind"] != "domain"])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
