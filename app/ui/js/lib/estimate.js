// lib/estimate.js —— 工作量与费用估算。
//
// 两个数分开算，互不推导：
//   1. 手写工时：高级程序员从零实现该格需要多少小时。
//   2. 生成 token：交给模型写，需要消耗多少 token。
// 二者都从能力格出发。格上已记录过「AI 从零写这一格要几天、多少 token」，
// 有记录就用记录；没有（或标「不建议」）就按接口规模与所属域估一个兜底值。
//
// 所有数字都是估算，不是报价。页面必须同时给出算法与三档单价，让人能自己复核。

import { D, HUB, GLUE, BASE } from "../../data/catalog.js";

/** 单价档：元 / 百万 token（输入与输出混合后的值） */
export const RATES = [
  { id: "eco", nm: "经济", price: 2, d: "国产中低端模型，写常规业务代码够用" },
  { id: "std", nm: "常规", price: 10, d: "主流模型，复杂重构与调试更稳" },
  { id: "flag", nm: "旗舰", price: 60, d: "顶级模型，长上下文与架构级改动" },
];

/** 高级程序员日薪（元），用于把手写工时折成钱 */
export const DAY_RATE = 1800;
export const HOURS_DAY = 8;

/** 手写 / AI 辅助的倍数：同一格，AI 辅助约省六成时间 */
export const HAND = 2.4;

/* 三种按量计价的格：页、节点、平台。取默认规模，页 6、节点 8、平台 2 —— 
   都写在页面的「怎么算的」里，不藏。 */
const SCALE = { page: 6, node: 8, plat: 2 };

/** 实现方式对工时的影响：现成库拿走大部分工作，自研从零写 */
const LV_HAND = { rec: 0.45, ok: 0.6, warn: 0.8, build: 1 };

/** 实现方式对 token 的影响：每小时产出对应的消耗（token / 小时） */
const LV_TK = { rec: 2e4, ok: 3.5e4, warn: 5e4, build: 7e4 };

/** 兜底时按域加的天数：越靠近硬件与工程，接口之外的验证成本越高 */
const DOM_DAY = {
  app: 0,
  "ai.chat": 0.3,
  "ai.text": 0.3,
  "ai.office": 0.4,
  "ai.search": 0.4,
  "ai.prompt": 0.3,
  "ai.detect": 0.3,
  "ai.deliver": 0.4,
  "ai.agent": 0.6,
  "ai.flow": 0.5,
  "ai.model": 0.6,
  kb: 0.6,
  "ai.media": 0.5,
  "ai.design": 0.5,
  "dev.code": 0.8,
  eng: 1.2,
  hw: 1.4,
  site: 0.6,
};

const comps = new Map(D.comps.map((c) => [c.id, c]));

const parts = (s) =>
  String(s || "")
    .split(/[+＋、/,，]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** "3–5 天" → 4；"0.5 天" → 0.5；按量计价的三种按默认规模展开；"不建议" → null */
function parseDays(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  if (t.includes("按页")) return SCALE.page * 0.6;
  if (t.includes("按节点")) return SCALE.node * 0.4;
  if (t.includes("天/平台")) return 4 * SCALE.plat;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:[–\-~至]\s*(\d+(?:\.\d+)?))?\s*天/);
  if (!m) return null;
  const a = +m[1];
  const b = m[2] ? +m[2] : a;
  return (a + b) / 2;
}

/** "约 300 万" → 3000000；"约 8 万/页" 按默认页数展开 */
function parseTk(s) {
  const t = String(s || "").trim();
  if (!t) return 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*万/);
  if (!m) return 0;
  const v = +m[1] * 1e4;
  if (t.includes("/页")) return v * SCALE.page;
  if (t.includes("每节点")) return v * SCALE.node;
  return v;
}

/** 没有记录时的兜底：接口每多一路数据，多一层校验与错误处理 */
function fallbackDays(c) {
  const n = c ? parts(c.ins).length + parts(c.outs).length : 2;
  return 0.5 + 0.15 * n + (c ? DOM_DAY[c.dom] || 0 : 0.4);
}

/**
 * 单个能力格。
 * lv 是所选实现方式的等级（rec / ok / warn / build）。
 */
export function estCell(cid, lv = "rec") {
  const c = comps.get(cid);
  const pv = c && c.pv.find((p) => p.k === "build");
  const days = parseDays(pv && pv.effort) ?? fallbackDays(c);
  const hours = days * HOURS_DAY * HAND * (LV_HAND[lv] ?? 1);
  const tkData = parseTk(pv && pv.tokens);
  // 自研并且有记录，用记录；其余按该方式的产出速率折算
  const tk = lv === "build" && tkData ? tkData : hours * (LV_TK[lv] ?? 3.5e4);
  return { hours, tk, days, dom: c ? c.dom : "" };
}

