// lib/need.js —— 一句话需求 → 一组能力格 → 一组模块。
//
// 为什么保留「关键词命中」而不是调大模型：这一步发生在装配之前，
// 用户还没决定要什么，此时调模型等于「先花 token 再问他到底要什么」。
// 关键词表的成本是零、结果可解释（能指出「命中『扫码』所以加了条码格」），
// 而这一步真正需要的正是「可解释」——不然后面七十条也没法核对。
//
// 关键词表在 catalog 里（D.trig / D.scen / D.req / D.cons / D.gap / D.neg），
// 是从旧版运行时导出的同一份，所以解析结果与旧版一致。

import { D, HUB, W } from "../../data/catalog.js";
import { hubCells } from "./hub.js";
import { CELL_BY_ID } from "./wire.js";

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\s,，。；;、！!？?（）()【】\[\]「」“”"'—\-]+/g, "");

/** 命中判定：词要出现，而且前面三个字里不能有否定词（「不需要登录」不该命中「登录」） */
function hit(t, w) {
  const nw = norm(w);
  if (!nw) return false;
  const neg = D.neg || [];
  let i = t.indexOf(nw);
  while (i >= 0) {
    const pre = t.slice(Math.max(0, i - 3), i);
    if (!neg.some((n) => pre.includes(n))) return true;
    i = t.indexOf(nw, i + 1);
  }
  return false;
}

const HW_ORDER = [
  "hw.mcu", "hw.sense", "hw.display", "hw.power", "hw.wireless",
  "hw.firmware", "hw.pcb", "hw.enclosure", "hw.gateway", "hw.cert",
];

/* 硬件格前置并按选型顺序排：用户最关心「这设备怎么做」，先给主控/传感/供电；
   从传感开始看，会先挑传感器，然后才发现主控得反过来配。软件格按域顺序跟在后面。 */
function ord(ids) {
  const rk = (c) => {
    const i = HW_ORDER.indexOf(c);
    return i < 0 ? 99 : i;
  };
  const dom = (c) => {
    const i = D.domOrder.indexOf((CELL_BY_ID[c] || {}).dom);
    return i < 0 ? 99 : i;
  };
  const hw = ids.filter((c) => c.startsWith("hw.")).sort((x, y) => rk(x) - rk(y));
  const rest = ids.filter((c) => !c.startsWith("hw.")).sort((x, y) => dom(x) - dom(y));
  return hw.concat(rest);
}

/**
 * @returns core（命中的主体）/ rec（补上的依赖）/ scene（弱相关的可选格）
 *          scen（识别到的场景词）/ why（每格为什么在）/ gaps（库外部分）/ prefs（约束）
 */
