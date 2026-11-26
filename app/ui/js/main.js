// main.js —— 应用外壳：顶栏、侧栏、路由、命令面板、快捷键、原生菜单。
// 壳只搭一次，之后只换 .view 里的内容。

import { h, MOD } from "./lib/dom.js";
import { icon } from "./icons.js";
import { btn, toast, modal, kv, pagehd, emptyState, clearToast } from "./components.js";
import { S, hydrate, set, subscribe, toggleTheme, applyTheme } from "./store.js";
import { register, start, go, parse, current } from "./router.js";
import { isTauri, onMenu, appInfo, revealDataDir } from "./lib/bridge.js";
import { saveDraft } from "./lib/draft.js";
import { openExportMd } from "./lib/exportMd.js";
import { SCENES, SCAT } from "../data/catalog.js";

import { viewHome } from "./views/home.js";
import { viewScenes } from "./views/scenes.js";
import { viewStyle } from "./views/style.js";
import { viewPacks } from "./views/packs.js";
import { viewPlans } from "./views/plans.js";
import { viewWire } from "./views/wire.js";
import { viewConfirm } from "./views/confirm.js";
import { viewBuild } from "./views/build.js";
import { viewDone } from "./views/done.js";
import { viewNeed } from "./views/need.js";
import { viewDrafts } from "./views/drafts.js";
import { viewTrial } from "./views/trial.js";
import { viewPack } from "./views/pack.js";
import { viewWip } from "./views/wip.js";

const NAV = [
  { id: "home", nm: "工作台", ico: "shell" },
  { id: "scenes", nm: "挑场景", ico: "layers" },
  { id: "drafts", nm: "草稿箱", ico: "clock" },
];

const CRUMB = {
  home: "工作台",
  scenes: "挑场景",
  drafts: "草稿箱",
  need: "一句话需求",
  style: "定形态",
  packs: "要哪几包",
  plans: "每格挑实现",
  wire: "它们接得上吗",
  confirm: "确认清单",
  build: "组装",
  done: "交付",
  trial: "试用",
  pack: "打包",
};

let viewEl, crumbEl, navEl, themeBtn;

/* ══ 外壳 ══════════════════════════════════════════════════ */

function buildShell(root) {
  crumbEl = h("nav.crumb", { "aria-label": "位置" });
  navEl = h("nav.scroll", { "aria-label": "主导航" });

  themeBtn = h(
    "button.iconbtn",
    { onclick: () => cycleTheme(), "aria-label": "切换外观" },
    icon("theme", { size: 15 })
  );

  const cmdBtn = h(
    "button.cmdk",
    { onclick: () => openCmdk(), "aria-label": `搜索与跳转（${MOD}K）` },
    icon("search", { size: 13 }),
    h("span", null, "搜索或跳转"),
    h("kbd", null, MOD + "K")
  );

  const topbar = h(
    "header.topbar.drag",
    null,
    h("div.brand", null, h("span.mark", null, "墨山"), h("span.sub", null, "装配台")),
    crumbEl,
    h(
      "div.right.no-drag",
      null,
      cmdBtn,
      themeBtn,
      h(
        "button.iconbtn",
        {
          onclick: () => set({ sidebar: !S.sidebar }),
          "aria-label": "收起侧栏",
          "data-tip": "收起侧栏",
        },
        icon("sidebar", { size: 15 })
      )
    )
  );

  viewEl = h("div.view.scroll", { id: "view", tabindex: "-1" });

  root.appendChild(
    h(
      "div.app",
      { id: "shell", "data-sidebar": S.sidebar ? "on" : "off" },
      topbar,
      h("aside.sidebar", null, navEl, sidebarFooter()),
      h("main.main", null, viewEl)
    )
  );
}

function sidebarFooter() {
  return h(
    "div.sidebar-ft",
    null,
    h(
      "button.nav-item",
      { onclick: () => openHelp() },
      icon("help", { size: 15 }),
      h("span", null, "怎么用")
    ),
    h(
      "button.nav-item",
      { onclick: () => openPrefs() },
      icon("gear", { size: 15 }),
      h("span", null, "偏好设置")
    ),
    h(
      "div.ver",
      null,
      isTauri ? "桌面版" : "浏览器预览",
      h("span.mono", null, S.info ? "v" + S.info.version : "")
    )
  );
}

