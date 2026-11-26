// views/home.js —— 工作台首页。
// 主入口只保留一个（整块可点、视觉最重），其余降为次级卡片，避免三个等重按钮互相竞争。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { pagehd, secttl, emptyState, btn, badge } from "../components.js";
import { S, set } from "../store.js";
import { SCENES, PACKS, HUB, W } from "../../data/catalog.js";
import { go } from "../router.js";

function hero() {
  return h(
    "div.hero",
    null,
    h(
      "button.start",
      {
        onclick: () => go("scenes"),
        "aria-label": "开始装配：先在场景中选择一个",
      },
      h("span.kicker", null, icon("spark", { size: 13 }), "从这里开始"),
      h("h2", null, "装配属于自己的工具"),
      h(
        "p",
        null,
        `选定场景后自动匹配 ${PACKS.length} 个功能包、${HUB.length} 个模块，并当场校验收线是否连通。`
      ),
      h("span.go", null, "开始装配", icon("arrow-right", { size: 14 }))
    ),
    h(
      "div.col.gap-3",
      null,
      h(
        "button.alt",
        { onclick: () => go("need"), style: { flex: "1" } },
        icon("note", { size: 18 }),
        h("h3", null, "从一句话需求开始"),
        h("p", null, "写清「拿进来什么、变成什么出去」，反推要哪些能力格")
      ),
      h(
        "button.alt",
        { onclick: () => go("drafts"), style: { flex: "1" } },
        icon("clock", { size: 18 }),
        h("h3", null, "继续上次的装配"),
        h("p", null, S.drafts.length ? `${S.drafts.length} 份草稿停在不同步骤` : "暂无草稿，中途可随时保存")
      )
    )
  );
}

function facts() {
  const items = [
    [SCENES.length, "场景"],
    [PACKS.length, "工程包"],
    [HUB.length, "模块"],
    [Object.keys(W).length, "能力格"],
  ];
  return h(
    "div.facts",
    null,
    items.map(([n, label]) => h("div.fact", null, h("b", null, String(n)), h("span", null, label)))
  );
}

function drafts() {
  const list = S.drafts;
  if (!list.length) {
    return h("div.card.card--flat", { style: { padding: "var(--sp-2)" } },
      emptyState({
        iconName: "clock",
        title: "暂无草稿",
        desc: "装配中途按 ⌘S 保存，下次从这里继续",
      })
    );
  }
  return h(
    "div.col.gap-2",
    null,
    list.map((d) =>
      h(
        "div.card.card--hover",
        { style: { display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-4)" } },
        icon("clock", { size: 15 }),
        h("div.grow", null,
          h("div.t-13.semi.ellipsis", null, d.name || "未命名装配"),
          h("div.t-12.faint", null, `${d.step || "工作台"} · ${d.when || "刚刚"}`)
        ),
        badge("草稿", "plain"),
        btn("打开", { size: "sm", kind: "ghost" })
      )
    )
  );
}

function twoPaths() {
  const path = (title, flow, note) =>
    h(
      "div.card.card--flat",
      { style: { padding: "var(--sp-4)" } },
      h("div.t-13.semi", { style: { marginBottom: "6px" } }, title),
      h("div.t-12.faint.mono", { style: { lineHeight: "1.9" } }, flow),
      h("div.t-12.faint", { style: { marginTop: "8px", lineHeight: "1.65" } }, note)
    );
  return h(
    "div",
    { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" } },
    path("从需求出发", "一句话 → 摊开能力格 → 打勾打包 → 查连通 → 排顺序组装",
      "无需知道模块名，系统按能力格匹配。"),
    path("从场景出发", "选场景 → 定形态 → 勾包 → 每格挑实现 → 查连通 → 组装",
      "知道自己要什么，就少走一步。")
  );
}

export function viewHome() {
  return h(
    "div.wrap",
    null,
    pagehd({
      title: "工作台",
      lead: "两种入口通向同一套装配流程。中途可存草稿，返回后从原处继续。",
      aside: btn("新建装配", { kind: "primary", iconName: "plus", onclick: () => go("scenes") }),
    }),
    hero(),
    facts(),
    secttl("草稿箱", S.drafts.length ? `${S.drafts.length} 份` : "空着"),
    drafts(),
    secttl("两种入口"),
    twoPaths()
  );
}
