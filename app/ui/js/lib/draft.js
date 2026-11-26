// lib/draft.js —— 草稿：存一份「走到哪了」的快照。
//
// 快照只存 hub（装配本身）+ 当时在哪一步。不存 build 进度：
// 进度是可以重放出来的（组装台按 hub 重算），存下来反而会出现
// 「草稿里 60%，点开却是 0%」这种自相矛盾的画面。

import { S, set } from "../store.js";
import { toast } from "../components.js";
import { hubLabel } from "./hub.js";

const STEP_LABEL = {
  need: "刚写了需求",
  style: "定形态",
  packs: "在挑包",
  plans: "在挑实现",
  wire: "在看连线",
  confirm: "待确认",
  build: "在组装",
  done: "已组装",
  trial: "试过原型",
  pack: "准备打包",
};

export function saveDraft(hub, route = "confirm") {
  if (!hub || !hub.mods || !hub.mods.length) {
    toast("还没有可存的装配", 1400);
    return null;
  }
  const d = {
    id: "d" + Date.now().toString(36),
    nm: hubLabel(hub, 26),
    step: STEP_LABEL[route] || "装配中",
    route,
    at: new Date().toISOString(),
    hub: JSON.parse(JSON.stringify(hub)),
  };
  set({ drafts: [d, ...(S.drafts || [])].slice(0, 30) });
  toast("已存进草稿箱", 1400);
  return d;
}

/** 打开草稿：恢复 hub，返回该去的页面 */
export function openDraft(d) {
  if (!d || !d.hub) return "home";
  set({ hub: JSON.parse(JSON.stringify(d.hub)) });
  // 「已组装」的草稿回到确认页：一眼看到全貌，再决定直接交付还是重装一遍
  return d.route === "build" || d.route === "done" || d.route === "trial" || d.route === "pack"
    ? "confirm"
    : d.route || "confirm";
}

export function removeDraft(id) {
  set({ drafts: (S.drafts || []).filter((x) => x.id !== id) });
}

/** 「3 分钟前」这种说法：草稿箱里比一串 ISO 时间好读 */
export function whenTxt(iso) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return Math.round(s / 60) + " 分钟前";
  if (s < 86400) return Math.round(s / 3600) + " 小时前";
  const d = new Date(t);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
