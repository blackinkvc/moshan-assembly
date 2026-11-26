// lib/proto.js —— 试用原型：把当前装配变成一份「能点」的 HTML。
//
// 三块东西：
//   protoData(hub)   纯数据：装配结果压成一份 JSON，塞进文档
//   protoCSS()       文档自己的样式（独立文档，不继承主站的变量与主题）
//   protoRuntime(D)  文档里的运行时。**这个函数会被 toString() 塞进文档**，
//                    所以它不能引用本模块任何东西——只吃 D，只用浏览器 API。
//   protoDoc(hub)    拼成完整 HTML
//
// 用途两个：试用页用 iframe.srcdoc 直接跑；打包页把同一份字符串写进 zip 的 index.html。
// 一处生成、两处消费——这样「试用看到的」和「带走的那份」永远是同一个东西。

import { HUB, PACKS, GLUE, BASE, STYLES } from "../../data/catalog.js";
import { hubCells, hubMod, formDef, platOf, memSim, sceneById, PLATS } from "./hub.js";
import { check, CELL_BY_ID } from "./wire.js";

const sigOf = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
const styName = (id) => (STYLES.find((s) => s.id === id) || STYLES[1]).nm;
const recOf = (provs) => provs.find((p) => p.lv === "rec") || provs[0];
const packMods = (pid) => HUB.filter((m) => (m.pks || []).includes(pid));
const d2 = (n) => (n < 10 ? "0" : "") + n;

/** 装配结果 → 原型文档里的那份数据 */
export function protoData(hub) {
  const isHub = !!(hub && hub.mods && hub.mods.length);
  /* 最小包：只留地基（core 里必装的那几块）+ 扩展系统。
     扩展系统是「以后下载模块」的入口，最小包里必须留着，不然后面加不上东西。 */
  const min = !!(isHub && hub.min);
  const all = isHub ? hub.mods.map((id) => hubMod(id)).filter(Boolean) : [];
  const keepMin = (m) => ((m.pks || []).includes("core") && m.tier === "must") || m.id === "plugin";
  const minSet = () => {
    const a = all.filter(keepMin);
    return a.some((m) => m.id === "plugin") ? a : [...a, hubMod("plugin")].filter(Boolean);
  };
  const mods = min ? minSet() : all;
  const ids = mods.map((m) => m.id);
  const picks = hubCells(ids);
  const r = check(picks, hub.form);
  const memo = isHub ? memSim(hub) : null;
  const planOf = (mid) => {
    const m = hubMod(mid);
    return m ? m.provs.find((p) => p.id === (hub.plans || {})[mid]) || recOf(m.provs) : null;
  };
  const now = new Date();
  const at = `${now.getFullYear()}-${d2(now.getMonth() + 1)}-${d2(now.getDate())} ${d2(now.getHours())}:${d2(now.getMinutes())}`;

  return {
    sig: isHub ? sigOf([hub.scene, hub.sty, hub.form, ids.slice().sort().join(",")].join("|")) : "need",
    form: isHub ? hub.form : "app",
    formNm: isHub ? formDef(hub.form).nm : "自定义",
    plat: isHub ? platOf(hub).slice() : [],
    platNm: isHub
      ? platOf(hub).map((x) => (PLATS.find((p) => p.id === x) || {}).nm).filter(Boolean)
      : [],
    min,
    anim: (hub && hub.anim) || "lego",
    mem: memo
      ? {
          total: memo.total, budget: memo.budget, shell: memo.shellMB, pack: memo.packMB,
          model: memo.modelMB, ok: memo.ok,
          modelNm: memo.model ? memo.model.nm : "",
          tps: memo.model ? memo.model.tps : 0, gb: memo.model ? memo.model.gb : 0,
        }
      : null,
    /* 没装的模块：一个模块可能挂在几个包里，商店里只出现一次，否则「还剩 N 个」会数重 */
    shop: (() => {
      if (!isHub) return [];
      const seen = {};
      const cut = [];
      PACKS.forEach((p) =>
        packMods(p.id).forEach((m) => {
          if (ids.includes(m.id) || seen[m.id]) return;
          seen[m.id] = 1;
          cut.push({ id: p.id, nm: p.nm, hue: p.hue, tier: p.tier, m });
        })
      );
      return PACKS.map((p) => ({
        id: p.id, nm: p.nm, hue: p.hue, tier: p.tier,
        mods: cut
          .filter((x) => x.id === p.id)
          .map((x) => ({
            id: x.m.id, nm: x.m.nm, tier: x.m.tier, sub: x.m.sub,
            why: (x.m.pks || []).length > 1
              ? "也在 " + (x.m.pks || []).map((y) => (PACKS.find((q) => q.id === y) || {}).nm).join(" / ")
              : "",
          })),
      })).filter((p) => p.mods.length);
    })(),
    name: isHub ? sceneById(hub.scene).nm + " · " + styName(hub.sty) : "装配结果",
    style: isHub ? styName(hub.sty) : "自定义需求",
    need: "",
    at,
    mods: mods.map((m) => {
      const p = planOf(m.id);
      return {
        id: m.id, nm: m.nm, tier: m.tier, cells: m.cells,
        prov: p ? { n: p.n, k: p.k, lv: p.lv, note: p.note } : null,
      };
    }),
    cells: picks.slice(),
    caps: picks.slice(),
    lines: r.lines,
    scene: isHub ? sceneById(hub.scene).nm : "",
    packs: isHub
      ? PACKS.filter((p) => mods.some((m) => (m.pks || []).includes(p.id))).map((p) => ({
          id: p.id, nm: p.nm, tier: p.tier, hue: p.hue,
          n: mods.filter((m) => (m.pks || []).includes(p.id)).length,
        }))
      : [],
    glue: isHub
      ? GLUE.map((g) => {
          const pv = g.provs.find((x) => x.id === (hub.glue || {})[g.id]) || recOf(g.provs);
          return { id: g.id, nm: g.nm, pick: pv.n, k: pv.k, why: g.why || g.sub };
        })
      : [],
    base: isHub
      ? BASE.map((g) => {
          const pv = g.provs.find((x) => x.id === (hub.base || {})[g.id]) || recOf(g.provs);
          return { id: g.id, nm: g.nm, pick: pv.n, k: pv.k, why: g.sub };
        })
      : [],
    order: r.order
      .filter((c) => picks.includes(c))
      .map((c) => ({ id: c, nm: (CELL_BY_ID[c] || {}).name || c })),
  };
}

