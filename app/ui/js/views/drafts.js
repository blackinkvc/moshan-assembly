// views/drafts.js —— 草稿箱：做一半的东西回来还能接着做。
//
// 每条草稿要能回答三件事：**这是什么、走到哪一步了、什么时候存的**。
// 只写「未命名装配」等于没写——用户存三份之后就没法分辨了。

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
      lead: "做一半可以随时存下（交付页有「存草稿」，⌘S / Ctrl+S 也行），回来时场景、形态、勾过的模块、每一格挑的做法都还在。",
      aside: list.length ? h("span.t-12.faint", null, `${list.length} 份`) : null,
    }),

    list.length
      ? h("div.dlist", null, list.map(row))
      : h(
          "div.emptywrap",
          null,
          emptyState({
            iconName: "clock",
            title: "还没有草稿",
            desc: "从挑场景开始，做到任何一步都能存",
            action: btn("开始装配", { kind: "primary", onclick: () => go("scenes") }),
          })
        ),

    list.length
      ? h(
          "p.t-12.faint",
          { style: { marginTop: "var(--sp-4)" } },
          "草稿只存装配本身，不存组装进度——进度是按装配重算出来的，存了会出现「草稿里 60%、点开 0%」。"
        )
      : null
  );
}
