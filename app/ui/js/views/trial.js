// views/trial.js —— 试用：把它先跑一遍，再决定要不要带走。
//
// 这一页只做一件事：把 lib/proto.js 生成的那份 HTML 塞进 iframe 跑起来。
// 不在这一页里写任何原型逻辑——原型是「带走的那个东西」本身，
// 试用页看到的和 zip 里 index.html 里的必须是同一份，否则试用没有意义。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, steps, toast } from "../components.js";
import { STEP_NAMES, sceneById, hubCells, hubMod, formDef } from "../lib/hub.js";
import { check } from "../lib/wire.js";
import { protoDoc } from "../lib/proto.js";
import { S } from "../store.js";
import { go } from "../router.js";

const ALL_DONE = STEP_NAMES.length;

export function viewTrial() {
  const hub = S.hub;
  if (!hub || !hub.mods || !hub.mods.length) {
    return h(
      "div.wrap",
      null,
      pagehd({ title: "还没有能试的东西", lead: "先把场景、模块、方案走完，这里才有东西可点。" }),
      h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "去挑场景"))
    );
  }

  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const r = check(picks, hub.form);
  const isCli = hub.form === "cli";

  /* 原型只做了「桌面上能点」的面板。硬件与现场类的格子没有面板——
     这不是漏做，是它们本来就没有可点的界面（要通电、要真机、要扫码）。
     但必须说出来：不然用户会以为「试用里没有 = 装的时候没有」。 */
  const bare = hub.mods
    .map((id) => hubMod(id))
    .filter((m) => m && (m.cells || []).length && (m.cells || []).every((c) => /^(hw|site)\./.test(c)));

  /* 不加 sandbox：原型要用 localStorage 记住你点过什么，
     sandbox 不给 allow-same-origin 的话是个 opaque origin，一碰 localStorage 就抛。
     内容是本地生成的（不含用户输入），同源没有额外风险。 */
  const frame = h("iframe.trialbox", { title: "试用原型" });

  /* 每次进页面重算一次文档：装配改过之后，这里必须是新的那份 */
  const mount = () => {
    frame.srcdoc = protoDoc(hub);
  };
  // srcdoc 要等节点进 DOM 之后再塞，否则 Safari 偶尔不重载
  requestAnimationFrame(mount);

  const reset = () => {
    /* 试用数据按装配分桶（键里带 sig），所以清的时候按前缀整族清，
       否则换了形态再试，里面还留着上一版的待办。 */
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("moshan.trial") === 0) kill.push(k);
      }
      kill.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* 某些 WebView 隐私模式下 localStorage 会抛，忽略即可：重置不了就重开一遍 */
    }
    mount();
    toast("试用数据已重置", 1500);
  };

  return h(
    "div.wrap",
    null,
    steps(STEP_NAMES, ALL_DONE),

    pagehd({
      title: "先试用一下",
      lead: `这是按你选的 ${hub.mods.length} 个模块拼出来的东西（${formDef(hub.form).nm}形态）。${
        isCli
          ? "输入 help 看有哪些命令——命令是真的会改数据。"
          : "点一遍：加条待办、记条笔记、搜一下、跟 AI 说句话。"
      } 数据只活在这一页里，随便折腾。`,
      right: badge("模拟 · 不接真后端", "mute"),
    }),

    h(
      "div.trialbar",
      null,
      h("span.badge.ok", null, `${hub.mods.length} 个模块`),
      h("span.badge.mute", null, `${picks.length} 格`),
      h("span.badge.mute", null, `${r.lines} 条连线`),
      hub.min ? badge("最小包 · 其余在商店里", "brass") : null,
      h("i.sp"),
      h("button.btn.btn--ghost", { onclick: reset }, icon("loop", { size: 13 }), h("span", null, "重置试用数据")),
      h(
        "button.btn",
        { onclick: () => go("pack") },
        h("span", null, "没问题，打包"),
        icon("arrow-right", { size: 14 })
      )
    ),

    frame,

    bare.length
      ? h(
          "p.t-12.faint.trialnote",
          null,
          `另有 ${bare.length} 个模块没有面板（${bare.slice(0, 4).map((m) => m.nm).join("、")}${bare.length > 4 ? " 等" : ""}）：`,
          "它们要通电、要真机、要扫码，原型里只留了接口约定与接线方式，交互在真机上才有意义。"
        )
      : null,

    h(
      "p.t-12.faint.trialnote",
      null,
      isCli
        ? "终端里的命令是真的会改数据的：todo add 之后 exit 再进，那条还在。"
        : `左侧只列你装了、而且原型做了面板的模块（${sc.nm} 场景）。没装的在「模块商店」里——那是扩展系统的入口。`
    ),

    h(
      "div.stepnav",
      null,
      h(
        "button.btn.btn--ghost",
        { onclick: () => go("done") },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：回交付")
      ),
      h(
        "div.btns",
        null,
        h(
          "button.btn",
          { onclick: () => go("pack") },
          h("span", null, "打包带走"),
          icon("arrow-right", { size: 14 })
        )
      )
    )
  );
}
