#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把能力目录与默认蓝图内嵌进画布，产出可直接双击打开的单文件 canvas.html。

为什么内嵌而不是 fetch：
  file:// 下 fetch 会被 CORS 拦掉，画布就白屏了。
  内嵌后 canvas.html 是一份自包含文件，能直接发给别人看，也能离线用。

用法:
  python3 tools/build_canvas.py [--blueprint examples/blueprint-media.json]
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TPL = os.path.join(ROOT, "canvas.template.html")
OUT = os.path.join(ROOT, "canvas.html")
CATALOG = os.path.join(ROOT, "catalog", "moshan-catalog.json")


def dump(path):
    with open(path, "r", encoding="utf-8") as f:
        d = json.load(f)
    # 防止 JSON 里的 </script> 提前闭合标签
    s = json.dumps(d, ensure_ascii=False, indent=None, separators=(",", ":"))
    return s.replace("</", "<\\/")


def main(argv):
    bp = os.path.join(ROOT, "examples", "blueprint-media.json")
    if "--blueprint" in argv:
        bp = argv[argv.index("--blueprint") + 1]

    with open(TPL, "r", encoding="utf-8") as f:
        html = f.read()

    if "<!--CATALOG_JSON-->" not in html or "<!--BLUEPRINT_JSON-->" not in html:
        print("✗ 模板缺少内嵌占位标记")
        return 1

    html = html.replace("<!--CATALOG_JSON-->", dump(CATALOG))
    html = html.replace("<!--BLUEPRINT_JSON-->", dump(bp))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("✓ 已生成 canvas.html（%.1f KB，内嵌 %d 个软件条目）" % (len(html) / 1024, len(json.load(open(CATALOG, encoding="utf-8"))["entries"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
