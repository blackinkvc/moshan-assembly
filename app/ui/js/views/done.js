// views/done.js —— 交付：东西装完了，接下来带走什么、先做哪三件事。
//
// 本页不提出新问题，也不做打包动作，只回答三件事：
//   1. 装成了什么（模块 / 格 / 连线 / 目录骨架）
//   2. 还有什么没接上（自研格、断点、死端）
//   3. 接下来先做哪三件，以及存草稿、导出清单

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { secttl, steps } from "../components.js";
import { STYLES } from "../../data/catalog.js";
import { STEP_NAMES, sceneById, packOf, hubCells, hubMod, formDef, hubLabel } from "../lib/hub.js";
import { check, cellName, CELL_BY_ID } from "../lib/wire.js";
import { openExportMd } from "../lib/exportMd.js";
import { saveDraft } from "../lib/draft.js";
import { hubEst, hrsTxt, tkTxt, costTxt, costOf, handCost, rateOf, HAND, DAY_RATE } from "../lib/estimate.js";
import { S } from "../store.js";
import { go } from "../router.js";

const styName = (id) => (STYLES.find((s) => s.id === id) || STYLES[1]).nm;
const dirOf = (dom) => (dom === "hw" ? "hardware" : "src/" + dom.replace(/\./g, "-"));

