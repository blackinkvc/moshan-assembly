// components.js —— 视图里复用的构造器。只负责「拼出符合规范的 DOM」，
// 不含业务逻辑；样式全在 components.css / app.css 里。

import { h, frag } from "./lib/dom.js";
import { icon } from "./icons.js";

export function btn(label, opts = {}) {
  const { kind = "", size = "", iconName, onclick, title, tip, disabled, block, type = "button", ariaLabel } = opts;
  const cls = ["btn"];
  if (kind) cls.push("btn--" + kind);
  if (size) cls.push("btn--" + size);
  if (block) cls.push("btn--block");
  return h(
    "button",
    {
      class: cls.join(" "),
      type,
      onclick,
      title,
      "data-tip": tip || null,
      disabled: disabled || null,
      "aria-label": ariaLabel || null,
    },
    iconName ? icon(iconName, { size: size === "lg" ? 15 : 14 }) : null,
    label ? h("span", null, label) : null
  );
}

export function badge(text, kind = "plain") {
  return h(`span.badge.badge--${kind}`, null, text);
}

export function dot(kind = "", pulse = false) {
  return h(`i.dot${kind ? ".dot--" + kind : ""}${pulse ? ".dot--pulse" : ""}`, { "aria-hidden": "true" });
}

export function pagehd({ title, lead, aside }) {
  return h(
    "header.pagehd",
    null,
    h("div.titles", null, h("h1", null, title), lead ? h("p.lead", null, lead) : null),
    aside ? h("div.aside", null, aside) : null
  );
}

export function secttl(title, note, extra) {
  return h(
    "div.secttl",
    null,
    h("b", null, title),
    note ? h("span", null, note) : null,
    extra ? h("span.push", null, extra) : null
  );
}

/** 步骤条：done / now / next 三态，超出宽度自动只留圆点（见 CSS） */
export function steps(list, currentIdx) {
  const nodes = [];
  list.forEach((nm, i) => {
    if (i) nodes.push(h("i.sep", { "aria-hidden": "true" }));
    const cls = i < currentIdx ? ".step--done" : i === currentIdx ? ".step--now" : "";
    nodes.push(
      h(
        `div.step${cls}`,
        { "aria-current": i === currentIdx ? "step" : null },
        h("span.idx", null, i < currentIdx ? "✓" : String(i + 1)),
        h("span.nm", null, nm)
      )
    );
  });
  return h("nav.steps", { "aria-label": "装配进度" }, nodes);
}

export function emptyState({ iconName = "box", title, desc, action }) {
  return h(
    "div.empty",
    null,
    icon(iconName, { size: 28 }),
    h("b", null, title),
    desc ? h("span.t-12", null, desc) : null,
    action || null
  );
}

/** 模态：返回 { close }，Esc 与点遮罩都能关 */
export function modal({ title, body, footer, wide = false, onClose, bare = false }) {
  const scrim = h("div.modal-scrim", { role: "presentation" });
  const box = h(
    `div.modal${wide ? ".modal--wide" : ""}`,
    { role: "dialog", "aria-modal": "true", "aria-label": title || "对话框" },
    title
      ? h(
          "div.modal-hd",
          null,
          h("h2", null, title),
          h("button.iconbtn.push", { onclick: () => close(), "aria-label": "关闭", "data-tip": "关闭" }, icon("x", { size: 14 }))
        )
      : null,
    h("div.modal-bd", null, body),
    footer ? h("div.modal-ft", null, footer) : null
  );
  if (bare) box.classList.add("modal--bare");

  function close() {
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
    onClose && onClose();
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }
  scrim.addEventListener("mousedown", (e) => {
    if (e.target === scrim) close();
  });
  document.addEventListener("keydown", onKey, true);
  scrim.appendChild(box);
  document.body.appendChild(scrim);

  // 焦点移进对话框，键盘用户不会还留在背后那层
  requestAnimationFrame(() => {
    const first = box.querySelector("[autofocus], input, button:not(.iconbtn)");
    (first || box).focus?.();
  });

  return { close, box };
}

let toastTimer = 0;
export function toast(msg, ms = 2000) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = h("div.toast-wrap", { role: "status", "aria-live": "polite" });
    document.body.appendChild(wrap);
  }
  // 只留最新一条：连着两次操作时，上一条的定时器会被清掉，
  // 不清节点就会永远贴在屏幕上叠成一列。
  wrap.replaceChildren();
  clearTimeout(toastTimer);

  const el = h("div.toast", null, icon("check", { size: 13 }), h("span", null, msg));
  wrap.appendChild(el);
  toastTimer = setTimeout(() => {
    el.style.transition = "opacity 160ms, transform 160ms";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 180);
  }, ms);
}

/** 切页时把残留的提示清掉：上一页的「已快进到完成」不该跟到下一页 */
export function clearToast() {
  clearTimeout(toastTimer);
  const wrap = document.querySelector(".toast-wrap");
  if (wrap) wrap.replaceChildren();
}

export function kv(label, value) {
  return h("div.row.gap-3", null, h("span.t-12.faint", { style: { minWidth: "72px" } }, label), h("span.t-13", null, value));
}

export { frag };
