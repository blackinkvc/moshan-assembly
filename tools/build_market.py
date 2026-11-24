#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把商店索引、插件清单、能力目录内嵌进 market.html，产出可离线双击打开的单文件市场。

用法:
  python3 tools/build_market.py [--registry registry/registry.json]
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TPL = os.path.join(ROOT, "market.template.html")
OUT = os.path.join(ROOT, "market.html")
CATALOG = os.path.join(ROOT, "catalog", "moshan-catalog.json")


def dump(obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return s.replace("</", "<\\/")


def main(argv):
    reg_path = os.path.join(ROOT, "registry", "registry.json")
    if "--registry" in argv:
        reg_path = argv[argv.index("--registry") + 1]
    if not os.path.exists(reg_path):
        print("✗ 找不到 %s，先跑：python3 tools/moshan.py registry \"examples/*.moshan.json\"" % reg_path)
        return 1
    reg = json.load(open(reg_path, encoding="utf-8"))

    manifests = {}
    for p in reg["plugins"]:
        mp = p.get("manifest")
        if not mp:
            continue
        fp = mp if os.path.isabs(mp) else os.path.join(ROOT, mp)
        if os.path.exists(fp):
            manifests[p["id"]] = json.load(open(fp, encoding="utf-8"))

    html = open(TPL, encoding="utf-8").read()
    for token in ("<!--REGISTRY_JSON-->", "<!--MANIFESTS_JSON-->", "<!--CATALOG_JSON-->"):
        if token not in html:
            print("✗ 模板缺少占位标记 %s" % token)
            return 1
    html = html.replace("<!--REGISTRY_JSON-->", dump(reg))
    html = html.replace("<!--MANIFESTS_JSON-->", dump(manifests))
    html = html.replace("<!--CATALOG_JSON-->", dump(json.load(open(CATALOG, encoding="utf-8"))))
    open(OUT, "w", encoding="utf-8").write(html)
    print("✓ 已生成 market.html（%.1f KB，%d 个插件 / %d 份清单 / %d 个软件条目）" % (
        len(html) / 1024.0, len(reg["plugins"]), len(manifests),
        len(json.load(open(CATALOG, encoding="utf-8"))["entries"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