function renderNav() {
  const cur = parse().name;
  const nodes = [
    h("div.nav-label", null, "装配"),
    ...NAV.map((it) =>
      h(
        "button.nav-item",
        {
          "aria-current": cur === it.id ? "page" : null,
          onclick: () => go(it.id),
        },
        icon(it.ico, { size: 15 }),
        h("span", null, it.nm),
        it.id === "drafts" && S.drafts.length ? h("span.cnt", null, String(S.drafts.length)) : null
      )
    ),
  ];

  // 刚选的场景留在侧栏里：中途去查东西，回来不用重挑
  const rec = S.hub && S.hub.scene ? SCENES.find((s) => s.id === S.hub.scene) : null;
  if (rec) {
    nodes.push(
      h("div.nav-label", null, "最近"),
      h(
        "button.nav-item",
        { onclick: () => go("style", rec.id), "aria-current": cur === "style" ? "page" : null },
        icon(rec.art, { size: 15 }),
        h("span.ellipsis", null, rec.nm)
      )
    );
  }

  navEl.replaceChildren(...nodes);
}

function renderCrumb() {
  const { name, param } = parse();
  const sc = param ? SCENES.find((s) => s.id === param) : null;
  const here = CRUMB[name] || name;
  if (name === "home") {
    // 品牌旁边再写一次「工作台」就是废话，首页直接留空
    crumbEl.replaceChildren();
    return;
  }
  crumbEl.replaceChildren(
    h("span", null, "工作台"),
    h("span.sep", null, "›"),
    h("b", null, sc ? `${here} · ${sc.nm}` : here)
  );
}

function cycleTheme() {
  const t = toggleTheme();
  toast(t === "system" ? "外观跟随系统" : t === "light" ? "外观：浅色" : "外观：深色", 1400);
}

/* ══ 命令面板 ══════════════════════════════════════════════ */

function commands() {
  const list = [
    { grp: "页面", nm: "工作台", ico: "shell", run: () => go("home") },
    { grp: "页面", nm: "挑场景", ico: "layers", run: () => go("scenes") },
    { grp: "页面", nm: "草稿箱", ico: "clock", run: () => go("drafts") },
    { grp: "动作", nm: "切换深浅色", ico: "theme", run: cycleTheme },
    { grp: "动作", nm: "收起 / 展开侧栏", ico: "sidebar", run: () => set({ sidebar: !S.sidebar }) },
    { grp: "动作", nm: "偏好设置", ico: "gear", run: openPrefs },
  ];
  for (const sc of SCENES) {
    list.push({
      grp: SCAT.find((g) => g.ids.includes(sc.id))?.nm || "场景",
      nm: sc.nm,
      ico: sc.art,
      run: () => go("style", sc.id),
    });
  }
  return list;
}

function openCmdk() {
  let sel = 0;
  let items = [];

  const input = h("input.cmdk-input", {
    placeholder: "搜场景、页面或动作…",
    autofocus: true,
    "aria-label": "搜索",
  });
  const list = h("div.cmdk-list", { role: "listbox" });

  const m = modal({ body: h("div", null, input, list) });
  m.box.classList.add("cmdk-modal");

  function paint() {
    const q = input.value.trim().toLowerCase();
    items = commands().filter((c) => !q || c.nm.toLowerCase().includes(q) || c.grp.toLowerCase().includes(q));
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...(items.length
        ? items.map((c, i) =>
            h(
              "button.cmdk-item",
              {
                role: "option",
                "aria-selected": String(i === sel),
                onclick: () => {
                  m.close();
                  c.run();
                },
                onmousemove: () => {
                  if (sel !== i) {
                    sel = i;
                    paint();
                  }
                },
              },
              icon(c.ico, { size: 15 }),
              h("span", null, c.nm),
              h("span.grp", null, c.grp)
            )
          )
        : [h("div.cmdk-empty", null, "没有匹配的。试试「场景」「配色」「草稿」。")])
    );
  }

  input.addEventListener("input", () => {
    sel = 0;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sel = Math.min(sel + 1, items.length - 1);
      paint();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = items[sel];
      if (c) {
        m.close();
        c.run();
      }
    }
  });

  paint();
}

/* ══ 帮助与偏好 ════════════════════════════════════════════ */

