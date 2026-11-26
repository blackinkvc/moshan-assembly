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

  // 切页要「立刻」停在顶部。容器上有 scroll-behavior: smooth，
  // 直接赋 scrollTop 会从上一页的位置滑上去——看着像页面自己在滚。
  const prev = host.style.scrollBehavior;
  host.style.scrollBehavior = "auto";
  host.scrollTop = 0;
  host.style.scrollBehavior = prev;

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
