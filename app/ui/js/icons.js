// icons.js —— 图标全部是 24×24 线框，stroke 用 currentColor。
// 主体来自旧版 ART（63 个），界面专用的几个在这里补，避免两套风格混着用。

import { ART } from "../data/catalog.js";

const NS = "http://www.w3.org/2000/svg";

/** 旧版没画、但新界面需要的 */
const EXTRA = {
  "arrow-right": '<path d="M4 12h15"/><path d="M13.5 6.5 19 12l-5.5 5.5"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="M10.5 6.5 5 12l5.5 5.5"/>',
  chevron: '<path d="M8.5 10 12 13.5 15.5 10"/>',
  "chevron-right": '<path d="M10 8.5 13.5 12 10 15.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6 20 20"/>',
  sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="M9.5 4.5v15"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12 3.2v2.3M12 18.5v2.3M4.8 7.9l2 1.15M17.2 15l2 1.15M4.8 16.1l2-1.15M17.2 9l2-1.15"/>',
  help: '<circle cx="12" cy="12" r="8.4"/><path d="M9.7 9.4a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .9-1 1.6v.4"/><circle cx="12" cy="16.9" r=".6" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M4.2 12h2M17.8 12h2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4M6.5 17.5l1.4-1.4M16.1 7.9l1.4-1.4"/>',
  moon: '<path d="M20 13.4A8.2 8.2 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4Z"/>',
  theme: '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none"/>',
  save: '<path d="M5 4.5h11.5L19.5 8v11.5H5z"/><path d="M8.5 4.5v5h7v-5M8.5 19.5v-5.6h7v5.6"/>',
  export: '<path d="M12 15.5V4.2"/><path d="M8 7.6 12 3.8l4 3.8"/><path d="M5 14v4.8c0 .9.6 1.5 1.5 1.5h11c.9 0 1.5-.6 1.5-1.5V14"/>',
  trash: '<path d="M5 7h14"/><path d="M8.5 7V5.2c0-.6.4-1 1-1h5c.6 0 1 .4 1 1V7"/><path d="M6.8 7l.8 12.2c0 .6.5 1 1 1h6.8c.5 0 1-.4 1-1L17.2 7"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.5V12l3.2 2"/>',
  box: '<path d="M3.8 8.2 12 4l8.2 4.2v7.6L12 20l-8.2-4.2z"/><path d="M3.8 8.2 12 12.4l8.2-4.2M12 12.4V20"/>',
  layers: '<path d="M12 3.8 3.8 8.2 12 12.6l8.2-4.4z"/><path d="M3.8 12.6 12 17l8.2-4.4"/><path d="M3.8 16.6 12 21l8.2-4.4"/>',
  spark: '<path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  warn: '<path d="M12 4.6 21 19.4H3z"/><path d="M12 9.6v4"/><circle cx="12" cy="16.6" r=".6" fill="currentColor" stroke="none"/>',
};

export function icon(name, opts = {}) {
  const { size = 16, cls = "" } = opts;
  const body = ART[name] || EXTRA[name] || ART.shell || "";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("class", "ico " + cls);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = body;
  return svg;
}

export function hasIcon(name) {
  return !!(ART[name] || EXTRA[name]);
}
