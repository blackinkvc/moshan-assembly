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
import {
  hubEst,
  hrsTxt,
  tkTxt,
  costTxt,
  costOf,
  handCost,
  RATES,
  HAND,
  DAY_RATE,
  HOURS_DAY,
} from "../lib/estimate.js";
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
      pagehd({ title: "还没有可确认的内容", lead: "先选择场景并勾选模块，这里才会有清单。" }),
      h(
        "div.row.gap-2",
        null,
        h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "回到第一步"))
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
      h("thead", null, h("tr", null, th("模块", "32%"), th("选定实现"), th("等级", "72px"), th("说明", "30%"))),
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
      h("thead", null, h("tr", null, th("类别", "72px"), th("项目", "26%"), th("选定实现"), th("说明", "26%"))),
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

  /* ── ④ 工作量与费用 ──
     两件事分开算：手写要多少工、生成要多少 token。费用只由 token 产生，
     所以把方案全换成现成库时，token 会降但不会归零——接线代码仍要生成。 */
  const est = hubEst(hub);
  const estBody = h("tbody");
  const cmpEl = h("div.estcmp");
  const segEl = h("div.estseg", { role: "tablist", "aria-label": "token 单价档" });

  function paintEst() {
    const rate = S.rate;
    const rows = [
      ["功能模块", est.mods.n, est.mods],
      ["胶水", est.glue.n, est.glue],
      ["底座", est.base.n, est.base],
      ["集成联调", null, est.integ],
    ];
    const trs = rows.map(([nm, n, g]) =>
      h(
        "tr",
        null,
        h("td.nm", null, nm),
        h("td", null, n == null ? "—" : String(n)),
        h("td", null, hrsTxt(g.hours)),
        h("td", null, tkTxt(g.tk)),
        h("td", null, costTxt(costOf(g.tk, rate)))
      )
    );
    trs.push(
      h(
        "tr.sum",
        null,
        h("td.nm", null, "合计"),
        h("td", null, String(est.mods.n + est.glue.n + est.base.n)),
        h("td", null, hrsTxt(est.total.hours)),
        h("td", null, tkTxt(est.total.tk)),
        h("td", null, costTxt(costOf(est.total.tk, rate)))
      )
    );
    estBody.replaceChildren(...trs);

    const hand = handCost(est.total.hours);
    const aidedHours = est.total.hours / HAND;
    const aided = handCost(aidedHours);
    const tkCost = costOf(est.total.tk, rate);
    cmpEl.replaceChildren(
      h(
        "div",
        null,
        h("span", null, "全手写"),
        h("b", null, hrsTxt(est.total.hours)),
        h("i", null, `${costTxt(hand)} · 按 ¥${DAY_RATE.toLocaleString("zh-CN")}/人天`)
      ),
      h(
        "div",
        null,
        h("span", null, "AI 辅助"),
        h("b", null, hrsTxt(aidedHours)),
        h("i", null, `${costTxt(aided)} 人工 + ${costTxt(tkCost)} token`)
      ),
      h(
        "div.hot",
        null,
        h("span", null, "净省"),
        h("b", null, hrsTxt(est.total.hours - aidedHours)),
        h("i", null, `${costTxt(Math.max(0, hand - aided - tkCost))} 人工费`)
      )
    );
    for (const b of segEl.children) b.setAttribute("aria-selected", String(b.dataset.rate === rate));
  }

  for (const r of RATES) {
    segEl.appendChild(
      h(
        "button.estseg-b",
        {
          "data-rate": r.id,
          title: r.d,
          onclick: () => {
            set({ rate: r.id });
            paintEst();
          },
        },
        r.nm
      )
    );
  }
  paintEst();

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
        `，部署到 ${plats.join(" / ") || "—"}。确认后按施工顺序逐格装配，中途可暂停。`
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
      dcard("平台", plats.join(" / ") || "—", "安装说明按这几项生成"),
      dcard(
        "内存占用",
        mbTxt(memo.total),
        memWarn
          ? `可用约 ${mbTxt(memo.avail)}，超出上限${memo.model ? "，需换用更小的模型" : ""}`
          : `可用约 ${mbTxt(memo.avail)}（预算 ${mbTxt(memo.budget)}）`
      )
    ),

    secttl("① 模块与实现", `${mods.length} 个 · 均已选定实现`),
    modTable,

    secttl("② 胶水与底座", `${GLUE.length + BASE.length} 项 · 模块连接方式与运行环境`),
    glueTable,

    h(
      "div.conf",
      null,
      h(
        "div",
        null,
        secttl("③ 施工清单", `${picks.length} 格 · 自上而下即装配顺序`),
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
          "商业服务的 key 需自行申请；标「自研」的格按清单思路实现，通常耗时最长；" +
            "断点不是错误，表示该格需自行补齐。"
        )
      )
    ),

    h(
      "div.estblk",
      null,
      h(
        "div.esthd",
        null,
        h(
          "div",
          null,
          h("b", null, "工作量与费用"),
          h("span", null, "按当前选型估算，含集成联调；不含需求沟通与验收。")
        ),
        segEl
      ),
      h(
        "div.tbl.est",
        null,
        h(
          "table",
          null,
          h(
            "thead",
            null,
            h("tr", null, th("分组", "30%"), th("项数", "64px"), th("手写工时"), th("生成 token"), th("费用"))
          ),
          estBody
        )
      ),
      cmpEl,
      h(
        "details.esthow",
        null,
        h("summary", null, "这些数怎么来的"),
        h(
          "p",
          null,
          h("b", null, "手写工时"),
          "＝库内记录的「让模型从零写这一格要几天」× 8 小时 × 2.4（手写相对辅助的倍数）× 方案系数（现成库 0.45、自行实现 1.0）。没有记录的格，按接口路数与所属域估。"
        ),
        h(
          "p",
          null,
          h("b", null, "生成 token"),
          "＝工时 × 该方式的产出速率（现成库 2 万/小时、自行实现 7 万/小时）；自行实现且库内有实测值的，直接用实测值。集成联调按开发工时的 18% 计，费率取 4 万/小时。"
        ),
        h(
          "p",
          null,
          h("b", null, "费用"),
          `＝token ÷ 100 万 × 单价。人工按 ¥${DAY_RATE.toLocaleString("zh-CN")}/人天折算。三档单价：` +
            RATES.map((r) => `${r.nm} ¥${r.price}/百万`).join("、") +
            "。"
        ),
        h(
          "p",
          null,
          "数字用于判断量级与取舍，不是报价。真实项目受需求变更、第三方服务稳定性、验收标准影响，偏差通常在正负三成以内。"
        )
      )
    ),

    h(
      "div.mobar",
      null,
      badge(`${picks.length} 格 · ${r.lines} 条连线 · ${mods.length} 个模块`, bad ? "clay" : "moss"),
      h("span.t-12.faint", null, "确认后进入组装台，逐格装配"),
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
          h("span", null, "确认并开始组装"),
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
        h("span", null, "上一步：连线图")
      )
    )
  );
}
