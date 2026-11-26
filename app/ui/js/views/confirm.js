// views/confirm.js —— 确认清单：把前面六步的结果摊成一张可以逐行核对的东西。
//
// 这一页不发新问题，只负责「看清楚」：形态/规格/平台/内存四个决定、每个模块选了哪套实现、
// 胶水与底座、以及按施工顺序排好的能力格清单。确认后进组装。
//
// 导出用「弹窗 + 复制」而不是下载文件：Tauri 里没有文件写入权限时，
// <a download> 会静默失败——宁可少一个按钮，也不要给一个点了没反应的按钮。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, secttl, steps } from "../components.js";
import { GLUE, BASE, HUB, PACKS, STYLES } from "../../data/catalog.js";
import {
  STEP_NAMES,
  PLATS,
  sceneById,
  packOf,
  hubCells,
  hubMod,
  formDef,
  platOf,
  memSim,
  mbTxt,
} from "../lib/hub.js";
import { check, cellName, cellOuts } from "../lib/wire.js";
import { openExportMd } from "../lib/exportMd.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

const LV_TXT = { rec: "推荐", ok: "能用", warn: "慎选", build: "自研" };
const LV_KIND = { rec: "moss", ok: "plain", warn: "clay", build: "brass" };
const styName = (id) => (STYLES.find((s) => s.id === id) || STYLES[1]).nm;
const recOf = (provs) => provs.find((p) => p.lv === "rec") || provs[0];

