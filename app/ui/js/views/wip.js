// views/wip.js —— 还没迁移过来的页面。不做假界面：
// 说清现在在哪、下一步做什么，给一条明确的回去的路。

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
      title: sc ? `已选：${sc.nm}` : "这一页还在迁移",
      lead: sc
        ? "场景已经记下了。形态、包、方案、连线这几页正在按新规范重做，还没接上来。"
        : "新版按批次迁移，这一页还没排到。先回工作台，别在半个界面上做决定。",
      aside: sc ? h("span.t-12.faint", null, `${(sc.packs || []).length} 个包 · ${sc.sub}`) : null,
    }),
    h(
      "div.wip",
      null,
      icon("layers", { size: 32 }),
      h("h2", null, "还没有迁移到这里"),
      h(
        "p",
        null,
        "外壳、设计规范、首页与场景选择已经换新；剩下的页面沿用旧逻辑，等下一批接过来。",
        "现在点下去只会看到一个空页，所以先不做——它不会假装能用。"
      ),
      h(
        "div.row.gap-2",
        null,
        btn("回工作台", { kind: "primary", onclick: () => go("home") }),
        btn("重挑场景", { onclick: () => go("scenes") })
      )
    )
  );
}
