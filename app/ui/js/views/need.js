// views/need.js —— 一句话需求：不挑场景，直接说要做什么，把它拆成能力格。
//
// 解析结果是**当场摊开给人看**的，不是转一圈再显示：命中了哪些格、每格凭什么命中、
// 哪几格有现成模块、哪几格没有——后面七十条都要靠这张表核对，藏起来就没法核对。
//
// 库里的模块只覆盖 160 格中的 93 格，所以「有 3 格要自己写」是常态。
// 这一页的责任就是把这件事提前说清，而不是等人装完在交付页才发现。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, secttl, toast } from "../components.js";
import { matchNeed, needHub, modulesFor } from "../lib/need.js";
import { hubMod, hubCells, packOf } from "../lib/hub.js";
import { CELL_BY_ID } from "../lib/wire.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

const EG = [
  ["拍照记账", "拍一张小票照片，自动识别金额和商品名，记到账本里，按月出统计图表，还能问这个月买菜花了多少"],
  ["生活助手", "我想做个个人生活助手，记录每天的饮食、睡眠和心情，到点提醒我喝水睡觉，每周给我一份总结"],
  ["仓库管理", "公司仓库管理：商品库存入库出库，扫码枪扫条码，库存低于阈值自动提醒补货，每月出报表，同事各自登录有权限"],
  ["行业研究", "我们做行业研究，要收集研报、公告和新闻，建成知识库能问答，自动写出带引用的行业分析报告，团队共享"],
  ["内部知识库", "公司要做个内部知识库问答，把产品手册、售后工单和培训视频都灌进去，客服能直接问，答不出来转人工"],
  ["温湿度计", "做个室内蓝牙 wifi 温湿度计，墨水屏显示温湿度，电池供电，能连手机看历史曲线"],
];

