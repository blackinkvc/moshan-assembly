// views/done.js —— 交付：东西装完了，接下来带走什么、先做哪三件事。
//
// 这一页不发新问题、也不假装在打包。它只回答三件事：
//   1. 装成了什么（模块 / 格 / 连线 / 目录骨架）
//   2. 还有什么没接上（自研格、断点、死端）—— 不藏，藏在里面等于骗人
//   3. 接下来先动手做哪三件，以及存草稿 / 导出清单

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { secttl, steps } from "../components.js";
import { STYLES } from "../../data/catalog.js";
import { STEP_NAMES, sceneById, packOf, hubCells, hubMod, formDef, hubLabel } from "../lib/hub.js";
import { check, cellName, CELL_BY_ID } from "../lib/wire.js";
import { openExportMd } from "../lib/exportMd.js";
import { saveDraft } from "../lib/draft.js";
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
      h("h1.t-20", null, "还没有装完的东西"),
      h("p.prose.t-13", { style: { margin: "8px 0 16px" } }, "从头走一遍就有了。"),
      h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "去挑场景"))
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

  /* ── 目录骨架：能力格按所属域归到目录里 ──
     顺序不是「按域排行」，而是「按施工顺序」，因为这份骨架的用途是
     「先建哪个目录、先填哪个格」——按域排会让人不知道该从哪下手。 */
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
      d: "要么再加一格把它用起来，要么确认这是终点（结果直接给人看）",
      tone: "clay",
    })),
    ...warnMods.slice(0, 2).map((m) => ({
      k: "慎选",
      t: `「${m.nm}」用了${(planOf(m.id) || {}).n}`,
      d: (planOf(m.id) || {}).note || "这个做法能跑，但有明显代价",
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
     排序理由是「谁最费时间谁先做」：自研格 > 断点 > 固定动作。
     固定动作只是兜底——默认配置里没有自研格也没有断点，
     这时清单会只剩一条「先跑通」，看着像没做完的页面。 */
  const firstC = order.length ? cellName(order[0]) : "第一格";
  // 端到端的另一头应该是「人看得见的那格」，不是施工顺序的最后一名（那通常是零碎的胶水）
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
      t: "把 src/wire.ts 的信箱定下来",
      d: `先把 ${picks.length} 格之间传什么字段对齐，再逐格填实现——顺序反了要返工`,
    },
    {
      t: `跑通「${firstC}」到「${lastC}」`,
      d: "端到端一条链路先亮起来，剩下的格照着这个模式铺，别一次全开",
    },
    {
      t: "填 .env.example",
      d: "只填用得上的那几把 key，没用到的服务别提前申请",
    },
  ];
  const firstThree = pool.slice(0, 3);

  const stat = (n, label) => h("div.fact", null, h("b", null, String(n)), h("span", null, label));

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
          `，${r.lines} 条连线已接通。`
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
      h("div.pcb-ft", null, "全部就绪 · 可以带走了")
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
          "按你选的能力格推出来的骨架，不是真生成过文件——")
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
              h("b", null, "没有自研格，也没有断点。"),
              "每一格都有现成做法，按上面的顺序接就行。")
      )
    ),

    /* ④ 带走：两个出口。先试用（能点的原型）→ 再打包（zip） */
    h(
      "div.stepnav",
      null,
      h("button.btn.btn--ghost", { onclick: () => go(S.build ? "build" : "confirm") },
        icon("arrow-left", { size: 14 }),
        h("span", null, S.build ? "上一步：回组装" : "上一步：回确认")),
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
          h("span", null, "先试用一下"), icon("arrow-right", { size: 14 }))
      )
    ),

    h("p.t-12.faint", { style: { marginTop: "var(--sp-4)", textAlign: "right" } },
      "试用会打开一个能点的原型（不是截图，也不是占位）：界面和交互是真的，后端是假的。")
  );
}
