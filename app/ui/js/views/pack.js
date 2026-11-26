// views/pack.js —— 打包带走：包里有什么、装的时候会被什么拦住、按下去真的能存。
//
// 文件不在此处拼接，而由 lib/pack.js 生成——与试用页 iframe 中运行的是同一份 HTML。
// 因此本页列出的大小与条数均为真实值，不是固定文案。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, secttl, steps, toast } from "../components.js";
import { STEP_NAMES, sceneById, hubCells, formDef, platOf, mbTxt, hubLabel, PLATS } from "../lib/hub.js";
import { check, cellName } from "../lib/wire.js";
import { packFiles, installNotes, minMods } from "../lib/pack.js";
import { hubEst, hrsTxt, tkTxt, costTxt, costOf, rateOf, HAND } from "../lib/estimate.js";
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
      pagehd({ title: "还没有可打包的内容", lead: "先完成一次装配，这里才会有产物。" }),
      h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "选择场景"))
    );
  }

  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const r = check(picks, hub.form);
  const plats = platOf(hub);
  const notes = installNotes(hub.form, plats);
  const pack = packFiles(hub, S.rate);
  /* 估算跟着「有效那份」走：开了最小包就按地基模块算，
     否则页面上模块数是 4、工时却按 21 个算，两套账 */
  const est = hubEst(hub.min ? { ...hub, mods: minMods(hub) } : hub);
  /* 另一档同时计算：本页需要给出最小包的实际节省量，
     缺少对照只能写「更小」，而磁盘占用实际差异很小。 */
  const alt = packFiles({ ...hub, min: !hub.min }, S.rate);
  const cur = pack; // 当前档位的别名，下文与 alt 对照时使用
  /* 页面数字一律取 pack 中的有效数据：启用最小包时按地基计算 */
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
    if (!where) toast("保存失败，请更换浏览器或检查下载权限", 2600);
    else if (where === name) toast(`已下载 ${name}`, 1800);
    else toast(`已存到 ${where}`, 3000);
  };

  return h(
    "div.wrap",
    null,
    steps(STEP_NAMES, ALL_DONE),

    pagehd({
      title: "打包与交付",
      lead: `包内共 ${pack.files.length} 个文件：可直接打开的试用版、模块清单、README、安装说明${
        pack.files.some((f) => f.name === "modules.json") ? "、商店清单" : ""
      }。均为纯文本，无安装脚本，解压后即为文件夹。`,
      right: h("span.badge.ok", null, pack.sizeTxt),
    }),

    /* ① 包里有什么 */
    secttl("① 包内文件", `${pack.files.length} 个文件 · 解压约 ${pack.sizeTxt} · ${effMods} 个模块`),
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
    secttl("② 体积与取舍", "最小包主要节省内存，磁盘差异很小"),
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
          `仅含地基模块（必装模块与扩展系统，共 ${minKeep} 个），其余 ${hub.mods.length - minKeep} 个由模块商店按需安装。`,
          h("b", null, "模块商店入口必须保留"),
          "：缺少下载入口后将无法再安装新模块。"
        ),
        h(
          "p.t-12.minfact",
          null,
          hub.min
            ? `磁盘 ${alt.sizeTxt} → ${cur.sizeTxt}，差异很小（体积主要来自运行时）；内存 ${mbTxt(alt.memo.total)} → ${mbTxt(cur.memo.total)}。`
            : `启用后：磁盘 ${cur.sizeTxt} → ${alt.sizeTxt}（体积主要来自运行时，模块占比很小），内存 ${mbTxt(cur.memo.total)} → ${mbTxt(alt.memo.total)}。`
        )
      ),
      h("span.badge" + (hub.min ? ".ok" : ".mute"), null, hub.min ? "只发地基" : "全量")
    ),

    /* ③ 装的时候会被什么拦住 */
    secttl(
      "③ 安装会被什么拦截",
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
      "原因：",
      h("b", null, "拦截来自系统无法验证发行者，而非程序本身"),
      "。可选购买代码签名证书，或发布源码由用户自行编译：后者零成本，且用户可审阅全部代码。"
    ),

    /* ④ 装完的数字 */
    secttl("④ 运行占用", "这些数值会写入 manifest.json"),
    h(
      "div.resgrid",
      null,
      stat("运行时外壳", mbTxt(memo.shellMB), "固定底座开销"),
      stat("模块与数据", mbTxt(memo.packMB), `${memo.packs.length} 个包 · ${effMods} 个模块`),
      stat(
        "本地模型",
        memo.modelMB ? mbTxt(memo.modelMB) : "—",
        memo.model ? `${memo.model.nm} · 约 ${memo.model.tps} 字/秒` : "未启用"
      ),
      stat("合计", mbTxt(memo.total), memo.ok ? `可用 ${mbTxt(memo.avail)} 之内` : `超出 ${mbTxt(memo.total - memo.avail)}`),
      stat("磁盘", pack.sizeTxt, hub.min ? "最小包（不含模型权重）" : "全量包（不含模型权重）"),
      stat(
        "冷启动",
        memo.modelMB ? (memo.model.gb < 2 ? "1 秒内" : "2–5 秒") : "0.5 秒内",
        memo.modelMB ? "要先把权重读进内存" : "没有权重加载"
      )
    ),

    /* ⑤ 工作量：与确认页同一份算法，这里只给结论，细节回确认页看 */
    est
      ? h(
          "div",
          null,
          secttl("⑤ 工作量与费用", `已写入 manifest.json · ${rateOf(S.rate).nm}价`),
          h(
            "div.resgrid.est3",
            null,
            stat("手写", hrsTxt(est.total.hours), "高级程序员从零实现"),
            stat("AI 辅助", hrsTxt(est.total.hours / HAND), "同等工作量，含调试"),
            stat("生成 token", tkTxt(est.total.tk), `折 ${costTxt(costOf(est.total.tk, S.rate))}`)
          )
        )
      : null,

    /* ⑤ 数据来源 */
    h(
      "div.facts2",
      null,
      h("div.kv", null, h("b", null, "形态 / 规格"), h("span", null, `${formDef(hub.form).nm} · ${hubLabel(hub)}`)),
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
        h("span", null, "上一步：试用")
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
      "本版为原型：界面、交互、目录结构与安装说明均为真实产物，但不含后端。" +
        "要成为可运行程序，按「模块清单.md」的施工顺序逐格实现。"
    )
  );
}
