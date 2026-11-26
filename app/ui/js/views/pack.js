// views/pack.js —— 打包带走：包里有什么、装的时候会被什么拦住、按下去真的能存。
//
// 文件不是「现场拼的」，而是 lib/pack.js 出的那一份——和试用页 iframe 里跑的
// 是同一份 HTML。所以这一页列出来的大小、条数都是真的，不是写死的文案。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, secttl, steps, toast } from "../components.js";
import { STEP_NAMES, sceneById, hubCells, formDef, platOf, mbTxt, PLATS } from "../lib/hub.js";
import { check, cellName } from "../lib/wire.js";
import { packFiles, installNotes, minMods } from "../lib/pack.js";
import { sizeTxt } from "../lib/zip.js";
import { saveFile } from "../lib/bridge.js";
import { openExportMd } from "../lib/exportMd.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

const ALL_DONE = STEP_NAMES.length;

export function viewPack() {
  const hub = S.hub;
  if (!hub || !hub.mods || !hub.mods.length) {
    return h(
      "div.wrap",
      null,
      pagehd({ title: "还没有能打包的东西", lead: "先装配一套出来，这里才有东西可打。" }),
      h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "去挑场景"))
    );
  }

  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const r = check(picks, hub.form);
  const plats = platOf(hub);
  const notes = installNotes(hub.form, plats);
  const pack = packFiles(hub);
  /* 另一档也算一份：这一页要说清「最小包到底省了多少」，
     不给对照就只能写一句「更小」，而那是不诚实的——它其实只省 2KB。 */
  const alt = packFiles({ ...hub, min: !hub.min });
  const cur = pack; // 「当前这一档」的别名：下文和 alt 对照时读起来顺一点
  /* 页面上的数字一律取 pack 里那份「有效数据」：开了最小包就按地基算 */
  const memo = pack.memo;
  const effMods = pack.data.mods.length;
  const effCells = pack.data.cells.length;
  const effLines = pack.data.lines;
  const minKeep = minMods(hub).length;
  const enc = new TextEncoder();
  const bytesOf = (s) => (typeof s === "string" ? enc.encode(s).length : s.length);

  const stat = (label, value, note) =>
    h("div.rcell", null, h("span", null, label), h("b", null, value), h("i", null, note));

  const save = async (name, data) => {
    const where = await saveFile(name, data);
    if (!where) toast("没能保存，换个浏览器或检查下载权限", 2600);
    else if (where === name) toast(`已下载 ${name}`, 1800);
    else toast(`已存到 ${where}`, 3000);
  };

  return h(
    "div.wrap",
    null,
    steps(STEP_NAMES, ALL_DONE),

    pagehd({
      title: "打包带走",
      lead: `包里是 ${pack.files.length} 个文件：一份能直接双击打开的试用版、模块清单、README、安装说明${
        pack.files.some((f) => f.name === "modules.json") ? "、商店清单" : ""
      }。全是普通文本，没有安装脚本，解开就是文件夹。`,
      right: h("span.badge.ok", null, pack.sizeTxt),
    }),

    /* ① 包里有什么 */
    secttl("① 包里有什么", `${pack.files.length} 个文件 · 解开约 ${pack.sizeTxt} · ${effMods} 个模块`),
    h(
      "div.packlist",
      null,
      pack.files.map((f) =>
        h(
          "div.row",
          null,
          h("b", null, f.name),
          h("span", null, f.why),
          h("em", null, sizeTxt(bytesOf(f.data)))
        )
      )
    ),

    /* ② 打多大 —— 这一块的重点不是开关，是把「省在哪、没省在哪」说清 */
    secttl("② 打多大", "最小包省的是内存，不是磁盘"),
    h(
      "div.minbox" + (hub.min ? ".on" : ""),
      null,
      h("button.switch" + (hub.min ? ".on" : ""), {
        role: "switch",
        "aria-checked": hub.min ? "true" : "false",
        "aria-label": "最小打包",
        onclick: () => {
          set({ hub: { ...S.hub, min: !S.hub.min } });
          go("pack");
        },
      }),
      h(
        "div",
        null,
        h("b", null, "最小打包"),
        h(
          "p.t-12.faint",
          null,
          `只带地基模块（core 里必装的那几块 + 扩展系统，共 ${minKeep} 个），其余 ${hub.mods.length - minKeep} 个进商店按需下。`,
          h("b", null, "模块商店入口强制保留"),
          "——最小包要是连下载入口都没有，以后就再也加不上东西了。"
        ),
        h(
          "p.t-12.minfact",
          null,
          hub.min
            ? `磁盘 ${alt.sizeTxt} → ${cur.sizeTxt}，几乎没变（原型主要是运行时，砍模块省不出多少）；真正省下来的是内存：${mbTxt(alt.memo.total)} → ${mbTxt(cur.memo.total)}。`
            : `开了它：磁盘 ${cur.sizeTxt} → ${alt.sizeTxt}（省不出多少，原型是代码不是数据），内存 ${mbTxt(cur.memo.total)} → ${mbTxt(alt.memo.total)}。`
        )
      ),
      h("span.badge" + (hub.min ? ".ok" : ".mute"), null, hub.min ? "只发地基" : "全量")
    ),

    /* ③ 装的时候会被什么拦住 */
    secttl(
      "③ 装的时候会被什么拦住",
      `${formDef(hub.form).nm} · ${plats.map((p) => (PLATS.find((x) => x.id === p) || {}).nm).filter(Boolean).join(" / ") || "—"}`
    ),
    h(
      "div.inst",
      null,
      notes.map((n) =>
        h(
          "div.icard",
          null,
          h(
            "div.ih",
            null,
            h("b", null, n.pl),
            h("span.badge.mute", null, hub.form === "web" ? "免安装" : hub.form === "cli" ? "命令行" : "安装包")
          ),
          n.items.map((it) =>
            h("div.irow", null, h("em", null, it.ty), h("div", { html: it.body }))
          )
        )
      )
    ),
    h(
      "p.hintline",
      null,
      "一句话：",
      h("b", null, "被拦住的从来不是「你的程序不好」，是「系统不认识它」"),
      "。要么买证书让它认识你，要么发源码让用户自己编——后者零成本，而且用户能看到每一行。"
    ),

    /* ④ 装完的数字 */
    secttl("④ 装完的数字", "这些会一起写进 manifest.json"),
    h(
      "div.resgrid",
      null,
      stat("运行时外壳", mbTxt(memo.shellMB), "不管装什么都要付的底座"),
      stat("模块与数据", mbTxt(memo.packMB), `${memo.packs.length} 个包 · ${effMods} 个模块`),
      stat(
        "本地模型",
        memo.modelMB ? mbTxt(memo.modelMB) : "—",
        memo.mdl ? `${memo.mdl.nm} · 约 ${memo.mdl.tps} 字/秒` : "未启用"
      ),
      stat("合计", mbTxt(memo.total), memo.ok ? `可用 ${mbTxt(memo.avail)} 之内` : `超出 ${mbTxt(memo.total - memo.avail)}`),
      stat("磁盘", pack.sizeTxt, hub.min ? "最小包（不含模型权重）" : "全量包（不含模型权重）"),
      stat(
        "冷启动",
        memo.modelMB ? (memo.mdl.gb < 2 ? "1 秒内" : "2–5 秒") : "0.5 秒内",
        memo.modelMB ? "要先把权重读进内存" : "没有权重加载"
      )
    ),

    /* ⑤ 一切从哪来 */
    h(
      "div.facts2",
      null,
      h("div.kv", null, h("b", null, "形态 / 规格"), h("span", null, `${formDef(hub.form).nm} · ${sc.nm}`)),
      h("div.kv", null, h("b", null, "平台"), h("span", null, plats.map((p) => (PLATS.find((x) => x.id === p) || {}).nm).filter(Boolean).join(" / ") || "—")),
      h("div.kv", null, h("b", null, "施工首格"), h("span", null, r.order.length ? `${cellName(r.order[0])} · 共 ${effCells} 格` : "—")),
      h("div.kv", null, h("b", null, "连线"), h("span", null, `${effLines} 条 · ${r.breaks.length ? r.breaks.length + " 处断点" : "无断点"}`))
    ),

    h(
      "div.stepnav",
      null,
      h(
        "button.btn.btn--ghost",
        { onclick: () => go("trial") },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：回试用")
      ),
      h(
        "div.btns",
        null,
        h(
          "button.btn.btn--ghost",
          { onclick: () => save("试用版.html", enc.encode(pack.html)) },
          icon("export", { size: 14 }),
          h("span", null, "只要 index.html")
        ),
        h(
          "button.btn.btn--ghost",
          { onclick: () => openExportMd(hub) },
          h("span", null, "导出清单")
        ),
        h(
          "button.btn.btn--ghost",
          {
            onclick: () => {
              set({ hub: null, build: null });
              go("scenes");
            },
          },
          icon("loop", { size: 14 }),
          h("span", null, "再做一个")
        ),
        h(
          "button.btn.btn--primary",
          { onclick: () => save((hub.min ? "moshan-min" : "moshan-hub") + ".zip", pack.bytes) },
          icon("box", { size: 14 }),
          h("span", null, `下载 .zip（${pack.sizeTxt}）`)
        )
      )
    ),

    h(
      "p.t-12.faint",
      { style: { marginTop: "var(--sp-4)" } },
      "这一版是原型：界面、交互、目录结构、安装说明都是真的，" +
        "但包里没有后端——要变成真程序，照着「模块清单.md」的施工顺序逐格落地。"
    )
  );
}
