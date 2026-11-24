#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""moshan 包清单校验 + 拓扑推导（纯标准库，无第三方依赖）

用法:
  python3 validate.py <moshan.json | moshan-plugins.json> [...]
  python3 validate.py --topology <moshan.json>      # 额外打印 mermaid 图与说明 Markdown
  python3 validate.py --dir _插件                   # 校验目录下每个子目录的 moshan.json

设计意图:
  1) 安装前拦截不合法的包，避免"装到一半才发现字段错"。
  2) 用 wires 一份数据同时产出 拓扑图 / 说明文档 / 环境变量注入计划，
     不需要作者再手写一份"几个软件怎么连"的说明。
"""

import json
import re
import sys
import os
import glob

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}$")
REPO_RE = re.compile(r"^[\w.-]+/[\w.-]+$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+")
DOT_RE = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){1,3}$")
TAG_RE = re.compile(r"^[a-z][a-z0-9-]{1,23}$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")

KINDS = ("single", "stack", "adapter")
COMP_KINDS = ("container", "process", "binary", "existing")
ART_KINDS = {"image", "asset", "package", "build", "none"}
GROUPS = ("plugin", "tool", "other")
TAG_GROUPS = ("领域", "技术栈")
STATUSES = ("ok", "warn", "error", "unknown", "stale")
PERM_PREFIX = ("fs:", "net:", "exec:", "docker", "cron")


class Err(list):
    def add(self, where, msg):
        self.append("%s: %s" % (where, msg))


def _req(d, key, errs, where):
    if key not in d:
        errs.add(where, "缺少必填字段 %r" % key)
        return False
    return True


def validate_manifest(d, name="<manifest>"):
    e = Err()
    if not isinstance(d, dict):
        e.add(name, "顶层必须是对象")
        return e

    if d.get("spec") not in ("2.0", "2.1"):
        e.add("spec", "必须是 \"2.0\" 或 \"2.1\"")
    if _req(d, "id", e, "id") and not ID_RE.match(str(d["id"])):
        e.add("id", "需匹配 %s（小写字母/数字/连字符）" % ID_RE.pattern)
    if _req(d, "name", e, "name") and len(str(d["name"])) > 32:
        e.add("name", "超过 32 字")
    if _req(d, "version", e, "version") and not SEMVER_RE.match(str(d["version"])):
        e.add("version", "需为 semver，如 1.1.0（GitHub Release tag 必须与之一致）")

    kind = d.get("kind")
    if kind not in KINDS:
        e.add("kind", "必须是 %s 之一" % (KINDS,))

    if "repo" in d and not REPO_RE.match(str(d["repo"])):
        e.add("repo", "需为 owner/repo 形式")
    if "group" in d and d["group"] not in GROUPS:
        e.add("group", "必须是 %s 之一" % (GROUPS,))

    port = d.get("port")
    if port is not None:
        if not isinstance(port, int) or not (1024 <= port <= 65535):
            e.add("port", "需为 1024-65535 的整数")

    for p in d.get("permissions", []) or []:
        if not any(str(p).startswith(x) for x in PERM_PREFIX):
            e.add("permissions", "未知权限写法 %r（应以 fs:/net:/exec:/docker/cron 开头）" % p)

    # kind 分支必填
    if kind == "single":
        if not isinstance(d.get("runtime"), dict):
            e.add("runtime", "kind=single 时必须提供 runtime 对象")
        elif not d["runtime"].get("entry"):
            e.add("runtime.entry", "缺少入口文件")
    if kind == "adapter":
        if not isinstance(d.get("attach"), dict):
            e.add("attach", "kind=adapter 时必须提供 attach 对象")
        elif not d["attach"].get("url"):
            e.add("attach.url", "缺少外部服务地址")

    comps = d.get("components") or []
    if kind == "stack" and not comps:
        e.add("components", "kind=stack 时必须至少有一个组件")

    # 组件
    comp_ids, provides = set(), {}
    for i, c in enumerate(comps):
        w = "components[%d]" % i
        if not isinstance(c, dict):
            e.add(w, "必须是对象")
            continue
        cid = c.get("id")
        if not cid:
            e.add(w + ".id", "缺少 id")
        elif cid in comp_ids:
            e.add(w + ".id", "组件 id 重复: %r" % cid)
        else:
            comp_ids.add(cid)
        if c.get("kind") not in COMP_KINDS:
            e.add(w + ".kind", "必须是 %s 之一" % (COMP_KINDS,))
        if c.get("kind") == "container":
            img = c.get("image") or ""
            if not img:
                e.add(w + ".image", "kind=container 时缺少 image")
            elif ":" not in img.rsplit("/", 1)[-1]:
                e.add(w + ".image", "镜像未固定 tag（%r），不允许 latest 漂移" % img)
        if c.get("kind") in ("process", "binary"):
            if not isinstance(c.get("runtime"), dict):
                e.add(w + ".runtime", "kind=%s 时必须有 runtime" % c.get("kind"))
        ex = c.get("expose")
        if ex is not None and (not isinstance(ex, int) or not (1024 <= ex <= 65535)):
            e.add(w + ".expose", "需为 1024-65535 的整数")
        provides[cid] = []
        for p in c.get("provides") or []:
            if not p.get("name"):
                e.add(w + ".provides", "端口缺少 name")
            else:
                provides[cid].append(p["name"])
            if not isinstance(p.get("port"), int):
                e.add(w + ".provides", "端口 %r 的 port 不是整数" % p.get("name"))

    # 连线（这是拓扑与注入的唯一真源，必须整体可解析）
    for i, w_ in enumerate(d.get("wires") or []):
        w = "wires[%d]" % i
        if not isinstance(w_, dict):
            e.add(w, "必须是对象")
            continue
        fr, to = w_.get("from") or {}, w_.get("to") or {}
        fc, fp = fr.get("component"), fr.get("port")
        tc, te, tp = to.get("component"), to.get("env"), to.get("path")
        carrier = w_.get("carrier", "env")
        if carrier not in ("env", "volume"):
            e.add(w + ".carrier", "必须是 env 或 volume")
        if fc not in comp_ids:
            e.add(w + ".from.component", "引用了不存在的组件 %r" % fc)
        elif carrier == "env" and fp not in provides.get(fc, []):
            e.add(w + ".from.port", "组件 %r 没有提供端口 %r（可用: %s）" % (fc, fp, provides.get(fc)))
        if tc not in comp_ids:
            e.add(w + ".to.component", "引用了不存在的组件 %r" % tc)
        if carrier == "env":
            if not fp:
                e.add(w + ".from.port", "carrier=env 时必须指定端口名")
            if not te:
                e.add(w + ".to.env", "carrier=env 时必须指定要注入的环境变量名")
        else:
            if not tp:
                e.add(w + ".to.path", "carrier=volume 时必须指定下游容器内的挂载点")
            if te:
                e.add(w + ".to.env", "carrier=volume 时不应注入环境变量（文件型接口注入 URL 是假连接）")

    # 端口重复
    used = {}
    for c in comps:
        ex = c.get("expose")
        if isinstance(ex, int):
            if ex in used:
                e.add("components", "宿主端口 %d 被 %r 与 %r 重复占用" % (ex, used[ex], c.get("id")))
            used[ex] = c.get("id")

    return e


def validate_blueprint(d, name="<blueprint>"):
    """蓝图：格子填的是能力，必须严格遵守三点——能力在词表、连线两端存在、端口不冲突。
    这里不做词表校验（词表在 catalog 里），只做结构校验。"""
    e = Err()
    if d.get("spec") != "1.0":
        e.add("spec", "必须是 \"1.0\"")
    for k in ("id", "name", "slots"):
        _req(d, k, e, k)
    ids = set()
    for i, s in enumerate(d.get("slots") or []):
        w = "slots[%d]" % i
        sid = s.get("id")
        if not sid:
            e.add(w + ".id", "缺少 id")
        elif sid in ids:
            e.add(w + ".id", "重复的格子 id %r" % sid)
        else:
            ids.add(sid)
        if not s.get("needs"):
            e.add(w + ".needs", "至少写一条能力，否则解析器无从推荐")
        if s.get("custom") and not s.get("outputs"):
            e.add(w + ".outputs", "custom 格应声明对外提供的能力，否则下游连不上")
    for i, x in enumerate(d.get("edges") or []):
        w = "edges[%d]" % i
        if x.get("from") not in ids:
            e.add(w + ".from", "引用了不存在的格子 %r" % x.get("from"))
        if x.get("to") not in ids:
            e.add(w + ".to", "引用了不存在的格子 %r" % x.get("to"))
        if x.get("carrier") == "volume" and not x.get("path"):
            e.add(w + ".path", "共享卷连线必须给下游挂载点")
    return e


def validate_catalog(d, name="<catalog>"):
    """能力目录：模块引用的能力必须存在，容器必须能固定 tag，进程必须能启动，
    每个条目必须打标签且标签在词表里。"""
    e = Err()
    if d.get("spec") != "1.0":
        e.add("spec", "必须是 \"1.0\"")
    caps = set()
    for i, c in enumerate(d.get("capabilities") or []):
        cid = c.get("id")
        if not cid:
            e.add("capabilities[%d].id" % i, "缺少 id")
            continue
        if cid in caps:
            e.add("capabilities[%d].id" % i, "能力 id 重复 %r" % cid)
        caps.add(cid)
        if not DOT_RE.match(str(cid)):
            e.add("capabilities[%d].id" % i, "需为 a.b 形式（如 media.download）")

    # 标签词表：和能力词表一样是受控的，条目只能打这里出现过的词
    tag_ids, tag_used = set(), set()
    for i, t in enumerate(d.get("tags") or []):
        w = "tags[%d]" % i
        tid = t.get("id")
        if not tid:
            e.add(w + ".id", "缺少 id")
            continue
        if tid in tag_ids:
            e.add(w + ".id", "标签 id 重复 %r" % tid)
        tag_ids.add(tid)
        if not TAG_RE.match(str(tid)):
            e.add(w + ".id", "需为小写字母/数字/连字符，2-24 字（如 ui、ag-ui）")
        if not t.get("label"):
            e.add(w + ".label", "缺少 label")
        elif len(str(t["label"])) > 16:
            e.add(w + ".label", "超过 16 字")
        if t.get("group") not in TAG_GROUPS:
            e.add(w + ".group", "必须是 %s 之一" % (TAG_GROUPS,))
    if not tag_ids:
        e.add("tags", "标签词表为空；每个条目都必须打标签，没有词表就无从校验")

    # 品类词表：条目的「这是哪一种东西」，有且只有一个，也必须是受控词
    cat_ids, cat_used = set(), set()
    for i, c in enumerate(d.get("categories") or []):
        w = "categories[%d]" % i
        cid = c.get("id")
        if not cid:
            e.add(w + ".id", "缺少 id")
            continue
        if cid in cat_ids:
            e.add(w + ".id", "品类 id 重复 %r" % cid)
        cat_ids.add(cid)
        if not TAG_RE.match(str(cid)):
            e.add(w + ".id", "需为小写字母/数字/连字符，2-24 字（如 agent-plugin）")
        if not c.get("label"):
            e.add(w + ".label", "缺少 label")
    if not cat_ids:
        e.add("categories", "品类词表为空；筛选界面靠它分段，没有词表就无法分组")

    eids = set()
    for i, ent in enumerate(d.get("entries") or []):
        w = "entries[%d]" % i
        eid = ent.get("id")
        if not eid or not ID_RE.match(str(eid)):
            e.add(w + ".id", "缺失或格式不合法")
        elif eid in eids:
            e.add(w + ".id", "条目 id 重复 %r" % eid)
        else:
            eids.add(eid)
        kind = ent.get("kind")
        if kind not in COMP_KINDS:
            e.add(w + ".kind", "必须是 %s 之一" % (COMP_KINDS,))
        # 品类：必填、有且只有一个、必须在词表内
        cat = ent.get("category")
        if not cat:
            e.add(w + ".category", "缺少品类（每个条目必须且只能属于一个品类，否则筛选漏项）")
        elif not isinstance(cat, str):
            e.add(w + ".category", "必须是字符串（一个条目只能属于一个品类，不能写成数组）")
        elif cat not in cat_ids:
            e.add(w + ".category", "引用了词表里不存在的品类 %r（先加到顶层 categories）" % cat)
        else:
            cat_used.add(cat)
        # 标签：必填、不重复、必须在词表内
        etags = ent.get("tags")
        if not isinstance(etags, list) or not etags:
            e.add(w + ".tags", "必须至少打一个标签（否则筛不到这个条目）")
        else:
            seen_t = set()
            for t in etags:
                if t in seen_t:
                    e.add(w + ".tags", "标签重复 %r" % t)
                elif t not in tag_ids:
                    e.add(w + ".tags", "引用了词表里不存在的标签 %r（先加到顶层 tags）" % t)
                else:
                    seen_t.add(t)
                    tag_used.add(t)
        if kind == "container":
            if not ent.get("image"):
                e.add(w + ".image", "容器条目缺少镜像")
            if not ent.get("sample_tag"):
                e.add(w + ".sample_tag", "容器条目缺少 sample_tag（安装时用于固定版本）")
        if kind in ("process", "binary") and not (ent.get("runtime") or {}).get("entry"):
            e.add(w + ".runtime.entry", "进程条目缺少启动入口")
        seen = set()
        for j, m in enumerate(ent.get("modules") or []):
            mw = "%s.modules[%d]" % (w, j)
            if not m.get("id"):
                e.add(mw + ".id", "缺少 id")
            elif m["id"] in seen:
                e.add(mw + ".id", "模块 id 重复 %r" % m["id"])
            else:
                seen.add(m["id"])
            if m.get("capability") not in caps:
                e.add(mw + ".capability", "引用了词表里不存在的能力 %r" % m.get("capability"))
            for cap in (m.get("accepts") or {}):
                if cap not in caps:
                    e.add(mw + ".accepts", "接受了词表里不存在的能力 %r" % cap)
            for cap in m.get("requires") or []:
                if cap not in caps:
                    e.add(mw + ".requires", "依赖了词表里不存在的能力 %r" % cap)
            a = m.get("artifact")
            if a is not None:
                ak = a.get("kind")
                if ak not in ART_KINDS:
                    e.add(mw + ".artifact.kind", "必须是 %s 之一" % (sorted(ART_KINDS),))
                elif ak == "image":
                    if not a.get("ref"):
                        e.add(mw + ".artifact.ref", "镜像制品必须给完整 repo:tag")
                    elif ":" not in a["ref"].split("/")[-1]:
                        e.add(mw + ".artifact.ref", "镜像 ref 必须固定 tag（禁止 latest 漂移）")
                    for vn, vr in (a.get("variants") or {}).items():
                        if ":" not in str(vr).split("/")[-1]:
                            e.add(mw + ".artifact.variants." + vn, "变体也必须固定 tag")
                    dv = a.get("default_variant")
                    if dv and dv not in (a.get("variants") or {}):
                        e.add(mw + ".artifact.default_variant", "默认变体 %r 未在 variants 中定义" % dv)
                elif ak == "asset":
                    if not a.get("repo") or not a.get("match"):
                        e.add(mw + ".artifact", "asset 制品必须给 repo 与 match")
                elif ak == "package":
                    if not a.get("name") or not a.get("manager"):
                        e.add(mw + ".artifact", "package 制品必须给 manager 与 name")
                elif ak == "build":
                    if not a.get("context"):
                        e.add(mw + ".artifact.context", "build 制品必须给构建上下文")
    return e


def validate_registry(d, name="<registry>"):
    e = Err()
    if not isinstance(d, dict):
        e.add(name, "顶层必须是对象")
        return e
    if d.get("spec") != "2.0":
        e.add("spec", "必须是 \"2.0\"")
    for k in ("store_id", "name", "plugins"):
        _req(d, k, e, k)
    seen = set()
    for i, p in enumerate(d.get("plugins") or []):
        w = "plugins[%d]" % i
        if not isinstance(p, dict):
            e.add(w, "必须是对象")
            continue
        pid = p.get("id")
        if not pid or not ID_RE.match(str(pid)):
            e.add(w + ".id", "缺失或格式不合法")
        elif pid in seen:
            e.add(w + ".id", "重复的插件 id: %r" % pid)
        else:
            seen.add(pid)
        for k in ("name", "version", "kind"):
            if not p.get(k):
                e.add(w, "缺少 %r" % k)
        # 安装来源：远端给 repo，本机自建给 manifest 相对路径，二者至少一个
        if not p.get("repo") and not p.get("manifest"):
            e.add(w, "repo 与 manifest 至少要给一个，否则无从安装")
        if p.get("kind") not in KINDS:
            e.add(w + ".kind", "必须是 %s 之一" % (KINDS,))
        if p.get("repo") and not REPO_RE.match(str(p["repo"])):
            e.add(w + ".repo", "需为 owner/repo")
        if p.get("sha256") and not SHA_RE.match(str(p["sha256"])):
            e.add(w + ".sha256", "必须是 64 位小写 hex")
        if not p.get("sha256"):
            e.add(w + ".sha256", "缺少校验和（安装前必须校验，否则不做来源保证）")
        # 品类：必须能归类，否则界面按品类筛选时这个插件会消失
        ccat = p.get("catalog_category")
        if not ccat:
            e.add(w + ".catalog_category", "缺品类（默认应为 agent-plugin；生成索引时由清单的 catalog_category 带出）")
        elif not TAG_RE.match(str(ccat)):
            e.add(w + ".catalog_category", "品类格式不合法 %r（小写字母/数字/连字符，2-24 字）" % ccat)
        # 标签：与软件目录共用一套词表，这里只能校格式；词表归属由 catalog 一侧保证
        ptags = p.get("tags")
        if not isinstance(ptags, list) or not ptags:
            e.add(w + ".tags", "缺标签：界面按标签筛选时会漏掉这个插件（清单写 tags，或让组件能推出标签）")
        else:
            seen_t = set()
            for t in ptags:
                if t in seen_t:
                    e.add(w + ".tags", "标签重复 %r" % t)
                elif not TAG_RE.match(str(t)):
                    e.add(w + ".tags", "标签格式不合法 %r（小写字母/数字/连字符，2-24 字）" % t)
                else:
                    seen_t.add(t)
    return e


def validate_cards(items, name="<cards>"):
    e = Err()
    if not isinstance(items, list):
        e.add(name, "顶层必须是数组")
        return e
    for i, c in enumerate(items):
        w = "cards[%d]" % i
        if not isinstance(c, dict):
            e.add(w, "必须是对象")
            continue
        for k in ("id", "plugin", "title", "status"):
            if not c.get(k):
                e.add(w, "缺少 %r" % k)
        if c.get("status") not in STATUSES:
            e.add(w + ".status", "必须是 %s 之一" % (STATUSES,))
        if len(str(c.get("title", ""))) > 32:
            e.add(w + ".title", "超过 32 字")
        for a in c.get("actions") or []:
            if not a.get("path"):
                e.add(w + ".actions", "action 缺少 path")
    return e


# ---------- 拓扑推导：wires -> mermaid + 人读说明 ----------

def render_topology(d):
    comps = d.get("components") or []
    wires = d.get("wires") or []
    if not comps:
        return "（该包为 %s 形态，无组件拓扑）" % d.get("kind")

    label = {}
    for c in comps:
        tag = c.get("version") or ""
        label[c["id"]] = "%s<br/><small>%s%s</small>" % (
            c.get("name", c["id"]),
            c.get("kind"),
            (" " + tag) if tag else "",
        )

    # 宿主视角的端口：同机进程访问容器要连 expose，不是容器内端口
    host_port = {}
    for c in comps:
        ex = c.get("expose")
        for p in c.get("provides") or []:
            host_port[(c["id"], p.get("name"))] = ex if ex else p.get("port")

    lines = ["```mermaid", "flowchart LR"]
    for c in comps:
        lines.append('  %s["%s"]' % (c["id"], label[c["id"]]))
    for w in wires:
        fr = w["from"]
        to = w["to"]
        arrow = "-->" if w.get("required", True) else "-.->"
        if w.get("carrier") == "volume":
            arrow = "==>"
        note = (w.get("note") or "").replace('"', "'")
        if len(note) > 42:  # 图上只放短标签，完整说明在下面的表里
            note = note[:41] + "…"
        if note:
            lines.append('  %s %s|"%s"| %s' % (fr["component"], arrow, note, to["component"]))
        else:
            lines.append("  %s %s %s" % (fr["component"], arrow, to["component"]))
    lines.append("```")
    mermaid = "\n".join(lines)

    rows = ["| 从 | 到 | 载体 | 接口 | 说明 |", "| --- | --- | --- | --- | --- |"]
    for w in wires:
        carrier = w.get("carrier", "env")
        if carrier == "volume":
            rows.append(
                "| %s | %s | volume | 挂载 `%s` | %s |"
                % (w["from"]["component"], w["to"]["component"], w["to"].get("path", "?"), w.get("note", ""))
            )
        else:
            rows.append(
                "| %s:%s | %s | env | `%s` | %s |"
                % (
                    w["from"]["component"],
                    w["from"].get("port", "?"),
                    w["to"]["component"],
                    w["to"].get("env", "?"),
                    w.get("note", ""),
                )
            )
    table = "\n".join(rows)

    inject, shares = [], []
    for w in wires:
        if not w.get("required", True):
            continue
        if w.get("carrier", "env") == "volume":
            shares.append("  %s -> %s: 同一宿主目录挂到 %s" % (w["to"]["component"], w["from"]["component"], w["to"].get("path")))
            continue
        tpl = w["to"].get("value_template") or "{protocol}://127.0.0.1:{port}"
        port = host_port.get((w["from"]["component"], w["from"].get("port")), "?")
        inject.append(
            "  %s: %s=%s"
            % (
                w["to"]["component"],
                w["to"]["env"],
                tpl.format(protocol=w.get("protocol", "http"), port=port),
            )
        )
    plan = "\n".join(inject) if inject else "  （无注入）"
    if shares:
        plan += "\n# 共享卷（不注入 URL，文件型接口）\n" + "\n".join(shares)
    return "## 拓扑\n\n%s\n\n## 连线说明\n\n%s\n\n## 安装时注入\n\n```yaml\n%s\n```" % (mermaid, table, plan)


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    if not argv:
        # 无参数 = 仓库自检：AGENTS.md 里写的就是这条命令，必须真的能跑
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        defaults = [os.path.join(root, "catalog", "moshan-catalog.json"),
                    os.path.join(root, "registry", "registry.json")]
        defaults += sorted(glob.glob(os.path.join(root, "examples", "*.json")))
        argv = [os.path.relpath(p, os.getcwd()) for p in defaults if os.path.isfile(p)]
        if not argv:
            print(__doc__)
            return 2
        print("（无参数，按仓库自检：catalog + registry + examples）\n")
    show_topo = "--topology" in argv
    args = [a for a in argv if not a.startswith("--")]
    targets = []
    for a in args:
        if os.path.isdir(a):
            for sub in sorted(os.listdir(a)):
                p = os.path.join(a, sub, "moshan.json")
                if os.path.isfile(p):
                    targets.append(p)
        else:
            targets.append(a)
    if not targets:
        print("没有找到可校验的文件")
        return 2

    bad = 0
    for t in targets:
        try:
            d = _load(t)
        except Exception as ex:
            print("✗ %s  读取失败: %s" % (t, ex))
            bad += 1
            continue

        if isinstance(d, dict) and "plugins" in d and "store_id" in d:
            errs = validate_registry(d, t)
            kindtxt = "registry"
        elif isinstance(d, dict) and "slots" in d and "capabilities" not in d:
            errs = validate_blueprint(d, t)
            kindtxt = "blueprint"
        elif isinstance(d, dict) and "entries" in d and "capabilities" in d:
            errs = validate_catalog(d, t)
            kindtxt = "catalog"
        elif isinstance(d, list):
            errs = validate_cards(d, t)
            kindtxt = "cards"
        else:
            errs = validate_manifest(d, t)
            kindtxt = "manifest(%s)" % d.get("kind", "?")

        if errs:
            bad += 1
            print("✗ %s  [%s] %d 个问题" % (t, kindtxt, len(errs)))
            for x in errs:
                print("    - %s" % x)
        else:
            print("✓ %s  [%s] ok" % (t, kindtxt))
            if show_topo and kindtxt.startswith("manifest"):
                print(render_topology(d))
    print("\n%d/%d 通过" % (len(targets) - bad, len(targets)))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
