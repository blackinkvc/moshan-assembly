#!/usr/bin/env python3
"""把 guide.template.html 里的 {{IMG_*}} 换成图内联的 base64，产出单文件 guide.html。

图在 arch/doc_img/，是界面实拍（见 arch/shot_guide.js 一类脚本）。单文件的好处是
可以直接发给不做技术的人，不用带文件夹。
"""
import base64
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
IMG = HERE / "doc_img"

MAP = {
    "{{IMG_FULL}}": "e_full.jpg",
    "{{IMG_ASK}}": "a_ask.jpg",
    "{{IMG_CARD}}": "b_card.jpg",
    "{{IMG_OPT}}": "i_opt.jpg",
    "{{IMG_BREAK}}": "k_break.jpg",
    "{{IMG_SIDE}}": "c_side.jpg",
    "{{IMG_ZERO}}": "f_zero.jpg",
}


def main() -> int:
    tpl = (HERE / "guide.template.html").read_text(encoding="utf-8")
    miss = [k for k in MAP if k in tpl]
    if not miss:
        print("模板里没有占位符，检查 guide.template.html", file=sys.stderr)
        return 1

    total, used = 0, 0
    for key, fname in MAP.items():
        if key not in tpl:
            continue
        path = IMG / fname
        if not path.exists():
            print("缺图：%s" % path, file=sys.stderr)
            return 1
        raw = path.read_bytes()
        total += len(raw)
        used += 1
        tpl = tpl.replace(key, "data:image/jpeg;base64," + base64.b64encode(raw).decode())

    left = [k for k in MAP if k in tpl]
    if left:
        print("还有未替换的占位符：%s" % left, file=sys.stderr)
        return 1

    out = HERE / "guide.html"
    out.write_text(tpl, encoding="utf-8")
    print("→ %s  %.0f KB（图 %.0f KB / %d 张）" % (
        out, out.stat().st_size / 1024, total / 1024, used))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
