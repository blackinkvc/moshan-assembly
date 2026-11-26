// views/plans.js —— 每格挑实现：模块用什么做、模块之间的胶水、整台东西跑在什么底座上。
//
// 这一页天然很长：21 个模块 × 平均 3.5 个做法，再加 10 项胶水与 9 项底座，全铺开
// 四千多像素，没人会从头读到尾。所以每条默认只显示「已经选中的那个」，
// 点标题上的「还有 N 个做法」就地展开——想核对的人能展开，不想看的人一行扫过去。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, modal, pagehd, secttl, steps } from "../components.js";
import { HUB, GLUE, BASE, PACKS } from "../../data/catalog.js";
import { STEP_NAMES, sceneById, packOf, hubCells, formDef } from "../lib/hub.js";
import { estGroup, hubEst, hrsTxt, tkTxt, costTxt, costOf, rateOf } from "../lib/estimate.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

const LV_TXT = { rec: "推荐", ok: "能用", warn: "慎选", build: "自研" };
const LV_KIND = { rec: "moss", ok: "plain", warn: "clay", build: "brass" };

const recOf = (provs) => provs.find((p) => p.lv === "rec") || provs[0];
const curOf = (provs, id) => provs.find((p) => p.id === id) || recOf(provs);

export function viewPlans() {
  const hub = S.hub;
  if (!hub || !hub.mods || !hub.mods.length) {
    return h(
      "div.wrap",
      null,
      pagehd({ title: "还没有可选模块", lead: "先选择场景、确定形态、勾选功能包，这里才会有模块。" }),
      h(
        "div.row.gap-2",
        null,
        h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "回到第一步"))
      )
    );
  }

  const sc = sceneById(hub.scene);
  const mods = hub.mods.map((id) => HUB.find((m) => m.id === id)).filter(Boolean);
  const cells = hubCells(hub.mods);

  /* 缺省值补齐：导出与打包读到的必须是同一份确定的值 */
  hub.plans = hub.plans || {};
  hub.glue = hub.glue || {};
  hub.base = hub.base || {};
  for (const m of mods) if (!hub.plans[m.id]) hub.plans[m.id] = recOf(m.provs).id;
  for (const g of GLUE) if (!hub.glue[g.id]) hub.glue[g.id] = recOf(g.provs).id;
  for (const g of BASE) {
    if (hub.base[g.id]) continue;
    // 底座里的「运行时外壳」跟着形态走：选了 CLI 就不该默认 Tauri
    const want = g.id === "bs-shell" ? formDef(hub.form).base : null;
    hub.base[g.id] = want && g.provs.some((p) => p.id === want) ? want : recOf(g.provs).id;
  }

  // 展开状态只是界面状态，不落盘
  const open = new Set();
  const blocks = new Map(); // key → { el, badge, cur, opts, it, provs, get, put }

  /* ── 一个可选项 ── */
  function optRow(it, pv, onPick) {
    const row = h(
      "button.opt",
      { "aria-checked": "false", "data-pid": pv.id, onclick: () => onPick(pv.id) },
      h("span.rd"),
      h(
        "span.txt",
        null,
        h(
          "span.n",
          null,
          pv.n,
          h("span.lv", { "data-lv": pv.lv }, LV_TXT[pv.lv] || ""),
          pv.k ? h("span.k", null, pv.k) : null
        ),
        h("span.nt", null, pv.note)
      )
    );
    return row;
  }

  /**
   * 一个「要挑的东西」：模块、胶水项、底座项都走这个构造。
   * get() 取当前选中的 id，put(pid) 写回。
   */
  function planBlock({ key, it, hue, tag, cells: cs, why, get, put }) {
    const provs = it.provs;
    const badgeEl = h("span.lvb");
    const curEl = h("span.cur");
    const estEl = h("span.est");
    const opts = h("div.opts");
    const toggle = h("button.more", { onclick: () => toggleOpen() });

    const head = h(
      "div.pl-h",
      null,
      h("span.pico", null, icon(it.art, { size: 16 })),
      h("b", null, it.nm),
      tag ? h("span.ptag", null, tag) : null,
      cs && cs.length
        ? h("span.cells", null, cs.map((c) => h("code", null, c)))
        : null,
      badgeEl,
      toggle
    );

    const el = h("div.pl", { "data-key": key }, head, why ? h("p.why", null, why) : null, curEl, estEl, opts);
    el.style.setProperty("--h", hue);

    function paintOptions() {
      const sel = curOf(provs, get());
      opts.replaceChildren(
        ...provs.map((pv) =>
          optRow(it, pv, (pid) => {
            put(pid);
            sync();
          })
        )
      );
      for (const n of opts.children) n.setAttribute("aria-checked", String(n.dataset.pid === sel.id));
    }

    function sync() {
      const sel = curOf(provs, get());
      badgeEl.replaceChildren(badge(LV_TXT[sel.lv] || "", LV_KIND[sel.lv] || "plain"));
      curEl.replaceChildren(
        h("span.nm", null, sel.n),
        h("span.nt", null, sel.note)
      );
      const e = estGroup(it, sel.id);
      estEl.replaceChildren(
        h("span.k", null, "估算"),
        h("span", null, hrsTxt(e.hours)),
        h("i", null, "·"),
        h("span", null, `${tkTxt(e.tk)} token`),
        h("i", null, "·"),
        h("span", null, costTxt(costOf(e.tk, S.rate)))
      );
      const isOpen = open.has(key);
      el.setAttribute("data-open", String(isOpen));
      toggle.replaceChildren(
        h("span", null, isOpen ? "收起" : `另有 ${provs.length - 1} 种`),
        icon(isOpen ? "chevron" : "chevron-right", { size: 12 })
      );
      if (isOpen) {
        for (const n of opts.children) n.setAttribute("aria-checked", String(n.dataset.pid === sel.id));
      }
    }

    function toggleOpen() {
      if (open.has(key)) open.delete(key);
      else open.add(key);
      sync();
    }

    paintOptions();
    sync();
    blocks.set(key, { el, sync });
    return el;
  }

  /* ── 三组 ── */

  const modBlocks = mods.map((m) =>
    planBlock({
      key: "m:" + m.id,
      it: m,
      hue: packOf((m.pks || [])[0] || "core").hue,
      tag: (PACKS.find((p) => p.id === m.pk) || {}).nm,
      cells: m.cells,
      get: () => S.hub.plans[m.id],
      put: (pid) => {
        set({ hub: { ...S.hub, plans: { ...S.hub.plans, [m.id]: pid } } });
        paintSum();
      },
    })
  );

  const glueBlocks = GLUE.map((g) =>
    planBlock({
      key: "g:" + g.id,
      it: g,
      hue: 45,
      cells: g.cells,
      why: g.why || g.sub,
      get: () => S.hub.glue[g.id],
      put: (pid) => {
        set({ hub: { ...S.hub, glue: { ...S.hub.glue, [g.id]: pid } } });
        paintSum();
      },
    })
  );

  const baseBlocks = BASE.map((g) =>
    planBlock({
      key: "b:" + g.id,
      it: g,
      hue: 215,
      cells: g.cells,
      why: g.why || g.sub,
      get: () => S.hub.base[g.id],
      put: (pid) => {
        set({ hub: { ...S.hub, base: { ...S.hub.base, [g.id]: pid } } });
        paintSum();
      },
    })
  );

  /* ── 全部按推荐 ── */
  function applyAllRec() {
    const plans = {};
    for (const m of mods) plans[m.id] = recOf(m.provs).id;
    const glue = {};
    for (const g of GLUE) glue[g.id] = recOf(g.provs).id;
    const base = {};
    for (const g of BASE) {
      const want = g.id === "bs-shell" ? formDef(S.hub.form).base : null;
      base[g.id] = want && g.provs.some((p) => p.id === want) ? want : recOf(g.provs).id;
    }
    set({ hub: { ...S.hub, plans, glue, base } });
    for (const b of blocks.values()) b.sync();
    paintSum();
    return { glue: GLUE.length, base: BASE.length };
  }

  function askRec() {
    applyAllRec();
    const m = modal({
      title: "已全部取推荐方案",
      body: h(
        "div.col.gap-3",
        null,
        h(
          "p.prose.t-13",
          null,
          `${mods.length} 个模块、${GLUE.length} 项胶水、${BASE.length} 项底座的实现已切换为`,
          h("b", null, "推荐方案"),
          "。本页无其他待填项，下一步将它们展开为能力格并校验连线。"
        ),
        h(
          "div.col.gap-2",
          null,
          rowKV("模块", `${mods.length} 个 · ${cells.length} 格`),
          rowKV("胶水", `${GLUE.length} 项`),
          rowKV("底座", `${BASE.length} 项 · 外壳跟着形态走（${formDef(S.hub.form).nm}）`)
        ),
        h(
          "p.t-12.faint",
          null,
          "需要逐项核对可留在此页，展开每条查看备选做法，修改后进入下一步。"
        )
      ),
      footer: [
        h("button.btn.btn--ghost", { onclick: () => m.close() }, h("span", null, "留在此页核对")),
        h("button.btn.btn--primary", { onclick: () => { m.close(); go("wire"); } }, h("span", null, "下一步：连线图")),
      ],
    });
  }

  function rowKV(k, v) {
    return h(
      "div.row.gap-3",
      null,
      h("span.t-12.faint", { style: { minWidth: "56px" } }, k),
      h("span.t-13", null, v)
    );
  }

  /* 合计随选型变化：改一条方案，这块要跟着动 */
  const sumEl = h("span.sum");
  function paintSum() {
    const e = hubEst(S.hub);
    if (!e) return;
    sumEl.replaceChildren(
      h("span", null, "当前选型合计：手写"),
      h("b", null, hrsTxt(e.total.hours)),
      h("span", null, "· 生成"),
      h("b", null, `${tkTxt(e.total.tk)} token`),
      h("span", null, `· ${costTxt(costOf(e.total.tk, S.rate))}（${rateOf(S.rate).nm}价）`)
    );
  }
  paintSum();

  const recBtn = h(
    "button.btn.btn--primary.btn--lg",
    { onclick: askRec },
    icon("spark", { size: 14 }),
    h("span", null, "全部取推荐")
  );

  return h(
    "div.wrap",
    null,
    pagehd({
      title: "选择实现方案",
      lead: h(
        "span",
        null,
        "三项待定：",
        h("b", null, "模块"),
        "用什么实现、模块之间的",
        h("b", null, "胶水"),
        "如何连接、整体运行在哪种",
        h("b", null, "底座"),
        "上。均已按推荐预选，可逐项修改，也可一次取全部推荐值。"
      ),
      aside: badge(`${mods.length} 模块 · ${cells.length} 格`, "plain"),
    }),

    steps(STEP_NAMES, 3),

    h(
      "div.recbar",
      null,
      h(
        "div.rb",
        null,
        h("b", null, "三项都无需修改？"),
        h(
          "span",
          null,
          `${mods.length} 个模块、${GLUE.length} 项胶水、${BASE.length} 项底座一次性取推荐方案，确认后进入下一步。`
        ),
        sumEl
      ),
      recBtn
    ),

    secttl("① 功能模块", `${mods.length} 个 · 每个 2–4 种实现`, h("span.t-12.faint", null, "展开可查看备选")),
    h("div.col.gap-2", null, modBlocks),

    secttl("② 模块之间的胶水", `${GLUE.length} 项 · 新模块接入的公共通道`),
    h("div.col.gap-2", null, glueBlocks),

    secttl("③ 底座", `${BASE.length} 项 · 运行环境与分发方式`),
    h("div.col.gap-2", null, baseBlocks),

    h(
      "div.mobar",
      null,
      badge(`${mods.length} 模块 · ${cells.length} 格 · ${GLUE.length} 胶水 · ${BASE.length} 底座`, "moss"),
      h("span.push", null, null),
      h(
        "button.btn.btn--primary",
        { onclick: () => go("wire") },
        h("span", null, "下一步：连线图"),
        icon("arrow-right", { size: 14 })
      )
    ),

    h(
      "div.stepnav",
      null,
      h(
        "button.btn.btn--ghost",
        { onclick: () => go("packs") },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：选择功能包")
      )
    )
  );
}