/** 一组格（模块 / 胶水项 / 底座项共用） */
export function estGroup(it, pid) {
  const provs = it.provs || [];
  const pv = provs.find((p) => p.id === pid) || provs.find((p) => p.lv === "rec") || provs[0];
  const lv = pv ? pv.lv : "rec";
  let hours = 0;
  let tk = 0;
  for (const cid of it.cells || []) {
    const e = estCell(cid, lv);
    hours += e.hours;
    tk += e.tk;
  }
  // 没有能力格的项（极少）按一项接线计
  if (!(it.cells || []).length) {
    hours = 6 * (LV_HAND[lv] ?? 1) * HAND;
    tk = hours * (LV_TK[lv] ?? 3.5e4);
  }
  return { hours, tk, lv, prov: pv, nm: it.nm, id: it.id, cells: it.cells || [] };
}

const sum = (list, k) => list.reduce((n, x) => n + (x[k] || 0), 0);

/**
 * 整台东西。
 * 模块、胶水、底座各算一遍，再加一段集成（联调、环境、首跑）。
 */
export function hubEst(hub) {
  if (!hub || !hub.mods || !hub.mods.length) return null;
  const plans = hub.plans || {};
  const glueSel = hub.glue || {};
  const baseSel = hub.base || {};

  const mods = hub.mods
    .map((id) => HUB.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => ({ it: m, e: estGroup(m, plans[m.id]) }));

  const glue = GLUE.map((g) => ({ it: g, e: estGroup(g, glueSel[g.id]) }));
  const base = BASE.map((g) => ({ it: g, e: estGroup(g, baseSel[g.id]) }));

  const mH = sum(mods.map((x) => x.e), "hours");
  const gH = sum(glue.map((x) => x.e), "hours");
  const bH = sum(base.map((x) => x.e), "hours");

  /* 集成：跨模块联调、环境搭建、首跑修错。按开发工时的 18% 计——低于这个数
     在真实项目里基本不可能，高于 30% 则说明前面的估算本身偏乐观。 */
  const integ = { hours: (mH + gH + bH) * 0.18, tk: (mH + gH + bH) * 0.18 * 4e4 };

  const dev = { hours: mH + gH + bH, tk: sum([...mods, ...glue, ...base].map((x) => x.e), "tk") };
  const total = { hours: dev.hours + integ.hours, tk: dev.tk + integ.tk };

  return {
    mods: { hours: mH, tk: sum(mods.map((x) => x.e), "tk"), n: mods.length },
    glue: { hours: gH, tk: sum(glue.map((x) => x.e), "tk"), n: glue.length },
    base: { hours: bH, tk: sum(base.map((x) => x.e), "tk"), n: base.length },
    integ,
    dev,
    total,
    rows: { mods, glue, base },
    buildCount: [...mods, ...glue, ...base].filter((x) => x.e.lv === "build").length,
  };
}

/** 一个包（按包内全部模块、推荐方案计）——用于选包时判断值不值得 */
export function packEst(pid) {
  const mods = HUB.filter((m) => m.pk === pid);
  let hours = 0;
  let tk = 0;
  for (const m of mods) {
    const e = estGroup(m, null);
    hours += e.hours;
    tk += e.tk;
  }
  return { hours, tk, n: mods.length };
}

/* ────────── 格式化 ────────── */

export const rateOf = (id) => RATES.find((r) => r.id === id) || RATES[1];

export const costOf = (tk, rateId = "std") => (tk / 1e6) * rateOf(rateId).price;

/** 工时：不足一天用小时，超过一天用人天 */
export function hrsTxt(hours) {
  if (!hours) return "0";
  if (hours < HOURS_DAY) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} 小时`;
  return `${(hours / HOURS_DAY).toFixed(1)} 人天`;
}

/** token：万 / 亿 */
export function tkTxt(tk) {
  if (!tk) return "0";
  if (tk < 1e4) return Math.round(tk).toLocaleString("zh-CN");
  if (tk < 1e8) return `${(tk / 1e4).toFixed(tk < 1e6 ? 1 : 0)} 万`;
  return `${(tk / 1e8).toFixed(2)} 亿`;
}

/** 金额：小于一元给两位小数 */
export function costTxt(amount) {
  if (!amount) return "¥0";
  if (amount < 1) return `¥${amount.toFixed(2)}`;
  if (amount < 1e4) return `¥${Math.round(amount).toLocaleString("zh-CN")}`;
  return `¥${(amount / 1e4).toFixed(1)} 万`;
}

/** 传统手写折成钱 */
export const handCost = (hours) => (hours / HOURS_DAY) * DAY_RATE;

/** 一行摘要：工时 · token · 费用 */
export function estTxt(e, rateId = "std") {
  return `${hrsTxt(e.hours)} · ${tkTxt(e.tk)} token · ${costTxt(costOf(e.tk, rateId))}`;
}