export function viewNeed() {
  let draft = S.need || "";
  let result = null; // { r, mods, missed }

  const ta = h("textarea.askta", {
    placeholder: "例：拍一张小票照片，自动识别金额，记到账本里，按月出统计",
    rows: "4",
    spellcheck: "false",
  });
  ta.value = draft;

  const out = h("div.askout");

  const run = () => {
    const q = ta.value.trim();
    if (!q) {
      ta.focus();
      toast("先写一句需求", 1400);
      return;
    }
    const r = matchNeed(q);
    const cells = [...r.core, ...r.rec];
    const { mods, missed } = modulesFor(cells);
    result = { q, r, mods, missed, cells };
    set({ need: q });
    paint();
  };

  const chip = (txt, tone) => h("span.badge" + (tone ? "." + tone : ""), null, txt);

  function paint() {
    if (!result) {
      out.replaceChildren(
        h(
          "div.askhint",
          null,
          icon("spark", { size: 14 }),
          h(
            "span",
            null,
            "解析走关键词，不是大模型——所以每一格都能说清「凭什么加进来」，",
            "也不会因为换个说法就多花一次 token。说法太偏（方言、内部叫法）会匹配不上，换个说法再试。"
          )
        )
      );
      return;
    }

    const { r, mods, missed, cells } = result;
    const modNames = mods.map((id) => hubMod(id)).filter(Boolean);
    const owned = new Set(mods.flatMap((id) => (hubMod(id) || {}).cells || []));
    const covered = cells.filter((c) => owned.has(c));
    const gaps = r.gaps || [];

    const why = (cid) => ((r.why || {})[cid] || []).join("；") || "依赖带进来的";

    const row = (cid, tone) => {
      const c = CELL_BY_ID[cid] || {};
      const has = owned.has(cid);
      return h(
        "div.cellrow",
        { "data-tone": has ? tone : "miss" },
        h("b", null, c.name || cid),
        h(
          "i",
          null,
          has
            ? why(cid)
            : /* 没模块的格重复同一句「库里还没有」没有信息量，改成说清它的接口约定：
                 有约定 = 知道该写什么；连约定都没有才是真空白 */
              [c.ins ? `收 ${c.ins}` : "", c.outs ? `出 ${c.outs}` : ""].filter(Boolean).join(" · ") ||
              "库里还没有模块覆盖这一格"
        ),
        h("span.tag", null, has ? "有模块" : "要自己写")
      );
    };

    out.replaceChildren(
      h(
        "div",
        null,
        h(
          "div.askhead",
          null,
          h("b", null, "解析结果"),
          h("span", null, `命中 ${cells.length} 格 · ${modNames.length} 个模块`),
          (r.scen || []).length ? h("span.scen", null, "识别到：" + r.scen.join(" / ")) : null,
          Object.keys(r.prefs || {}).length
            ? h("span.scen", null, "约束：" + Object.values(r.prefs).flat().join(" / "))
            : null
        ),

        /* 一句话结论：这三句决定要不要往下走 */
        h(
          "div.asksum",
          null,
          h(
            "div.sm",
            null,
            h("b", null, String(covered.length)),
            h("span", null, "格能直接装配")
          ),
          h(
            "div.sm",
            { "data-tone": missed.length ? "warn" : null },
            h("b", null, String(missed.length)),
            h("span", null, missed.length ? "格要自己写" : "格要自己写")
          ),
          h("div.sm", { "data-tone": gaps.length ? "warn" : null }, h("b", null, String(gaps.length)), h("span", null, "项在库外")),
          h("div.sm", null, h("b", null, String(modNames.length)), h("span", null, "个模块要装"))
        ),

        /* 有模块的：按施工顺序摊出来，每行说清凭什么 */
        h("div.asksec", null, secttl("① 能直接装的格", `${covered.length} 格 · 每格都说明白为什么`)),
        h(
          "div.celllist",
          null,
          covered.map((cid) => row(cid, "ok"))
        ),

        /* 没模块的：这一块是这一页最该说清的地方 */
        missed.length
          ? h(
              "div.asksec",
              null,
              secttl("② 库里还没模块的格", `${missed.length} 格 · 要自己写，或在库外找`),
              h(
                "div.celllist",
                null,
                missed.map((cid) => row(cid, "miss"))
              ),
              h(
                "p.t-12.faint",
                { style: { marginTop: "var(--sp-2)" } },
                "这些格在图上是存在的（有输入输出约定），只是还没有哪个模块认领它。",
                "装配时会跳过它们——交付页与导出清单里会把它们单独列出来，不会悄悄消失。"
              )
            )
          : null,

        /* 库外部分：连格都没有的能力 */
        gaps.length
          ? h(
              "div.asksec",
              null,
              secttl("③ 库外的部分", `${gaps.length} 项 · 不进装配，但要知道`),
              h(
                "div.gaplist",
                null,
                gaps.map((g) =>
                  h("div.gapbox", null, h("b", null, g.name), h("span", null, g.how))
                )
              )
            )
          : null,

        /* 组合预览：装哪几个模块、落在哪些包 */
        h("div.asksec", null, secttl("④ 会装哪几个模块", `${modNames.length} 个 · ${new Set(modNames.flatMap((m) => m.pks || [])).size} 个包`)),
        h(
          "div.modlist",
          null,
          modNames.map((m) => {
            const el = h(
              "div.mrow",
              null,
              h("span.dot"),
              h("b", null, m.nm),
              h("span", null, (m.cells || []).filter((c) => owned.has(c)).length + " 格"),
              h("i", null, (m.pks || []).map((p) => packOf(p).nm).slice(0, 2).join(" / "))
            );
            el.style.setProperty("--h", packOf((m.pks || ["core"])[0]).hue);
            return el;
          })
        ),

        h(
          "div.askfoot",
          null,
          h(
            "button.btn.btn--ghost",
            { onclick: () => { result = null; paint(); ta.focus(); } },
            icon("arrow-left", { size: 14 }),
            h("span", null, "改一改再解析")
          ),
          h(
            "button.btn.btn--primary",
            {
              disabled: !modNames.length || undefined,
              onclick: () => {
                if (!modNames.length) return;
                const { hub } = needHub(result.q);
                /* 没模块的格要跟着 hub 走：交付页、清单、README 都要能把它们点名，
                   否则「装配时会跳过」就成了只在嘴上说的一句话。 */
                set({ hub: { ...hub, needMiss: result.missed } });
                go("style");
              },
            },
            h("span", null, "按这 " + modNames.length + " 个模块装"),
            icon("arrow-right", { size: 14 })
          )
        )
      )
    );
  }

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  });

  paint();

  return h(
    "div.wrap",
    null,
    h(
      "div.askgrid",
      null,
      h(
        "div.askwrap",
        null,
        h("h1", null, "你要做个什么？"),
        h(
          "p.prose",
          null,
          "用大白话写。说清「拿什么进来、变成什么出去、什么时候发生」就够，不用写技术栈。"
        ),
        ta,
        h(
          "div.chips",
          null,
          EG.map(([label, text]) =>
            h(
              "button.chip",
              {
                onclick: () => {
                  ta.value = text;
                  ta.focus();
                },
              },
              h("span", null, label)
            )
          )
        ),
        h(
          "div.askbtns",
          null,
          h("button.btn.btn--primary", { onclick: run }, icon("spark", { size: 14 }), h("span", null, "开始解析")),
          h("button.btn.btn--ghost", { onclick: () => { ta.value = ""; ta.focus(); } }, h("span", null, "清空")),
          h("span.t-12.faint", null, "⌘ / Ctrl + Enter 也可以")
        )
      ),

      h(
        "aside.asktips",
        null,
        h("b", null, "写不好的三种情况"),
        h("div.tp", null, h("em", null, "太短"), h("span", null, "「做个记账软件」——不知道输入是什么，会出现 0 格。")),
        h("div.tp", null, h("em", null, "太杂"), h("span", null, "一句话塞五个系统，会多勾出不相干的格子。")),
        h("div.tp", null, h("em", null, "太术语"), h("span", null, "「要 RAG、要 Agent」——那是选型阶段的事，这里只要说清要干什么。")),
        h(
          "div.tpnote",
          null,
          "解析只在本地跑：需求文本不会发到任何地方，也存不进草稿以外的文件。"
        )
      )
    ),

    out
  );
}