export function matchNeed(need) {
  const t = norm(need);
  const score = {};
  const why = {};
  const add = (cid, w, r) => {
    if (!CELL_BY_ID[cid]) return;
    score[cid] = (score[cid] || 0) + w;
    (why[cid] = why[cid] || []).push(r);
  };

  // ① 逐格命中关键词：强词 ×3（最多算三个），弱词 ×1
  for (const cid in D.trig) {
    const [strong, weak] = D.trig[cid];
    const ns = (strong || []).filter((w) => hit(t, w));
    if (ns.length) {
      add(cid, 3 * Math.min(ns.length, 3), "命中「" + ns.slice(0, 3).join("、") + "」");
      continue;
    }
    const nw = (weak || []).filter((w) => hit(t, w));
    if (nw.length) add(cid, 1, "沾到「" + nw.slice(0, 2).join("、") + "」");
  }

  // ② 场景词：命中的场景整组加权（「仓库」「巡检」这类词一条能带出一片）
  const scen = [];
  for (const [label, words, cells] of D.scen || []) {
    const ns = (words || []).filter((w) => hit(t, w));
    if (!ns.length) continue;
    scen.push(label);
    (cells || []).forEach((c) => add(c, 5, "场景「" + label + "」"));
  }

  // ③ 约束（平台 / 离线 / 团队 / 硬件这类），页面用来提示，不改选格
  const prefs = {};
  for (const k in D.cons || {}) {
    const v = D.cons[k].filter((w) => hit(t, w));
    if (v.length) prefs[k] = v;
  }

  // ④ 分档：命中三次以上算「要」，一两次算「可选」
  let must = [];
  let opt = [];
  for (const cid in score) (score[cid] >= 3 ? must : opt).push(cid);

  // ⑤ 依赖闭包：要了「导出 Excel」就得有「表格解析」，否则是个断点
  const pulled = {};
  const q = [...must];
  while (q.length) {
    const cid = q.shift();
    for (const dep of D.req[cid] || []) {
      if (must.includes(dep) || !CELL_BY_ID[dep]) continue;
      must.push(dep);
      pulled[dep] = cid;
      q.push(dep);
    }
  }

  // ⑥ AI 兜底：只要碰到 AI 域的格，就得有模型网关，不然那一格没有出口
  const aiSel = must.some((c) => {
    const d = (CELL_BY_ID[c] || {}).dom || "";
    return d && !["app", "ai.deliver", "ai.model", "hw"].includes(d);
  });
  if (aiSel && !must.includes("ai.model.gateway") && CELL_BY_ID["ai.model.gateway"]) {
    must.push("ai.model.gateway");
    pulled["ai.model.gateway"] = "AI 域兜底";
  }
  opt = opt.filter((c) => !must.includes(c)).sort((x, y) => score[y] - score[x]);

  // ⑦ 有记录产出但缺数据仓或界面：补为「推荐」，不并入主体
  const core = [];
  const rec = [];
  const given = new Set();
  must.forEach((c) => (W[c] || [null, []])[1].forEach((x) => given.add(x)));
  if (given.has("R") && !must.includes("app.data") && CELL_BY_ID["app.data"]) rec.push("app.data");
  if (
    (given.has("T") || given.has("R") || given.has("F")) &&
    !given.has("X") &&
    !must.includes("app.ui") &&
    CELL_BY_ID["app.ui"]
  ) {
    rec.push("app.ui");
  }
  must.forEach((cid) => {
    if (!pulled[cid]) return core.push(cid);
    cid === "ai.model.gateway" || cid.startsWith("hw.") ? core.push(cid) : rec.push(cid);
  });

  const scene = opt
    .filter((c) => !rec.includes(c))
    .slice(0, Math.max(0, 14 - core.length - rec.length));

  const uniq = (a) => [...new Set(a)];
  const gaps = [];
  (D.gap || []).forEach(([words, name, how]) => {
    if ((words || []).some((w) => hit(t, w))) gaps.push({ name, how });
  });

  return {
    core: ord(uniq(core)),
    rec: ord(uniq(rec)),
    scene: ord(uniq(scene)),
    scen,
    why,
    score,
    gaps,
    prefs,
    empty: !core.length && !rec.length && !scene.length,
  };
}

/**
 * 能力格 → 模块。一格常被几个模块提供，这里按两条挑：
 * 先挑「覆盖命中格最多」的（少装几个模块，少几处要接的线），
 * 再比等级（必装优先），最后比包内顺序（稳，结果可复现）。
 */
export function modulesFor(cells) {
  const want = new Set(cells);
  const rank = { must: 0, rec: 1, opt: 2 };
  const best = new Map();
  for (const m of HUB) {
    const own = (m.cells || []).filter((c) => want.has(c));
    if (!own.length) continue;
    const prev = best.get(m.id);
    const cur = { m, cover: own.length, tier: rank[m.tier] ?? 3 };
    if (!prev) best.set(m.id, cur);
  }
  // 贪心覆盖：每次挑「能补最多还没盖住的格」的那个模块
  const left = new Set(cells);
  const picked = [];
  const pool = [...best.values()];
  while (left.size) {
    let pick = null;
    for (const it of pool) {
      if (picked.includes(it.m.id)) continue;
      const gain = (it.m.cells || []).filter((c) => left.has(c)).length;
      if (!gain) continue;
      if (
        !pick ||
        gain > pick.gain ||
        (gain === pick.gain && it.tier < pick.tier) ||
        (gain === pick.gain && it.tier === pick.tier && it.m.pks.length > pick.m.pks.length)
      ) {
        pick = { ...it, gain };
      }
    }
    if (!pick) break; // 剩下的格没有任何模块提供：留给「库外部分」说
    picked.push(pick.m.id);
    pick.m.cells.forEach((c) => left.delete(c));
  }
  return { mods: picked, missed: [...left] };
}

/** 命中结果 → 一个能进既有八步流程的 hub（场景用合成的「按需求配的」） */
export function needHub(need, extra = {}) {
  const r = matchNeed(need);
  const cells = [...r.core, ...r.rec];
  const { mods, missed } = modulesFor(cells);
  const packsHint = [...new Set(mods.flatMap((id) => (HUB.find((m) => m.id === id) || {}).pks || []))];
  return {
    hub: {
      scene: "custom",
      sty: "mid",
      form: "app",
      plat: ["mac", "win"],
      anim: "lego",
      mem: 16,
      model: "qwen2.5:3b",
      min: false,
      plans: {},
      glue: {},
      base: {},
      mods,
      need,
      packsHint,
      ...extra,
    },
    result: r,
    missed,
  };
}

export { norm, hit };