// ─────────────────────────────────────────────────────────────
// 以下三段从旧版 arch/app.html 原样搬来（只改了函数名）。
// 搬而不是重写：这套运行时是「能真的点」的关键，重写一遍等于重新验一遍 14 个面板。
// ─────────────────────────────────────────────────────────────

export function protoCSS() {
  return `*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:#ecebe5;color:#26251f;font:13px/1.62 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
#app{height:100%;display:flex;flex-direction:column;background:#fff}
.hdr{height:46px;flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:0 14px;border-bottom:1px solid #e4e1d8;background:#fbfaf7}
.dots{display:flex;gap:6px;margin-right:2px}
.dots i{width:10px;height:10px;border-radius:50%;background:#dcd8cd;display:block}
.dots i:nth-child(1){background:#e3a5a0}.dots i:nth-child(2){background:#e0c48a}.dots i:nth-child(3){background:#a8c9ae}
.ttl{font-weight:650;font-size:13px}
.badge{font-size:10.5px;color:#6b6960;border:1px solid #e4e1d8;border-radius:20px;padding:1px 8px;background:#fff;white-space:nowrap}
.badge.sim{color:#8a6d1f;border-color:#e8dcc0;background:#fdf8ea}
.bwrap{flex:1;display:flex;min-height:0}
.nav{width:168px;flex:0 0 auto;border-right:1px solid #efece4;padding:8px 6px;overflow:auto;background:#faf9f6}
.nav button{width:100%;text-align:left;border:0;background:transparent;border-radius:7px;padding:7px 10px;font:inherit;color:#4a4944;cursor:pointer}
.nav button:hover{background:#f1efe8}
.nav button.on{background:#26251f;color:#fff}
.nav .g{font-size:10.5px;color:#a3a096;padding:9px 10px 4px;letter-spacing:.06em}
main{flex:1;min-width:0;overflow:auto;padding:16px 18px 22px;background:#fff}
.ftr{flex:0 0 auto;height:28px;display:flex;align-items:center;gap:10px;padding:0 14px;border-top:1px solid #efece4;font-size:10.5px;color:#96938a;background:#fbfaf7}
.hd{display:flex;align-items:baseline;gap:8px;font-size:15px;font-weight:640;margin-bottom:10px}
.hd .c{font-size:11.5px;color:#96938a;font-weight:400}
.card{border:1px solid #e4e1d8;border-radius:10px;padding:11px 12px;background:#fff}
.inp{width:100%;border:1px solid #e4e1d8;border-radius:8px;padding:8px 10px;font:inherit;outline:none;background:#fbfaf7;color:inherit}
.inp:focus{border-color:#c3bda8;background:#fff}
textarea.inp{min-height:84px;resize:vertical;line-height:1.7}
.row{display:flex;align-items:center;gap:9px;padding:7px 2px;border-bottom:1px solid #f1efe8}
.row:last-child{border-bottom:0}
.ck{width:16px;height:16px;border:1.5px solid #cdc8bb;border-radius:4px;display:grid;place-items:center;font-size:11px;color:#fff;cursor:pointer;flex:0 0 auto;transition:.12s}
.row.done .ck{background:#3f7d5a;border-color:#3f7d5a}
.row.done .tx{color:#a3a096;text-decoration:line-through}
.tx{flex:1;min-width:0;cursor:pointer;word-break:break-word}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
.at{font-size:10.5px;color:#b3b0a6;white-space:nowrap}
.del{border:0;background:transparent;color:#c6c2b6;cursor:pointer;font-size:13px;padding:0 3px;line-height:1}
.del:hover{color:#26251f}
.empty{color:#b3b0a6;font-size:12px;padding:16px 2px;text-align:center}
.hint{font-size:11px;color:#96938a;margin-top:10px;line-height:1.66;border-top:1px dashed #e4e1d8;padding-top:8px}
.hint b{color:#6b6960;font-weight:600}
.btn{border:1px solid #d9d5c8;background:#fff;border-radius:7px;padding:5px 11px;font:inherit;cursor:pointer;color:inherit}
.btn:hover{background:#f7f5ef}
.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.col{background:#faf9f6;border:1px solid #efece4;border-radius:9px;padding:8px;min-height:120px}
.col h4{margin:0 0 7px;font-size:11.5px;color:#6b6960;font-weight:600;display:flex;align-items:center;gap:6px}
.col h4 i{font-style:normal;margin-left:auto;color:#b3b0a6;font-weight:400}
.gc{background:#fff;border:1px solid #e4e1d8;border-radius:7px;padding:7px 8px;font-size:12px;line-height:1.5;
  margin-bottom:6px;cursor:pointer;display:flex;gap:7px;align-items:flex-start}
.gc:hover{border-color:#c3bda8}
.gc .tg{width:6px;height:6px;border-radius:50%;flex:0 0 auto;margin-top:6px}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.day{border:1px solid #efece4;border-radius:8px;padding:6px;min-height:96px;background:#fff}
.day.today{border-color:#c9b98a;background:#fdfbf4}
.day b{font-size:10.5px;color:#96938a;font-weight:500;display:block;margin-bottom:5px}
.ev{font-size:11px;line-height:1.4;background:#f4f2ec;border-radius:5px;padding:3px 5px;margin-bottom:4px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gens{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.gi{border:1px solid #e4e1d8;border-radius:9px;overflow:hidden;background:#fff;cursor:pointer}
.gi .im{aspect-ratio:1;display:grid;place-items:center;font-size:22px}
.gi .cp{padding:6px 7px;font-size:10.5px;color:#6b6960;line-height:1.45;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th{text-align:left;font-size:10.5px;color:#96938a;font-weight:500;padding:5px 6px;border-bottom:1px solid #efece4}
.tbl td{padding:6px;border-bottom:1px solid #f6f4ee}
.tbl td.n{text-align:right;font-variant-numeric:tabular-nums}
.mv{border:1px solid #e4e1d8;background:#fff;border-radius:5px;width:20px;height:20px;line-height:1;cursor:pointer;color:#6b6960}
.mv:hover{background:#f4f2ec}

.btn.p{background:#26251f;border-color:#26251f;color:#fff}
.btn.p:hover{background:#3a3830}
.msg{border-radius:9px;padding:8px 10px;font-size:12.5px;line-height:1.7;max-width:92%}
.msg.bot{background:#f4f2ec;border:1px solid #e8e5db;align-self:flex-start}
.msg.me{background:#26251f;color:#fff;align-self:flex-end}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.ap{border:1px solid #e4e1d8;border-radius:10px;padding:12px 8px;text-align:center;cursor:pointer;background:#fff}
.ap:hover{border-color:#c3bda8;box-shadow:0 1px 6px rgba(38,37,31,.06)}
.ap .ic{width:34px;height:34px;border-radius:9px;margin:0 auto 6px;display:grid;place-items:center;color:#fff;font-size:13px;font-weight:600}
.ap .nm{font-size:11.5px;color:#4a4944;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw{width:34px;height:19px;border-radius:20px;background:#dcd8cd;position:relative;cursor:pointer;flex:0 0 auto;transition:.16s}
.sw:after{content:"";position:absolute;width:15px;height:15px;border-radius:50%;background:#fff;top:2px;left:2px;transition:.16s}
.sw.on{background:#3f7d5a}
.sw.on:after{left:17px}
.bar{height:6px;border-radius:6px;background:#f1efe8;overflow:hidden;margin-top:8px}
.bar>i{display:block;height:100%;width:0;background:#3f7d5a;transition:width .25s}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:10px}
.st{border:1px solid #e4e1d8;border-radius:9px;padding:9px 11px;background:#fbfaf7}
.st b{display:block;font-size:19px;font-weight:640;line-height:1.2}
.st span{font-size:11px;color:#96938a}
.cliwrap{height:100%;display:flex;flex-direction:column;background:#1c1d1b;color:#d6d3c8;
  font:12.5px/1.62 ui-monospace,SFMono-Regular,Menlo,monospace}
.clibar{flex:0 0 auto;height:38px;display:flex;align-items:center;gap:8px;padding:0 12px;
  border-bottom:1px solid #33352f;background:#232421;color:#b9b6aa;font-size:12px}
.clibar b{color:#e6e3d8;font-weight:600}
.clibar .badge{border-color:#3c3e37;background:#282a26;color:#a9a69a}
.clibar .badge.sim{border-color:#4a4331;background:#39321f;color:#d9c58a}
.cliscr{flex:1;min-height:0;overflow:auto;padding:14px 16px;white-space:pre-wrap}
.cliscr .cmd{color:#8fb3a0}
.cliscr .ok{color:#8fc7a5}
.cliscr .err{color:#e08a80}
.cliscr .dim{color:#85857b}
.cliscr .grp{color:#d9c58a;margin-top:6px}
.cliin{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 14px 12px;border-top:1px solid #2c2e29}
.cliin span{color:#7ba98c}
.cliin input{flex:1;background:transparent;border:0;outline:none;color:#e6e3d8;font:inherit}
@media(max-width:620px){.nav{width:112px}.hdr .badge.hide{display:none}main{padding:12px}.at{display:none}}`;
}

