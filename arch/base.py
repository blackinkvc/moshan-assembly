#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""项目卡 + 连通检查：把「要哪几格」变成「勾哪几个、能不能接上、按什么顺序做」。

用法：
  python3 arch/base.py "拍张照识别小票，记到账本里"            出卡 + 默认勾选的连通检查
  python3 arch/base.py --pick "ocr,sheet,data" "同一个需求"     只检查这几个勾
  python3 arch/base.py --html                                  重新生成 planner.html

三档怎么分（这是给小白看的核心）：
  必选  去掉就做不成。用户直接要的格 + 模型网关（没有它任何 AI 格都是空的）
  建议  引擎为了让链路通自动带上的格。不勾也能跑，但某条线会断
  看情况 沾边但不确定你要不要。默认不勾
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import match                                                # noqa: E402
import wires                                                # noqa: E402

T = wires.TYPE_CN
EXT = wires.EXT


def implied(a, picks):
    """需求没明说、但只要产出了这些类型就一定要有的格。
    「谁来看结果」「数据存哪」属于架构常识，不是猜测——猜的是「要不要做」，这里是「做了就必须有」。"""
    giv = {x for c in picks for x in wires.WIRE.get(c, ([], []))[1]}
    out = []
    if "R" in giv and "app.data" not in picks:
        out.append("app.data")
    if ({"T", "R", "F"} & giv) and "X" not in giv and "app.ui" not in picks:
        out.append("app.ui")
    return [c for c in out if c in a.idx]


def tier(a, cov):
    """把 must/pulled/opt 分成 必选/建议/看情况。"""
    core, rec, scene = [], [], []
    for cid in implied(a, cov["must"]):
        rec.append(cid)
    for cid in cov["must"]:
        if cid in cov["pulled"]:
            # 网关是硬依赖：任何 AI 格没它都跑不了，不能算「建议」
            (core if cid == "ai.model.gateway" else rec).append(cid)
        else:
            core.append(cid)
    scene = [c for c in cov["opt"] if c not in cov["must"]]
    return core, rec, scene


def io_cn(cid):
    needs, gives = wires.WIRE.get(cid, ([], []))
    if cid in wires.UI_FREE:
        ins = "（自己就是入口）"
    elif not needs:
        ins = "（不需要输入）"
    else:
        ins = " 或 ".join("+".join(T[x] for x in g) for g in needs)
    outs = " + ".join(T[x] for x in gives) if gives else "（无产出）"
    return ins, outs


def check(a, picks):
    """picks: 勾选的 cid 列表。返回 (断点列表, 施工顺序, 线的条数)。"""
    picks = [c for c in picks if c in wires.WIRE]
    given = {}
    for cid in picks:
        for x in wires.WIRE[cid][1]:
            given.setdefault(x, []).append(cid)

    breaks = []
    for cid in picks:
        if cid in wires.UI_FREE:
            continue
        for grp in wires.WIRE[cid][0]:
            ok = False
            for x in grp:
                if x in EXT:
                    ok = True
                elif any(o != cid for o in given.get(x, [])):
                    ok = True
            if not ok:
                missing = "、".join(T[x] for x in grp)
                fix = []
                for x in grp:
                    for p in wires.PATCH.get(x, []):
                        if p not in picks:
                            fix.append(a.idx[p]["name"])
                breaks.append({"who": a.idx[cid]["name"], "cid": cid,
                               "need": missing, "fix": fix[:3]})

    # 拓扑：每轮挑「输入已被已排格或外部源满足」的格
    done, order, pool = set(), [], list(picks)   # done 里存的是「已产出的类型」，不是格 id
    while pool:
        ready = []
        for cid in pool:
            if cid in wires.UI_FREE:
                ready.append(cid)
                continue
            good = True
            for grp in wires.WIRE[cid][0]:
                if not any((x in EXT) or (x in done) for x in grp):
                    good = False
                    break
            if good:
                ready.append(cid)
        if not ready:                       # 有环，剩下的按原序收尾
            order.extend(pool)
            break
        # 同轮内：先做「源头格」（不需要输入的），再按域顺序
        def rank(c):
            # 「文本」是万能输入，谁都能吃，按它算依赖度会把所有给文本的格排到最前，失真
            outs = set(wires.WIRE[c][1]) - {"T", "S", "E"}
            used = sum(1 for o in picks if o != c and any(set(g) & outs for g in wires.WIRE[o][0]))
            return (0 if not wires.WIRE[c][0] else 1, -used,
                    match.DOM_ORDER.index(a.dom_of(c)) if a.dom_of(c) in match.DOM_ORDER else 99)
        ready.sort(key=rank)
        order.extend(ready)
        for c in ready:
            done |= set(wires.WIRE[c][1])
        pool = [c for c in pool if c not in ready]

    # 出口检查：做出来的东西没人接，也没界面/发布交出去
    dead = []
    for cid in picks:
        if cid.startswith("ai.deliver") or cid == "app.ui":
            continue
        for x in wires.WIRE[cid][1]:
            if x in ("X", "Q", "E", "S"):
                continue
            if not any(x in g for o in picks if o != cid for g in wires.WIRE[o][0]):
                dead.append((cid, x))

    lines = sum(len(v) for v in given.values())
    return breaks, order, lines, dead


