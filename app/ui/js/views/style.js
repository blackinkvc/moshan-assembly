// views/style.js —— 定形态：做成什么东西、装多满、装到哪几个系统。
//
// 三组分开问，是因为它们回答的是三个不同的问题，混在一屏会互相干扰：
//   形态 → 决定哪些模块根本不适用（CLI 没有看板与地图）
//   规格 → 决定默认勾多满（简约只留地基）
//   平台 → 只影响安装说明与内存底线，不改勾选
// 三组都不是「三套代码」——共用同一批包与能力格，所以先做简约以后再补不会返工。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, steps, toast } from "../components.js";
import { FORMS, STYLES } from "../../data/catalog.js";
import {
  PLATS,
  STEP_NAMES,
  sceneById,
  newHub,
  withChoice,
  styCount,
  hubCells,
  platOk,
  platOf,
  formDef,
  defaultMods,
  unavailableCount,
} from "../lib/hub.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

/** 文案里带 <b> 强调，来自我们自己的数据文件，不是用户输入 */
function rich(str) {
  const span = h("span");
  span.innerHTML = str || "";
  return span;
}

/* ────────── 三张规格示意图 ──────────
   三张图共用同一套坐标，仅改变密度，差异可直接对比，无需阅读文字。
   颜色走 CSS 变量，深色模式下不会突然出现一块白底。 */

function styleArt(id) {
  // 框内不填色，随卡片底色变化，选中时不会在黄铜色渐变上叠加白色块
  const frame = `<rect x="3" y="6" width="134" height="72" rx="6" style="fill:none;stroke:var(--line-strong)"/>
    <path d="M3 18h134" style="stroke:var(--line)"/>`;
  const dots = [9, 15, 21]
    .map((cx) => `<circle cx="${cx}" cy="12" r="1.5" style="fill:var(--line-strong)"/>`)
    .join("");
  const side = `<rect x="3" y="18" width="26" height="60" style="fill:var(--surface-2)"/>
    <path d="M8 28h16M8 35h12M8 42h14M8 49h10M8 56h13" style="stroke:var(--line-strong)" stroke-linecap="round"/>`;
  const box = (x, y, w, hh, r = 3) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${r}" style="fill:var(--surface-2);stroke:var(--line)"/>`;

  let inner;
  if (id === "min") {
    // 一块主区 + 两个小格：其余什么都没有
    inner = `${box(12, 25, 116, 26, 4)}${box(12, 56, 56, 15)}${box(72, 56, 56, 15)}`;
  } else if (id === "mid") {
    // 侧栏 + 两张大卡 + 两行：日常够用
    inner = `${side}${box(35, 24, 46, 22)}${box(85, 24, 46, 22)}${box(35, 50, 96, 9, 2.5)}${box(35, 63, 60, 9, 2.5)}`;
  } else {
    // 三列两行加通栏：呈现满载状态，与均衡档的两张大卡形成反差
    inner = `${side}
      ${box(35, 22, 96, 7, 2.5)}
      ${box(35, 33, 30, 15)}${box(69, 33, 30, 15)}${box(103, 33, 30, 15)}
      ${box(35, 52, 30, 15)}${box(69, 52, 30, 15)}${box(103, 52, 30, 15)}
      ${box(35, 71, 96, 6, 2)}`;
  }

  const wrap = h("div.art");
  wrap.innerHTML = `<svg viewBox="0 0 140 84" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${frame}${dots}${inner}</svg>`;
  return wrap;
}

/* ────────── 页面 ────────── */

