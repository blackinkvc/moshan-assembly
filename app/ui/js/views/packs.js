// views/packs.js —— 要哪几包：把「整包勾」和「只留其中两个模块」放在同一页。
//
// 两类包必须分开处理：
//   场景内的包 —— 是这个场景的答案，全部展开
//   场景外的包 —— 16 个包、89 个模块，全铺开会让页面失控，默认折叠
// 同一个模块会出现在几个包里，这是正常的（日历既在日程包也在笔记包），
// 所以卡上标出「+2 包」，勾一次两边都算。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, secttl, steps, toast } from "../components.js";
import { HUB, PACKS, STYLES } from "../../data/catalog.js";
import {
  STEP_NAMES,
  sceneById,
  packOf,
  hubCells,
  modTierEff,
  formDef,
} from "../lib/hub.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

const packMods = (pid) => HUB.filter((m) => (m.pks || []).includes(pid));
const styName = (id) => (STYLES.find((s) => s.id === id) || STYLES[1]).nm;
const TIER_TXT = { must: "必装", rec: "推荐", opt: "可选" };

/** 默认实现：优先「推荐」，没有就取第一个——方案页要用，提前铺好 */
function defaultProv(m) {
  return (m.provs.find((p) => p.lv === "rec") || m.provs[0] || {}).id;
}

