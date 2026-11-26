// dom.js —— 极简 DOM 构造。不引框架：这个应用的界面是「一屏一渲染」，
// 数据量小（几百个节点），虚拟 DOM 的收益抵不过它的复杂度。

/**
 * h("div.card#x", { onclick, style, ... }, ...children)
 * tag 支持 .class 与 #id 简写；children 里 null/false 会被跳过。
 */
export function h(tag, props, ...children) {
  let name = "div";
  const classes = [];
  let id = null;

  const m = String(tag).match(/^([a-zA-Z0-9-]+)?([.#].*)?$/);
  if (m) {
    if (m[1]) name = m[1];
    if (m[2]) {
      for (const tok of m[2].split(/(?=[.#])/)) {
        if (!tok) continue;
        if (tok[0] === ".") classes.push(tok.slice(1));
        else if (tok[0] === "#") id = tok.slice(1);
      }
    }
  }

  const el = document.createElementNS(
    name === "svg" || name === "path" || name === "g" ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml",
    name
  );

  if (classes.length) el.setAttribute("class", classes.join(" "));
  if (id) el.id = id;

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class" || k === "className") {
        const prev = el.getAttribute("class");
        el.setAttribute("class", prev ? prev + " " + v : v);
      } else if (k === "style" && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith("--")) el.style.setProperty(sk, String(sv));
          else el.style[sk] = sv;
        }
      } else if (k === "dataset" && typeof v === "object") {
        Object.assign(el.dataset, v);
      } else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "html") {
        el.innerHTML = v;
      } else if (k === "text") {
        el.textContent = v;
      } else if (v === true) {
        el.setAttribute(k, "");
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }

  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** 清空并放入新内容（视图切换用） */
export function mount(host, node) {
  host.replaceChildren();
  if (node) host.appendChild(node);
  return node;
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 中文数字/计数用：1234 → 1,234 */
export function nf(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}

/** 平台修饰键：macOS 显示 ⌘ */
export const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";