export function viewStyle({ param }) {
  const sceneId = param || (S.hub && S.hub.scene) || "hub";

  // 直接跳进 #/style/lodge 时，状态里可能还是别的场景——以 URL 为准重建
  if (!S.hub || S.hub.scene !== sceneId) set({ hub: newHub(sceneId) });

  const sc = sceneById(sceneId);

  /* 形态卡 */
  const formCards = FORMS.map((f) => {
    const el = h(
      "button.fcard",
      {
        role: "radio",
        "aria-checked": "false",
        "data-form": f.id,
        onclick: () => choose({ form: f.id }),
      },
      h(
        "div.hd",
        null,
        h("span.fico", null, icon(f.art, { size: 22 })),
        h(
          "span.nm",
          null,
          f.nm,
          h("span.tag", null, f.id === "cli" ? "无图形" : f.id === "web" ? "零安装" : "本机程序")
        ),
        h("span.pickmark", null, icon("check", { size: 12 }))
      ),
      h("p.d", null, f.d),
      h("p.keep", null, rich(f.keep))
    );
    return { id: f.id, el };
  });

  /* 规格卡：数字随形态变，所以要把节点留出来 */
  const styCards = STYLES.map((s) => {
    const count = h("span.n");
    const el = h(
      "button.scd",
      {
        role: "radio",
        "aria-checked": "false",
        "data-sty": s.id,
        onclick: () => choose({ sty: s.id }),
      },
      styleArt(s.id),
      h(
        "div.hd",
        null,
        h("span.nm", null, s.nm),
        count,
        h("span.pickmark", null, icon("check", { size: 12 }))
      ),
      h("p.d", null, s.d),
      h("p.keep", null, rich(s.keep))
    );
    return { id: s.id, el, count };
  });

  /* 平台 */
  const platBtns = PLATS.map((p) => {
    const state = h("span.pn");
    const el = h(
      "button.plat",
      {
        "aria-pressed": "false",
        "data-plat": p.id,
        onclick: () => togglePlat(p.id),
      },
      icon(p.art, { size: 15 }),
      h("b", null, p.nm),
      state
    );
    return { id: p.id, el, state, def: p };
  });

  const hint = h("p.hintline");
  const summary = h("span.t-12.faint");

  /* ── 状态同步：只改属性和文字，不重建节点，焦点不会丢 ── */
  function sync() {
    const hub = S.hub;
    const form = hub.form;

    for (const c of formCards) c.el.setAttribute("aria-checked", String(c.id === form));

    for (const c of styCards) {
      c.el.setAttribute("aria-checked", String(c.id === hub.sty));
      const k = styCount(c.id, hub.scene, form, hub.mods);
      c.count.textContent = `${k.n} 个模块 · ${k.cells} 格`;
    }

    const on = platOf(hub);
    for (const b of platBtns) {
      const ok = platOk(b.id, form);
      const yes = ok && on.includes(b.id);
      b.el.disabled = !ok;
      b.el.setAttribute("aria-pressed", String(yes));
      b.el.setAttribute("title", ok ? b.def.note : `${formDef(form).nm} 形态不支持 ${b.def.nm}`);
      b.state.textContent = ok ? (yes ? "要" : "不要") : "不适用";
    }

    // 形态导致模块被排除时必须说明，否则会被当作模块缺失
    const no = unavailableCount(hub.scene, form);
    hint.replaceChildren(
      ...(no
        ? [
            icon("puzzle", { size: 13 }),
            h(
              "span",
              null,
              `${formDef(form).nm} 形态下，另有 `,
              h("b", null, String(no)),
              " 个模块不适用（如看板、地图类），已自动排除。"
            ),
          ]
        : [])
    );

    summary.textContent = `已勾 ${hub.mods.length} 个模块 · ${hubCells(hub.mods).length} 格`;
  }

  function choose(patch) {
    const before = S.hub;
    // 仅当当前勾选与「按规则应勾」不一致时，换选才会重置，需明确告知
    const wasCustom =
      before.mods.join() !== defaultMods(before.scene, before.sty, before.form).join();
    const next = withChoice(before, patch);
    set({ hub: next });
    sync();
    if (wasCustom && next.mods.join() !== before.mods.join()) {
      toast("勾选已按新规则重算，手动添加的模块已被重置", 2200);
    }
  }

  function togglePlat(pid) {
    const cur = platOf(S.hub);
    const next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid];
    if (!next.length) {
      toast("至少选择一个目标平台", 1600);
      return;
    }
    set({ hub: { ...S.hub, plat: next } });
    sync();
  }

  const page = h(
    "div.wrap",
    null,
    pagehd({
      title: "形态与规格",
      lead: h(
        "span",
        null,
        h("b", null, "形态"),
        "决定哪些模块不适用，",
        h("b", null, "规格"),
        "决定默认勾选的密度，",
        h("b", null, "平台"),
        "只影响安装说明。三者共用同一批功能包与能力格，先做简约、后续补齐不会返工。"
      ),
      aside: [badge(sc.nm), h("span.t-12.faint", null, `${(sc.packs || []).length} 个包`)],
    }),

    steps(STEP_NAMES, 1),

    h(
      "section.pgroup",
      null,
      h("div.pgt", null, h("b", null, "① 形态"), h("span", null, "交付形态 · 三选一")),
      h("div.fgrp", { role: "radiogroup", "aria-label": "形态" }, formCards.map((c) => c.el)),
      hint
    ),

    h(
      "section.pgroup",
      null,
      h("div.pgt", null, h("b", null, "② 规格"), h("span", null, "首版范围 · 三选一")),
      h("div.sgrp", { role: "radiogroup", "aria-label": "规格" }, styCards.map((c) => c.el))
    ),

    h(
      "section.pgroup",
      null,
      h(
        "div.pgt",
        null,
        h("b", null, "③ 平台"),
        h("span", null, "目标平台 · 可多选，影响安装说明与内存底线")
      ),
      h("div.plats", { role: "group", "aria-label": "平台" }, platBtns.map((b) => b.el)),
      h(
        "p.hintline.mute",
        null,
        "安卓的可用内存低于桌面端，同等配置需先移除本地模型。"
      )
    ),

    h(
      "div.note",
      null,
      h("b", null, "三组共用一套数据。"),
      "差别只在默认勾选哪些模块、底座默认选什么、打包输出哪些文件，因此「先做简约、后续补齐」不会返工。" +
        "更换形态或规格会按新规则重算勾选，手动调整过的部分将被重置。"
    ),

    h(
      "div.stepnav",
      null,
      h("div.row.gap-3", null, summary),
      h(
        "div.btns",
        null,
        h(
          "button.btn.btn--ghost",
          { onclick: () => go("scenes") },
          icon("arrow-left", { size: 14 }),
          h("span", null, "上一步：选择场景")
        ),
        h(
          "button.btn.btn--primary.btn--lg",
          { onclick: () => go("packs") },
          h("span", null, "下一步：选择功能包"),
          icon("arrow-right", { size: 14 })
        )
      )
    )
  );

  sync();
  return page;
}
