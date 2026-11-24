#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""墨山架构库：校验 arch.json、生成 arch.db、按需查询。

用法：
  python3 arch/build.py                 校验 + 重建 arch.db + 打印统计
  python3 arch/build.py --tree kb       看某棵子树
  python3 arch/build.py --comp kb.rag   看某个模块的全部方案
  python3 arch/build.py --product dify  看某软件由哪些模块拼成
"""
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "arch.json")
DB = os.path.join(HERE, "arch.db")


class Err:
    def __init__(self):
        self.items = []

    def add(self, where, msg):
        self.items.append((where, msg))

    def dump(self):
        for w, m in self.items:
            print("  x %-28s %s" % (w, m))
        return len(self.items)


def load():
    with open(SRC, encoding="utf-8") as f:
        return json.load(f)


def check(d):
    """返回 (errors, comp_index)。错误全收，不早退——一次改完比逐条试快。"""
    e = Err()
    comps = d.get("components") or []
    prods = d.get("products") or []

    idx = {}
    for i, c in enumerate(comps):
        w = "components[%d]" % i
        cid = c.get("id")
        if not cid:
            e.add(w, "缺少 id")
            continue
        if cid in idx:
            e.add(w, "id 重复 %r" % cid)
            continue
        idx[cid] = c

    # 层级：level 由 parent 推，链条必须闭合，不许成环
    levels = {}

    def level_of(cid, seen=None):
        if cid in levels:
            return levels[cid]
        if cid not in idx:
            return None
        seen = seen or set()
        if cid in seen:
            e.add(cid, "parent 链条成环")
            return 1
        seen.add(cid)
        p = idx[cid].get("parent")
        if not p:
            levels[cid] = 1
        else:
            pl = level_of(p, seen)
            levels[cid] = (pl or 0) + 1
        return levels[cid]

    for cid in idx:
        level_of(cid)

    for cid, c in idx.items():
        w = cid
        kind = c.get("kind")
        parent = c.get("parent")
        lv = levels.get(cid, 1)
        if kind not in ("domain", "module", "part"):
            e.add(w, "kind 必须是 domain/module/part")
        if not parent:
            # 没有 parent 的可以是「本体域」，也可以是「独立模块」——小 skill 只有一层，不该硬塞进某个域
            if kind not in ("domain", "module"):
                e.add(w, "没有 parent 的只能是 domain，或 kind=module 的独立模块")
            if lv != 1:
                e.add(w, "层级算出来是 %d，顶层应为 1" % lv)
        else:
            if parent not in idx:
                e.add(w, "parent %r 不存在" % parent)
            else:
                pk = idx[parent].get("kind")
                if kind == "domain":
                    e.add(w, "本体域不能有 parent")
                elif kind == "module" and pk not in ("domain",):
                    e.add(w, "模块的 parent 应是本体域，实际是 %s" % pk)
                elif kind == "part" and pk not in ("module", "part"):
                    e.add(w, "子模块的 parent 应是模块/子模块，实际是 %s" % pk)
        if lv > 5:
            e.add(w, "层级 %d 层，超过 5 层就该怀疑拆错了" % lv)
        if len(str(c.get("note") or "")) < 40:
            e.add(w, "note 不足 40 字（要写清何时需要、何时不需要、坑在哪）")
        if len(str(c.get("abstract") or "")) < 8:
            e.add(w, "abstract 太短")

        provs = c.get("providers") or []
        # 本体域是「分类」，不是可选型的格子，不要求方案
        if not provs and kind != "domain":
            e.add(w, "providers 为空：每一格至少要有一个能拿到手的方案")
        kinds = set()
        for j, p in enumerate(provs):
            pw = "%s.providers[%d]" % (w, j)
            pk = p.get("kind")
            if pk not in ("oss", "commercial", "build", "pattern"):
                e.add(pw, "kind 必须是 oss/commercial/build/pattern")
            kinds.add(pk)
            if pk == "oss" and not p.get("repo") and not p.get("homepage"):
                e.add(pw, "标了开源却没写 repo，无法核许可")
            if pk == "build":
                if not p.get("effort"):
                    e.add(pw, "自研方案缺 effort（大概几天）")
                if not p.get("tokens"):
                    e.add(pw, "自研方案缺 tokens（大概烧多少）")
                if len(p.get("outline") or []) < 2:
                    e.add(pw, "自研方案至少写 2 步思路")
        # 铁律：全闭源时必须给一条自研路，否则这一格是死路
        if kinds and kinds <= {"commercial"}:
            e.add(w, "全部方案都闭源，必须补一条 build（AI 自研），否则用户无路可走")
        # 模块及以上应能独立选型，不能只有商业方案还没替代
        if kind in ("module", "part") and provs and len(provs) == 1 and "commercial" in kinds:
            e.add(w, "只有一个闭源方案，没有替代/自研，等于把用户锁死")

    # 产物索引
    pidx = {}
    for i, p in enumerate(prods):
        w = "products[%d]" % i
        pid = p.get("id")
        if not pid:
            e.add(w, "缺少 id")
            continue
        if pid in pidx:
            e.add(w, "id 重复 %r" % pid)
            continue
        pidx[pid] = p
        composes = p.get("composes") or []
        if len(composes) < 2:
            e.add(pid, "composes 少于 2 项：只有一个模块的东西不该进架构库")
        seen = set()
        for j, cp in enumerate(composes):
            cw = "%s.composes[%d]" % (pid, j)
            ref = cp.get("component")
            if ref not in idx:
                e.add(cw, "引用了不存在的模块 %r" % ref)
                continue
            if ref in seen:
                e.add(cw, "同一模块重复引用 %r" % ref)
            seen.add(ref)
            if idx[ref].get("kind") in ("domain",):
                e.add(cw, "product 只能引用模块/子模块，不能直接引用本体域 %r" % ref)
            pv = cp.get("provider")
            if pv:
                got = {x.get("id") for x in (idx[ref].get("providers") or [])}
                if pv not in got:
                    e.add(cw, "模块 %r 没有这个方案 %r" % (ref, pv))
    return e, idx, levels, pidx


def build_db(d, idx, levels, pidx):
    if os.path.exists(DB):
        os.remove(DB)
    db = sqlite3.connect(DB)
    db.executescript(
        """
        CREATE TABLE component(
          id TEXT PRIMARY KEY, name TEXT, kind TEXT, parent TEXT, level INT,
          abstract TEXT, note TEXT, io_in TEXT, io_out TEXT);
        CREATE TABLE provider(
          key TEXT PRIMARY KEY, comp TEXT, id TEXT, name TEXT, kind TEXT,
          license TEXT, repo TEXT, homepage TEXT, note TEXT,
          effort TEXT, tokens TEXT, outline TEXT);
        CREATE TABLE product(
          id TEXT PRIMARY KEY, name TEXT, category TEXT, homepage TEXT,
          license TEXT, tags TEXT, note TEXT);
        CREATE TABLE composes(
          product TEXT, component TEXT, provider TEXT, role TEXT);
        """
    )
    for cid, c in idx.items():
        io = c.get("io") or {}
        db.execute(
            "INSERT INTO component VALUES(?,?,?,?,?,?,?,?,?)",
            (cid, c.get("name"), c.get("kind"), c.get("parent"), levels.get(cid, 1),
             c.get("abstract"), c.get("note"), io.get("in"), io.get("out")),
        )
        for p in c.get("providers") or []:
            db.execute(
                "INSERT INTO provider VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (cid + "::" + p["id"], cid, p["id"], p.get("name"), p.get("kind"),
                 p.get("license"), p.get("repo"), p.get("homepage"), p.get("note"),
                 p.get("effort"), p.get("tokens"),
                 json.dumps(p.get("outline") or [], ensure_ascii=False)),
            )
    for pid, p in pidx.items():
        db.execute(
            "INSERT INTO product VALUES(?,?,?,?,?,?,?)",
            (pid, p.get("name"), p.get("category"), p.get("homepage"),
             p.get("license"), json.dumps(p.get("tags") or [], ensure_ascii=False),
             p.get("note")),
        )
        for cp in p.get("composes") or []:
            db.execute("INSERT INTO composes VALUES(?,?,?,?)",
                       (pid, cp["component"], cp.get("provider"), cp.get("role")))
    db.commit()
    return db


def stats(db, idx, pidx, levels):
    n_by_kind = {}
    for cid, c in idx.items():
        n_by_kind[c["kind"]] = n_by_kind.get(c["kind"], 0) + 1
    n_prov = db.execute("select count(*) from provider").fetchone()[0]
    n_build = db.execute("select count(*) from provider where kind='build'").fetchone()[0]
    n_oss = db.execute("select count(*) from provider where kind='oss'").fetchone()[0]
    n_pat = db.execute("select count(*) from provider where kind='pattern'").fetchone()[0]
    n_com = db.execute("select count(*) from provider where kind='commercial'").fetchone()[0]
    used = db.execute("""
        select c.id, c.name, count(distinct p.product) n
        from component c join composes p on p.component=c.id
        join product pr on pr.id=p.product
        group by c.id order by n desc, c.id""").fetchall()
    covered = {r[0] for r in used}
    # 引用率只算软件域：硬件格不该出现在「软件 = 若干模块的组装」里，
    # 混进去会让引用率虚低（硬件本来就不是软件产品的一部分）
    leaves = [cid for cid in idx
              if idx[cid]["kind"] != "domain" and not cid.startswith("hw.")]
    # 子模块不必单独挂在产品上：父模块被选，它自然在里面
    def implied(cid):
        cur, hop = cid, 0
        while cur and hop < 6:
            if cur in covered:
                return True
            cur, hop = idx.get(cur, {}).get("parent"), hop + 1
        return False
    lone = [cid for cid in leaves if not implied(cid)]

    print("\n模块 %d（本体域 %d / 模块 %d / 子模块 %d，最深 %d 层）"
          % (len(idx), n_by_kind.get("domain", 0), n_by_kind.get("module", 0),
             n_by_kind.get("part", 0), max(levels.values()) if levels else 0))
    print("方案 %d（开源 %d / 做法 %d / 闭源 %d / 自研 %d）" % (n_prov, n_oss, n_pat, n_com, n_build))
    n_hw = sum(1 for cid in idx if cid.startswith("hw."))
    print("软件 %d ／ 硬件格 %d（不进软件产品组合，单独一条线）" % (len(pidx), n_hw))
    if leaves:
        rate = len(covered & set(leaves)) / len(leaves) * 100
        print("模块被软件引用率 %.0f%%（%d/%d）" % (rate, len(covered & set(leaves)), len(leaves)))
    if lone:
        print("尚未被任何软件用上的模块 %d 个：%s" % (len(lone), ", ".join(sorted(lone)[:12])))
    print("\n复用最多的 12 格：")
    for cid, name, n in used[:12]:
        print("  %-22s %-14s %d 个软件" % (cid, name, n))


def tree(idx, levels, root):
    if root not in idx:
        print("没有 %r" % root)
        return
    def walk(cid, depth):
        c = idx[cid]
        pad = "  " * depth
        mark = {"domain": "=", "module": "+", "part": "."}.get(c["kind"], "?")
        print("%s%s %s  [%s]" % (pad, mark, c.get("name"), cid))
        for ch in sorted(x for x in idx if idx[x].get("parent") == cid):
            walk(ch, depth + 1)
    walk(root, 0)


def show_comp(db, cid):
    r = db.execute("select id,name,kind,parent,level,abstract,note,io_in,io_out from component where id=?", (cid,)).fetchone()
    if not r:
        print("没有模块 %r" % cid)
        return
    print("%s  %s" % (r[1], r[0]))
    print("层级 L%d  %s  parent=%s" % (r[4], r[2], r[3] or "—"))
    print("一句话：%s" % r[5])
    print("注释：%s" % r[6])
    if r[7] or r[8]:
        print("接口：吃 %s → 吐 %s" % (r[7] or "?", r[8] or "?"))
    print("方案：")
    for p in db.execute("select id,name,kind,license,repo,note,effort,tokens from provider where comp=?", (cid,)):
        tag = {"oss": "开源", "commercial": "闭源", "build": "自研", "pattern": "做法"}.get(p[2], p[2])
        print("  [%s] %-14s %s" % (tag, p[1], ("许可 " + p[3]) if p[3] else ""))
        if p[4]:
            print("         repo %s" % p[4])
        if p[5]:
            print("         %s" % p[5])
        if p[6] or p[7]:
            print("         成本 %s / %s" % (p[6] or "-", p[7] or "-"))


def show_product(db, pid):
    r = db.execute("select name,category,license,note from product where id=?", (pid,)).fetchone()
    if not r:
        print("没有软件 %r" % pid)
        return
    print("%s  %s  [%s]  %s" % (r[0], pid, r[1], r[2] or ""))
    if r[3]:
        print(r[3])
    print("组成：")
    for c in db.execute("""select p.component,c.name,p.provider,p.role from composes p
                           join component c on c.id=p.component where p.product=? order by c.level,p.component""", (pid,)):
        print("  %-22s %-16s %-22s %s" % (c[0], c[1], c[2] or "—", c[3]))


def main():
    d = load()
    e, idx, levels, pidx = check(d)
    if e.items:
        print("校验未通过，%d 处问题：" % len(e.items))
        e.dump()
        return 1
    print("校验通过：%d 模块 / %d 软件" % (len(idx), len(pidx)))
    db = build_db(d, idx, levels, pidx)
    stats(db, idx, pidx, levels)
    a = sys.argv[1:]
    if a and a[0] == "--tree":
        tree(idx, levels, a[1])
    elif a and a[0] == "--comp":
        show_comp(db, a[1])
    elif a and a[0] == "--product":
        show_product(db, a[1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
