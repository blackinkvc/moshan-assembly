// views/wip.js —— 尚未迁移的页面。不提供假界面：
// 说明当前状态与后续计划，并给出返回路径。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { btn, pagehd } from "../components.js";
import { SCENES } from "../../data/catalog.js";
import { go } from "../router.js";

export function viewWip({ param }) {
  const sc = param ? SCENES.find((s) => s.id === param) : null;

  return h(
    "div.wrap",
    null,
    pagehd({
      title: sc ? `已选：${sc.nm}` : "该页面正在迁移",
      lead: sc
        ? "场景已记录。形态、功能包、方案与连线页面正在按新规范重做，尚未接入。"
        : "新版按批次迁移，该页面尚未排期。请先返回工作台，不在未完成的界面上做决定。",
      aside: sc ? h("span.t-12.faint", null, `${(sc.packs || []).length} 个包 · ${sc.sub}`) : null,
    }),
    h(
      "div.wip",
      null,
      icon("layers", { size: 32 }),
      h("h2", null, "该页面尚未迁移"),
      h(
        "p",
        null,
        "外壳、设计规范、工作台与场景选择已更换为新实现；其余页面沿用旧逻辑，待下一批接入。",
        "此处当前只会显示空页，因此不做占位实现。"
      ),
      h(
        "div.row.gap-2",
        null,
        btn("返回工作台", { kind: "primary", onclick: () => go("home") }),
        btn("重新选择场景", { onclick: () => go("scenes") })
      )
    )
  );
}