export function viewDone() {
  const hub = S.hub;
  if (!hub || !hub.mods || !hub.mods.length) {
    return h(
      "div.wrap",
      null,
      h("h1.t-20", null, "还没有交付内容"),
      h("p.prose.t-13", { style: { margin: "8px 0 16px" } }, "完成一次装配后即可查看。"),
      h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "选择场景"))
    );
  }

  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const r = check(picks, hub.form);
  const mods = hub.mods.map((id) => hubMod(id)).filter(Boolean);
  const order = r.order.filter((c) => picks.includes(c));
  const plans = hub.plans || {};
  const planOf = (mid) => {
    const m = hubMod(mid);
    return m ? m.provs.find((p) => p.id === plans[mid]) || m.provs[0] : null;
  };

  /* ── 目录骨架：能力格按所属域归到目录 ──
     顺序取施工顺序而非域名排序：这份骨架的用途是判断先建哪个目录、先填哪个格。 */
  const byDom = new Map();
  for (const cid of order) {
    const dom = (CELL_BY_ID[cid] || {}).dom || "app";
    if (!byDom.has(dom)) byDom.set(dom, []);
    byDom.get(dom).push(cellName(cid));
  }
  const dirs = [...byDom.entries()]
    .map(([dom, names]) => ({ dom, dir: dirOf(dom), names }))
    // 源码在前、硬件在后：先有东西能跑，再去接真机
    .sort((a, b) => (a.dom === "hw" ? 1 : 0) - (b.dom === "hw" ? 1 : 0));

  /* ── 还没解决的部分 ── */
  const buildMods = mods.filter((m) => (planOf(m.id) || {}).lv === "build");
  const warnMods = mods.filter((m) => (planOf(m.id) || {}).lv === "warn");
  const issues = [
    ...r.breaks.slice(0, 4).map((b) => ({
      k: "断点",
      t: `「${b.who}」缺 ${b.need}`,
      d: b.fix.length ? "补上这几格之一：" + b.fix.join("、") : "这一格要自己写，或换个做法",
      tone: "clay",
    })),
    ...r.dead.slice(0, 2).map((x) => ({
      k: "死端",
      t: `「${x.who}」产出的${x.type}没人接`,
      d: "补充下游能力格，或确认它是终点（结果直接呈现）",
      tone: "clay",
    })),
    ...warnMods.slice(0, 2).map((m) => ({
      k: "慎选",
      t: `「${m.nm}」用了${(planOf(m.id) || {}).n}`,
      d: (planOf(m.id) || {}).note || "该方案可用，但存在明显代价",
      tone: "brass",
    })),
    ...(hub.needMiss || []).slice(0, 3).map((cid) => ({
      k: "要自己写",
      t: `「${cellName(cid)}」库里没有模块`,
      d: "这一格在图上有输入输出约定，但还没有哪个模块认领它",
      tone: "brass",
    })),
  ].slice(0, 5);

  /* ── 先做哪三件事 ──
     排序按耗时：自研格 > 断点 > 固定动作。
     固定动作作为兜底：默认配置下既无自研格也无断点，
     缺少兜底时清单只剩一条，页面会显得未完成。 */
  const firstC = order.length ? cellName(order[0]) : "第一格";
  // 端到端另一端取用户可见的那一格，而非施工顺序末位（通常是零碎胶水）
  const lastC = picks.includes("app.ui")
    ? cellName("app.ui")
    : order.length
      ? cellName(order[order.length - 1])
      : "最后一格";
  const pool = [
    ...buildMods.map((m) => ({
      t: `自己写「${m.nm}」`,
      d: (planOf(m.id) || {}).note || "按清单里的思路写，通常最费时间",
    })),
    ...r.breaks.map((b) => ({
      t: `补上「${b.who}」缺的 ${b.need}`,
      d: b.fix.length ? "可以用：" + b.fix.join("、") : "这一格要自己写，或换方案",
    })),
    ...(hub.needMiss || []).map((cid) => ({
      t: `自己写「${cellName(cid)}」`,
      d: "库里没有模块覆盖这一格：按接口约定自己写，或者换一种做法绕开",
    })),
    {
      t: "确定 src/wire.ts 的消息契约",
      d: `先对齐 ${picks.length} 格之间传递的字段，再逐格实现；顺序颠倒会导致返工`,
    },
    {
      t: `跑通「${firstC}」到「${lastC}」`,
      d: "先打通一条端到端链路，其余按同一模式铺开，避免一次性全开",
    },
    {
      t: "填 .env.example",
      d: "只填实际使用的 key，未启用的服务不必提前申请",
    },
  ];
  const firstThree = pool.slice(0, 3);

  const stat = (n, label) => h("div.fact", null, h("b", null, String(n)), h("span", null, label));

  const est = hubEst(hub);

  return h(
    "div.wrap",
    null,
    steps(STEP_NAMES, 7),

    /* ① 完成度一句话说清 */
    h(
      "div.donehero",
      null,
      h("div.tickmark", null, icon("check", { size: 20 })),
      h("div.dhx", null,
        h("h1", null, "装配完成"),
        h("p", null,
          `${hubLabel(hub)} · ${formDef(hub.form).nm} · ${styName(hub.sty)}：`,
          h("b", null, `${mods.length} 个模块插在 ${picks.length} 格上`),
          `，${r.lines} 条连线已连通。`
        )
      )
    ),

    h(
      "div.facts",
      null,
      stat(mods.length, "模块"),
      stat(picks.length, "能力格"),
      stat(r.lines, "连线"),
      stat(buildMods.length, "格要自己写")
    ),

    /* ② 装完的主板：全部实心，没有空槽 */
    h(
      "div.pcb.doneBoard",
      null,
      h("div.pcb-hd", null,
        icon("chip", { size: 15 }),
        h("b", null, `${hubLabel(hub, 12)} · 主板`),
        h("i", null, `${mods.length}/${mods.length} 已插上`)
      ),
      h(
        "div.pcbgrid",
        null,
        mods.map((m) => {
          const el = h("div.mchip", { title: `${m.nm} · ${(planOf(m.id) || {}).n || "—"}` },
            h("span.nm", null, m.nm));
          el.style.setProperty("--h", packOf(m.pk).hue);
          return el;
        })
      ),
      h("div.pcb-ft", null, "全部就绪 · 可交付")
    ),

    /* ③ 目录骨架 + 先做三件事 */
    h(
      "div.donecols",
      null,
      h(
        "div",
        null,
        secttl("① 装出来的目录", `${dirs.length} 个目录 · 按施工顺序排的格`),
        h(
          "div.tree",
          null,
          h("div.l1", null, "app/"),
          dirs.map((d) =>
            h("div.l2", null,
              h("span.br", null, "├─ "),
              h("span.d", null, d.dir + "/"),
              h("span.m", null, "  " + d.names.slice(0, 3).join("、") +
                (d.names.length > 3 ? ` 等 ${d.names.length} 格` : ""))
            )
          ),
          h("div.l2", null, h("span.br", null, "├─ "),
            h("span.d", null, "src/wire.ts"),
            h("span.m", null, `  ← 接口基板，${picks.length} 格的信箱`)),
          h("div.l2", null, h("span.br", null, "├─ "),
            h("span.d", null, ".env.example"),
            h("span.m", null, "  ← 商业服务的 key 占位")),
          h("div.l2", null, h("span.br", null, "└─ "),
            h("span.d", null, "README.md"),
            h("span.m", null, "  ← 每格做什么、为什么选这个做法"))
        ),
        h("p.t-12.faint", { style: { marginTop: "var(--sp-2)" } },
          "目录骨架按所选能力格推导，未实际生成文件。")
      ),

      h(
        "div",
        null,
        secttl("② 先做这三件事", `${firstThree.length} 项`),
        h(
          "ol.todo3",
          null,
          firstThree.map((x, i) =>
            h("li", null,
              h("b", null, String(i + 1)),
              h("div", null, h("span", null, x.t), h("i", null, x.d))
            )
          )
        ),
        issues.length
          ? h("div.doneissues", null,
              h("div.dih", null, icon("warn", { size: 13 }), h("b", null, `${issues.length} 处要注意`)),
              issues.map((x) =>
                h("div.di", { "data-tone": x.tone },
                  h("span.k", null, x.k),
                  h("div", null, h("span.t", null, x.t), h("i", null, x.d))
                )
              )
            )
          : h("div.note", null,
              h("b", null, "无自研格，也无断点。"),
              "每一格都有现成实现，按上述顺序接入即可。")
      )
    ),

    /* ④ 工作量小结：交付时给出量级，不必回确认页查看 */
    est
      ? h(
          "div.estsum",
          null,
          secttl("④ 工作量与费用", `按当前选型估算 · ${rateOf(S.rate).nm}价`),
          h(
            "div.esg",
            null,
            h("div", null, h("span", null, "手写"), h("b", null, hrsTxt(est.total.hours)), h("i", null, "高级程序员从零实现")),
            h("div", null, h("span", null, "AI 辅助"), h("b", null, hrsTxt(est.total.hours / HAND)), h("i", null, "同等工作量，含调试")),
            h("div", null, h("span", null, "生成 token"), h("b", null, tkTxt(est.total.tk)), h("i", null, `折 ${costTxt(costOf(est.total.tk, S.rate))}`)),
            h("div.hot", null, h("span", null, "净省"), h("b", null, costTxt(handCost(est.total.hours) - handCost(est.total.hours / HAND) - costOf(est.total.tk, S.rate))), h("i", null, "人工费差额"))
          ),
          h(
            "p.t-12.faint",
            { style: { marginTop: "8px" } },
            `手写人工按 ¥${DAY_RATE.toLocaleString("zh-CN")}/人天折算约 ${costTxt(handCost(est.total.hours))}；估算不含需求沟通与验收，偏差通常在正负三成内。`
          )
        )
      : null,

    /* ④ 交付出口：先试用（可交互原型），再打包（zip） */
    h(
      "div.stepnav",
      null,
      h("button.btn.btn--ghost", { onclick: () => go(S.build ? "build" : "confirm") },
        icon("arrow-left", { size: 14 }),
        h("span", null, S.build ? "上一步：组装台" : "上一步：确认清单")),
      h(
        "div.btns",
        null,
        h("button.btn.btn--ghost", { onclick: () => saveDraft(hub, "done") },
          icon("save", { size: 14 }), h("span", null, "存草稿")),
        h("button.btn.btn--ghost", { onclick: () => openExportMd(hub) },
          icon("export", { size: 14 }), h("span", null, "导出清单")),
        h("button.btn", { onclick: () => go("pack") },
          icon("box", { size: 14 }), h("span", null, "直接打包")),
        h("button.btn.btn--primary", { onclick: () => go("trial") },
          h("span", null, "试用原型"), icon("arrow-right", { size: 14 }))
      )
    ),

    h("p.t-12.faint", { style: { marginTop: "var(--sp-4)", textAlign: "right" } },
      "试用打开的是可交互原型：界面与交互为真实实现，后端为模拟。")
  );
}