function protoRuntime(D) {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const pad = n => (n < 10 ? "0" : "") + n;
  const ts = () => { const d = new Date(); return (d.getMonth()+1) + "-" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  /* 每套装配一份数据：同一个草稿再打开，里面点过的东西还在；换一套不会串味 */
  const K = "moshan.trial.v2:" + (D.sig || "x");
  const save = () => { try { localStorage.setItem(K, JSON.stringify(ST)); } catch(e){} };

  const seed = () => ({
    todo: [{t:"把这一版翻一遍，看看哪些模块其实用不上", done:false, at:ts()},
           {t:"叉掉不用的，回去重新装一次", done:false, at:ts()}],
    note: [{t:"中台的第一条笔记\n这段话只存在你自己的浏览器里。换台设备看不到——要跨设备，得装「多端同步」。", at:ts()}],
    clip: [{t:"https://news.ycombinator.com/item?id=39210000", k:"链接"},
           {t:'{"model":"gpt-5","tokens":842,"cost":0.0031}', k:"JSON"},
           {t:"/Users/me/Documents/发票 2026-11.pdf", k:"路径"}],
    plug: {pomo:true, git:false},
    board: [{t:"把这一版过一遍", c:0}, {t:"定下三个包的实现", c:1},
            {t:"数据仓建表", c:2}, {t:"连通检查跑通", c:0}],
    cal: [{d:0, t:"周会 10:00"}, {d:2, t:"交版本"}, {d:3, t:"对账"}, {d:5, t:"复盘"}],
    gen: [{p:"雨里的橘猫，赛博朋克", c:"#c9a227"}, {p:"一张能当封面的构图", c:"#7f9b6a"}],
    stock: [{sku:"SKU-001", nm:"帆布包 · 黑", qty:12, hold:2},
            {sku:"SKU-002", nm:"帆布包 · 米", qty:3, hold:1},
            {sku:"SKU-003", nm:"钥匙扣 · 共版", qty:0, hold:0}],
    syncOn: false, syncAt: "从未同步",
    launch: [{n:"VS Code", c:"#2f6feb"}, {n:"Chrome", c:"#e07b39"}, {n:"终端", c:"#26251f"}, {n:"备忘录", c:"#c9a227"}],
    tab: null
  });
  let ST = null;
  try { ST = JSON.parse(localStorage.getItem(K) || "null"); } catch(e){ ST = null; }
  if(!ST || !Array.isArray(ST.todo)) ST = seed();
  if(!ST.launch) ST.launch = seed().launch;
  if(!ST.plug) ST.plug = seed().plug;

  const NAV = [["todo","待办"],["note","速记"],["board","看板"],["cal","日程"],["search","搜索"],
               ["ai","AI 助手"],["imagegen","生图"],["stock","库存"],["clip","剪贴板"],
               ["launch","启动器"],["plugin","扩展"],["update","更新"],["sync","同步"],["data","数据"]];
  /* 面板「有还是没有」按能力格判，不按模块 id 判：
     不同场景里同一个能力可能叫 note / memo / kb-note，但能力格是同一套命名。
     光按 id 判的话，换个场景就会「装了速记却没有速记面板」。 */
  const CAP = {
    note: ["kb.ingest", "kb.manage", "kb.fulltext"],
    search: ["kb.fulltext", "kb.ingest"],
    todo: ["app.todo", "app.remind"],
    board: ["app.board", "app.strata"],
    cal: ["app.cal", "app.remind"],
    data: ["app.data", "app.backup"],
    ai: ["ai.chat.core", "ai.agent.tool"],
    stock: ["biz.stock", "biz.catalog"],
  };
  const caps = D.caps || [];
  const have = id =>
    D.mods.some(m => m.id === id) ||
    ((CAP[id] || []).some(c => caps.indexOf(c) >= 0));
  const tabs = NAV.filter(([id]) => have(id));
  /* 最小包里只有地基，但「模块商店」这个入口必须在——不然用户以后没法加模块 */
  if((D.shop || []).length) tabs.push(["shop", "模块商店"]);
  if(!ST.tab || !tabs.some(([id]) => id === ST.tab)) ST.tab = tabs.length ? tabs[0][0] : "data";

  const toast = txt => {
    let t = $("#tip");
    if(!t){ t = document.createElement("div"); t.id = "tip";
      t.style.cssText = "position:fixed;left:50%;bottom:44px;transform:translateX(-50%);background:#26251f;color:#fff;" +
        "font-size:12px;padding:7px 14px;border-radius:8px;opacity:0;transition:.18s;pointer-events:none;z-index:9";
      document.body.appendChild(t); }
    t.textContent = txt; t.style.opacity = 1;
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = 0; }, 1600);
  };

  const P = {};

  /* ── CLI 形态：没有界面就没有面板，只有提示符。命令是真的会改 ST 的。 ── */
  if(D.form === "cli"){
    document.body.innerHTML = `<div class="cliwrap"><div class="clibar">
        <b>${esc(D.name)}</b><span class="badge">CLI</span><span class="badge sim">模拟</span>
        <span style="flex:1"></span><span class="badge">${D.mods.length} 模块 · ${D.cells.length} 格</span></div>
      <div class="cliscr" id="scr"></div>
      <div class="cliin"><span>$</span><input id="cin" autocomplete="off" spellcheck="false" placeholder="help"></div></div>`;
    const scr = $("#scr"), inp = $("#cin");
    const out = (t, c) => { const d = document.createElement("div"); if(c) d.className = c; d.textContent = t; scr.appendChild(d); scr.scrollTop = scr.scrollHeight; };
    const cmds = {
      help(){ out("可用命令："); ["todo  列出待办 / todo add <内容> / todo done <序号>",
        "note  列出笔记 / note add <内容>", "board 列出看板三列", "search <词> 搜待办与笔记",
        "stock 库存与占用", "status 这台东西装了什么", "clear 清屏"].forEach(x => out("  " + x)); },
      todo(a){
        if(a[0] === "add" && a[1]) { ST.todo.push({t:a.slice(1).join(" "), done:false, at:ts()}); save(); out("已添加：" + a.slice(1).join(" "), "ok"); return; }
        if(a[0] === "done" && a[1]) { const i = +a[1] - 1; if(ST.todo[i]){ ST.todo[i].done = true; save(); out("已完成：" + ST.todo[i].t, "ok"); } else out("没有第 " + a[1] + " 条", "err"); return; }
        if(!ST.todo.length) return out("（空）", "dim");
        ST.todo.forEach((t, i) => out(`  ${i + 1}. [${t.done ? "x" : " "}] ${t.t}`));
      },
      note(a){
        if(a[0] === "add" && a[1]) { ST.note.push({t:a.slice(1).join(" "), at:ts()}); save(); out("已记下", "ok"); return; }
        if(!ST.note.length) return out("（空）", "dim");
        ST.note.forEach((n, i) => out(`  ${i + 1}. ${n.t.split("\n")[0].slice(0, 60)}  ${n.at}`));
      },
      board(){
        ["待办", "进行中", "已完成"].forEach((nm, ci) => {
          out(nm, "grp"); ST.board.filter(b => b.c === ci).forEach(b => out("  · " + b.t));
        });
      },
      search(q){
        const w = (q || "").toLowerCase(); if(!w) return out("用法：search <词>");
        const hit = [];
        ST.todo.forEach(t => t.t.toLowerCase().includes(w) && hit.push(["待办", t.t]));
        ST.note.forEach(n => n.t.toLowerCase().includes(w) && hit.push(["笔记", n.t.split("\n")[0]]));
        if(!hit.length) return out("没搜到「" + q + "」", "dim");
        hit.forEach(([k, t]) => out(`  [${k}] ${t.slice(0, 70)}`));
      },
      stock(){
        out("SKU            名称              在库  占用", "grp");
        ST.stock.forEach(s => out(`  ${s.sku.padEnd(14)} ${s.nm.padEnd(16)} ${String(s.qty).padStart(3)}   ${s.hold}`));
        out("提示：扣减要用带条件的 UPDATE（qty >= n），先查后扣在大促那天必然超卖。", "dim");
      },
      status(){
        out(D.name, "grp");
        out(`  形态 ${D.formNm} · 平台 ${(D.platNm || []).join("/") || "—"} · 内存约 ${D.mem ? (D.mem.total / 1024).toFixed(1) + " GB" : "—"}`);
        out("  模块：" + D.mods.map(m => m.nm).join("、"));
        out("  能力格：" + D.cells.length + " 格 · 连线 " + D.lines + " 条");
        if((D.shop || []).length) out("  没装：" + D.shop.map(p => p.nm + "(" + p.mods.length + ")").join("、") + "　用 shop 看怎么装", "dim");
      },
      shop(){
        if(!(D.shop || []).length) return out("全都装上了。", "dim");
        D.shop.forEach(p => { out(p.nm + "（" + p.mods.length + "）", "grp"); p.mods.forEach(m => out("  · " + m.nm + "　" + m.sub)); });
        out("模拟版没有真的下载；真实版本这里会走「下载 → 校验 → 热加载」。", "dim");
      },
      clear(){ scr.innerHTML = ""; }
    };
    out(D.name + "　" + D.formNm + " · " + D.mods.length + " 个模块", "grp");
    out("输入 help 看命令。这是模拟，数据存在浏览器里。", "dim");
    inp.focus();
    inp.addEventListener("keydown", e => {
      if(e.key !== "Enter") return;
      const line = inp.value.trim(); inp.value = "";
      out("$ " + line, "cmd");
      if(!line) return;
      const [c, ...a] = line.split(/\s+/);
      if(cmds[c]) { try { cmds[c](a); } catch(err){ out("出错：" + err.message, "err"); } }
      else out("没有这个命令：" + c + "（输入 help）", "err");
    });
    return;
  }

  P.shop = el => {
    const ins = () => { try { return JSON.parse(localStorage.getItem(K + ".inst") || "[]"); } catch(e){ return []; } };
    const got = ins();
    const packs = (D.shop || []);
    const total = packs.reduce((n, p) => n + p.mods.length, 0);
    el.innerHTML = `<div class="hd">模块商店<span class="c">${total} 个模块没装 · 按需下载</span></div>
      <div class="card" style="margin-bottom:10px">
        <div style="font-size:12.5px;line-height:1.7">
          <b>最小包为什么留着这个页面：</b>先装一个能跑的地基（几十 MB），
          其余模块你以后用到哪个再下哪个。下载是「拿一个包 + 校验 + 热加载」，不用重装主程序。
        </div>
      </div>
      ${packs.map(p => `<div class="card" style="margin-bottom:9px;border-left:3px solid hsl(${p.hue} 55% 62%)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <b style="font-size:13px">${esc(p.nm)}</b>
          <span class="badge">${p.mods.length} 个</span>
          <span style="flex:1"></span>
          <button class="btn" data-pall="${p.id}">整包安装</button>
        </div>
        ${p.mods.map(m => `<div class="row" data-mid="${m.id}" data-got="${got.includes(m.id) ? 1 : 0}">
          <div class="tx"><b style="font-weight:600">${esc(m.nm)}</b>
            <div style="font-size:11.5px;color:#96938a">${esc(m.sub)}${m.why ? "　·　" + esc(m.why) : ""}</div></div>
          <button class="btn" data-ins="${m.id}">${got.includes(m.id) ? "已装 ✓" : "下载"}</button>
        </div>`).join("")}
      </div>`).join("")}
      <div class="hint">点了「下载」只是把这一格标记成已装（模拟）。真实版本要做三件事：
        <b>分块下载 + sha256 校验 + 装完热加载</b>，任一失败要能回滚到上一个可用版本。</div>`;
    const mark = id => {
      const cur = ins(); if(!cur.includes(id)) cur.push(id);
      try { localStorage.setItem(K + ".inst", JSON.stringify(cur)); } catch(e){}
      paint(); toast("已装（模拟）：" + ((D.shop.flatMap(p => p.mods).find(m => m.id === id) || {}).nm || id));
    };
    $$("[data-ins]", el).forEach(b => b.onclick = () => mark(b.dataset.ins));
    $$("[data-pall]", el).forEach(b => b.onclick = () => {
      const p = packs.find(x => x.id === b.dataset.pall);
      const cur = ins();
      p.mods.forEach(m => { if(!cur.includes(m.id)) cur.push(m.id); });
      try { localStorage.setItem(K + ".inst", JSON.stringify(cur)); } catch(e){}
      paint(); toast("整包已装（模拟）：" + p.nm);
    });
  };

  P.board = el => {
    const COLS = ["待办", "进行中", "已完成"], CN = ["#c9a227", "#3f7d5a", "#6b6960"];
    el.innerHTML = `<div class="hd">看板<span class="c">${ST.board.length} 张卡 · 点一下挪到下一列</span></div>
      <div class="cols">${COLS.map((nm, ci) => {
        const list = ST.board.map((b, i) => [b, i]).filter(([b]) => b.c === ci);
        return `<div class="col"><h4><span class="tg" style="background:${CN[ci]};width:6px;height:6px;border-radius:50%;display:inline-block"></span>
          ${nm}<i>${list.length}</i></h4>
          ${list.length ? list.map(([b, i]) => `<div class="gc" data-mv="${i}">
            <span class="tg" style="background:${CN[ci]}"></span><span>${esc(b.t)}</span></div>`).join("")
            : `<div class="empty" style="padding:10px 0">空</div>`}</div>`;
      }).join("")}</div>
      <div class="hint">看板与甘特是同一份数据的两个视图：一个看「现在卡在哪」，一个看「什么时候做完」。
        底层必须是一条记录（状态 + 起止时间），否则两个视图会各存一份、互相对不上。</div>`;
    $$("[data-mv]", el).forEach(n => n.onclick = () => {
      const i = +n.dataset.mv; ST.board[i].c = (ST.board[i].c + 1) % 3; save(); paint();
    });
  };

  P.cal = el => {
    const now = new Date(), wd = (now.getDay() + 6) % 7;
    const start = new Date(now); start.setDate(now.getDate() - wd);
    const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    el.innerHTML = `<div class="hd">日程<span class="c">本周 · ${ST.cal.length} 条</span></div>
      <div class="cal">${days.map((d, i) => {
        const isToday = d.toDateString() === now.toDateString();
        const evs = ST.cal.filter(c => c.d === i);
        return `<div class="day ${isToday ? "today" : ""}"><b>${"一二三四五六日"[i]} ${d.getDate()}</b>
          ${evs.map(e => `<div class="ev">${esc(e.t)}</div>`).join("")}</div>`;
      }).join("")}</div>
      <div class="hint">真实版本要处理两件事：<b>重复事件</b>（每周一 9 点，改一次只改那一次）与
        <b>时区</b>（全天事件不能存 UTC 时间戳，否则跨时区会跑到前一天）。</div>`;
  };

  P.imagegen = el => {
    el.innerHTML = `<div class="hd">生图<span class="c">${ST.gen.length} 张 · 提示词与种子都留着</span></div>
      <div class="card">
        <input class="inp" id="gnIn" placeholder="描述你要的图，回车生成">
        <div class="gens" id="gnList" style="margin-top:9px"></div>
        <div class="hint">模拟版只画色块，但流程是真的：提示词进队列 → 出图 → 存素材库、留参数。
          真实版本要把「提示词 + 种子 + 模型版本」一起存，否则好图复现不出来。</div>
      </div>`;
    const box = $("#gnList");
    const draw = () => {
      box.innerHTML = ST.gen.length ? ST.gen.map((g, i) => `<div class="gi" data-gd="${i}">
        <div class="im" style="background:${g.c}22;color:${g.c}">✦</div>
        <div class="cp">${esc(g.p)}</div></div>`).join("") : `<div class="empty">还没有图</div>`;
      $$("[data-gd]", box).forEach(n => n.onclick = () => {
        ST.gen.splice(+n.dataset.gd, 1); save(); draw(); toast("已从素材库删掉");
      });
    };
    draw();
    const inp = $("#gnIn");
    inp.onkeydown = e => {
      if(e.key !== "Enter") return;
      const v = inp.value.trim(); if(!v) return;
      const h = (v.length * 37) % 360;
      ST.gen.unshift({p:v, c:"hsl(" + h + " 42% 55%)"}); save(); draw(); inp.value = ""; toast("生成完成（模拟）");
    };
  };

  P.stock = el => {
    const total = ST.stock.reduce((n, s) => n + s.qty, 0);
    const hold = ST.stock.reduce((n, s) => n + s.hold, 0);
    el.innerHTML = `<div class="hd">库存<span class="c">${ST.stock.length} 个 SKU · 可用 ${total - hold} 件</span></div>
      <div class="card">
        <table class="tbl"><thead><tr><th>SKU</th><th>名称</th><th class="n">在库</th><th class="n">占用</th><th class="n">可用</th><th></th></tr></thead>
        <tbody>${ST.stock.map((s, i) => `<tr>
          <td class="mono">${esc(s.sku)}</td><td>${esc(s.nm)}</td>
          <td class="n">${s.qty}</td><td class="n">${s.hold}</td>
          <td class="n" style="color:${s.qty - s.hold > 0 ? "#3f7d5a" : "#b4472f"}">${s.qty - s.hold}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="mv" data-sq="${i}:-1">−</button>
            <button class="mv" data-sq="${i}:1">+</button></td></tr>`).join("")}</tbody></table>
        <div class="hint">扣减必须是<b>原子的</b>：<code>UPDATE ... WHERE qty &gt;= n</code> 看影响行数，
          而不是「先查够不够、再减」。后者在两个人同时买最后一件时必然超卖。</div>
      </div>`;
    $$("[data-sq]", el).forEach(n => n.onclick = () => {
      const [i, d] = n.dataset.sq.split(":").map(Number);
      ST.stock[i].qty = Math.max(0, ST.stock[i].qty + d); save(); paint();
    });
  };

  P.todo = el => {
    const left = ST.todo.filter(t => !t.done).length;
    el.innerHTML = `<div class="hd">待办<span class="c">${left} 条未完成 · 共 ${ST.todo.length} 条</span></div>
      <div class="card">
        <input class="inp" id="tdIn" placeholder="加一条，回车确认">
        <div id="tdList" style="margin-top:4px">${ST.todo.length ? ST.todo.map((t, i) => `<div class="row ${t.done ? "done" : ""}">
          <div class="ck" data-tg="${i}">${t.done ? "✓" : ""}</div>
          <div class="tx" data-tg="${i}">${esc(t.t)}</div>
          <div class="at">${esc(t.at)}</div>
          <button class="del" data-del="${i}">✕</button></div>`).join("") : `<div class="empty">还没有待办，上面加一条</div>`}</div>
        <div class="hint">模拟版只做勾选与增删。真实版本在这里接「自建表 + 滚动周期规则」——周期任务勾一次自动滚到下一轮，
          不会堆一屏逾期副本，提醒走后台线程。</div>
      </div>`;
    const inp = $("#tdIn");
    inp.onkeydown = e => {
      if(e.key !== "Enter") return;
      const v = inp.value.trim(); if(!v) return;
      ST.todo.unshift({t:v, done:false, at:ts()}); save(); paint();
      const n = $("#tdIn"); if(n) n.focus();
    };
    $$("[data-tg]", el).forEach(n => n.onclick = () => { const i = +n.dataset.tg; ST.todo[i].done = !ST.todo[i].done; save(); paint(); });
    $$("[data-del]", el).forEach(n => n.onclick = () => { ST.todo.splice(+n.dataset.del, 1); save(); paint(); });
  };

  P.note = el => {
    el.innerHTML = `<div class="hd">速记<span class="c">${ST.note.length} 条</span></div>
      <div class="card">
        <textarea class="inp" id="ntIn" placeholder="随手记一条。⌘/Ctrl + Enter 保存，第一行当标题"></textarea>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
          <button class="btn p" id="ntSave">保存</button>
          <span style="font-size:11px;color:#96938a">真实版本存成 Markdown 文件，任何编辑器都能打开</span></div>
      </div>
      <div class="card" style="margin-top:10px">${ST.note.length ? ST.note.map((n, i) => {
        const ls = String(n.t).split("\n");
        const rest = ls.slice(1).join(" ").trim();
        return `<div class="row" style="align-items:flex-start">
          <div class="tx"><b>${esc(ls[0] || "（空）")}</b>
            ${rest ? `<div style="color:#6b6960;font-size:12px;margin-top:2px">${esc(rest.length > 90 ? rest.slice(0, 90) + "…" : rest)}</div>` : ""}
            <div class="at" style="margin-top:3px">${esc(n.at)}</div></div>
          <button class="del" data-ndel="${i}">✕</button></div>`;
      }).join("") : `<div class="empty">还没有笔记</div>`}</div>`;
    const ta = $("#ntIn");
    const put = () => {
      const v = ta.value.trim(); if(!v) { toast("写点什么再存"); return; }
      ST.note.unshift({t:v, at:ts()}); save(); paint(); toast("已存进笔记");
    };
    $("#ntSave").onclick = put;
    ta.onkeydown = e => { if((e.metaKey || e.ctrlKey) && e.key === "Enter") put(); };
    $$("[data-ndel]", el).forEach(n => n.onclick = () => { ST.note.splice(+n.dataset.ndel, 1); save(); paint(); });
  };

  P.search = el => {
    el.innerHTML = `<div class="hd">全局搜索<span class="c">Ctrl + K</span></div>
      <div class="card"><input class="inp" id="sqIn" placeholder="搜待办、速记、剪贴板…">
        <div id="sqList" style="margin-top:6px"></div>
        <div class="hint">模拟版在内存里做包含匹配。真实版本走 <b>SQLite FTS5</b>，中英混排能直接搜，
          增量更新要自己写触发器。</div></div>`;
    const inp = $("#sqIn"), box = $("#sqList");
    const run = () => {
      const q = inp.value.trim().toLowerCase();
      if(!q){ box.innerHTML = `<div class="empty">输入关键词，三个来源一起搜</div>`; return; }
      const hits = [];
      ST.todo.forEach((t, i) => { if(String(t.t).toLowerCase().includes(q)) hits.push(["待办", t.t, "todo"]); });
      ST.note.forEach(n => { if(String(n.t).toLowerCase().includes(q)) hits.push(["速记", String(n.t).split("\n")[0], "note"]); });
      ST.clip.forEach(c => { if(String(c.t).toLowerCase().includes(q)) hits.push(["剪贴板", c.t, "clip"]); });
      box.innerHTML = hits.length ? hits.slice(0, 20).map(([k, t, tab]) => `<div class="row" data-jump="${tab}">
        <span class="badge">${k}</span><div class="tx">${esc(t.slice(0, 110))}</div><span class="at">跳过去 →</span></div>`).join("")
        : `<div class="empty">没搜到「${esc(inp.value)}」</div>`;
      $$("[data-jump]", box).forEach(n => n.onclick = () => { ST.tab = n.dataset.jump; save(); syncNav(); paint(); });
    };
    inp.oninput = run; run(); inp.focus();
  };

  P.ai = el => {
    const mod = D.mods.find(m => m.id === "ai") || {};
    el.innerHTML = `<div class="hd">AI 助手<span class="c">模拟回复 · 这一版没有联网</span></div>
      <div class="card" id="aiBox" style="display:flex;flex-direction:column;gap:8px;min-height:220px">
        <div class="msg bot">（模拟）我读得到这个中台里的数据。试试这几句：<br>
          · 帮我加一条待办：明天交电费<br>· 我现在有几条待办<br>· 总结一下</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input class="inp" id="aiIn" placeholder="说点什么…"><button class="btn p" id="aiGo">发送</button>
      </div>
      <div class="hint">真实版本走 <b>${esc(mod.prov ? mod.prov.n : "自带 Key 直连")}</b>：请求从本机发出，Key 进系统钥匙串。
        你选它的理由是：${esc(mod.prov ? mod.prov.note : "—")}</div>`;
    const box = $("#aiBox"), inp = $("#aiIn");
    const push = (cls, html) => { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; box.appendChild(d); box.scrollTop = box.scrollHeight; };
    const reply = q => {
      const s = q.replace(/\s+/g, "");
      if(/待办|提醒|记一下|记个/.test(s)){
        const m = q.match(/[：:]\s*([\s\S]+)$/);
        if(m && m[1].trim()){
          const t = m[1].trim();
          ST.todo.unshift({t, done:false, at:ts()}); save();
          return "已经加进待办了：「" + esc(t) + "」。现在 " + ST.todo.filter(x => !x.done).length + " 条没做完。";
        }
        return "要记什么？照「帮我加一条待办：内容」这么说。";
      }
      if(/几条待办|多少待办|待办.*几/.test(s))
        return "未完成 " + ST.todo.filter(x => !x.done).length + " 条，已完成 " + ST.todo.filter(x => x.done).length + " 条。";
      if(/总结|概括|概览/.test(s)){
        const first = (ST.todo.find(x => !x.done) || {}).t || "（没有未完成的）";
        return "现在有 " + ST.todo.filter(x => !x.done).length + " 条未完成待办、" + ST.note.length +
               " 条速记、" + ST.clip.length + " 条剪贴板记录。最该先动的：「" + esc(first) + "」。";
      }
      return "（模拟回复）这一版没有真模型，我只能做本地那几件事：加待办、数数据、给个概览。";
    };
    const send = () => {
      const q = inp.value.trim(); if(!q) return;
      push("me", esc(q)); inp.value = "";
      setTimeout(() => { push("bot", reply(q)); }, 260);
    };
    $("#aiGo").onclick = send;
    inp.onkeydown = e => { if(e.key === "Enter") send(); };
    inp.focus();
  };

  P.clip = el => {
    el.innerHTML = `<div class="hd">剪贴板<span class="c">${ST.clip.length} 条</span></div>
      <div class="card">${ST.clip.length ? ST.clip.map((c, i) => `<div class="row">
        <span class="badge">${esc(c.k)}</span>
        <div class="tx mono" data-cp="${i}" title="点一下复制">${esc(c.t)}</div>
        <button class="del" data-cdel="${i}">✕</button></div>`).join("") : `<div class="empty">没有记录</div>`}
        <div class="hint">点条目复制。真实版本监听系统剪贴板：按内容哈希去重、图片落盘并生成缩略图，
          而且必须加密码类应用的排除列表。</div></div>`;
    $$("[data-cp]", el).forEach(n => n.onclick = () => {
      const t = ST.clip[+n.dataset.cp].t;
      navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(t).then(() => toast("已复制"), () => toast("已复制（模拟）"))
        : toast("已复制（模拟）");
    });
    $$("[data-cdel]", el).forEach(n => n.onclick = () => { ST.clip.splice(+n.dataset.cdel, 1); save(); paint(); });
  };

  P.launch = el => {
    el.innerHTML = `<div class="hd">快捷启动器<span class="c">${ST.launch.length} 个</span></div>
      <div class="card"><div class="grid">${ST.launch.map((a, i) => `<div class="ap" data-ln="${i}">
          <div class="ic" style="background:${esc(a.c)}">${esc(a.n.slice(0, 2))}</div>
          <div class="nm">${esc(a.n)}</div></div>`).join("")}
        <div class="ap" id="lpAdd"><div class="ic" style="background:#efece4;color:#96938a">＋</div><div class="nm">添加</div></div>
      </div>
      <div class="hint">真实版本扫系统菜单批量导入、取原生 256px 图标；已经开着的应用要切到前台，而不是再开一个。</div></div>`;
    $$("[data-ln]", el).forEach(n => n.onclick = () => toast("模拟打开：" + ST.launch[+n.dataset.ln].n));
    $("#lpAdd").onclick = () => {
      const n = (prompt("要加什么？填个名字") || "").trim();
      if(!n) return;
      ST.launch.push({n, c:"#6b6960"}); save(); paint(); toast("已加进启动器");
    };
  };

  P.plugin = el => {
    const rows = [["pomo", "番茄钟", "25 分钟专注 + 5 分钟休息，到点弹系统通知"],
                  ["git", "Git 状态", "在侧栏显示当前仓库分支与改动行数"]];
    el.innerHTML = `<div class="hd">扩展<span class="c">${Object.values(ST.plug).filter(Boolean).length} 个已启用</span></div>
      <div class="card">${rows.map(([id, nm, d]) => `<div class="row">
        <div class="tx" style="cursor:default"><b>${nm}</b><div style="font-size:11.5px;color:#96938a">${d}</div></div>
        <div class="sw ${ST.plug[id] ? "on" : ""}" data-pg="${id}"></div></div>`).join("")}
        <div class="hint">真实版本每个扩展是 <b>manifest + iframe 沙箱</b>：崩了不牵连主程序，权限按 manifest 逐项授权。</div></div>`;
    $$("[data-pg]", el).forEach(n => n.onclick = () => {
      const id = n.dataset.pg; ST.plug[id] = !ST.plug[id]; save();
      n.classList.toggle("on", ST.plug[id]);
      const c = el.querySelector(".hd .c");
      if(c) c.textContent = Object.values(ST.plug).filter(Boolean).length + " 个已启用";
      toast((ST.plug[id] ? "已启用 " : "已停用 ") + (id === "pomo" ? "番茄钟" : "Git 状态"));
    });
  };

  P.update = el => {
    el.innerHTML = `<div class="hd">自动更新</div>
      <div class="card">
        <div class="row"><div class="tx" style="cursor:default"><b>当前版本</b>
          <div style="font-size:11.5px;color:#96938a">v0.1.0 · stable 通道</div></div>
          <button class="btn" id="upBtn">检查更新</button></div>
        <div id="upRes" style="font-size:12px;color:#96938a;padding:8px 2px 0"></div>
        <div class="bar" id="upBar" style="display:none"><i></i></div>
        <div class="hint">真实版本：验签 → 比 semver → 下 sha256 校验 → 两步改名自替换，失败回滚。
          清单用 <b>Ed25519</b> 签名，防止有人给你推个假包。</div>
      </div>`;
    $("#upBtn").onclick = () => {
      const b = $("#upBtn"), r = $("#upRes"), bar = $("#upBar");
      b.disabled = true; b.textContent = "检查中…"; bar.style.display = "block";
      bar.firstElementChild.style.width = "40%";
      r.textContent = "正在拉清单…";
      setTimeout(() => {
        bar.firstElementChild.style.width = "100%";
        r.textContent = "已是最新：v0.1.0（清单签名校验通过）";
        b.textContent = "检查更新"; b.disabled = false;
        setTimeout(() => { bar.style.display = "none"; bar.firstElementChild.style.width = "0"; }, 700);
      }, 1200);
    };
  };

  P.sync = el => {
    el.innerHTML = `<div class="hd">多端同步</div>
      <div class="card">
        <div class="row"><div class="tx" style="cursor:default"><b>开启同步</b>
          <div style="font-size:11.5px;color:#96938a">本机加密后再上传，服务器只见密文</div></div>
          <div class="sw ${ST.syncOn ? "on" : ""}" id="sySw"></div></div>
        <div class="row"><div class="tx" style="cursor:default"><b>上次同步</b>
          <div style="font-size:11.5px;color:#96938a">${esc(ST.syncAt)}</div></div>
          <button class="btn" id="syGo">立即同步</button></div>
        <div class="bar" id="syBar"><i></i></div>
        <div class="hint">真实版本要做三件事：设备配对、冲突合并（不是简单覆盖）、墓碑删除（删掉的东西不能在另一台复活）。</div>
      </div>`;
    $("#sySw").onclick = () => {
      ST.syncOn = !ST.syncOn; save();
      $("#sySw").classList.toggle("on", ST.syncOn);
      toast(ST.syncOn ? "同步已开启（模拟）" : "同步已关闭");
    };
    $("#syGo").onclick = () => {
      if(!ST.syncOn){ toast("先打开上面的开关"); return; }
      const b = $("#syGo"), bar = $("#syBar");
      b.disabled = true; b.textContent = "同步中…"; bar.firstElementChild.style.width = "60%";
      setTimeout(() => {
        bar.firstElementChild.style.width = "100%";
        ST.syncAt = ts() + " · 3 项变更"; save();
        b.textContent = "立即同步"; b.disabled = false;
        paint(); toast("已同步 3 项变更（模拟）");
      }, 1100);
    };
  };

  P.data = el => {
    const bytes = (() => { try { return new Blob([JSON.stringify(ST)]).size; } catch(e){ return 0; } })();
    el.innerHTML = `<div class="hd">本地数据仓<span class="c">中台的一切都落在这儿</span></div>
      <div class="stats">
        <div class="st"><b>${ST.todo.length}</b><span>待办</span></div>
        <div class="st"><b>${ST.note.length}</b><span>速记</span></div>
        <div class="st"><b>${ST.clip.length}</b><span>剪贴板</span></div>
        <div class="st"><b>${(bytes / 1024).toFixed(1)} KB</b><span>占用</span></div>
      </div>
      <div class="card">
        <div style="display:flex;gap:9px;align-items:center">
          <button class="btn p" id="dtExp">导出全部数据</button>
          <button class="btn" id="dtReset">清空并恢复示例</button>
        </div>
        <div class="hint">模拟版把数据塞在浏览器的 <b>localStorage</b> 里（每套装配一个键，<code>moshan.trial.v2:*</code>），
          上限几 MB。真实版本是 <b>SQLite 单文件 + WAL</b>：零运维、整库能拷走、备份就是一个 zip。<br>
          选中方案：${esc((D.mods.find(m => m.id === "data") || {}).prov ? D.mods.find(m => m.id === "data").prov.n : "—")}</div>
      </div>`;
    $("#dtExp").onclick = () => {
      try {
        const blob = new Blob([JSON.stringify(ST, null, 2)], {type:"application/json"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "中台数据.json"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast("已导出 中台数据.json");
      } catch(e){ toast("这个环境不让下载，独立打开 index.html 再试"); }
    };
    $("#dtReset").onclick = () => { ST = seed(); ST.tab = "data"; save(); paint(); toast("已恢复示例数据"); };
  };

  function syncNav(){
    $$("#nav [data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === ST.tab));
  }
  function paint(){
    const el = $("#main");
    el.scrollTop = 0;
    (P[ST.tab] || P.data)(el);
  }

  /* 外壳 */
  document.body.innerHTML = `<div id="app">
    <div class="hdr">
      <div class="dots"><i></i><i></i><i></i></div>
      <div class="ttl">${esc(D.name)}</div>
      <span class="badge hide">${esc(D.formNm || D.style)}</span>
      <span class="badge hide">${esc((D.platNm || []).join(" / "))}</span>
      ${D.min ? `<span class="badge sim">最小包</span>` : ""}
      <span class="badge sim">模拟</span>
      <div style="flex:1"></div>
      <span class="badge hide">${D.mods.length} 个模块 · ${D.cells.length} 格${D.mem ? " · " + (D.mem.total / 1024).toFixed(1) + " GB" : ""}</span>
    </div>
    <div class="bwrap">
      <div class="nav" id="nav"><div class="g">模块</div></div>
      <main id="main"></main>
    </div>
    <div class="ftr"><span>${D.min ? "最小包：只装了地基，其余在「模块商店」里" : "模拟运行 · 数据存在本浏览器"}</span>
      <div style="flex:1"></div><span>${esc(D.formNm || "")} · 装配于 ${esc(D.at)}</span></div>
  </div>`;
  $("#nav").innerHTML += tabs.map(([id, nm]) =>
    `<button data-tab="${id}" class="${ST.tab === id ? "on" : ""}">${nm}</button>`).join("");
  $$("#nav [data-tab]").forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; save(); syncNav(); paint(); });
  paint();

  /* Ctrl+K 直接进搜索 */
  document.addEventListener("keydown", e => {
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && have("search")){
      e.preventDefault(); ST.tab = "search"; save(); syncNav(); paint();
    }
  });
}

/** 拼成一份完整、能独立打开的 HTML（试用页 srcdoc 与 zip 里的 index.html 是同一份） */
export function protoDoc(hub) {
  const data = protoData(hub);
  // < 转义：内容里有「</script>」会提前结束脚本
  const js = JSON.stringify(data).replace(/</g, "\\u003c");
  const name = String(data.name).replace(/[<>&"]/g, "");
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} · 模拟试用</title>
<style>${protoCSS()}</style></head>
<body>
<script>(${protoRuntime.toString()})(${js});<\/script>
</body></html>`;
}
