#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""moshan —— 插件仓库 / 定向安装 / 按需下载的最小可用 CLI（纯标准库，无第三方依赖）。

它只做三件真实的事：

  1. registry  扫盘生成商店索引（静态 JSON，零后端）
  2. plan      按勾选的模块算出「要下载什么、多大、占哪个端口、要注入什么」
  3. install   生成可执行的 compose.yaml + run-*.sh + README，再（可选）真拉真起

设计前提（与架构文档一致）：
  · 拆解 = 目录里的静态知识，预先做好，不下载。
  · 下载 = 安装时按勾选结果算出的最小制品集。
  · 没勾的模块不产生下载项，也不进 compose —— 这是「要用的才下」的实现点。

用法:
  python3 tools/moshan.py catalog [--cap media.download] [--tag ui]
  python3 tools/moshan.py tags [--entries]
  python3 tools/moshan.py plan examples/generated-media-auto.moshan.json
  python3 tools/moshan.py plan <manifest> --use "jellyfin:stream,transcode;siyuan:store"
  python3 tools/moshan.py install <manifest> --out build/media
  python3 tools/moshan.py install <manifest> --out build/media --yes
  python3 tools/moshan.py registry examples/*.moshan.json --out registry/registry.json
  python3 tools/moshan.py search 媒体
  python3 tools/moshan.py show media-stack
"""

import argparse
import datetime
import glob
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "catalog", "moshan-catalog.json")
DEFAULT_STORE = os.path.join(ROOT, "registry", "registry.json")

# 硬件加速变体 → 需要的设备/运行时。写在代码里而不是目录里，是因为它绑定的是宿主能力，
# 不是软件属性：同一镜像在群晖和盒子上要透传的东西不一样。
GPU_PASSTHROUGH = {
    "vaapi": {"devices": ["/dev/dri:/dev/dri"], "group_add": ["video", "render"]},
    "nvidia": {"runtime": "nvidia"},
}


# ---------------------------------------------------------------- 基础工具


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def human(mb):
    if mb is None:
        return "?"
    if mb >= 1024:
        return "%.1f GB" % (mb / 1024.0)
    return ("%g MB" % mb)


def die(msg, code=1):
    sys.stderr.write("✗ %s\n" % msg)
    sys.exit(code)


def catalog():
    c = load_json(CATALOG)
    return c, {e["id"]: e for e in c["entries"]}


# ---------------------------------------------------------------- 装配模型


class Comp(object):
    """一个组件（= 一个容器镜像或一个进程），以及它被勾中的模块。"""

    def __init__(self, comp_id, manifest_comp, entry):
        self.id = comp_id
        self.is_self = bool((manifest_comp or {}).get("_self"))
        self.mc = manifest_comp or {}
        self.entry = entry            # 目录条目，可能为 None（custom 胶水）
        self.modules = []             # 选中的模块对象
        self.variant = None           # 因某模块要求而切换的镜像变体
        self.downloads = []           # [(kind, label, ref, size_mb, why)]
        self.skipped = []             # [(module_id, size_mb)] 未选但本可下载
        self.fallback_image = False   # 镜像靠条目兜底下载了

    @property
    def kind(self):
        if self.entry:
            return self.entry["kind"]
        return self.mc.get("kind", "process")

    @property
    def expose(self):
        return self.mc.get("expose")

    @property
    def container_port(self):
        for p in self.mc.get("provides") or []:
            return p.get("port")
        return None

    def image(self):
        """最终镜像：基础 ref，或按变体替换 tag 后缀（10.10.3 -> 10.10.3-vaapi）。"""
        if self.kind != "container" or not self.entry:
            return None
        base = self.mc.get("image") or ""
        if ":" not in base.split("/")[-1]:
            base = "%s:%s" % (base, self.entry.get("sample_tag") or "")
        if not self.variant:
            return base
        repo, tag = base.rsplit(":", 1)
        return "%s:%s-%s" % (repo, tag, self.variant)


def _mod_index(entry):
    return {m["id"]: m for m in entry.get("modules") or []}


def pick_modules(manifest, entry, use_mods, skip_mods):
    """选模块：显式 > 蓝图扩展 > 目录默认。显式即准，绝不偷偷补回。"""
    idx = _mod_index(entry)
    chosen = []
    if use_mods is not None:
        for mid in use_mods:
            if mid not in idx:
                die("条目 %r 没有模块 %r（可用: %s）" % (entry["id"], mid, sorted(idx)))
            chosen.append(idx[mid])
    else:
        bp = (manifest.get("extensions") or {}).get("cn.moshan.blueprint") or {}
        slot = next((s for s in bp.get("slots") or [] if s.get("resolved") == entry["id"]), None)
        if slot and slot.get("modules"):
            chosen = [idx[m] for m in slot["modules"] if m in idx]
        else:
            chosen = [m for m in idx.values() if m.get("default", True)]
    chosen = [m for m in chosen if m["id"] not in (skip_mods or [])]

    # requires 闭包：依赖的能力若本组件内有模块供给，必须一并打开
    got = {m["capability"] for m in chosen}
    for m in list(chosen):
        for cap in m.get("requires") or []:
            if cap in got:
                continue
            prov = [x for x in idx.values() if x["capability"] == cap]
            if prov:
                chosen.append(prov[0])
                got.add(cap)
    seen, out = set(), []
    for m in chosen:
        if m["id"] not in seen:
            seen.add(m["id"])
            out.append(m)
    return out


def assemble(manifest, entries, use=None, skip=None):
    """把清单 + 目录 + 勾选，变成下载集与端口表。"""
    use_map, skip_map = {}, {}
    for spec in use or []:
        for chunk in spec.split(";"):
            chunk = chunk.strip()
            if not chunk:
                continue
            cid, _, mods = chunk.partition(":")
            use_map[cid.strip()] = [m.strip() for m in mods.split(",") if m.strip()]
    for spec in skip or []:
        for chunk in spec.split(";"):
            chunk = chunk.strip()
            if not chunk:
                continue
            cid, _, mods = chunk.partition(":")
            skip_map.setdefault(cid.strip(), []).extend(m.strip() for m in mods.split(",") if m.strip())

    comps = []
    raw = list(manifest.get("components") or [])
    if not raw:
        # single / adapter 形态只有顶层 runtime：它自己就是那一个组件
        raw = [{
            "_self": True,
            "id": manifest["id"],
            "kind": "process",
            "expose": manifest.get("port"),
            "runtime": manifest.get("runtime") or {},
            "provides": [{"name": "webui", "port": manifest.get("port") or 0, "protocol": "http"}],
            "health": manifest.get("health") or {},
        }]
    for mc in raw:
        e = entries.get(mc["id"])
        c = Comp(mc["id"], mc, e)
        if e:
            c.modules = pick_modules(manifest, e, use_map.get(mc["id"]), skip_map.get(mc["id"]))
            idx = _mod_index(e)
            # 变体决策：任一选中模块要求变体，就换镜像（一个服务只有一个镜像）
            for m in c.modules:
                v = (m.get("artifact") or {}).get("variant")
                if v:
                    c.variant = v
            # 下载项。镜像要单独处理：变体镜像会替换基础镜像，不能两条一起算。
            base = None          # (ref, size, why)
            variant = None       # (size, why)
            for m in c.modules:
                a = m.get("artifact") or {"kind": "none"}
                k = a.get("kind", "none")
                if a.get("variant"):
                    variant = (a.get("size_mb"), "模块 %s 要求 %s 变体" % (m["id"], a["variant"]))
                if k == "image":
                    base = (a.get("ref"), a.get("size_mb"), "模块 %s 的载体" % m["id"])
                elif k == "asset":
                    url = (a.get("ref") or "").format(
                        repo=a.get("repo", ""), version=manifest.get("version", ""),
                        tag=manifest.get("version", ""))
                    label = "资产 %s %s" % (a.get("repo", ""), a.get("match", ""))
                    c.downloads.append(("asset", label, url, a.get("size_mb"),
                                        "模块 %s 的数据" % m["id"]))
                elif k == "package":
                    spec = "%s[%s]" % (a.get("name"), a["extra"]) if a.get("extra") else a.get("name")
                    c.downloads.append(("package", "包", spec, a.get("size_mb"),
                                        "模块 %s 的依赖" % m["id"]))
                elif k == "build":
                    c.downloads.append(("build", "需构建", a.get("context"), a.get("size_mb"),
                                        "模块 %s 需要在本地构建" % m["id"]))
                # none：无下载项（同一制品内的开关）
            if c.variant:
                # 换镜像：只拉变体那一个，体积用变体镜像的整体积（含基础层）
                size = (variant[0] if variant else None) or (base[1] if base else None)
                why = variant[1] if variant else "模块要求 %s 变体" % c.variant
                c.downloads.append(("image", "镜像(%s)" % c.variant, c.image(), size, why))
            elif base:
                c.downloads.append(("image", "镜像", base[0], base[1], base[2]))
            elif c.kind == "container" and c.entry:
                # 选中模块都没声明镜像（例如只勾 library）：镜像仍按条目取，不能漏。
                # 体积取该条目任一 image 制品的体积作参考。
                ref = "%s:%s" % (c.entry.get("image"), c.entry.get("sample_tag"))
                size = next((a.get("size_mb") for a in
                             [(m.get("artifact") or {}) for m in c.entry["modules"]]
                             if a.get("kind") == "image"), None)
                c.downloads.append(("image", "镜像", ref, size, "组件本体（所选模块只提供开关）"))
                c.fallback_image = True
            # 未选模块的潜在体积（告诉用户省了多少）
            for mid, m in idx.items():
                if mid in {x["id"] for x in c.modules}:
                    continue
                a = m.get("artifact") or {}
                if c.fallback_image and a.get("kind") == "image":
                    continue  # 镜像已兜底下载，再说「省了」就是骗人
                if a.get("kind") in ("image", "asset", "package") and a.get("size_mb"):
                    c.skipped.append((mid, a["size_mb"]))
        comps.append(c)
    return comps


def dedupe_downloads(comps):
    """同一镜像被多个模块引用时只算一次。"""
    seen, items = set(), []
    for c in comps:
        for kind, label, ref, size, why in c.downloads:
            key = (kind, ref)
            if key in seen:
                continue
            seen.add(key)
            items.append({"component": c.id, "kind": kind, "label": label,
                          "ref": ref, "size_mb": size, "why": why})
    return items


# ---------------------------------------------------------------- 渲染


def render_plan(manifest, comps, items, entries, mode="auto"):
    out = []
    total = sum(i.get("size_mb") or 0 for i in items)
    skipped = sum(s for c in comps for _, s in c.skipped)

    out.append("# 安装计划 · %s %s" % (manifest.get("name", manifest.get("id")), manifest.get("version", "")))
    out.append("")
    out.append("模式：%s" % {
        "explicit": "定向（你显式指定了模块，未做任何推荐）",
        "skip": "默认 + 显式排除",
        "auto": "按蓝图/目录默认模块",
    }.get(mode, mode))
    out.append("")

    out.append("## 一、要下载什么（按勾选结果算最小集）")
    out.append("")
    if not items:
        out.append("（无需下载：全部为同一制品内的开关或本地已有）")
    else:
        out.append("| 组件 | 类型 | 制品 | 体积 | 为什么 |")
        out.append("| --- | --- | --- | --- | --- |")
        for i in items:
            out.append("| %s | %s | `%s` | %s | %s |" % (
                i["component"], i["kind"], i["ref"], human(i["size_mb"]), i["why"]))
        out.append("")
        out.append("**合计 %s**%s" % (
            human(total), ("；另有 %s 的模块未勾选、不会下载" % human(skipped)) if skipped else ""))
    out.append("")

    out.append("## 二、选中的模块")
    out.append("")
    for c in comps:
        if not c.entry:
            if c.is_self:
                rt = c.mc.get("runtime") or {}
                out.append("- **%s** — 本包自带进程（`%s`），无上游依赖，不需要下载镜像" % (
                    c.id, rt.get("entry") or "—"))
            else:
                out.append("- **%s** — 自带胶水，无目录条目（需自己实现）" % c.id)
            continue
        mods = "、".join("%s(%s)" % (m.get("label") or m["id"], m["capability"]) for m in c.modules) or "无"
        variant_note = (" [镜像变体: %s]" % c.variant) if c.variant else ""
        out.append("- **%s** — %s%s" % (c.id, mods, variant_note))
        for mid, size in c.skipped:
            out.append("    - 未选 `%s`，省 %s" % (mid, human(size)))
    out.append("")

    out.append("## 三、端口与访问")
    out.append("")
    out.append("| 组件 | 容器内 | 宿主 | 入口 |")
    out.append("| --- | --- | --- | --- |")
    for c in comps:
        cp = c.container_port
        url = "http://127.0.0.1:%s" % c.expose if c.expose else "-"
        out.append("| %s | %s | %s | %s |" % (c.id, cp if cp else "-", c.expose or "-", url))
    out.append("")

    out.append("## 四、安装时要注入的环境变量")
    out.append("")
    rows = []
    for w in manifest.get("wires") or []:
        if w.get("carrier", "env") != "env":
            continue
        to = w["to"]
        tpl = to.get("value_template") or "{protocol}://127.0.0.1:{port}"
        src = next((c for c in comps if c.id == w["from"]["component"]), None)
        port = src.expose if src else "?"
        rows.append("  %s: %s=%s" % (to["component"], to["env"], tpl.format(
            protocol=w.get("protocol", "http"), port=port)))
    out.append("```yaml")
    out.extend(rows or ["  （无）"])
    out.append("```")
    out.append("")
    vol = [w for w in manifest.get("wires") or [] if w.get("carrier") == "volume"]
    if vol:
        out.append("共享卷连线（不注入 URL，靠同一个卷交付）：")
        for w in vol:
            out.append("  - %s → %s：%s" % (w["from"]["component"], w["to"]["component"], w.get("note", "")))
        out.append("")

    attach = manifest.get("attach") or {}
    if attach.get("url"):
        h = manifest.get("health") or {}
        out.append("## 外部服务（不安装，只登记与探活）")
        out.append("")
        out.append("- 地址：`%s`" % attach["url"])
        out.append("- 探活：`%s`，每 %ss 一次" % (h.get("path") or "/", h.get("interval") or 60))
        out.append("- 生命周期：**不代管**。起停由它所在的那台机器负责，中台只判断活着没有。")
        out.append("")

    missing = [c.id for c in comps if not c.entry and c.kind == "process" and not c.is_self]
    if missing:
        out.append("## 五、需要你自己实现的部分")
        out.append("")
        for cid in missing:
            out.append("- `%s`：协议只生成骨架与探活，业务逻辑留给你写" % cid)
        out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------- compose 渲染


def yaml_str(v):
    s = str(v)
    if s == "" or re.search(r"[:#\s\"'{}\[\],&*?|>%@`]", s) or s.lower() in ("true", "false", "null", "yes", "no"):
        return '"%s"' % s.replace('"', '\\"')
    return s


def render_compose(manifest, comps, host_root):
    containers = [c for c in comps if c.kind == "container"]
    if not containers:
        return None
    lines = ["# 由 tools/moshan.py 生成。改这里会被下次 install 覆盖，要持久化请改 moshan.json。",
             "name: %s" % yaml_str(manifest["id"]), "services:"]
    env_by_comp = {}
    for w in manifest.get("wires") or []:
        if w.get("carrier", "env") != "env":
            continue
        to = w["to"]
        tpl = to.get("value_template") or "{protocol}://127.0.0.1:{port}"
        src = next((c for c in comps if c.id == w["from"]["component"]), None)
        port = src.expose if src else 0
        env_by_comp.setdefault(to["component"], {})[to["env"]] = tpl.format(
            protocol=w.get("protocol", "http"), port=port)

    # 共享卷：无论连线方向，只要模块声明了 shared 就挂载同一宿主目录（这就是「卷型连线」）。
    volumes = {}
    for c in comps:
        for m in c.modules:
            sh = m.get("shared")
            if sh:
                volumes.setdefault(sh["name"], None)
    data_map = (manifest.get("data") or {}).get("volumes") or {}
    for name in list(volumes):
        volumes[name] = os.path.expanduser(str(data_map.get(name) or os.path.join(host_root, name)))
    # 卷型连线的下游挂载：目标容器在 to.path 挂同一个宿主目录（不注入 URL，注入就是假连接）
    vol_wires = {}
    for w in manifest.get("wires") or []:
        if w.get("carrier") != "volume":
            continue
        src = next((x for x in comps if x.id == w["from"]["component"]), None)
        vname = None
        if src:
            vname = next((m.get("shared", {}).get("name") for m in src.modules if m.get("shared")), None)
        if not vname:
            continue
        volumes.setdefault(vname, os.path.expanduser(str(data_map.get(vname) or os.path.join(host_root, vname))))
        mount = (w.get("to") or {}).get("path") or "/data"
        vol_wires.setdefault(w["to"]["component"], []).append("%s:%s" % (volumes[vname], mount))

    for c in containers:
        env = {}
        for m in c.modules:
            for k, v in (m.get("config") or {}).items():
                env[k] = v
        env.update(env_by_comp.get(c.id, {}))
        lines.append("  %s:" % yaml_str(c.id))
        lines.append("    image: %s" % yaml_str(c.image()))
        lines.append("    container_name: %s" % yaml_str("moshan-%s-%s" % (manifest["id"], c.id)))
        lines.append("    restart: unless-stopped")
        if c.expose and c.container_port:
            lines.append("    ports:")
            lines.append('      - "%s:%s"' % (c.expose, c.container_port))
        if env:
            lines.append("    environment:")
            for k in sorted(env):
                lines.append("      %s: %s" % (k, yaml_str(env[k])))
        # 卷：模块 shared 声明的宿主目录 + 卷型连线指定给本组件的挂载点
        vols = list(vol_wires.get(c.id, []))
        for m in c.modules:
            sh = m.get("shared")
            if sh:
                vols.append("%s:%s" % (volumes.get(sh["name"]), sh["container"]))
        if vols:
            lines.append("    volumes:")
            for v in sorted(set(vols)):
                lines.append("      - %s" % yaml_str(v))
        if c.variant and c.variant in GPU_PASSTHROUGH:
            g = GPU_PASSTHROUGH[c.variant]
            if g.get("devices"):
                lines.append("    devices:")
                for d in g["devices"]:
                    lines.append("      - %s" % yaml_str(d))
            if g.get("runtime"):
                lines.append("    runtime: %s" % g["runtime"])
            if g.get("group_add"):
                lines.append("    group_add:")
                for grp in g["group_add"]:
                    lines.append("      - %s" % yaml_str(grp))
        h = c.mc.get("health") or {}
        if h.get("path"):
            lines.append("    healthcheck:")
            lines.append('      test: ["CMD-SHELL", %s]' % yaml_str(
                "curl -fsS http://127.0.0.1:%s%s || exit 1" % (c.container_port, h["path"])))
            lines.append("      interval: 30s")
            lines.append("      timeout: 3s")
            lines.append("      retries: 3")
    return "\n".join(lines) + "\n"


def render_runner(manifest, comps, host_root):
    procs = [c for c in comps if c.kind == "process"]
    if not procs:
        return {}
    files = {}
    lines = ["#!/usr/bin/env bash", "set -euo pipefail",
             "cd \"$(dirname \"$0\")\"", "", "# 宿主机进程（非容器）。端口与 env 来自 moshan.json。"]
    for c in procs:
        entry = (c.mc.get("runtime") or {}).get("entry") or "%s/main.py" % c.id
        args = (c.mc.get("runtime") or {}).get("args") or ["--port", str(c.expose or "")]
        args = [str(a).replace("${port}", str(c.expose or "")) for a in args]
        env = {}
        for m in c.modules:
            env.update(m.get("config") or {})
        for w in manifest.get("wires") or []:
            if w.get("carrier", "env") != "env" or w["to"]["component"] != c.id:
                continue
            to = w["to"]
            tpl = to.get("value_template") or "{protocol}://127.0.0.1:{port}"
            src = next((x for x in comps if x.id == w["from"]["component"]), None)
            env[to["env"]] = tpl.format(protocol=w.get("protocol", "http"), port=src.expose if src else "")
        lines.append("")
        lines.append("# %s" % c.id)
        for k in sorted(env):
            lines.append("export %s=%s" % (k, "'%s'" % env[k]))
        lines.append("exec python3 %s %s" % (entry, " ".join(args)))
    files["run.sh"] = "\n".join(lines) + "\n"
    return files


def render_install_sh(manifest, comps, items):
    has_compose = any(c.kind == "container" for c in comps)
    lines = ["#!/usr/bin/env bash", "set -euo pipefail", "cd \"$(dirname \"$0\")\"", ""]
    lines.append('echo "==> %s %s"' % (manifest.get("name", manifest["id"]), manifest.get("version", "")))
    pulls = [i for i in items if i["kind"] == "image"]
    if pulls:
        lines.append("")
        lines.append("# 只拉勾选到的镜像（未勾的模块不会下载）")
        for i in pulls:
            lines.append('docker pull %s' % i["ref"])
    assets = [i for i in items if i["kind"] == "asset"]
    if assets:
        lines.append("")
        lines.append("mkdir -p cache")
        for i in assets:
            lines.append('curl -fL --retry 3 -o cache/%s.bin "%s"' % (i["component"], i["ref"]))
    has_proc = any(c.kind == "process" for c in comps)
    execing = False
    if has_compose:
        lines.append("")
        lines.append("docker compose up -d")
        if has_proc:
            lines.append("")
            lines.append('echo "容器已起。宿主机进程请另开终端执行：./run.sh"')
    elif has_proc:
        lines.append("")
        lines.append('echo "本包没有容器，直接前台跑：./run.sh"')
        lines.append("exec ./run.sh")
        execing = True
    if not execing:
        lines.append("")
        lines.append('echo "==> 完成"')
    return "\n".join(lines) + "\n"


def render_readme(manifest, comps, items):
    out = ["# %s" % manifest.get("name", manifest["id"]), "",
           "%s" % (manifest.get("summary") or ""), ""]
    out.append("## 组件与端口")
    out.append("")
    out.append("| 组件 | 类型 | 镜像/入口 | 宿主端口 |")
    out.append("| --- | --- | --- | --- |")
    for c in comps:
        art = c.image() or (c.mc.get("runtime") or {}).get("entry") or "自带胶水"
        out.append("| %s | %s | `%s` | %s |" % (c.id, c.kind, art, c.expose or "-"))
    out.append("")
    env_rows = []
    for w in manifest.get("wires") or []:
        env_rows.append("| %s | %s | %s | `%s` |" % (
            w["from"]["component"], w["to"]["component"],
            "共享卷" if w.get("carrier") == "volume" else "环境变量",
            w["to"].get("env", "-")))
    if env_rows:
        out.append("## 它们怎么连（由 wires 渲染，不会与真实配置脱节）")
        out.append("")
        out.append("| 从 | 到 | 方式 | 注入名 |")
        out.append("| --- | --- | --- | --- |")
        out.extend(env_rows)
        out.append("")
    out.append("## 下载体积")
    out.append("")
    if items:
        out.append("合计 %s，共 %d 个制品。" % (human(sum(i.get("size_mb") or 0 for i in items)), len(items)))
    else:
        out.append("无需下载：本包只有同一制品内的开关，或用的就是本机已有的程序。")
    out.append("")
    out.append("## 怎么起")
    out.append("")
    out.append("```bash")
    out.append("./install.sh")
    out.append("```")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- 命令


def cmd_catalog(args):
    cat, entries = catalog()
    caps = {c["id"]: c for c in cat["capabilities"]}
    tmap = {t["id"]: t for t in cat.get("tags") or []}
    if args.json:
        print(json.dumps(cat, ensure_ascii=False, indent=2))
        return 0
    tag = getattr(args, "tag", None)
    if tag and tag not in tmap:
        die("词表里没有标签 %r（可用：%s）" % (tag, "、".join(sorted(tmap))))
    print("能力词表 %d 条，标签 %d 个，条目 %d 个\n" % (len(caps), len(tmap), len(entries)))
    shown = 0
    for e in cat["entries"]:
        if tag and tag not in (e.get("tags") or []):
            continue
        mods = [m for m in e["modules"] if not args.cap or m["capability"] == args.cap]
        if args.cap and not mods:
            continue
        shown += 1
        total = sum(((m.get("artifact") or {}).get("size_mb") or 0)
                    for m in e["modules"] if m.get("default", True))
        # 标签写在 id 前，一眼能看出这条归在哪一类
        tline = "/".join((tmap.get(t) or {}).get("label", t) for t in (e.get("tags") or []))
        print("%-14s %-10s %-6s %6s  %s" % (e["id"], e["kind"], e.get("tier", "community"),
                                            human(total), (e.get("repo") or "")))
        print("   %s  标签 %s" % (" " * 8, tline))
        for m in mods:
            a = m.get("artifact") or {"kind": "none"}
            tag_ = a.get("kind")
            if tag_ == "image":
                tag_ += "@" + (a.get("ref") or "").rsplit(":", 1)[-1]
            elif tag_ == "none" and a.get("variant"):
                tag_ += "->" + a["variant"]
            print("   %-10s %-18s %-22s %s" % (m["id"], m["capability"], tag_,
                                               human(a.get("size_mb")) if a.get("size_mb") else ""))
    if tag:
        print("\n标签「%s」命中 %d / %d 个条目" % (tmap[tag]["label"], shown, len(entries)))
    return 0


def cmd_tags(args):
    """列标签词表与用量。零用量的标签会标出来——要么忘了给条目打，要么这个词该删。"""
    cat, _ = catalog()
    vocab = cat.get("tags") or []
    if not vocab:
        print("目录里还没有标签词表。")
        return 1
    cnt = {t["id"]: 0 for t in vocab}
    usage = {}
    for e in cat["entries"]:
        for t in (e.get("tags") or []):
            if t in cnt:
                cnt[t] += 1
                usage.setdefault(t, []).append(e["id"])
    grp = None
    for t in vocab:
        if t.get("group") != grp:
            grp = t.get("group")
            print("\n[%s]" % grp)
        warn = "" if cnt[t["id"]] else "  ← 零使用"
        print("  %-12s %-6s %2d  %s%s" % (t["id"], t["label"], cnt[t["id"]],
                                          t.get("desc", ""), warn))
    if args.entries:
        print("")
        for t in vocab:
            if usage.get(t["id"]):
                print("%-12s %s" % (t["id"], " ".join(usage[t["id"]])))
    return 0


def cmd_plan(args):
    manifest = load_json(args.manifest)
    _, entries = catalog()
    comps = assemble(manifest, entries, args.use, args.skip)
    items = dedupe_downloads(comps)
    if args.json:
        print(json.dumps({"items": items,
                          "components": [{"id": c.id, "kind": c.kind, "expose": c.expose,
                                          "variant": c.variant,
                                          "modules": [m["id"] for m in c.modules]} for c in comps],
                          "total_mb": sum(i.get("size_mb") or 0 for i in items)},
                         ensure_ascii=False, indent=2))
        return 0
    print(render_plan(manifest, comps, items, entries, "explicit" if args.use else ("skip" if args.skip else "auto")))
    return 0


def cmd_install(args):
    manifest = load_json(args.manifest)
    _, entries = catalog()
    comps = assemble(manifest, entries, args.use, args.skip)
    items = dedupe_downloads(comps)
    out = os.path.abspath(args.out or os.path.join(ROOT, "build", manifest["id"]))
    os.makedirs(out, exist_ok=True)
    host_root = os.path.join(out, "data")

    written = []
    compose = render_compose(manifest, comps, host_root)
    if compose:
        p = os.path.join(out, "compose.yaml")
        open(p, "w", encoding="utf-8").write(compose)
        written.append(p)
    for name, body in render_runner(manifest, comps, host_root).items():
        p = os.path.join(out, name)
        open(p, "w", encoding="utf-8").write(body)
        os.chmod(p, 0o755)
        written.append(p)
    p = os.path.join(out, "install.sh")
    open(p, "w", encoding="utf-8").write(render_install_sh(manifest, comps, items))
    os.chmod(p, 0o755)
    written.append(p)
    p = os.path.join(out, "README.md")
    open(p, "w", encoding="utf-8").write(render_readme(manifest, comps, items))
    written.append(p)

    print(render_plan(manifest, comps, items, entries, "explicit" if args.use else ("skip" if args.skip else "auto")))
    print("\n## 已生成\n")
    for p in written:
        rel = os.path.relpath(p, ROOT)
        print("  " + (p if rel.startswith("..") else rel))
    shown = out if os.path.relpath(out, ROOT).startswith("..") else os.path.relpath(out, ROOT)
    print("\n真装：cd %s && ./install.sh（或加 --yes 让本命令执行）" % shown)

    if not args.yes:
        return 0
    if not shutil_which("docker"):
        die("找不到 docker，无法执行安装。文件已生成，可在有 docker 的机器上跑 install.sh")
    rc = subprocess.call(["bash", os.path.join(out, "install.sh")])
    return rc


def shutil_which(x):
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = os.path.join(d, x)
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def cmd_registry(args):
    files = []
    for pat in args.paths:
        files.extend(sorted(glob.glob(pat)))
    # 标签词表来自能力目录：插件与软件条目共用一套，界面上才能一个筛选器管两边
    cat = load_json(CATALOG) if os.path.exists(CATALOG) else {"entries": [], "tags": []}
    tag_order = [t["id"] for t in (cat.get("tags") or [])]
    tag_ids = set(tag_order)
    entry_tags = {e["id"]: list(e.get("tags") or []) for e in (cat.get("entries") or [])}

    def tags_for(m, pid):
        """清单自己写的 tags 优先；没写就按它装的组件推导（并集，按词表顺序，最多 5 个）；
        single/adapter 没有组件，退回按 id 认领同名目录条目。"""
        declared = [t for t in (m.get("tags") or []) if isinstance(t, str)]
        if declared:
            for t in declared:
                if t not in tag_ids:
                    sys.stderr.write("警告 %s：标签 %r 不在目录词表里，界面上筛不到\n" % (pid, t))
            return [t for t in tag_order if t in declared] + \
                   [t for t in declared if t not in tag_ids]
        got = set()
        for c in (m.get("components") or []):
            got.update(entry_tags.get(c.get("id"), []))
        if not got:
            got.update(entry_tags.get(pid, []))
        return [t for t in tag_order if t in got][:5]

    plugins, seen = [], set()
    for f in files:
        try:
            m = load_json(f)
        except Exception as ex:
            sys.stderr.write("跳过 %s：%s\n" % (f, ex))
            continue
        # 三种形态都要收：single 只有 runtime，adapter 只有 attach，stack 才有 components
        if not isinstance(m, dict) or not ({"components", "runtime", "attach"} & set(m)):
            continue
        pid = m.get("id")
        if not pid:
            continue
        if pid in seen:
            sys.stderr.write("跳过 %s：id %r 已在索引里（先到先得）\n" % (f, pid))
            continue
        seen.add(pid)
        # 中文可搜性：蓝图格子的中文标签就是最自然的别名，英文 keywords 搜不到「媒体」
        aliases = list(m.get("aliases") or [])
        for slot in (((m.get("extensions") or {}).get("cn.moshan.blueprint") or {}).get("slots") or []):
            if slot.get("label"):
                aliases.append(slot["label"])
        plugins.append({
            "id": pid,
            "name": m.get("name", pid),
            "version": m.get("version", "0.0.0"),
            "kind": m.get("kind", "single"),
            "summary": (m.get("summary") or "")[:64],
            "author": m.get("author"),
            "repo": m.get("repo") or "",
            "category": m.get("category"),
            "group": m.get("group"),
            "keywords": m.get("keywords") or [],
            "tags": tags_for(m, pid),
            "aliases": sorted(set(a for a in aliases if a)),
            "permissions": m.get("permissions") or [],
            "requires": m.get("requires") or {},
            "manifest": os.path.relpath(os.path.abspath(f), ROOT),
            "size": os.path.getsize(f),
            "sha256": sha256_of(f),
        })
    store = {
        "spec": "2.0",
        "store_id": args.store_id,
        "name": args.name,
        "description": "本机插件仓库（由 tools/moshan.py registry 生成）",
        "updated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "plugins": plugins,
    }
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(json.dumps(store, ensure_ascii=False, indent=2) + "\n")
    print("✓ 已生成 %s（%d 个插件）" % (os.path.relpath(out, ROOT), len(plugins)))
    for p in plugins:
        print("   %-16s %-8s %-8s %s" % (p["id"], p["version"], p["kind"], p["summary"]))
    return 0


def _score(q, p):
    q = q.lower()
    ids = (p.get("id") or "").lower()
    name = (p.get("name") or "").lower()
    kw = " ".join(p.get("keywords") or []).lower()
    al = " ".join(p.get("aliases") or []).lower()
    hay = " ".join([ids, name, p.get("summary", ""), kw, al, p.get("category") or ""]).lower()
    if q not in hay:
        return 0
    s = 1
    if q in ids:
        s += 6
    if q in name:
        s += 4
    if q in al:
        s += 4
    if q in kw:
        s += 3
    if q in (p.get("summary") or "").lower():
        s += 2
    return s


def cmd_search(args):
    store = load_json(args.store)
    hits = [(p, _score(args.kw, p)) for p in store["plugins"]]
    hits = sorted([h for h in hits if h[1] > 0], key=lambda x: -x[1])
    if not hits:
        print("没有匹配 %r 的插件。试试 moshan.py registry 重建索引。" % args.kw)
        return 1
    for p, _ in hits:
        print("%-16s %-8s %-8s %s" % (p["id"], p["version"], p["kind"], p["summary"]))
        print("%18s%s" % ("", "、".join((p.get("keywords") or [])[:6])))
    return 0


def cmd_show(args):
    store = load_json(args.store)
    p = next((x for x in store["plugins"] if x["id"] == args.id), None)
    if not p:
        die("仓库里没有 %r" % args.id)
    print(json.dumps(p, ensure_ascii=False, indent=2))
    if p.get("manifest") and os.path.exists(os.path.join(ROOT, p["manifest"])):
        m = load_json(os.path.join(ROOT, p["manifest"]))
        print("\n组件：")
        for c in m.get("components") or []:
            print("  %-14s %-10s %s" % (c["id"], c.get("kind"), c.get("image") or c.get("expose")))
    return 0


def main(argv):
    ap = argparse.ArgumentParser(prog="moshan", description="墨山插件仓库 / 定向安装 / 按需下载")
    sub = ap.add_subparsers(dest="cmd")

    p = sub.add_parser("catalog", help="列出能力目录（拆解知识，不含下载）")
    p.add_argument("--cap", help="只看某条能力")
    p.add_argument("--tag", help="只看某个标签（如 ui、network、protocol）")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_catalog)

    p = sub.add_parser("tags", help="列标签词表与用量（零使用的会标出来）")
    p.add_argument("--entries", action="store_true", help="附上每个标签下的条目 id")
    p.set_defaults(fn=cmd_tags)

    p = sub.add_parser("plan", help="算出下载集、端口、注入（不下载）")
    p.add_argument("manifest")
    p.add_argument("--use", action="append", help='显式指定："jellyfin:stream,transcode;siyuan:store"')
    p.add_argument("--skip", action="append", help='显式排除："jellyfin:transcode"')
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_plan)

    p = sub.add_parser("install", help="生成并（可选）执行安装")
    p.add_argument("manifest")
    p.add_argument("--use", action="append")
    p.add_argument("--skip", action="append")
    p.add_argument("--out", help="输出目录")
    p.add_argument("--yes", action="store_true", help="真的执行 install.sh")
    p.set_defaults(fn=cmd_install)

    p = sub.add_parser("registry", help="扫盘生成商店索引")
    p.add_argument("paths", nargs="+", help="清单文件或 glob")
    p.add_argument("--out", default="registry/registry.json")
    p.add_argument("--store-id", default="local")
    p.add_argument("--name", default="本机仓库")
    p.set_defaults(fn=cmd_registry)

    p = sub.add_parser("search", help="在市场里搜")
    p.add_argument("kw")
    p.add_argument("--store", default=DEFAULT_STORE)
    p.set_defaults(fn=cmd_search)

    p = sub.add_parser("show", help="看一个插件的详情")
    p.add_argument("id")
    p.add_argument("--store", default=DEFAULT_STORE)
    p.set_defaults(fn=cmd_show)

    args = ap.parse_args(argv)
    if not getattr(args, "fn", None):
        ap.print_help()
        return 2
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
