// bridge.js —— 与 Tauri 壳的唯一通道。
// 在浏览器里直接打开 ui/index.html 时自动降级到 localStorage，界面不会因此崩。

const TAURI = window.__TAURI__;
const core = TAURI && TAURI.core;
const ev = TAURI && TAURI.event;

export const isTauri = !!(core && core.invoke);

const LS_KEY = "moshan.v2.state";

async function invoke(cmd, args) {
  if (!isTauri) throw new Error("not in tauri");
  return core.invoke(cmd, args);
}

export async function storeRead() {
  if (!isTauri) {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "null");
    } catch {
      return null;
    }
  }
  try {
    return await invoke("store_read");
  } catch (e) {
    console.warn("store_read failed, falling back", e);
    return null;
  }
}

export async function storeWrite(value) {
  if (!isTauri) {
    localStorage.setItem(LS_KEY, JSON.stringify(value));
    return;
  }
  try {
    await invoke("store_write", { value });
  } catch (e) {
    console.warn("store_write failed", e);
  }
}

export async function appInfo() {
  if (!isTauri) {
    return {
      version: "2.0.0-dev",
      platform: "web",
      data_dir: "(浏览器预览，无本地数据目录)",
      theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    };
  }
  try {
    return await invoke("app_info");
  } catch {
    return { version: "2.0.0", platform: "tauri", data_dir: "", theme: "light" };
  }
}

export async function revealDataDir() {
  if (!isTauri) return null;
  try {
    return await invoke("reveal_data_dir");
  } catch {
    return null;
  }
}

/** 原生菜单点击 → 前端动作 */
export function onMenu(cb) {
  if (!isTauri || !ev) return () => {};
  let unlisten = null;
  ev.listen("menu", (e) => cb(e.payload)).then((fn) => (unlisten = fn));
  return () => unlisten && unlisten();
}
