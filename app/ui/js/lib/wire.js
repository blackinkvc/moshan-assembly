// lib/wire.js —— 把一组能力格摊成一张图，并当场自检它接不接得上。
//
// 两件事都是纯计算，不碰 DOM：
//   check()  谁要的东西没人产出（断点）、谁产出的东西没人接（死端）、施工顺序
//   layout() 按施工序把格铺成网格，算出每个节点的坐标与每条边怎么画
// 判断逻辑与旧版 arch/app.html 一致，注释保留了当初为什么这么判。

import { W, D } from "../../data/catalog.js";

export const TC = D.typeCn; // X → 界面、T → 文本 …
export const CELL_BY_ID = Object.fromEntries((D.comps || []).map((c) => [c.id, c]));

/** 同一个域用同一个色相：图上一眼看得出「这几格是一家的」 */
const DOM_HUE = {};
export function domHue(dom = "app") {
  if (DOM_HUE[dom] == null) {
    const i = Math.max(0, (D.domOrder || []).indexOf(dom));
    DOM_HUE[dom] = (205 + i * 41) % 360;
  }
  return DOM_HUE[dom];
}

export const cellName = (cid) => (CELL_BY_ID[cid] || {}).name || cid;

/** 这一格吃什么、吐什么（中文名），确认清单与详情都用它 */
export const cellIns = (cid) => ((W[cid] || [[], []])[0] || []).map((grp) => grp.map((t) => TC[t] || t));
export const cellOuts = (cid) => ((W[cid] || [null, []])[1] || []).map((t) => TC[t] || t);

/* ────────── 自检 ────────── */

export function check(picks, form = "app") {
  /* CLI 形态没有图形界面：终端本身就是入口，也是输出。
     所以 X（界面）在 CLI 下算「系统天然提供」，R/F（记录与产物）算「已经打印出来了」。
     不这么特判，任何 CLI 组合都会被判成「缺界面、产出没人接」——那是判据错了，不是方案错了。 */
  const cli = form === "cli";
  const ext = cli ? [...D.ext, "X"] : D.ext;
  const term = cli ? ["X", "Q", "E", "S", "R", "F"] : ["X", "Q", "E", "S"];

  // 每种产物是谁给的
  const given = {};
  for (const c of picks) {
    for (const t of (W[c] || [null, []])[1]) (given[t] = given[t] || []).push(c);
  }

  /* 断点：某个「必须的输入组」里没有一个能由别人或系统提供 */
  const breaks = [];
  for (const cid of picks) {
    if (cid === "app.ui") continue;
    for (const grp of (W[cid] || [[], []])[0]) {
      const ok = grp.some((t) => ext.includes(t) || (given[t] || []).some((o) => o !== cid));
      if (ok) continue;
      const fix = [];
      for (const t of grp) {
        for (const p of D.patch[t] || []) {
          if (!picks.includes(p) && CELL_BY_ID[p]) fix.push(CELL_BY_ID[p].name);
        }
      }
      breaks.push({
        who: cellName(cid),
        cid,
        need: grp.map((t) => TC[t] || t).join("或"),
        fix: fix.slice(0, 3),
      });
    }
  }

  /* 施工顺序：反复挑「输入都已经在手上」的格。
     同批可做的格按三条排：硬件先行（先做真机）→ 没有输入的（源头）先做 →
     产出被别人用得多的先做。 */
  const done = new Set();
  const order = [];
  const placed = new Set();
  let pool = [...picks];

  while (pool.length) {
    const ready = pool.filter((cid) => {
      // 手工钉的前后关系：网关接的是主控吐出来的数据
      const af = (D.after || {})[cid];
      if (af && picks.indexOf(af) >= 0 && !placed.has(af)) return false;
      return (
        cid === "app.ui" ||
        (W[cid] || [[], []])[0].every((grp) => grp.some((x) => ext.includes(x) || done.has(x)))
      );
    });
    if (!ready.length) {
      order.push(...pool);
      break;
    }
    const usedBy = (cid) => {
      const outs = (W[cid] || [null, []])[1].filter((x) => !["T", "S", "E"].includes(x));
      return picks.filter(
        (o) => o !== cid && (W[o] || [[], []])[0].some((g) => g.some((x) => outs.includes(x)))
      ).length;
    };
    ready.sort((x, y) => {
      const hx = x.startsWith("hw.") ? 0 : 1;
      const hy = y.startsWith("hw.") ? 0 : 1;
      if (hx !== hy) return hx - hy;
      const ax = (W[x] || [[], []])[0].length ? 1 : 0;
      const ay = (W[y] || [[], []])[0].length ? 1 : 0;
      if (ax !== ay) return ax - ay;
      const d = usedBy(y) - usedBy(x);
      if (d) return d;
      return D.domOrder.indexOf(CELL_BY_ID[x].dom) - D.domOrder.indexOf(CELL_BY_ID[y].dom);
    });
    order.push(...ready);
    for (const c of ready) placed.add(c);
    for (const c of ready) for (const t of (W[c] || [null, []])[1]) done.add(t);
    pool = pool.filter((c) => !ready.includes(c));
  }

  /* 死端：产出的东西没人接。只要这一格有「终点型」产出（界面/动作/事件/会话），
     剩下的中间产物就不算死端——全文检索的片段可能没人接，但结果本来就摆在界面上。 */
  const dead = [];
  for (const cid of picks) {
    if (cid.startsWith("ai.deliver") || cid === "app.ui") continue;
    const outs = (W[cid] || [null, []])[1];
    if (outs.some((x) => term.includes(x))) continue;
    for (const t of outs) {
      if (!picks.some((o) => o !== cid && (W[o] || [[], []])[0].some((g) => g.includes(t)))) {
        dead.push({ who: cellName(cid), cid, type: TC[t] || t });
      }
    }
  }

  const lines = Object.values(given).reduce((n, v) => n + v.length, 0);
  return { breaks, order, lines, dead };
}