export function viewPacks() {
  const hub = S.hub;
  if (!hub) {
    return h(
      "div.wrap",
      null,
      pagehd({ title: "还没选场景", lead: "这一步要从一个场景长出来。" }),
      h(
        "div.row.gap-2",
        null,
        h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "去挑场景"))
      )
    );
  }

  const sc = sceneById(hub.scene);
  /* 合成场景（一句话需求）没有固定包，用它解析出来的 packsHint 当「场景内」，
     否则解析完进来一看，命中的包全被折到「场景外」去了。 */
  const hint = hub.packsHint || [];
  const inScene = (pid) => (sc.packs || []).includes(pid) || hint.includes(pid);

  // 场景顺序优先：先按场景列的包排，其余按目录顺序
  const ordered = [
    ...(sc.packs || []).map(packOf),
    ...PACKS.filter((p) => !(sc.packs || []).includes(p.id)),
  ];

  /* 首次进来：给每个已勾模块铺一个默认方案 */
  if (!hub.plans) hub.plans = {};
  for (const id of hub.mods) {
    const m = HUB.find((x) => x.id === id);
    if (m && !hub.plans[id]) hub.plans[id] = defaultProv(m);
  }

  /* 场景外的包里已经有勾选的，就不该把它藏起来。
     注意不能只看「这个包里有模块被勾了」——模块会跨包共享（日历同时属于日程包与
     笔记包），场景内的包一勾，十几个场景外的包都会看起来「有勾选」。
     要判的是：有没有哪个勾上的模块，是只能从场景外的包才够得到的。 */
  const inSceneModIds = new Set(
    PACKS.filter((p) => inScene(p.id)).flatMap((p) => packMods(p.id).map((m) => m.id))
  );
  let outOpen = PACKS.some(
    (p) =>
      !inScene(p.id) &&
      packMods(p.id).some((m) => !inSceneModIds.has(m.id) && hub.mods.includes(m.id))
  );

  /* ── 计数与提示：任何一次勾选都要同步这几处 ── */
  const cntBadge = h("span");
  const warnHost = h("div");
  const cellBadge = h("span.badge");
  const nextBtn = h("button.btn.btn--primary.btn--lg", { onclick: () => go("plans") });
  const outCount = h("span");

  function counters() {
    const ms = S.hub.mods;
    const cs = hubCells(ms);

    cntBadge.replaceChildren(badge(`已选 ${ms.length} 个模块`, "plain"));

    cellBadge.className = "badge " + (cs.length ? "badge--moss" : "badge--clay");
    cellBadge.textContent = `${ms.length} 个模块 · ${cs.length} 格`;

    nextBtn.disabled = !ms.length;
    nextBtn.replaceChildren(h("span", null, "下一步：选方案"), icon("arrow-right", { size: 14 }));

    // 地基被叉掉不会报错，但装出来是半成品——必须当场说
    const lost = HUB.filter(
      (m) => m.tier === "must" && modTierEff(m, sc.id) === "must" && !ms.includes(m.id)
    );
    warnHost.replaceChildren(
      ...(lost.length
        ? [
            h(
              "div.warnbox",
              null,
              icon("warn", { size: 14 }),
              h(
                "span",
                null,
                "你叉掉了地基：",
                h("b", null, lost.map((m) => m.nm).join("、")),
                "。界面或数据会缺一块——不会报错，但装出来是半成品。"
              ),
              h(
                "button.btn.btn--sm.btn--ghost",
                {
                  onclick: () => {
                    set({ hub: { ...S.hub, mods: [...new Set([...S.hub.mods, ...lost.map((m) => m.id)])] } });
                    syncAll();
                  },
                },
                h("span", null, "全部装回")
              )
            ),
          ]
        : [])
    );
  }

  /* ── 单个模块卡 ── */
  function modRow(m, p) {
    const on = S.hub.mods.includes(m.id);
    const others = (m.pks || []).filter((x) => x !== p.id).map((x) => packOf(x).nm);

    const row = h(
      "button.mod",
      {
        "aria-pressed": String(on),
        "data-mid": m.id,
        onclick: () => toggleMod(m.id),
      },
      h("span.box", null, icon("check", { size: 10 })),
      h("span.mico", null, icon(m.art, { size: 15 })),
      h(
        "span.body",
        null,
        h(
          "span.nm",
          null,
          m.nm,
          m.tier === "must" ? h("span.tk", null, "必装") : null,
          others.length
            ? h("span.mp", { title: `也属于：${others.join("、")}` }, `+${others.length} 包`)
            : null,
          h("span.pv", null, `${(m.provs || []).length} 个方案`)
        ),
        h("span.sb", null, m.sub),
        h(
          "span.cells",
          null,
          (m.cells || []).map((c) => h("code", null, c))
        )
      )
    );
    row.style.setProperty("--h", p.hue);
    return row;
  }

  /* ── 一个包 ── */
  const packEls = new Map();

  function packBlock(p) {
    const ms = packMods(p.id);
    const state = h("span.pn");
    const allBtn = h("button.pall", { onclick: (e) => { e.stopPropagation(); togglePack(p.id); } });
    const list = h("div.plist");

    const head = h(
      "div.ph",
      null,
      h("span.pico", null, icon(p.art, { size: 18 })),
      h("b", null, p.nm),
      h("span.ptk", null, TIER_TXT[p.tier] + "包"),
      inScene(p.id) ? null : h("span.pout", null, "场景外"),
      state,
      allBtn
    );

    const box = h("div.pk", { "data-pk": p.id }, head, h("p.ps", null, p.sub), list);
    box.style.setProperty("--h", p.hue);

    packEls.set(p.id, { box, list, state, allBtn, p, ms });
    paintPack(p.id);
    return box;
  }

  /** 只重画一个包的模块列表：整包勾选时用，避免整页重排导致滚动位置跳动 */
  function paintPack(pid) {
    const it = packEls.get(pid);
    if (!it) return;
    const on = it.ms.filter((m) => S.hub.mods.includes(m.id));

    it.state.textContent = `${on.length}/${it.ms.length}`;
    it.allBtn.textContent = on.length === it.ms.length ? "全不选" : "全选";
    it.box.classList.toggle("is-off", on.length === 0);
    it.list.replaceChildren(...it.ms.map((m) => modRow(m, it.p)));
  }

  /** 整包被改动时闪一下：改动的地方得看得见，否则长页面里不知道哪变了 */
  function flash(pid) {
    const it = packEls.get(pid);
    if (!it) return;
    it.box.classList.add("is-hot");
    setTimeout(() => it.box.classList.remove("is-hot"), 340);
  }

  /* ── 改动 ── */
  function ensurePlans() {
    if (!S.hub.plans) S.hub.plans = {};
    for (const id of S.hub.mods) {
      const m = HUB.find((x) => x.id === id);
      if (m && !S.hub.plans[id]) S.hub.plans[id] = defaultProv(m);
    }
  }

  function toggleMod(id) {
    const has = S.hub.mods.includes(id);
    const mods = has ? S.hub.mods.filter((x) => x !== id) : [...S.hub.mods, id];
    set({ hub: { ...S.hub, mods } });
    ensurePlans();

    // 一格可能挂在几个包里，涉及的包都要重画
    const m = HUB.find((x) => x.id === id);
    for (const pid of m ? m.pks || ["core"] : ["core"]) paintPack(pid);
    counters();
  }

  function togglePack(pid) {
    const ms = packMods(pid);
    const allOn = ms.every((m) => S.hub.mods.includes(m.id));
    let mods;
    if (allOn) {
      mods = S.hub.mods.filter((id) => !ms.some((m) => m.id === id));
    } else {
      const add = ms.filter((m) => !S.hub.mods.includes(m.id)).map((m) => m.id);
      mods = [...S.hub.mods, ...add];
    }
    set({ hub: { ...S.hub, mods } });
    ensurePlans();
    paintPack(pid);
    flash(pid);
    counters();
    toast(allOn ? `已清空「${packOf(pid).nm}」` : `已装上「${packOf(pid).nm}」`, 1400);
  }

  function syncAll() {
    for (const pid of packEls.keys()) paintPack(pid);
    counters();
  }

  /* ── 场景外的包：折叠区 ── */
  const outWrap = h("div.col.gap-3");
  const outLabel = h("span.push.t-12.faint");
  const outToggle = h(
    "button.xpack-hd",
    {
      "aria-expanded": String(outOpen),
      onclick: () => {
        outOpen = !outOpen;
        paintOut();
      },
    },
    icon("chevron", { size: 14 }),
    h("b", null, "场景外的包"),
    outCount,
    outLabel
  );

  function paintOut() {
    const outs = ordered.filter((p) => !inScene(p.id));
    const totalMods = outs.reduce((n, p) => n + packMods(p.id).length, 0);
    outCount.textContent = `${outs.length} 个包 · ${totalMods} 个模块`;
    outToggle.setAttribute("aria-expanded", String(outOpen));
    outLabel.textContent = outOpen ? "收起" : "展开";

    if (outOpen) {
      // 首次展开才建节点：89 个模块不必在打开页面前就渲染
      if (!outWrap.childElementCount) outWrap.append(...outs.map(packBlock));
      outWrap.classList.remove("hidden");
    } else {
      outWrap.classList.add("hidden");
    }
  }

  /* ── 组装页面 ── */
  const inPacks = ordered.filter((p) => inScene(p.id));
  const inMods = inPacks.reduce((n, p) => n + packMods(p.id).length, 0);

  const page = h(
    "div.wrap",
    null,
    pagehd({
      title: "要哪几包？",
      lead: h(
        "span",
        null,
        `场景 `,
        h("b", null, sc.nm),
        `、形态 `,
        h("b", null, formDef(hub.form).nm),
        `、规格 `,
        h("b", null, styName(hub.sty)),
        "。包是一成套的功能：整包勾上最省事，也可以只留包里的一两个模块。",
        "同一个模块出现在两个包里是正常的——勾一次，两边都算。"
      ),
      aside: cntBadge,
    }),

    steps(STEP_NAMES, 2),

    warnHost,

    secttl("这个场景用到的包", `${inPacks.length} 个包 · ${inMods} 个模块`, h("span.t-12.faint", null, "按场景顺序")),

    h("div.col.gap-3", null, inPacks.map(packBlock)),

    h(
      "section.xpack",
      null,
      outToggle,
      h(
        "p.t-12.faint",
        { style: { margin: "0 0 var(--sp-3) var(--sp-2)" } },
        "这些包和当前场景无关，但能力是现成的。装上它们会多出对应的模块与格子。"
      ),
      outWrap
    ),

    h(
      "div.mobar",
      null,
      cellBadge,
      h("span.t-12.faint", null, "下一步给每块挑实现方案"),
      h("span.push", null, nextBtn)
    ),

    h(
      "div.stepnav",
      null,
      h(
        "button.btn.btn--ghost",
        { onclick: () => go("style", sc.id) },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：换形态/规格")
      )
    )
  );

  counters();
  paintOut();
  return page;
}
