#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""moshan 蓝图解析器：格子(能力) -> 推荐软件 -> 挑模块 -> 推导连线 -> 生成 moshan.json

用法:
  python3 blueprint.py <blueprint.json> [--catalog catalog/moshan-catalog.json]
                                      [--out examples/generated-x.moshan.json]
                                      [--topology] [--quiet]

为什么要有这一层:
  直接在画布上填「用什么软件」等于让人先读 5000 个 GitHub README。
  填「要什么能力」才能被匹配、被校验、被自动连线。
  能力来自受控词表，所以推荐结果可以对错，而不是模型说了算。

设计约束:
  1) 推荐必须可解释：每个候选给出覆盖率/内存/端口三项依据。
  2) 覆不满就报缺口，不许「凑一个最像的」。缺口有两种处置：标 custom 自己写，或申请新增能力。
  3) 连线不是手写的：由「上游提供的能力」与「下游接受的能力」匹配得出。
     匹配不上就是真连不上，必须在装之前暴露。
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_CATALOG = os.path.join(ROOT, "catalog", "moshan-catalog.json")

# ---------- 目录 ----------


class Catalog:
    def __init__(self, d):
        self.raw = d
        self.updated = d.get("updated", "?")
        self.caps = {c["id"]: c for c in d.get("capabilities", [])}
        self.entries = {e["id"]: e for e in d.get("entries", [])}
        # capability -> [(entry_id, module)]
        self.prov = {}
        # capability -> [(entry_id, module, env)]
        self.accept = {}
        for e in self.entries.values():
            for m in e.get("modules", []):
                self.prov.setdefault(m["capability"], []).append((e["id"], m))
                for cap, env in (m.get("accepts") or {}).items():
                    self.accept.setdefault(cap, []).append((e["id"], m, env))

    def modules(self, eid, pinned, need):
        """选中哪些模块。
        pinned 非空时以它为准（作者/用户在画布上手动勾的模块有最终决定权，
        哪怕因此覆盖不满 need——那是缺口，应当报出来，不能偷偷补回来）；
        pinned 为空时取默认模块，并自动补上能覆盖 need 的模块。"""
        e = self.entries[eid]
        mods = e["modules"]
        if pinned:
            sel = [m for m in mods if m["id"] in pinned]
        else:
            sel = [m for m in mods if m.get("default", True)]
            sel_ids = {m["id"] for m in sel}
            for m in mods:
                if m["capability"] in need and m["id"] not in sel_ids:
                    sel.append(m)
                    sel_ids.add(m["id"])
        # requires 闭包（同软件内优先，其次交给全局缺口语义）
        changed = True
        while changed:
            changed = False
            for m in list(sel):
                for cap in m.get("requires") or []:
                    if any(x["capability"] == cap for x in sel):
                        continue
                    for cand in mods:
                        if cand["capability"] == cap and cand["id"] not in sel_ids:
                            sel.append(cand)
                            sel_ids.add(cand["id"])
                            changed = True
                            break
        return sel

    def coverage(self, eid, pinned, need):
        sel = self.modules(eid, pinned, need)
        got = {m["capability"] for m in sel}
        return got & set(need), got, sel


