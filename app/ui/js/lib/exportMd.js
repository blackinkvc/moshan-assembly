// lib/exportMd.js —— 把一次装配导成 Markdown。
//
// 确认页和交付页都要这个，所以放在这里一份：两处各写一遍必然漂移
// （早前就出现过交付页少了「胶水与底座」半张表）。
//
// 导出用「弹窗 + 复制」而不是下载文件：Tauri 里没有文件写入权限时，
// <a download> 会静默失败——宁可少一个按钮，也不要给一个点了没反应的按钮。

import { h } from "./dom.js";
import { modal, toast } from "../components.js";
import { GLUE, BASE, HUB, STYLES } from "../../data/catalog.js";
import { sceneById, hubCells, hubMod, formDef, platOf, PLATS } from "./hub.js";
import { check, cellName } from "./wire.js";

const LV_TXT = { rec: "推荐", ok: "能用", warn: "慎选", build: "自研" };
const styName = (id) => (STYLES.find((s) => s.id === id) || STYLES[1]).nm;
const recOf = (provs) => provs.find((p) => p.lv === "rec") || provs[0];

/** 纯函数：给定中台状态，产出 Markdown 文本 */
export function mdFor(hub) {
  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const r = check(picks, hub.form);
  const mods = hub.mods.map((id) => HUB.find((m) => m.id === id)).filter(Boolean);
  const plats = platOf(hub).map((id) => (PLATS.find((p) => p.id === id) || {}).nm).filter(Boolean);

  const planOf = (mid) => {
    const m = hubMod(mid);
    return m ? m.provs.find((p) => p.id === (hub.plans || {})[mid]) || recOf(m.provs) : null;
  };
  const glueOf = (g) => g.provs.find((p) => p.id === (hub.glue || {})[g.id]) || recOf(g.provs);
  const baseOf = (g) => g.provs.find((p) => p.id === (hub.base || {})[g.id]) || recOf(g.provs);
  const ownerOf = (cid) => {
    const m = mods.find((x) => (x.cells || []).includes(cid));
    return m ? m.nm : "（公共）";
  };

  const L = [];
  L.push(`# ${sc.nm} · ${formDef(hub.form).nm} · ${styName(hub.sty)}`, "");
  L.push(`共 ${mods.length} 个模块 · ${picks.length} 格 · ${r.lines} 条连线`, "");
  L.push(`平台：${plats.join(" / ") || "—"}`, "");

  L.push("## 模块与实现", "", "| 模块 | 实现 | 等级 | 说明 |", "|---|---|---|---|");
  for (const m of mods) {
    const p = planOf(m.id);
    L.push(`| ${m.nm} | ${p ? p.n : "—"} | ${p ? LV_TXT[p.lv] : "—"} | ${p ? (p.note || "").replace(/\|/g, "/") : ""} |`);
  }

  L.push("", "## 胶水与底座", "", "| 类别 | 这一项 | 选了什么 | 为什么 |", "|---|---|---|---|");
  for (const [kind, g, pv] of [
    ...GLUE.map((g) => ["胶水", g, glueOf(g)]),
    ...BASE.map((g) => ["底座", g, baseOf(g)]),
  ]) {
    L.push(`| ${kind} | ${g.nm} | ${pv.n} | ${(pv.note || "").replace(/\|/g, "/")} |`);
  }

  L.push("", "## 施工顺序", "", "| 序 | 能力格 | 来自模块 |", "|---|---|---|");
  r.order
    .filter((c) => picks.includes(c))
    .forEach((cid, i) => L.push(`| ${i + 1} | ${cellName(cid)}（${cid}） | ${ownerOf(cid)} |`));

  // 交付页比确认页多这一段：没接上的东西不能只在页面上说说，清单里也要留痕
  L.push("", "## 还没解决", "");
  if (!r.breaks.length && !r.dead.length) L.push("- 无");
  for (const b of r.breaks) {
    L.push(`- 断点：「${b.who}」缺 ${b.need}${b.fix.length ? "，可补 " + b.fix.join("、") : ""}`);
  }
  for (const d of r.dead) L.push(`- 死端：「${d.who}」产出的${d.type}没人接`);

  return L.join("\n");
}

/** 弹窗展示 + 一键复制 */
export function openExportMd(hub) {
  const text = mdFor(hub);
  const ta = h("textarea.mdout", { readonly: true, rows: "16", "aria-label": "清单内容" });
  ta.value = text;
  const m = modal({
    title: "清单（Markdown）",
    wide: true,
    body: h(
      "div.col.gap-3",
      null,
      h("p.t-12.faint", null, "复制走，贴进笔记、Issue 或 README 都行。"),
      ta
    ),
    footer: [
      h("button.btn.btn--ghost", { onclick: () => m.close() }, h("span", null, "关闭")),
      h(
        "button.btn.btn--primary",
        {
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast("已复制清单", 1500);
              m.close();
            } catch {
              ta.select();
              toast("已全选，按 ⌘C 复制", 2200);
            }
          },
        },
        h("span", null, "复制")
      ),
    ],
  });
}
