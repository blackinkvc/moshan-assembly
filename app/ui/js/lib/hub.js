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

/* 合成场景：一句话需求解析出来的组合没有固定场景，但下游每一步都要读 hub.scene，
   与其让每页都写一遍「hub.scene 可能为空」，不如给一个真场景对象。 */
const CUSTOM_SCENE = {
  id: "custom",
  nm: "按需求配的",
  cat: "custom",
  sub: "从一句话需求解析出来的组合，没有固定场景",
  packs: [],
};
export const sceneById = (id) =>
  id === "custom" ? CUSTOM_SCENE : SCENES.find((s) => s.id === id) || SCENES[0];
export const isCustomScene = (id) => id === "custom";

/** 这套装配叫什么：一句话需求来的就用需求（截断），其余用场景名。
    页面标题、原型标题、zip 里的 README 都读这个，否则「按需求配的」会到处出现。 */
export function hubLabel(hub, max = 18) {
  const q = (hub && hub.need ? String(hub.need).trim() : "").replace(/\s+/g, " ");
  if (q) return q.length > max ? q.slice(0, max) + "…" : q;
  return sceneById(hub && hub.scene).nm;
}
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
export function styCount(styId, sceneId, form = "app", picked = null) {
  // 合成场景没有「默认勾选」这回事：格子是需求解析出来的，规格只影响能不能装
  if (isCustomScene(sceneId)) {
    const mods = (picked || []).filter((id) => {
      const m = hubMod(id);
      return m && formOk(m, form);
    });
    return { n: mods.length, cells: hubCells(mods).length };
  }
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
  /* 合成场景（一句话需求）不能按「场景默认包」重算，否则换一次形态就把
     解析出来的模块全抹掉——那是把用户刚说的话丢了。只按形态过滤。 */
  n.mods = isCustomScene(n.scene)
    ? (hub.mods || []).filter((id) => {
        const m = hubMod(id);
        return m && formOk(m, n.form);
      })
    : defaultMods(n.scene, n.sty, n.form);
  n.plat = (n.plat || []).filter((pid) => platOk(pid, n.form));
  if (!n.plat.length) n.plat = ["mac", "win"].filter((pid) => platOk(pid, n.form));
  return n;
}

/* ────────── 本地模型 ──────────
   ram 是「跑起来占多少」，不是文件多大：7B 的 Q4 文件 4.7GB，实际要 6.6GB，
   中间那块是 KV cache（4k 上下文下 0.5–1.5GB）。按文件大小算内存会低估一半。 */
export const LLM_MODELS = [
  { id: "qwen2.5:0.5b", nm: "Qwen2.5 0.5B", q: "Q4_K_M", gb: 0.4, ram: 1.1, tps: 150, use: "分类、打标签、抽取字段" },
  { id: "llama3.2:1b", nm: "Llama 3.2 1B", q: "Q4_K_M", gb: 0.8, ram: 1.7, tps: 95, use: "短摘要、改写、路由" },
  { id: "qwen2.5:1.5b", nm: "Qwen2.5 1.5B", q: "Q4_K_M", gb: 1.1, ram: 2.2, tps: 78, use: "中文摘要、轻问答" },
  { id: "qwen2.5:3b", nm: "Qwen2.5 3B", q: "Q4_K_M", gb: 2.0, ram: 3.4, tps: 42, use: "通用问答、写小段代码" },
  { id: "llama3.2:3b", nm: "Llama 3.2 3B", q: "Q4_K_M", gb: 2.0, ram: 3.4, tps: 42, use: "英文写作、指令跟随" },
  { id: "qwen2.5:7b", nm: "Qwen2.5 7B", q: "Q4_K_M", gb: 4.7, ram: 6.6, tps: 22, use: "主力：写作、代码、分析" },
  { id: "qwen2.5-coder:7b", nm: "Qwen2.5-Coder 7B", q: "Q4_K_M", gb: 4.7, ram: 6.8, tps: 20, use: "补全与改代码" },
  { id: "qwen2.5:14b", nm: "Qwen2.5 14B", q: "Q4_K_M", gb: 9.0, ram: 12.2, tps: 11, use: "复杂推理；16G 内存起步" },
  { id: "nomic-embed", nm: "nomic-embed-text", q: "F16", gb: 0.27, ram: 0.6, tps: 0, use: "向量检索（配合知识库）" },
];

export const modelOf = (id) =>
  LLM_MODELS.find((m) => m.id === id) || LLM_MODELS.find((m) => m.id === "qwen2.5:3b");

export const mbTxt = (n) =>
  n >= 1024 ? (n / 1024).toFixed(1) + " GB" : Math.round(n) + " MB";

/* ────────── 内存估算 ──────────
   外壳 + 各包的常驻 + 本地模型。预算按用户选的机器内存，再扣掉系统占用：
   桌面留 8G、安卓留 4G；但机器本身只有 8G 甚至 4G 时不能整块扣掉，
   否则「可用」会被扣成负数再兜到 1G，所有组合一律「超了」——所以最多扣一半。 */
export function memSim(hub) {
  const shellMB = { tauri: 95, electron: 225, web: 45, cli: 12 }[hub.base?.["bs-shell"] || formDef(hub.form).base] || 95;

  const used = new Set();
  for (const id of hub.mods) {
    const m = hubMod(id);
    if (m) for (const p of m.pks || []) used.add(p);
  }
  const packMB = [...used].reduce((n, p) => n + (packOf(p).mb || 0), 0);

  const hasLLM = hub.mods.includes("llmrt") || hub.mods.includes("llmpull") || used.has("llm");
  const mdl = hasLLM ? modelOf(hub.model) : null;
  const modelMB = mdl ? Math.round(mdl.ram * 1024) : 0;

  const total = shellMB + packMB + modelMB;
  const budget = (hub.mem || 16) * 1024;
  const floorWant = (hub.plat || []).includes("android") ? 4096 : 8192;
  const floor = Math.min(floorWant, Math.round(budget / 2));
  const avail = Math.max(1024, budget - floor);

  return {
    shellMB,
    packMB,
    modelMB,
    model: mdl,
    total,
    budget,
    avail,
    floor,
    pct: total / avail,
    ok: total <= avail,
    packs: [...used], // 计了费的包（导出 README 时要写「N 个包」）
  };
}
