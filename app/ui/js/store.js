// store.js —— 单一状态源。所有页面读 S、写 set()，不各自持有副本。

import { storeRead, storeWrite } from "./lib/bridge.js";

export const S = {
  route: "home",
  theme: "system", // system | light | dark
  sidebar: true,
  hub: null, // 正在装配的中台（后续批次接上）
  drafts: [], // 草稿
  build: null, // 正在进行的组装（进度、日志）
  info: null, // 壳信息（版本、平台、数据目录）
};

const subs = new Set();
let saveTimer = 0;

/** 只序列化需要落盘的部分：route 与 info 是运行时的，存了反而会在下次启动时跳页 */
function persistable() {
  // build 也存：装到一半刷新/切页回来还能接着装
  return { version: 2, theme: S.theme, sidebar: S.sidebar, hub: S.hub, drafts: S.drafts, build: S.build };
}

export async function hydrate() {
  const saved = await storeRead();
  if (saved && typeof saved === "object") {
    if (saved.theme) S.theme = saved.theme;
    if (typeof saved.sidebar === "boolean") S.sidebar = saved.sidebar;
    if (Array.isArray(saved.drafts)) S.drafts = saved.drafts;
    if (saved.hub) S.hub = saved.hub;
    if (saved.build) S.build = saved.build;
  }
  applyTheme();
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function notify() {
  for (const fn of subs) fn(S);
}

/** patch：浅合并；save 为 true 时落盘（默认落盘） */
export function set(patch, opts = {}) {
  Object.assign(S, patch);
  notify();
  if (opts.save !== false) scheduleSave();
}

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storeWrite(persistable()), 350);
}

export function applyTheme() {
  const root = document.documentElement;
  if (S.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", S.theme);
}

export function toggleTheme() {
  const order = ["system", "light", "dark"];
  const next = order[(order.indexOf(S.theme) + 1) % order.length];
  set({ theme: next });
  applyTheme();
  return next;
}