export function viewConfirm() {
  const hub = S.hub;
  if (!hub || !hub.mods || !hub.mods.length) {
    return h(
      "div.wrap",
      null,
      pagehd({ title: "还没有可确认的东西", lead: "先挑场景、勾模块，这里才有清单。" }),
      h(
        "div.row.gap-2",
        null,
        h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "从头开始"))
      )
    );
  }

  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const r = check(picks, hub.form);
  const mods = hub.mods.map((id) => HUB.find((m) => m.id === id)).filter(Boolean);
  const plats = platOf(hub).map((id) => (PLATS.find((p) => p.id === id) || {}).nm).filter(Boolean);
  const memo = memSim(hub);
  const bad = r.breaks.length;
  const dead = r.dead.length;

  /* 谁带来这一格：第一格可能由多个模块提供，取最先勾上的那个 */
  const ownerOf = (cid) => {
    const m = mods.find((x) => (x.cells || []).includes(cid));
    return m ? m.nm : "（公共）";
  };

  const planOf = (mid) => {
    const m = hubMod(mid);
    return m ? m.provs.find((p) => p.id === (hub.plans || {})[mid]) || recOf(m.provs) : null;
  };
  const glueOf = (g) =>
    g.provs.find((p) => p.id === (hub.glue || {})[g.id]) || recOf(g.provs);
  const baseOf = (g) =>
    g.provs.find((p) => p.id === (hub.base || {})[g.id]) || recOf(g.provs);

  const builds = mods.filter((m) => (planOf(m.id) || {}).lv === "build").length;

  /* ── 小部件 ── */
  const dcard = (label, value, note) =>
    h(
      "div.dcard",
      null,
      h("span", null, label),
      h("b", null, value),
      h("i", null, note)
    );

  const th = (t, w) => h("th", w ? { style: { width: w } } : null, t);

  /* ── 表格 1：模块与实现 ── */
  const modTable = h(
    "div.tbl",
    null,
    h(
      "table",
      null,
      h("thead", null, h("tr", null, th("模块", "32%"), th("你选的实现"), th("等级", "72px"), th("为什么 / 备注", "30%"))),
      h(
        "tbody",
        null,
        mods.map((m) => {
          const p = planOf(m.id);
          return h(
            "tr",
            null,
            h("td.nm", null, m.nm, h("div.sub", null, (m.cells || []).join(" · "))),
            h("td", null, p ? p.n : "—", h("div.sub", null, p ? p.k : "")),
            h("td", null, p ? badge(LV_TXT[p.lv] || "", LV_KIND[p.lv] || "plain") : "—"),
            h("td.faint.t-12", null, p ? p.note : "—")
          );
        })
      )
    )
  );

  /* ── 表格 2：胶水与底座 ── */
  const glueTable = h(
    "div.tbl",
    null,
    h(
      "table",
      null,
      h("thead", null, h("tr", null, th("类别", "72px"), th("这一项", "26%"), th("选了什么"), th("为什么", "26%"))),
      h(
        "tbody",
        null,
        [...GLUE.map((g) => ["胶水", g, glueOf(g)]), ...BASE.map((g) => ["底座", g, baseOf(g)])].map(
          ([kind, g, pv]) =>
            h(
              "tr",
              null,
              h("td", null, badge(kind, "plain")),
              h("td.nm", null, g.nm, g.cells && g.cells.length ? h("div.sub", null, g.cells.join(" · ")) : null),
              h("td", null, pv.n, h("div.sub", null, pv.k || "")),
              h("td.faint.t-12", null, pv.note)
            )
        )
      )
    )
  );

  /* ── 表格 3：施工清单 ── */
  const cellTable = h(
    "div.tbl",
    null,
    h(
      "table",
      null,
      h("thead", null, h("tr", null, th("序", "40px"), th("能力格", "38%"), th("来自模块", "24%"), th("产出什么"))),
      h(
        "tbody",
        null,
        r.order
          .filter((c) => picks.includes(c))
          .map((cid, i) => {
            return h(
              "tr",
              null,
              h("td.mono.faint", null, String(i + 1)),
              h("td.nm", null, cellName(cid), h("div.sub", null, cid)),
              h("td.faint.t-12", null, ownerOf(cid)),
              h("td.faint.t-12", null, outTxt(cid))
            );
          })
      )
    )
  );

  function outTxt(cid) {
    return cellOuts(cid).join("、") || "—";
  }

  const stat = (n, label, warn) =>
    h(
      "div.st",
      null,
      h("b", { class: warn ? "is-warn" : null }, String(n)),
      h("span", null, label)
    );

  /* ── 开工：把结果固化成一次组装快照 ── */
  function startBuild() {
    set({
      hub: { ...S.hub, startedAt: Date.now(), done: [], running: false },
    });
    go("build");
  }

  const memWarn = memo.pct > 0.92;

  return h(
    "div.wrap",
    null,
    pagehd({
      title: "确认清单",
      lead: h(
        "span",
        null,
        `${sc.nm} · ${formDef(hub.form).nm} · ${styName(hub.sty)}：`,
        h("b", null, `${mods.length} 个模块插在 ${picks.length} 格上`),
        `，装到 ${plats.join(" / ") || "—"}。确认后按施工顺序逐格装，中途可以停。`
      ),
      aside: [
        badge(bad ? `${bad} 个断点` : "接得上", bad ? "clay" : "moss"),
        dead ? badge(`${dead} 个死端`, "brass") : null,
      ],
    }),

    steps(STEP_NAMES, 5),

    h(
      "div.dgrid",
      null,
      dcard("形态", formDef(hub.form).nm, formDef(hub.form).d),
      dcard("规格", styName(hub.sty), `${mods.length} 个模块 · ${picks.length} 格`),
      dcard("平台", plats.join(" / ") || "—", "安装说明按这几项给"),
      dcard(
        "内存占用",
        mbTxt(memo.total),
        memWarn
          ? `可用约 ${mbTxt(memo.avail)}，装不下${memo.model ? "——换小一号的模型" : ""}`
          : `可用约 ${mbTxt(memo.avail)}（预算 ${mbTxt(memo.budget)}）`
      )
    ),

    secttl("① 模块与实现", `${mods.length} 个 · 每个都定了做法`),
    modTable,

    secttl("② 胶水与底座", `${GLUE.length + BASE.length} 项 · 模块之间怎么接、跑在哪`),
    glueTable,

    h(
      "div.conf",
      null,
      h(
        "div",
        null,
        secttl("③ 施工清单", `${picks.length} 格 · 从上到下就是装配顺序`),
        cellTable
      ),
      h(
        "aside.stats",
        null,
        h(
          "div.stat",
          null,
          stat(picks.length, "格"),
          stat(r.lines, "连线"),
          stat(builds, "自研格", builds > 0)
        ),
        h(
          "div.note",
          null,
          h("b", null, "开工前确认"),
          "商业服务的 key 要自己申请；标「自研」的格按清单里的思路写，通常最费时间；" +
            "断点不是错误，是「这一格要自己补上」。"
        )
      )
    ),

    h(
      "div.mobar",
      null,
      badge(`${picks.length} 格 · ${r.lines} 条连线 · ${mods.length} 个模块`, bad ? "clay" : "moss"),
      h("span.t-12.faint", null, "确认后进组装台，一格一格装"),
      h(
        "span.push.row.gap-2",
        null,
        h(
          "button.btn.btn--ghost",
          { onclick: () => openExportMd(hub) },
          icon("export", { size: 14 }),
          h("span", null, "导出清单")
        ),
        h(
          "button.btn.btn--primary.btn--lg",
          { onclick: () => startBuild() },
          h("span", null, "确认开工，开始组装"),
          icon("arrow-right", { size: 14 })
        )
      )
    ),

    h(
      "div.stepnav",
      null,
      h(
        "button.btn.btn--ghost",
        { onclick: () => go("wire") },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：回连线图")
      )
    )
  );
}
