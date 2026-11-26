// views/drafts.js —— 草稿箱：做一半的东西回来还能接着做。
//
// 每条草稿需回答三件事：这是什么、走到哪一步、何时保存。
// 仅显示「未命名装配」时，存到第三份起就无法分辨。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { btn, emptyState, pagehd, toast } from "../components.js";
import { openDraft, removeDraft, whenTxt } from "../lib/draft.js";
import { hubCells, packOf } from "../lib/hub.js";
import { S } from "../store.js";
import { go } from "../router.js";

export function viewDrafts() {
  const list = S.drafts || [];

  const row = (d) => {
    const cells = d.hub ? hubCells(d.hub.mods || []).length : 0;
    const mods = (d.hub && d.hub.mods ? d.hub.mods.length : 0);
    const first = d.hub && d.hub.mods ? d.hub.mods[0] : null;

    const dot = h("span.dtdot");
    if (first) dot.style.setProperty("--h", packOf((first.pks || ["core"])[0]).hue);

    return h(
      "div.drow",
      null,
      dot,
      h(
        "div.dinfo",
        null,
        h("b", null, d.nm || "未命名装配"),
        h(
          "span",
          null,
          [d.step || "装配中", `${mods} 个模块 · ${cells} 格`, whenTxt(d.at)].filter(Boolean).join(" · ")
        )
      ),
      h(
        "div.dacts",
        null,
        btn("打开", {
          kind: "ghost",
          size: "sm",
          onclick: () => go(openDraft(d)),
        }),
        btn("删除", {
          kind: "ghost",
          size: "sm",
          onclick: () => {
            removeDraft(d.id);
            toast("草稿已删除", 1400);
            // 就地重画：删完剩下的不用整页刷新也能看到
            const host = document.querySelector("#view");
            if (host) {
              host.replaceChildren();
              host.appendChild(viewDrafts());
            }
          },
        })
      )
    );
  };

  return h(
    "div.wrap",
    null,
    pagehd({
      title: "草稿箱",
      lead: "装配中途可保存（交付页「存草稿」或 ⌘S / Ctrl+S）。恢复时场景、形态、已勾模块与各格实现均保留。",
      aside: list.length ? h("span.t-12.faint", null, `${list.length} 份`) : null,
    }),

    list.length
      ? h("div.dlist", null, list.map(row))
      : h(
          "div.emptywrap",
          null,
          emptyState({
            iconName: "clock",
            title: "暂无草稿",
            desc: "从选择场景开始，任意步骤都可保存",
            action: btn("开始装配", { kind: "primary", onclick: () => go("scenes") }),
          })
        ),

    list.length
      ? h(
          "p.t-12.faint",
          { style: { marginTop: "var(--sp-4)" } },
          "草稿只保存装配内容，不保存组装进度：进度由装配重算，保存后会出现不一致。"
        )
      : null
  );
}