/* ────────── 布局 ──────────
   不用「依赖层级」：层级的代价是某一层挤十几个、其他层空着，图会又高又散。
   改成按施工序铺格子，一行 8 个铺满换列——从左往右就是从先做到后做，
   高度恒定、屏幕看得全，依赖用曲线连（交叉是必然的，但流向读得出来）。 */

export const NW = 120; // 节点宽
export const NH = 29; // 节点高
// 列间距 196 而不是贴着放：格与格之间要留出标注「缺 XX」的余地，
// 否则那行小字会盖到左边那格上。
const GX = 196;
const GY = 33;

export function layout(picks, form = "app") {
  const r = check(picks, form);
  const cli = form === "cli";
  const ext = cli ? [...D.ext, "X"] : D.ext;

  const seq = r.order.filter((c) => picks.includes(c));
  const IDX = Object.fromEntries(seq.map((c, i) => [c, i]));
  const ROWS = Math.min(8, Math.max(3, Math.ceil(seq.length / 6)));
  const cols = Math.max(1, Math.ceil(seq.length / ROWS));
  const Wd = cols * GX + NW + 24;
  const Ht = ROWS * GY + 46;

  const xy = {};
  seq.forEach((c, i) => {
    xy[c] = { x: 14 + Math.floor(i / ROWS) * GX, y: 34 + (i % ROWS) * GY };
  });

  const given = {};
  for (const c of picks) for (const t of (W[c] || [[], []])[1]) (given[t] = given[t] || []).push(c);

  const badCell = new Set(r.breaks.map((b) => b.cid));
  const deadCell = new Set(r.dead.map((b) => b.cid));

  const edges = [];
  const missing = [];
  for (const cid of picks) {
    for (const grp of (W[cid] || [[], []])[0]) {
      const okPairs = [];
      for (const t of grp) {
        for (const p of given[t] || []) if (p !== cid) okPairs.push([p, t]);
      }
      if (okPairs.length) {
        for (const [p, t] of okPairs) edges.push({ a: p, b: cid, t });
      } else if (!grp.some((t) => ext.includes(t))) {
        missing.push({ b: cid, t: grp });
      }
    }
  }

  const nodes = seq.map((cid, i) => ({
    cid,
    i,
    ...xy[cid],
    cls: badCell.has(cid) ? "bad" : deadCell.has(cid) ? "warn" : "",
    hue: domHue((CELL_BY_ID[cid] || {}).dom),
    name: cellName(cid),
  }));

  return { ...r, seq, IDX, xy, nodes, edges, missing, Wd, Ht, ROWS };
}
