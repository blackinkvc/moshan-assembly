// views/wire.js —— 它们接得上吗：一张逻辑图 + 一遍自动自检 + 一张包图。
//
// 自检不是给用户点的按钮，是进页面就自己跑的：没人会主动点「走一遍」，
// 他只会看这一眼就往下走——所以「能不能接上」得当场演给他看，跑完把结论写在条上。
//
// 图上的颜色全部走 CSS 变量（节点底色、描边、文字、连线的域色），
// 只有域色相 --h 是算出来的：同一个域同一个色相，图上一眼看得出「这几格是一家的」。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, secttl, steps } from "../components.js";
import { PACKS, HUB, ANIMS } from "../../data/catalog.js";
import { STEP_NAMES, sceneById, hubCells, formDef, packOf } from "../lib/hub.js";
import { layout, NW, NH, TC } from "../lib/wire.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

const NS = "http://www.w3.org/2000/svg";

/** SVG 没有 h()，只能自己建节点：好处是能挂 dataset，不用拼 innerHTML */
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("--")) el.style.setProperty(k, v);
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k == null) continue;
    el.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  }
  return el;
}

const shortName = (nm) => (nm.length > 8 ? nm.slice(0, 8) + "…" : nm);

export function viewWire() {
  const hub = S.hub;
  if (!hub || !hub.mods || !hub.mods.length) {
    return h(
      "div.wrap",
      null,
      pagehd({ title: "还没有可连的东西", lead: "先挑场景、勾上模块，这里才有格可连。" }),
      h(
        "div.row.gap-2",
        null,
        h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "从头开始"))
      )
    );
  }

  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const lay = layout(picks, hub.form);
  const bad = lay.breaks.length;
  const dead = lay.dead.length;
  const anim = hub.anim || "lego";

  /* ── 图 ── */
  const svg = s(
    "svg",
    {
      class: "lg",
      "data-anim": anim,
      viewBox: `0 0 ${lay.Wd} ${lay.Ht}`,
      preserveAspectRatio: "xMinYMin meet",
      style: `width:${lay.Wd}px;height:${lay.Ht}px`,
      role: "img",
      "aria-label": `${lay.nodes.length} 个能力格与它们之间的连线`,
    },
    s(
      "g",
      { class: "edges" },
      lay.edges.map((e) => {
        const A = lay.xy[e.a];
        const B = lay.xy[e.b];
        if (!A || !B) return null;
        const x1 = A.x + NW;
        const y1 = A.y + NH / 2;
        const x2 = B.x;
        const y2 = B.y + NH / 2;
        // 同一列里的短边走直线，跨列的走曲线
        const d =
          Math.abs(x2 - x1) < 6
            ? `M${x1} ${y1} L${x2} ${y2}`
            : `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
        const len = Math.abs(x2 - x1) + Math.abs(y2 - y1) + 40;
        // 线要等两端都落定了才画：否则会出现「线先到、格子后到」的错位感
        const dly = Math.max(0, Math.max(lay.IDX[e.a] || 0, lay.IDX[e.b] || 0) * 24 - 100);
        // 线的颜色跟着「上游那格」的域色走，一眼看得出这条线是谁吐出来的
        const srcHue = (lay.nodes.find((n) => n.cid === e.a) || {}).hue || 210;
        return s("path", {
          class: "edge",
          d,
          style: `--len:${len};--ed:${dly}ms;--h:${srcHue}`,
        });
      })
    ),
    s(
      "g",
      { class: "missing" },
      // 每个方块只标一行：一个格常常同时缺两样，逐条标会互相压住、
      // 还会盖到左边方块上（列间距只有 56px）。完整清单在下面「检查结果」里。
      [...new Map(lay.missing.map((m) => [m.b, m])).values()].map((m) => {
        const B = lay.xy[m.b];
        if (!B) return null;
        const all = lay.missing.filter((x) => x.b === m.b);
        const first = all[0].t.map((t) => TC[t] || t).join("/");
        const more = all.length > 1 ? `+${all.length - 1}` : "";
        return s(
          "g",
          { class: "miss" },
          s("path", {
            d: `M${B.x - 16} ${B.y + NH / 2} L${B.x} ${B.y + NH / 2}`,
            class: "mline",
          }),
          s(
            "text",
            { x: B.x - 19, y: B.y + NH / 2 + 3, "text-anchor": "end", class: "mlbl" },
            `缺 ${first}${more}`
          )
        );
      })
    ),
    s(
      "g",
      { class: "nodes" },
      lay.nodes.map((n) =>
        s(
          "g",
          {
            class: `node ${n.cls}`,
            "data-cid": n.cid,
            style: `--h:${n.hue};--d:${n.i * 24}ms;--r:${n.i % 2 ? 10 : -10}deg`,
          },
          s("title", {}, `${n.name}`),
          s("rect", { class: "box", x: n.x, y: n.y, width: NW, height: NH, rx: anim === "flat" ? 2 : 6 }),
          s("rect", { class: "spine", x: n.x, y: n.y, width: 3, height: NH, rx: 1.5 }),
          s("text", { class: "lbl", x: n.x + 9, y: n.y + 18.5 }, shortName(n.name)),
          n.cls === "bad" ? s("circle", { class: "dot-bad", cx: n.x + NW - 7, cy: n.y + 7, r: 3 }) : null,
          n.cls === "warn" ? s("circle", { class: "dot-warn", cx: n.x + NW - 7, cy: n.y + 7, r: 3 }) : null,
          n.cls === "" ? s("circle", { class: "dot-ok", cx: n.x + NW - 7, cy: n.y + NH - 7, r: 2.2 }) : null
        )
      )
    )
  );

  /* ── 自检条 ── */
  const dot = h("i.tdot");
  const status = h("span.tst", null, dot, "准备自检");
  const num = h("span.tnum", null, `0 / ${lay.nodes.length} 格`);
  const fill = h("i");
  const res = h("span.tres");

  function settle() {
    status.replaceChildren(dot, bad || dead ? "自检没通过" : "自检通过");
    num.textContent = `${lay.nodes.length} / ${lay.nodes.length} 格`;
    fill.style.width = "100%";
    res.replaceChildren(
      ...(bad || dead
        ? [
            h("b", null, `${bad} 个断点`),
            dead ? `、${h("b", null, `${dead} 个死端`)}` : "",
            "　要的东西没人产出",
          ]
        : [h("b", null, `${lay.nodes.length} 格 · ${lay.lines} 条连线`), "全部接上，没有死端"])
    );
  }

  let raf = 0;
  function play() {
    cancelAnimationFrame(raf);
    const nodes = [...svg.querySelectorAll("g.node")];
    const n = nodes.length;
    for (const g of nodes) g.removeAttribute("data-t");

    status.replaceChildren(dot, "正在测试连线");
    num.textContent = `0 / ${n} 格`;
    fill.style.width = "0%";
    res.replaceChildren();

    svg.classList.remove("play");
    void svg.getBoundingClientRect(); // 强制回流，动画才会重播
    svg.classList.add("play");

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const g of nodes) g.dataset.t = "1";
      settle();
      return;
    }

    const STEP = 45;
    const t0 = performance.now();
    let done = 0;
    const tick = (now) => {
      if (!document.body.contains(svg)) return; // 中途切走了
      const el = Math.max(0, now - t0);
      const k = Math.min(n, Math.floor(el / STEP));
      if (k !== done) {
        for (let i = done; i < k; i++) if (nodes[i]) nodes[i].dataset.t = "1";
        done = k;
        num.textContent = `${k} / ${n} 格`;
        fill.style.width = (k / n) * 100 + "%";
      }
      if (el < n * STEP + 240) raf = requestAnimationFrame(tick);
      else {
        for (const g of nodes) g.dataset.t = "1";
        settle();
      }
    };
    raf = requestAnimationFrame(tick);
  }

  /* ── 动效选择 ── */
  const note = h("div.animnote", null, (ANIMS.find((a) => a.id === anim) || ANIMS[0]).d);
  const chips = ANIMS.map((a) => {
    const el = h(
      "button.achip",
      {
        "aria-pressed": String(a.id === anim),
        title: a.d,
        onclick: () => {
          if (S.hub.anim === a.id) return;
          set({ hub: { ...S.hub, anim: a.id } });
          chips.forEach((c) => c.setAttribute("aria-pressed", String(c.id === a.id)));
          svg.setAttribute("data-anim", a.id);
          // 圆角是画上去的：平涂要直角块，其余圆角
          const rx = a.id === "flat" ? 2 : 6;
          for (const r of svg.querySelectorAll("g.node .box")) r.setAttribute("rx", rx);
          note.textContent = a.d;
          play();
        },
        id: a.id,
      },
      a.nm
    );
    return el;
  });

  /* ── 包图：用户视角，一行一个包 ── */
  const mods = hub.mods.map((id) => HUB.find((m) => m.id === id)).filter(Boolean);
  // 只列「这个包自己的模块被装了」的行，否则会冒出装了空包的行
  const usedPacks = PACKS.filter((p) => mods.some((m) => m.pk === p.id));

  const packMap = h(
    "div.pmap",
    null,
    usedPacks.map((p) => {
      const ms = mods.filter((m) => (m.pks || []).includes(p.id));
      const row = h(
        "div.prow",
        null,
        h(
          "div.pnode",
          null,
          h("span.pd", null, icon(p.art, { size: 15 })),
          h("b", null, p.nm),
          h("i", null, String(ms.length))
        ),
        h(
          "div.pchips",
          null,
          ms.map((m) => {
            const others = (m.pks || []).filter((x) => x !== p.id).map((x) => packOf(x).nm);
            return h(
              "span.mnode",
              { title: others.length ? `也在：${others.join("、")}` : m.nm },
              m.nm,
              others.length ? h("em", null, `+${others.length}`) : null
            );
          })
        )
      );
      row.style.setProperty("--h", p.hue);
      return row;
    })
  );

  /* ── 检查结果 ── */
  const issues = bad || dead
    ? h(
        "div.issues",
        null,
        h("div.ih", null, icon("warn", { size: 14 }), h("b", null, "检查结果")),
        lay.breaks.map((b) =>
          h(
            "div.gapbox",
            null,
            h("b", null, `断点 · ${b.who}`),
            `　需要「${b.need}」，勾选里没人产出。`,
            b.fix.length ? ` 补上：${b.fix.join("、")}` : " 这一格要自己写或换方案。"
          )
        ),
        lay.dead.map((d) =>
          h("div.gapbox.warn", null, h("b", null, `死端 · ${d.who}`), `　产出的「${d.type}」没有任何模块接。`)
        )
      )
    : null;

  const page = h(
    "div.wrap",
    null,
    pagehd({
      title: "它们接得上吗？",
      lead: h(
        "span",
        null,
        "先看",
        h("b", null, "逻辑图"),
        "：模块摊开以后谁吃什么、谁吐什么，按施工顺序一格一格装上去。",
        h("b", null, "进这一页就自动跑一遍自检"),
        "，从第一格测到最后一格，接不接得上当场就知道——不用你去找。",
        "下面那张",
        h("b", null, "包图"),
        "是同一份东西的另一种看法：你看见的分组。"
      ),
      aside: [
        badge(bad ? `${bad} 个断点` : "接得上", bad ? "clay" : "moss"),
        dead ? badge(`${dead} 个死端`, "brass") : null,
      ],
    }),

    steps(STEP_NAMES, 4),

    secttl(
      "① 逻辑图",
      `底层视角 · ${picks.length} 格 · 从左往右是施工顺序`,
      h("span.t-12.faint", null, "图比屏幕宽时可以左右拖")
    ),

    h(
      "div.testbar",
      { "data-bad": String(bad), "data-dead": String(dead) },
      status,
      num,
      h("span.tline", null, fill),
      res,
      h(
        "button.btn.btn--sm.btn--ghost",
        { onclick: () => play() },
        icon("loop", { size: 13 }),
        h("span", null, "再跑一遍")
      )
    ),

    h(
      "div.wbar",
      null,
      h("span.t-12.faint", null, "装模块的动效"),
      h("div.achips", null, chips),
      h("span.push", null, null)
    ),

    h("div.lgwrap", null, svg),
    note,

    secttl(
      "② 包图",
      `用户视角 · ${usedPacks.length} 个包`,
      h("span.t-12.faint", null, "一个模块出现在两行，说明它同时属于两个包")
    ),
    packMap,

    issues,

    h(
      "div.mobar",
      null,
      badge(`${picks.length} 格 · ${lay.lines} 条连线 · ${hub.mods.length} 个模块`, bad ? "clay" : "moss"),
      h("span.t-12.faint", null, formDef(hub.form).nm + " · " + sc.nm),
      h(
        "span.push",
        null,
        h(
          "button.btn.btn--primary",
          { onclick: () => go("confirm") },
          h("span", null, "下一步：确认清单"),
          icon("arrow-right", { size: 14 })
        )
      )
    ),

    h(
      "div.stepnav",
      null,
      h(
        "button.btn.btn--ghost",
        { onclick: () => go("plans") },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：改方案")
      )
    )
  );

  // 图进视野才开跑：进页面就开跑等于白跑（用户还没看到图）
  requestAnimationFrame(() => {
    const r = svg.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) play();
    else {
      const io = new IntersectionObserver(
        (es) => {
          if (es.some((e) => e.isIntersecting)) {
            play();
            io.disconnect();
          }
        },
        { threshold: 0.25 }
      );
      io.observe(svg);
    }
  });

  return page;
}
