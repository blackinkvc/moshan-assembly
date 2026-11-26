// router.js —— hash 路由。桌面应用不用浏览器历史，但保留 hash 至少让刷新能停在原地、
// 也让开发时改一行就能直接跳到某页（#/scenes）。

const VIEWS = new Map();
let host = null;
let fallback = null;

export function register(name, fn) {
  VIEWS.set(name, fn);
}

export function parse() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  if (!raw) return { name: "home", param: null };
  const [name, param] = raw.split("/");
  return { name: name || "home", param: param || null };
}

export function go(name, param) {
  const next = "#/" + name + (param ? "/" + param : "");
  if (location.hash === next) render();
  else location.hash = next;
}

export function current() {
  return parse().name;
}

function render() {
  if (!host) return;
  const { name, param } = parse();
  const view = VIEWS.get(name) || fallback;
  if (!view) return;
  host.replaceChildren();
  const node = view({ param });
  if (node) host.appendChild(node);
  host.scrollTop = 0;
  document.dispatchEvent(new CustomEvent("route:change", { detail: { name, param } }));
}

export function start(el, fallbackView) {
  host = el;
  fallback = fallbackView;
  window.addEventListener("hashchange", render);
  render();
}

export function rerender() {
  render();
}
