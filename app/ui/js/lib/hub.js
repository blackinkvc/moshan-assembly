// lib/hub.js —— 「正在装配的这台东西」的模型与规则。
//
// 这里只有纯计算，不碰 DOM：形态能不能用、默认该勾哪些模块、某个规格下有多少格，
// 都由这几条规则决定。视图只负责把结果画出来——规则改了不用动界面。
// 规则与旧版 arch/app.html 逐条对齐，注释保留了当初为什么这么写。

import { SCENES, PACKS, HUB, FORMS } from "../../data/catalog.js";

export const STEP_NAMES = ["场景", "形态", "包", "方案", "连线", "确认", "组装", "交付"];

/* ────────── 平台：装到哪几个系统上（可多选） ────────── */

export const PLATS = [
  { id: "mac", nm: "macOS", art: "chip", note: "dmg 未签名会被 Gatekeeper 拦" },
  { id: "win", nm: "Windows", art: "chip", note: "exe 未签名会撞 SmartScreen" },
  { id: "linux", nm: "Linux", art: "term", note: "AppImage 要 chmod +x；deb 有依赖" },
  { id: "android", nm: "安卓", art: "wifi", note: "apk 要放开未知来源；上架要签名与审核" },
];

/** 形态 → 装不上的平台。CLI 在安卓上只能 Termux，不算正经支持 */
const PLAT_NO = { cli: ["android"], web: [] };

/* ────────── 形态 → 哪些模块在这个形态下根本不适用 ──────────
   CLI 没有窗口、看板、日历、图库、主题、动效、图标位、布局、地图、位置、追踪；
   网页形态只差一个「安装器」（网页没有安装过程）。 */

const FORM_NO = {
  cli: [
    "shell", "board", "cal", "gallery", "imagegen", "edit", "upscale",
    "theme", "motion", "icons", "layout", "map", "locate", "trace",
  ],
  web: ["installer"],
  app: [],
};

/* ────────── 查表 ────────── */

export const sceneById = (id) => SCENES.find((s) => s.id === id) || SCENES[0];
export const scenePacks = (id) => sceneById(id).packs || [];
export const packOf = (id) => PACKS.find((p) => p.id === id) || PACKS[0];
export const hubMod = (id) => HUB.find((m) => m.id === id);

export const formOf = (hub) => (hub && hub.form) || "app";
export const formDef = (id) => FORMS.find((f) => f.id === (id || "app")) || FORMS[1];
export const platOf = (hub) => (hub && hub.plat && hub.plat.length ? hub.plat : ["mac", "win"]);

export const formOk = (m, form = "app") => !(FORM_NO[form] || []).includes(m.id);
export const platOk = (pid, form = "app") => !(PLAT_NO[form] || []).includes(pid);

/* ────────── 有效等级 ──────────
   一个包在「这一次装配」里的等级，不等于它在目录里的等级：
   场景把它列进 must、而它本身是可选包时，升一档。这样「仓库管理」里的交易包
   不会被当成可有可无——同一个包在「个人中台」里仍然是可选。 */

export function packTierEff(pid, sceneId) {
  const sc = sceneById(sceneId);
  const core = (sc.must || ["core"]).includes(pid);
  const t = packOf(pid).tier;
  return core && t === "opt" ? "rec" : t;
}

/* 模块升档只有一种情况：它所在的某个包被场景列为 must，而那个包本身是可选包。
   不能按「它所有包里最高的一档」算——那样 ai+dev 里的可选模块会被 ai 的推荐档
   带上来，均衡档会莫名多出十几个模块。 */
export function modTierEff(m, sceneId) {
  const sc = sceneById(sceneId);
  const boosted = (m.pks || []).some(
    (pid) => packOf(pid).tier === "opt" && (sc.must || []).includes(pid)
  );
  return boosted && m.tier === "opt" ? "rec" : m.tier;
}

/* ────────── 场景 + 规格 + 形态 → 默认勾哪些模块 ──────────
   简约与场景无关（只留地基）；均衡勾场景包的必装 + 推荐；齐全把场景包全勾上。
   形态是最后一道过滤：CLI 下没有看板、没有主题、没有地图。 */

export function defaultMods(sceneId, styId = "mid", form = "app") {
  const pids = scenePacks(sceneId);
  const ok = (m) => formOk(m, form);
  const inScene = (m) => (m.pks || []).some((p) => pids.includes(p));

  if (styId === "min") return HUB.filter((m) => m.tier === "must" && ok(m)).map((m) => m.id);
  if (styId === "mid")
    return HUB.filter((m) => ok(m) && inScene(m) && modTierEff(m, sceneId) !== "opt").map((m) => m.id);
  return HUB.filter((m) => ok(m) && inScene(m)).map((m) => m.id);
}

/** 模块 → 去掉重复后的能力格 */
export function hubCells(modIds) {
  const out = [];
  for (const id of modIds) {
    const m = hubMod(id);
    if (!m) continue;
    for (const c of m.cells || []) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** 某个规格下会勾多少模块、落多少格——首页与形态页都靠这个显示「装多满」 */
export function styCount(styId, sceneId, form = "app") {
  const mods = defaultMods(sceneId, styId, form);
  return { n: mods.length, cells: hubCells(mods).length };
}

/** 这个场景 + 形态下，有几个模块因为形态不适用而被排除（用来解释为什么少了东西） */
export function unavailableCount(sceneId, form = "app") {
  const pids = scenePacks(sceneId);
  return HUB.filter(
    (m) => !formOk(m, form) && (m.pks || []).some((p) => pids.includes(p))
  ).length;
}

/* ────────── 新建 / 改选 ────────── */

const DEFAULTS = {
  sty: "mid",
  form: "app",
  plat: ["mac", "win"],
  anim: "lego", // 组装动效：lego / wire / ink / …（组装页用）
  mem: 16,
  model: "qwen2.5:3b",
  min: false,
  plans: {}, // 每格挑了哪个实现 { cellId: provId }
  glue: {}, // 连线上的胶水选择
  base: {}, // 底座选型
};

export function newHub(sceneId, extra = {}) {
  const h = { scene: sceneId, ...DEFAULTS, ...extra };
  h.mods = extra.mods || defaultMods(h.scene, h.sty, h.form);
  return h;
}

/** 换形态或规格：按新规则重算勾选，平台里不适用的自动去掉。
    手改过的勾选会重置——这是刻意的，页面上有一句话说清。 */
export function withChoice(hub, patch) {
  const n = { ...hub, ...patch };
  n.mods = defaultMods(n.scene, n.sty, n.form);
  n.plat = (n.plat || []).filter((pid) => platOk(pid, n.form));
  if (!n.plat.length) n.plat = ["mac", "win"].filter((pid) => platOk(pid, n.form));
  return n;
}