def card(a, need, show_all=True):
    cov = a.build(need)
    core, rec, scene = tier(a, cov)
    allp = core + rec + scene
    out = ["", "═" * 62,
           " 项目卡 · " + need[:40] + ("…" if len(need) > 40 else ""),
           " 共 %d 格：必选 %d · 建议 %d · 看情况 %d   （最少 %d 格能跑，推荐 %d 格）"
           % (len(allp), len(core), len(rec), len(scene), len(core), len(core) + len(rec)),
           "═" * 62]

    def block(title, hint, ids, mark):
        if not ids:
            return
        out.append("")
        out.append("【%s】%s" % (title, hint))
        for cid in ids:
            c = a.idx[cid]
            ins, outs = io_cn(cid)
            ps, total = a.pick(cid, cov["prefs"])
            pstr = "｜".join("%s（%s）" % (p["name"], match.KIND_CN.get(p["kind"], p["kind"]))
                             for p in ps) or "—"
            out.append("  %s %s %s" % (mark, match.pad(c["name"], 16), cid))
            out.append("     干什么：%s" % c["abstract"])
            out.append("     进 → 出：%s ─→ %s" % (ins, outs))
            out.append("     方案：%s%s" % (pstr, (" 等 %d 款" % total) if total > len(ps) else ""))

    block("必选", "去掉就做不成", core, "☑")
    block("建议", "引擎为了让线通自动带的，不勾这条线会断", rec, "☑")
    if show_all:
        block("看情况", "沾边，你要不要？默认不勾", scene, "☐")

    picks = core + rec
    breaks, order, lines, dead = check(a, picks)
    out.append("")
    out.append("── 连通检查（默认勾 %d 格）──" % len(picks))
    if not picks:
        out.append("0 格可勾：这句需求不在库里，看下面「库外」怎么写，或把需求改成「输入是什么 → 产出是什么」再试")
    elif not breaks:
        out.append("✓ 全通：%d 条线都能接上，可以开工" % lines)
    else:
        out.append("✗ %d 处断点：" % len(breaks))
        for b in breaks:
            out.append("  · %s 需要「%s」，勾选里没人产出" % (b["who"], b["need"]))
            if b["fix"]:
                out.append("    补：%s" % " / ".join(b["fix"]))
    out.append("")
    if dead:
        names = ["%s → %s" % (a.idx[c]["name"], T[x]) for c, x in dead]
        out.append("⚠ 做出来没去处：%s（加一格界面或发布）" % "、".join(names[:3]))
        out.append("")
    if order:
        out.append("施工顺序（按数据流，先做的先能吃上数据）：")
    for i, cid in enumerate(order, 1):
        ins, outs = io_cn(cid)
        out.append("  %2d. %s %-22s %s ─→ %s"
                   % (i, match.pad(a.idx[cid]["name"], 16), cid, ins, outs))
    if cov["gaps"]:
        out.append("")
        out.append("库外（要自己找方案，库里没有）：")
        for g in cov["gaps"]:
            out.append("  - %s：%s" % (g["name"], g["how"]))
    return "\n".join(out)


def parse_pick(a, s):
    """支持 cid 全名、cid 尾段、中文名。"""
    want, out = [], []
    for tok in s.replace("，", ",").split(","):
        tok = tok.strip()
        if not tok:
            continue
        for cid, c in a.idx.items():
            if c["kind"] == "domain":
                continue
            if tok in (cid, cid.split(".")[-1], c["name"]):
                out.append(cid)
                break
        else:
            want.append(tok)
    for w in want:
        print("！没认出来：" + w)
    return out


# ── GUI ────────────────────────────────────────────────────────────────
def build_html(a):
    tmpl = os.path.join(HERE, "planner.template.html")
    dst = os.path.join(HERE, "planner.html")
    if not os.path.exists(tmpl):
        print("缺 template：%s" % tmpl)
        return 1
    data = {
        "comps": [{"id": c["id"], "name": c["name"], "kind": c["kind"],
                   "dom": a.dom_of(c["id"]), "abstract": c["abstract"],
                   "providers": [{"n": p["name"], "k": p["kind"]} for p in c.get("providers", [])][:3],
                   "np": len(c.get("providers", []))}
                  for c in a.d["components"] if c["kind"] != "domain"],
        "doms": match.DOM_CN,
        "domOrder": match.DOM_ORDER,
        "trig": match.TRIG, "scen": match.SCEN, "req": match.REQ,
        "gap": match.GAP, "cons": match.CONS, "neg": list(match.NEG),
        "wire": wires.WIRE, "typeCn": wires.TYPE_CN, "ext": list(wires.EXT),
        "patch": wires.PATCH,
    }
    js = json.dumps(data, ensure_ascii=False)
    with open(tmpl, encoding="utf-8") as f:
        html = f.read()
    html = html.replace("/*__DATA__*/null", js)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(html)
    print("写出 %s（%.0f KB）" % (dst, len(html) / 1024))
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    a = match.Arch()
    if args and args[0] == "--html":
        sys.exit(build_html(a))
    if not args:
        print(__doc__)
        sys.exit(0)
    pick = None
    if args[0] == "--pick":
        pick, args = args[1], args[2:]
    need = " ".join(args)
    if pick:
        cov = a.build(need)
        core, rec, scene = tier(a, cov)
        picks = parse_pick(a, pick)
        breaks, order, lines, dead = check(a, picks)
        print("需求：%s" % need)
        print("勾选 %d 格：%s" % (len(picks), "、".join(a.idx[c]["name"] for c in picks)))
        print("─" * 50)
        if breaks:
            print("✗ %d 处断点：" % len(breaks))
            for b in breaks:
                print("  · %s 需要「%s」，没人产出" % (b["who"], b["need"]))
                if b["fix"]:
                    print("    补：%s" % " / ".join(b["fix"]))
        else:
            print("✓ 全通：%d 条线都能接上" % lines)
        if dead:
            print("⚠ 没去处：" + "、".join("%s→%s" % (a.idx[c]["name"], T[x]) for c, x in dead[:3]))
        print("施工顺序：" + " → ".join(a.idx[c]["name"] for c in order))
    else:
        print(card(a, need))
