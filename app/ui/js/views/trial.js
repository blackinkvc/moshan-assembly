// views/trial.js —— 试用：把它先跑一遍，再决定要不要带走。
//
// 本页只做一件事：把 lib/proto.js 生成的 HTML 放入 iframe 运行。
// 原型逻辑不写在这里——原型就是交付物本身，
// 试用页所见与 zip 中 index.html 必须是同一份，否则试用失去意义。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, pagehd, steps, toast } from "../components.js";
import { STEP_NAMES, sceneById, hubCells, hubMod, formDef, isCustomScene } from "../lib/hub.js";
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
      pagehd({ title: "还没有可试用的内容", lead: "先完成场景、模块与方案的选择，这里才会有原型。" }),
      h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "选择场景"))
    );
  }

  const sc = sceneById(hub.scene);
  const picks = hubCells(hub.mods);
  const r = check(picks, hub.form);
  const isCli = hub.form === "cli";

  /* 原型只包含桌面端可交互面板。硬件与现场类格子没有面板，
     它们需要通电、真机或扫码，本身不存在可点界面。
     这一点必须写明，否则会被误认为装配时也缺失。 */
  const bare = hub.mods
    .map((id) => hubMod(id))
    .filter((m) => m && (m.cells || []).length && (m.cells || []).every((c) => /^(hw|site)\./.test(c)));

  /* 不加 sandbox：原型需要用 localStorage 记录操作，
     未给 allow-same-origin 时属 opaque origin，访问 localStorage 会抛异常。
     内容为本地生成（不含用户输入），同源不引入额外风险。 */
  const frame = h("iframe.trialbox", { title: "试用原型" });

  /* 每次进页面重算一次文档：装配改过之后，这里必须是新的那份 */
  const mount = () => {
    frame.srcdoc = protoDoc(hub);
  };
  // srcdoc 要等节点进 DOM 之后再塞，否则 Safari 偶尔不重载
  requestAnimationFrame(mount);

  const reset = () => {
    /* 试用数据按装配分桶（键含 sig），清理时按前缀整组清除，
       否则换形态后仍会读到上一版的数据。 */
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("moshan.trial") === 0) kill.push(k);
      }
      kill.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* 部分 WebView 隐私模式下 localStorage 会抛异常，忽略即可 */
    }
    mount();
    toast("试用数据已重置", 1500);
  };

  return h(
    "div.wrap",
    null,
    steps(STEP_NAMES, ALL_DONE),

    pagehd({
      title: "试用原型",
      lead: `这是按所选 ${hub.mods.length} 个模块生成的可运行原型（${formDef(hub.form).nm} 形态）。${
        isCli
          ? "输入 help 查看可用命令，命令会真实改写数据。"
          : "可依次尝试：新建待办、记录笔记、检索、与 AI 对话。"
      } 数据仅保存在本页，重载后重置。`,
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
        h("span", null, "打包"),
        icon("arrow-right", { size: 14 })
      )
    ),

    frame,

    bare.length
      ? h(
          "p.t-12.faint.trialnote",
          null,
          `另有 ${bare.length} 个模块没有面板（${bare.slice(0, 4).map((m) => m.nm).join("、")}${bare.length > 4 ? " 等" : ""}）：`,
          "这类模块需要通电或真机环境，原型中仅保留接口约定与接线方式。"
        )
      : null,

    h(
      "p.t-12.faint.trialnote",
      null,
      isCli
        ? "终端命令会真实改写数据：todo add 之后退出再进入，记录仍然存在。"
        : `左侧仅列出已装配且原型提供面板的模块${isCustomScene(hub.scene) ? "" : `（${sc.nm} 场景）`}。未装配的模块位于「模块商店」，那是扩展系统的入口。`
    ),

    h(
      "div.stepnav",
      null,
      h(
        "button.btn.btn--ghost",
        { onclick: () => go("done") },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：交付")
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
