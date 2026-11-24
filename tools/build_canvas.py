#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把能力目录与默认蓝图内嵌进画布，产出可直接双击打开的单文件 canvas.html。

为什么内嵌而不是 fetch：
  file:// 下 fetch 会被 CORS 拦掉，画布就白屏了。
  内嵌后 canvas.html 是一份自包含文件，能直接发给别人看，也能离线用。

用法:
  python3 tools/build_canvas.py [--blueprint examples/blueprint-media.json]
"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TPL = os.path.join(ROOT, "canvas.template.html")
OUT = os.path.join(ROOT, "canvas.html")
CATALOG = os.path.join(ROOT, "catalog", "moshan-catalog.json")
CASES = os.path.join(ROOT, "examples", "blueprint-*.json")


def dump(path):
    with open(path, "r", encoding="utf-8") as f:
        d = json.load(f)
    # 防止 JSON 里的 </script> 提前闭合标签
    s = json.dumps(d, ensure_ascii=False, indent=None, separators=(",", ":"))
    return s.replace("</", "<\\/")


def build_cases(default_bp):
    """页头下拉里的案例集：默认那份打头，其余 examples/blueprint-*.json 一并内嵌。
    新增一个案例只要加一个 json，不用改模板。"""
    pool, seen = [default_bp], {default_bp.get("id")}
    for p in sorted(glob.glob(CASES)):
        if os.path.basename(p).startswith("._"):   # exFAT 边车，不是案例
            continue
        with open(p, "r", encoding="utf-8") as f:
            bp = json.load(f)
        if "slots" not in bp or bp.get("id") in seen:
            continue
        seen.add(bp.get("id"))
        pool.append(bp)
    return pool


def main(argv):
    bp = os.path.join(ROOT, "examples", "blueprint-media.json")
    if "--blueprint" in argv:
        bp = argv[argv.index("--blueprint") + 1]

    with open(TPL, "r", encoding="utf-8") as f:
        html = f.read()

    marks = ("<!--CATALOG_JSON-->", "<!--BLUEPRINT_JSON-->", "<!--CASES_JSON-->")
    missing = [m for m in marks if m not in html]
    if missing:
        print("✗ 模板缺少内嵌占位标记：%s" % "、".join(missing))
        return 1

    with open(bp, "r", encoding="utf-8") as f:
        default_bp = json.load(f)

    html = html.replace("<!--CATALOG_JSON-->", dump(CATALOG))
    html = html.replace("<!--BLUEPRINT_JSON-->", dump(bp))
    html = html.replace("<!--CASES_JSON-->", json.dumps(
        build_cases(default_bp), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("✓ 已生成 canvas.html（%.1f KB，内嵌 %d 个条目、%d 个案例）" % (
        len(html) / 1024,
        len(json.load(open(CATALOG, encoding="utf-8"))["entries"]),
        len(build_cases(default_bp))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