function openHelp() {
  const row = (k, v) => h("div.row.gap-3", { style: { padding: "5px 0" } }, h("kbd", null, k), h("span.t-13.dim", null, v));
  modal({
    title: "怎么用",
    body: h(
      "div.col.gap-3",
      null,
      h(
        "p.prose.t-13",
        null,
        "八步：挑场景 → 定形态 → 勾包 → 每格挑实现 → 查连通 → 确认 → 组装 → 交付。每一步只让你做一个决定，做错能退回上一步。"
      ),
      h("div.sep-h"),
      h("div.t-12.faint.wide", null, "键盘"),
      row(MOD + "K", "搜索场景 / 跳转 / 切外观"),
      row(MOD + "1", "回工作台"),
      row(MOD + "N", "新建装配"),
      row(MOD + "S", "保存草稿"),
      row(MOD + "⇧ L", "切换深浅色"),
      row(MOD + "⇧ S", "收起侧栏"),
      h("p.t-12.faint", null, `菜单栏里的「文件 / 视图」与本页快捷键是同一套动作。`)
    ),
    footer: btn("知道了", { kind: "primary", onclick: () => document.querySelector(".modal-scrim")?.remove() }),
  });
}

async function openPrefs() {
  const info = S.info || (await appInfo());
  const themeRow = h(
    "div.row.gap-2",
    null,
    ["system", "light", "dark"].map((t) =>
      h(
        "button.chip",
        {
          "aria-pressed": String(S.theme === t),
          onclick: (e) => {
            set({ theme: t });
            applyTheme();
            e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
            e.currentTarget.setAttribute("aria-pressed", "true");
          },
        },
        t === "system" ? "跟随系统" : t === "light" ? "浅色" : "深色"
      )
    )
  );

  modal({
    title: "偏好设置",
    body: h(
      "div.col.gap-4",
      null,
      h("div.col.gap-2", null, h("div.t-12.faint.wide", null, "外观"), themeRow),
      h("div.sep-h"),
      h(
        "div.col.gap-2",
        null,
        kv("版本", info.version),
        kv("运行", isTauri ? "Tauri 桌面壳" : "浏览器"),
        kv("数据目录", h("span.mono.t-12", null, info.data_dir || "—")),
        h(
          "div.row.gap-2",
          { style: { marginTop: "4px" } },
          btn("在访达中显示", {
            size: "sm",
            onclick: async () => {
              const p = await revealDataDir();
              toast(p ? "已打开数据目录" : "浏览器预览下没有本地目录", 1800);
            },
          })
        )
      )
    ),
  });
}

/* ══ 菜单与快捷键 ══════════════════════════════════════════ */

function wireMenu() {
  onMenu((id) => {
    switch (id) {
      case "new":
        go("scenes");
        break;
      case "open":
        go("drafts");
        break;
      case "save":
        saveDraft(S.hub, current());
        break;
      case "export":
        // 没有装配时导出没有意义，直接说清楚
        if (S.hub && S.hub.mods && S.hub.mods.length) openExportMd(S.hub);
        else toast("还没有可导出的装配", 1600);
        break;
      case "prefs":
        openPrefs();
        break;
      case "toggle-theme":
        cycleTheme();
        break;
      case "toggle-sidebar":
        set({ sidebar: !S.sidebar });
        break;
      case "welcome":
        go("home");
        break;
      case "help":
        openHelp();
        break;
      case "reveal":
        revealDataDir().then((p) => toast(p ? "已打开数据目录" : "浏览器预览下没有本地目录", 1600));
        break;
      case "reload":
        location.reload();
        break;
      default:
        break;
    }
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCmdk();
      return;
    }
    /* ⌘S：浏览器里这个键是「保存网页」，要拦下来；Tauri 里菜单的保存也走同一条路 */
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (S.hub && S.hub.mods && S.hub.mods.length) saveDraft(S.hub, current());
    }
  });
}

/* ══ 启动 ══════════════════════════════════════════════════ */

async function boot() {
  if (isTauri) document.documentElement.classList.add("is-tauri");
  await hydrate();
  S.info = await appInfo();

  const root = document.getElementById("app");
  buildShell(root);

  register("home", viewHome);
  register("scenes", viewScenes);
  register("need", viewNeed);
  register("style", viewStyle);
  register("packs", viewPacks);
  register("plans", viewPlans);
  register("wire", viewWire);
  register("confirm", viewConfirm);
  register("build", viewBuild);
  register("done", viewDone);
  register("trial", viewTrial);
  register("pack", viewPack);
  register("drafts", viewDrafts);
  start(viewEl, viewWip);

  // 侧栏折叠要重画外壳的 grid 标记
  subscribe(() => {
    const shell = document.getElementById("shell");
    if (shell) shell.dataset.sidebar = S.sidebar ? "on" : "off";
  });

  document.addEventListener("route:change", () => {
    // 上一页的提示不该跟着走到下一页
    clearToast();
    renderNav();
    renderCrumb();
  });
  renderNav();
  renderCrumb();

  wireMenu();
}

boot();
