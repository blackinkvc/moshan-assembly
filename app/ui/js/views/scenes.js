// views/scenes.js —— 场景选择。
// 18 个场景平铺难以查找，顶部索引因此做成筛选而非锚点跳转；
// 筛选后保留一行「查看全部」，否则会被误认为其余场景不存在。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { pagehd, badge } from "../components.js";
import { SCENES, SCAT, PACKS } from "../../data/catalog.js";
import { newHub } from "../lib/hub.js";
import { go } from "../router.js";
import { set } from "../store.js";

const pkName = (id) => (PACKS.find((p) => p.id === id) || {}).nm || id;

/** 记住上次选择的分类，返回时停在原处 */
let lastCat = "all";

function scCard(sc) {
  const packs = (sc.packs || []).slice(0, 3).map(pkName);
  const more = (sc.packs || []).length - packs.length;

  return h(
    "button.sc",
    {
      role: "listitem",
      tabindex: "-1",
      "data-sc": sc.id,
      "aria-label": `${sc.nm}：${sc.sub}`,
      onclick: () => pick(sc.id),
    },
    h(
      "div.hd",
      null,
      icon(sc.art, { size: 26, cls: "ico" }),
      h("span.nm.grow", null, sc.nm),
      icon("chevron-right", { size: 14 })
    ),
    h("div.sub.clamp-3", null, sc.sub),
    h(
      "div.packs",
      null,
      packs.map((n) => h("span.pk", null, n)),
      more > 0 ? h("span.pk", null, `+${more}`) : null
    )
  );
}

function pick(id) {
  // 选定场景即写入状态：形态、功能包、方案都由这台 hub 往下推导。
  // 默认取「软件 + 均衡」，形态页进入后即有可确认的选项。
  set({ hub: newHub(id) });
  go("style", id);
}

/** 键盘：方向键在网格内移动，Enter 进入 */
function wireKeys(grid) {
  grid.addEventListener("keydown", (e) => {
    const cards = [...grid.querySelectorAll(".sc")];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;

    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    let next = -1;
    if (e.key === "ArrowRight") next = i + 1;
    else if (e.key === "ArrowLeft") next = i - 1;
    else if (e.key === "ArrowDown") next = i + cols;
    else if (e.key === "ArrowUp") next = i - cols;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = cards.length - 1;
    else return;

    if (next < 0 || next >= cards.length) return;
    e.preventDefault();
    cards.forEach((c) => (c.tabIndex = -1));
    cards[next].tabIndex = 0;
    cards[next].focus();
  });
}

export function viewScenes() {
  const counts = new Map();
  for (const g of SCAT) counts.set(g.id, g.ids.length);

  const chip = (id, label, n) =>
    h(
      "button.chip",
      {
        "aria-pressed": String(id === lastCat),
        onclick: () => {
          lastCat = id;
          rerenderBody();
        },
      },
      label,
      h("span.n", null, String(n))
    );

  const body = h("div");
  let grid = null;

  function renderBody() {
    const cat = SCAT.find((g) => g.id === lastCat);
    const list = cat ? SCENES.filter((s) => cat.ids.includes(s.id)) : SCENES;

    grid = h("div.scgrid", { role: "list", "aria-label": cat ? cat.nm : "全部场景" }, list.map(scCard));
    grid.querySelector(".sc")?.setAttribute("tabindex", "0");
    wireKeys(grid);

    body.replaceChildren(
      grid,
      h(
        "div.sctip",
        null,
        cat
          ? h(
              "span",
              null,
              `仅显示「${cat.nm}」类，共 ${list.length} 个场景　`,
              h(
                "span.lnk",
                {
                  role: "button",
                  tabindex: "0",
                  onclick: () => {
                    lastCat = "all";
                    rerenderBody();
                  },
                  onkeydown: (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      lastCat = "all";
                      rerenderBody();
                    }
                  },
                },
                `查看全部 ${SCENES.length} 个`
              )
            )
          : h("span", null, cat ? "" : `共 ${SCENES.length} 个场景，按使用对象分为 ${SCAT.length} 类`)
      )
    );
  }

  function rerenderBody() {
    // 索引 chip 的选中态要跟着变
    idx.querySelectorAll(".chip").forEach((c, i) => {
      const id = i === 0 ? "all" : SCAT[i - 1].id;
      c.setAttribute("aria-pressed", String(id === lastCat));
    });
    renderBody();
  }

  const idx = h(
    "div.scidx",
    { role: "toolbar", "aria-label": "场景分类" },
    h("span.lbl", null, "分类"),
    chip("all", "全部", SCENES.length),
    SCAT.map((g) => chip(g.id, g.nm, counts.get(g.id) || 0))
  );

  renderBody();

  return h(
    "div.wrap",
    null,
    pagehd({
      title: "选择场景",
      lead: h(
        "span",
        null,
        "判断标准是这个场景",
        h("b", null, "最难解决的问题"),
        "是否与当前需求一致，而非名称是否相近。选择后可以随时返回更换。"
      ),
      aside: h("span.t-12.faint", null, `${SCENES.length} 个场景 · ${SCAT.length} 类`),
    }),
    idx,
    body
  );
}
