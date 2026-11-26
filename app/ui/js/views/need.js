// views/need.js —— 一句话需求：不挑场景，直接说要做什么，把它拆成能力格。
//
// 解析结果当场展开：命中哪些格、每格依据什么命中、哪几格有现成模块、哪几格没有。
// 后续七十余条都以这张表为准，隐藏起来无法核对。
//
// 模块库覆盖 160 格中的 93 格，因此「有若干格需自行实现」属常态，
// 本页负责提前说明，而非等到交付页才暴露。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, secttl, toast } from "../components.js";
import { hubEst, hrsTxt, tkTxt, costTxt, costOf, rateOf } from "../lib/estimate.js";
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
      toast("请先填写需求", 1400);
      return;
    }
    const r = matchNeed(q);
    const cells = [...r.core, ...r.rec];
    const { mods, missed } = modulesFor(cells);
    result = { q, r, mods, missed, cells };
    set({ need: q });
    paint();
  };

  /** 按当前命中估算总量级：模块走默认实现，胶水与底座按全量计 */
  const askEst = (ms) => {
    const e = hubEst({ mods: ms.map((m) => m.id), plans: {}, glue: {}, base: {} });
    if (!e) return null;
    return h(
      "div.askest",
      null,
      h("span", null, "按此装配：手写约"),
      h("b", null, hrsTxt(e.total.hours)),
      h("span", null, "· 生成"),
      h("b", null, `${tkTxt(e.total.tk)} token`),
      h("span", null, ` · ${costTxt(costOf(e.total.tk, S.rate))}（${rateOf(S.rate).nm}价）`)
    );
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
            "解析基于关键词匹配，不使用大模型：每一格都能说明命中依据，也不产生额外调用成本。",
            "方言或内部叫法可能无法匹配，可换一种表述再试。"
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
            : /* 无模块的格重复「库里没有」没有信息量，改为给出接口约定：
                 有约定即可判断该实现什么；无约定才是真正空白 */
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

        /* 结论先行：这几项决定是否继续 */
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
            h("span", null, "格要自己写")
          ),
          h("div.sm", { "data-tone": gaps.length ? "warn" : null }, h("b", null, String(gaps.length)), h("span", null, "项在库外")),
          h("div.sm", null, h("b", null, String(modNames.length)), h("span", null, "个模块要装"))
        ),

        /* 命中结果的总量级：决定「这个方向值不值得继续」 */
        askEst(modNames),

        /* 有模块的格按施工顺序展开，逐行给出依据 */
        h("div.asksec", null, secttl("① 可直接装配的格", `${covered.length} 格 · 每格附命中依据`)),
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
              secttl("② 库中暂无模块的格", `${missed.length} 格 · 需自行实现或在库外寻找`),
              h(
                "div.celllist",
                null,
                missed.map((cid) => row(cid, "miss"))
              ),
              h(
                "p.t-12.faint",
                { style: { marginTop: "var(--sp-2)" } },
                "这些格在图中存在（已有输入输出约定），只是尚无模块认领。",
                "装配时会跳过，并在交付页与导出清单中单独列出。"
              )
            )
          : null,

        /* 库外部分：连格都没有的能力 */
        gaps.length
          ? h(
              "div.asksec",
              null,
              secttl("③ 库外部分", `${gaps.length} 项 · 不进入装配，但需知悉`),
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
        h("div.asksec", null, secttl("④ 将装配的模块", `${modNames.length} 个 · ${new Set(modNames.flatMap((m) => m.pks || [])).size} 个包`)),
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
            h("span", null, "修改后重新解析")
          ),
          h(
            "button.btn.btn--primary",
            {
              disabled: !modNames.length || undefined,
              onclick: () => {
                if (!modNames.length) return;
                const { hub } = needHub(result.q);
                /* 无模块的格需要随 hub 传递：交付页、清单与 README 都要逐一列出，
                   否则「装配时跳过」只停留在说明层面。 */
                set({ hub: { ...hub, needMiss: result.missed } });
                go("style");
              },
            },
            h("span", null, `按这 ${modNames.length} 个模块装配`),
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
        h("h1", null, "要做什么？"),
        h(
          "p.prose",
          null,
          "用日常语言描述即可：说明输入是什么、输出是什么、何时触发，无需写技术栈。"
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
          h("button.btn.btn--primary", { onclick: run }, icon("spark", { size: 14 }), h("span", null, "解析需求")),
          h("button.btn.btn--ghost", { onclick: () => { ta.value = ""; ta.focus(); } }, h("span", null, "清空")),
          h("span.t-12.faint", null, "⌘ / Ctrl + Enter 同样可执行")
        )
      ),

      h(
        "aside.asktips",
        null,
        h("b", null, "三种常见问题"),
        h("div.tp", null, h("em", null, "太短"), h("span", null, "如「做个记账软件」：无法判断输入，解析结果为 0 格。")),
        h("div.tp", null, h("em", null, "太杂"), h("span", null, "一句话包含五个系统，会引入不相关的能力格。")),
        h("div.tp", null, h("em", null, "太术语"), h("span", null, "如「要 RAG、要 Agent」：属选型阶段内容，此处只需说明用途。")),
        h(
          "div.tpnote",
          null,
          "解析在本地完成：需求文本不会外发，也不会写入除草稿之外的文件。"
        )
      )
    ),

    out
  );
}