def load_json(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------- 打分 ----------


def score(cat, eid, need, used, pinned_modules=None):
    covered, got, sel = cat.coverage(eid, pinned_modules, need)
    e = cat.entries[eid]
    cov = (len(covered) / len(need)) if need else 1.0
    cost = e.get("cost") or {}
    ram = cost.get("ram_mb", 200)
    ports = sum(1 for m in sel if m.get("port"))
    reuse = 1 if eid in used else 0
    s = cov * 100.0 - min(ram, 700) * 0.06 - ports * 1.0 + (12.0 if reuse else 0.0)
    if cost.get("gpu") and not any((m.get("cost") or {}).get("gpu") for m in sel):
        pass
    return {
        "entry": eid,
        "score": round(s, 1),
        "cov": len(covered),
        "need": len(need),
        "missing": [c for c in need if c not in got],
        "ram": ram,
        "ports": ports,
        "modules": [m["id"] for m in sel],
    }


def rank(cat, need, used, only=None, pinned_modules=None):
    ids = [only] if only else list(cat.entries)
    out = []
    for eid in ids:
        if eid not in cat.entries:
            continue
        r = score(cat, eid, need, used, pinned_modules)
        if r["cov"] == 0 and not only:
            continue
        out.append(r)
    out.sort(key=lambda r: (-r["score"], r["ram"]))
    return out


def why(a, b):
    """比较式解释：比第二名强在哪"""
    if b is None:
        return "唯一能覆盖这些能力的条目"
    if a["cov"] > b["cov"]:
        return "多覆盖 %d 条能力" % (a["cov"] - b["cov"])
    if a["ram"] != b["ram"]:
        d = b["ram"] - a["ram"]
        return "同覆盖，%s %dMB 内存" % ("省" if d > 0 else "多耗", abs(d))
    if a["ports"] < b["ports"]:
        return "同内存，少占 %d 个端口" % (b["ports"] - a["ports"])
    return "同分，按目录顺序取更稳的一个"


# ---------- 解析 ----------


class Plan:
    def __init__(self):
        self.errors = []
        self.warns = []
        self.choices = {}   # slot_id -> {entry, modules, score...}
        self.comps = []
        self.wires = []
        self.gaps = []

    def err(self, m):
        self.errors.append(m)

    def warn(self, m):
        self.warns.append(m)


def resolve(bp, cat):
    p = Plan()
    slots = bp.get("slots") or []
    cons = bp.get("constraints") or {}
    pool = cons.get("port_pool") or [8790, 8799]
    reserved = set(cons.get("reserved_ports") or [])
    install = bp.get("install_as") or {}

    # 1) 词表校验：能力必须存在
    for s in slots:
        for cap in s.get("needs") or []:
            if cap not in cat.caps:
                p.err(
                    "格子 %r 需要的能力 %r 不在词表里（现有 %d 条）。"
                    "新增能力要先进 catalog.capabilities，否则匹配结果无法校验。"
                    % (s["id"], cap, len(cat.caps))
                )
    if p.errors and all(not c.get("needs") for c in [{"needs": 1}]):
        pass

    # 2) 逐格选软件
    used = set()
    for s in slots:
        need = [c for c in (s.get("needs") or []) if c in cat.caps]
        if not need:
            continue
        pinned = (s.get("use") or {}).get("entry")
        pinned_mods = (s.get("use") or {}).get("modules")
        r = rank(cat, need, used, only=pinned, pinned_modules=pinned_mods)
        if s.get("custom"):
            p.choices[s["id"]] = {"custom": True, "modules": [], "score": None}
            continue
        if not need:
            continue
        if not r:
            p.err("格子 %r 无可选条目（钉死的 %r 不存在或覆盖 0 条能力）" % (s["id"], pinned))
            continue
        best = r[0]
        p.choices[s["id"]] = dict(best)
        used.add(best["entry"])
        if best["missing"]:
            p.gaps.append({"slot": s["id"], "missing": best["missing"], "best": best["entry"]})
            if s.get("custom"):
                pass
            p.warn(
                "格子 %r 只覆盖 %d/%d 条能力，缺 %s。"
                "选择：① 把它改成 custom 自己写胶水 ② 换多提供一点的条目 ③ 拆成两格"
                % (s["id"], best["cov"], best["need"], "、".join(best["missing"]))
            )
        p.choices[s["id"]]["alternatives"] = r[1:4]

    # 3) 端口分配
    pool_set = [x for x in range(pool[0], pool[1] + 1) if x not in reserved]
    install_port = install.get("port")
    taken = set()
    if install_port:
        taken.add(install_port)  # 主入口端口先保留，普通格子不许抢

    def take_port(slot):
        if slot.get("port"):
            if slot["port"] in reserved:
                p.err("格子 %r 钉死的端口 %d 已被其他插件占用" % (slot["id"], slot["port"]))
            taken.add(slot["port"])
            return slot["port"]
        for x in pool_set:
            if x not in taken:
                taken.add(x)
                return x
        p.err("端口池 %s 已耗尽" % (pool,))
        return None

    # 4) 构建组件
    comp_of = {}
    for s in slots:
        ch = p.choices.get(s["id"])
        if not ch:
            continue
        if ch.get("custom"):
            if s.get("ui") and install_port and not s.get("port"):
                port = install_port
            else:
                port = take_port(s)
            if s.get("ui") and install_port and port != install_port:
                p.warn(
                    "格子 %r 是插件入口页，但端口 %d 与主端口 %d 不一致，中台会打不开"
                    % (s["id"], port, install_port)
                )
            cid = s["id"]
            comp_of[s["id"]] = cid
            p.comps.append(
                {
                    "id": cid,
                    "name": s.get("label", cid),
                    "kind": "process",
                    "source": "本插件自带（custom 格）",
                    "runtime": {
                        "entry": "%s/main.py" % cid,
                        "args": ["--serve", "--no-open", "--port", "${port}"],
                        "restart": "always",
                    },
                    "expose": port,
                    "_caps": set(s.get("outputs") or []),
                    "_custom": True,
                    "_slot": s["id"],
                    "provides": [{"name": "api", "port": port, "protocol": "http"}],
                    "volumes": [{"host": "${data}/%s" % cid, "container": "/app/data"}],
                    "health": {
                        "url": "http://127.0.0.1:%d/api/ping" % port,
                        "expect_body": "ok",
                    },
                }
            )
            p.warns.append(
                "格子 %r 是 custom：解析器只生成了进程骨架、端口 %d、注入表与 /api/ping 探活；"
                "%s/main.py 需要人写（约 30-80 行）" % (s["id"], port, cid)
            )
            continue

        eid = ch["entry"]
        e = cat.entries[eid]
        sel = cat.modules(eid, (s.get("use") or {}).get("modules"), s.get("needs") or [])
        port = take_port(s)
        cid = eid
        comp_of[s["id"]] = cid
        comp = {
            "id": cid,
            "name": e["name"],
            "kind": e["kind"],
            "version": e.get("sample_tag"),
            "source": "https://github.com/%s" % e["repo"] if e.get("repo") else e.get("homepage"),
            "expose": port,
            "_caps": {m["capability"] for m in sel},
            "_slot": s["id"],
            "provides": [],
            "volumes": [],
            "env": {},
        }
        if e["kind"] == "container":
            comp["image"] = "%s:%s" % (e["image"], e.get("sample_tag") or "latest")
        if e["kind"] in ("process", "binary"):
            rt = e.get("runtime") or {}
            comp["runtime"] = {
                "entry": rt.get("entry") or "main.py",
                "args": rt.get("args") or [],
                "restart": "on-failure",
            }
        for m in sel:
            if m.get("port"):
                pin = m["port"]["port"]
                # 进程类组件的"内部端口"就是它自己监听的宿主端口
                shown = port if e["kind"] in ("process", "binary") else pin
                if not any(x["name"] == m["port"]["name"] for x in comp["provides"]):
                    comp["provides"].append(
                        {
                            "name": m["port"]["name"],
                            "port": shown,
                            "protocol": m["port"].get("protocol", "http"),
                        }
                    )
            for k, v in (m.get("config") or {}).items():
                comp["env"][k] = v
            sh = m.get("shared")
            if sh:
                comp.setdefault("_shared", {})[sh["name"]] = {
                    "host": "${data}/shared/%s" % sh["name"],
                    "container": sh["container"],
                }
        for name, v in (comp.pop("_shared", {}) or {}).items():
            comp["volumes"].append(
                {"host": v["host"], "container": v["container"]}
            )
        if s.get("ui") or any(x["name"] in ("webui", "api") for x in comp["provides"]):
            comp["health"] = {
                "url": "http://127.0.0.1:%d/" % port,
                "expect_status": 200,
            }
        p.comps.append(comp)

    # 5) 推导连线
    by_id = {c["id"]: c for c in p.comps}
    for e in bp.get("edges") or []:
        a, b = comp_of.get(e["from"]), comp_of.get(e["to"])
        if not a or not b:
            p.err("连线 %s->%s 引用了不存在的格子" % (e["from"], e["to"]))
            continue
        ca, cb = by_id[a], by_id[b]
        carrier = e.get("carrier", "env")
        want_cap = e.get("capability")

        if carrier == "volume":
            path = e.get("path")
            if not path:
                p.err("连线 %s->%s 用共享卷但没有给下游挂载点 path" % (a, b))
                continue
            cap = want_cap or (sorted(ca.get("_caps") or [])[0] if ca.get("_caps") else None)
            if not cap:
                p.err("连线 %s->%s 无法判定共享哪份数据（上游没有能力声明）" % (a, b))
                continue
            # 上游容器内的挂载点：找同来源的 shared 声明
            host = None
            src_container = None
            eid = ca["id"]
            if eid in cat.entries:
                for m in cat.entries[eid]["modules"]:
                    if m.get("shared") and m["capability"] in (ca.get("_caps") or {cap}):
                        host = "${data}/shared/%s" % m["shared"]["name"]
                        src_container = m["shared"]["container"]
                        break
            host = host or "${data}/shared/%s" % cap.split(".")[-1]
            src_container = src_container or "/data"
            _ensure_vol(ca, host, src_container, False)
            _ensure_vol(cb, host, path, True)
            p.wires.append(
                {
                    "from": {"component": a},
                    "to": {"component": b, "path": path},
                    "carrier": "volume",
                    "note": e.get("note") or "共享卷 %s，写端 %s 读端 %s" % (host, src_container, path),
                }
            )
            continue

        # env 型
        prod = {c: m for c, m in [(m["capability"], m) for m in _mods_of(cat, ca)]}
        accep = {c: env for c, env in _accepts_of(cat, cb)}
        if cb.get("_custom"):
            # 下游是 custom 格：上游任何能力都能接，env 名由蓝图给或自动派生
            if want_cap:
                if want_cap not in prod:
                    p.err("连线 %s->%s 指定能力 %r，但上游不提供" % (a, b, want_cap))
                    continue
                cap = want_cap
            else:
                cand = [c for c in prod if c in (ca.get("_caps") or set())]
                cap = (cand or list(prod))[0] if (cand or prod) else None
            if not cap:
                p.err("连线 %s->%s 上游没有任何可暴露的能力" % (a, b))
                continue
            env = e.get("env") or ("SRC_" + _envsafe(a))
            mod = prod[cap]
            port_name = (mod.get("port") or {}).get("name") or "api"
            p.wires.append(
                {
                    "from": {"component": a, "port": port_name},
                    "to": {"component": b, "env": env},
                    "protocol": "http",
                    "capability": cap,
                    "note": e.get("note") or (mod.get("note") or ""),
                }
            )
            continue

        caps_ok = [c for c in prod if c in accep]
        if want_cap:
            caps_ok = [c for c in caps_ok if c == want_cap] or caps_ok
        if not accep:
            p.err(
                "连线 %s->%s 连不上：%s 不读任何环境变量（例如靠配置文件或共享目录工作）。"
                "改成 carrier=volume，或在中间加一格 custom 胶水。"
                % (a, b, b)
            )
            continue
        if not caps_ok:
            p.err(
                "连线 %s->%s 连不上：%s 提供 %s，而 %s 只接受 %s。"
                "需要一格胶水（标 custom），或改用共享卷。"
                % (
                    a,
                    b,
                    a,
                    "、".join(sorted(prod)) or "（无）",
                    b,
                    "、".join(sorted(accep)) or "（无）",
                )
            )
            continue
        cap = caps_ok[0]
        env = e.get("env") or accep[cap]
        mod = prod[cap]
        p.wires.append(
            {
                "from": {"component": a, "port": (mod.get("port") or {}).get("name") or "api"},
                "to": {"component": b, "env": env},
                "protocol": "http",
                "capability": cap,
                "note": e.get("note") or (mod.get("note") or ""),
            }
        )

    # 6) 预算
    mx = cons.get("max_ram_mb")
    if mx:
        total = sum((cat.entries.get(c["id"], {}).get("cost", {}) or {}).get("ram_mb", 0) for c in p.comps)
        if total > mx:
            p.warn("内存预算 %dMB，实际合计约 %dMB，超 %dMB" % (mx, total, total - mx))

    return p


def _mods_of(cat, comp):
    e = cat.entries.get(comp["id"])
    if not e:
        return []
    return [m for m in e["modules"] if m["capability"] in (comp.get("_caps") or set())]


def _accepts_of(cat, comp):
    e = cat.entries.get(comp["id"])
    if not e:
        return []
    out = []
    for m in e["modules"]:
        for cap, env in (m.get("accepts") or {}).items():
            out.append((cap, env))
    return out


def _ensure_vol(comp, host, container, readonly):
    for v in comp.setdefault("volumes", []):
        if v["host"] == host and v["container"] == container:
            return
    v = {"host": host, "container": container}
    if readonly:
        v["readonly"] = True
    comp["volumes"].append(v)


def _envsafe(s):
    return "".join(ch.upper() if ch.isalnum() else "_" for ch in s)


# ---------- 输出 ----------


def to_manifest(bp, cat, p):
    install = bp.get("install_as") or {}
    main = install.get("port") or (next((c["expose"] for c in p.comps if c.get("health")), None))
    comps = []
    for c in p.comps:
        c = dict(c)
        c.pop("_caps", None)
        c.pop("_custom", None)
        c.pop("_slot", None)
        if not c.get("provides"):
            c.pop("provides", None)
        if not c.get("volumes"):
            c.pop("volumes", None)
        if not c.get("env"):
            c.pop("env", None)
        if c.get("version") is None:
            c.pop("version", None)
        comps.append(c)

    m = {
        "$schema": "https://moshan.dev/schema/moshan-2.1.json",
        "spec": "2.1",
        "id": install.get("plugin_id") or bp["id"],
        "name": bp["name"],
        "version": install.get("version", "0.1.0"),
        "summary": (bp.get("goal") or "")[:64],
        "description": "由蓝图 examples/%s.json 解析生成，能力目录 %s。改动请改蓝图，不要改本文件——它是产物。"
        % (bp["id"], cat.updated),
        "author": {"name": "pamphile"},
        "license": "MIT",
        "kind": "stack",
        "category": bp.get("category", "组合栈"),
        "group": install.get("group", "other"),
        "keywords": sorted({cap.split(".")[0] for s in bp["slots"] for cap in s.get("needs") or []}),
        "permissions": install.get("permissions") or ["docker", "net:127.0.0.1"],
        "requires": {"moshan": ">=2.1"},
        "port": main,
        "ui": {"path": "/", "embed": "iframe", "open": "panel"},
        "health": {"path": "/api/ping", "interval": 30, "timeout": 3},
        "cards": {"api": "/api/cards"},
        "data": {
            "env": install.get("data_env", "MOSHAN_DATA"),
            "default": install.get("data_default", "~/Documents/AI项目/_栈/%s" % bp["id"]),
        },
        "components": comps,
        "wires": p.wires,
        "extensions": {
            "cn.moshan.blueprint": {
                "blueprint": bp["id"],
                "catalog_updated": cat.updated,
                "slots": [
                    {
                        "slot": s["id"],
                        "label": s.get("label"),
                        "needs": s.get("needs"),
                        "resolved": (p.choices.get(s["id"]) or {}).get("entry") or ("custom" if s.get("custom") else None),
                        "modules": (p.choices.get(s["id"]) or {}).get("modules") or [],
                    }
                    for s in bp["slots"]
                ],
                "gaps": p.gaps,
            }
        },
    }
    return m


def render_canvas(bp, p):
    lines = ["```mermaid", "flowchart LR"]
    for s in bp["slots"]:
        ch = p.choices.get(s["id"]) or {}
        if ch.get("custom"):
            tag = "手写胶水"
        elif ch.get("entry"):
            tag = ch["entry"]
        else:
            tag = "?"
        lines.append('  %s["%s<br/><small>%s</small>"]' % (s["id"], s.get("label", s["id"]), tag))
    for e in bp.get("edges") or []:
        note = (e.get("note") or "").replace('"', "'")
        if len(note) > 34:
            note = note[:33] + "…"
        arrow = "==>" if e.get("carrier") == "volume" else "-->"
        if note:
            lines.append('  %s %s|"%s"| %s' % (e["from"], arrow, note, e["to"]))
        else:
            lines.append("  %s %s %s" % (e["from"], arrow, e["to"]))
    lines.append("```")
    return "\n".join(lines)


def report(bp, cat, p, show_topo):
    out = []
    out.append("## 蓝图 %s · %s" % (bp["id"], bp["name"]))
    out.append("目标：%s\n" % bp.get("goal", "-"))
    out.append("| 格子 | 需要能力 | 选中 | 模块 | 端口 | 内存 |")
    out.append("| --- | --- | --- | --- | --- | --- |")
    for s in bp["slots"]:
        ch = p.choices.get(s["id"]) or {}
        e = cat.entries.get(ch.get("entry") or "")
        out.append(
            "| %s | %s | %s | %s | %s | %s |"
            % (
                s.get("label", s["id"]),
                "、".join(c.split(".", 1)[-1] for c in s.get("needs") or []),
                "**手写胶水**" if ch.get("custom") else (ch.get("entry") or "—"),
                "、".join(ch.get("modules") or []) or "—",
                next((c["expose"] for c in p.comps if c["id"] == (ch.get("entry") or s["id"])), "—"),
                ("%dMB" % (e.get("cost") or {}).get("ram_mb", 0)) if e else "—",
            )
        )

    out.append("\n### 推荐依据（为什么是它）")
    for s in bp["slots"]:
        ch = p.choices.get(s["id"]) or {}
        if not ch:
            out.append("- **%s** → 未能解析（见错误）" % s.get("label"))
            continue
        if ch.get("custom"):
            out.append("- **%s** → 手写胶水：这个词表里确实没有现成软件，硬凑一个只会多一个中间层" % s.get("label"))
            continue
        alts = ch.get("alternatives") or []
        out.append(
            "- **%s** → `%s` 得分 %.1f，覆盖 %d/%d。%s"
            % (
                s.get("label"),
                ch.get("entry"),
                ch.get("score", 0),
                ch.get("cov", 0),
                ch.get("need", 0),
                why(ch, alts[0] if alts else None),
            )
        )
        for a in alts:
            out.append("    - 备选 `%s`（%.1f，覆盖 %d/%d，%dMB）" % (a["entry"], a["score"], a["cov"], a["need"], a["ram"]))

    if p.gaps:
        out.append("\n### 缺口")
        for g in p.gaps:
            out.append("- 格子 `%s`：%s 无实现 → %s" % (g["slot"], "、".join(g["missing"]), g["best"]))
    if p.warns:
        out.append("\n### 提醒")
        for w in p.warns:
            out.append("- %s" % w)
    if p.errors:
        out.append("\n### 错误（必须修，解析器不猜）")
        for e in p.errors:
            out.append("- %s" % e)

    if show_topo:
        out.append("\n### 画布")
        out.append(render_canvas(bp, p))
        out.append("\n### 生成的连线")
        out.append("| 从 | 到 | 载体 | 目标 | 说明 |")
        out.append("| --- | --- | --- | --- | --- |")
        for w in p.wires:
            if w.get("carrier") == "volume":
                tgt = "挂载 `%s`" % w["to"]["path"]
            else:
                tgt = "`%s`" % w["to"]["env"]
            out.append(
                "| %s | %s | %s | %s | %s |"
                % (
                    w["from"]["component"],
                    w["to"]["component"],
                    w.get("carrier", "env"),
                    tgt,
                    w.get("note", ""),
                )
            )
    return "\n".join(out)


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    bp_path = args[0]
    cat_path = DEFAULT_CATALOG
    if "--catalog" in argv:
        cat_path = argv[argv.index("--catalog") + 1]
    out_path = None
    if "--out" in argv:
        out_path = argv[argv.index("--out") + 1]

    bp = load_json(bp_path)
    cat = Catalog(load_json(cat_path))
    p = resolve(bp, cat)

    if "--quiet" not in argv:
        print(report(bp, cat, p, "--topology" in argv))
        print()

    if p.errors:
        print("✗ 解析未通过（%d 个错误），不生成清单" % len(p.errors))
        return 1

    man = to_manifest(bp, cat, p)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(man, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("✓ 已生成 %s（%d 组件 / %d 连线）" % (out_path, len(man["components"]), len(man["wires"])))
    else:
        print("（未指定 --out，不落盘）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
