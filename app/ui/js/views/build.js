// views/build.js —— 组装台：把选好的模块一格一格插上去。
//
// 这是全流程里唯一「有节奏」的页面：一次只推进一步，每一步都有开始与完成两行日志，
// 主板上的槽位一个个变成实心块。它当然是模拟——页头就标着「模拟」，不假装在编译。
//
// 推进状态放在 S.build 里并落盘：中途去查东西、刷新页面，回来还能接着装。

import { h } from "../lib/dom.js";
import { icon } from "../icons.js";
import { badge, modal, toast } from "../components.js";
import { ANIMS, STYLES } from "../../data/catalog.js";
import { sceneById, packOf, hubMod, formDef } from "../lib/hub.js";
import { S, set } from "../store.js";
import { go } from "../router.js";

const styName = (id) => (STYLES.find((s) => s.id === id) || STYLES[1]).nm;
const planOf = (hub, mid) => {
  const m = hubMod(mid);
  return m ? m.provs.find((p) => p.id === (hub.plans || {})[mid]) || m.provs[0] : null;
};

/** 一次组装的快照要能被识别是不是同一套：模块清单变了就得重来 */
const sigOf = (hub) => hub.scene + "|" + hub.form + "|" + hub.mods.join(",");

function freshBuild(hub) {
  return {
    sig: sigOf(hub),
    order: hub.mods.slice(),
    i: 0,
    pct: 4,
    done: false,
    paused: false,
    busy: false,
    t0: Date.now(),
    logs: [{ t: "0.0s", c: "dim", s: "→ 开板：先立外壳与数据仓，空槽留给还没插的模块" }],
  };
}

const elapsed = (t0) => ((Date.now() - t0) / 1000).toFixed(1) + "s";

export function viewBuild() {
  const hub = S.hub;
  if (!hub || !hub.mods || !hub.mods.length) {
    return h(
      "div.wrap",
      null,
      h("h1.t-20", { style: { marginBottom: "8px" } }, "没有要装的东西"),
      h(
        "div.row.gap-2",
        null,
        h("button.btn.btn--primary", { onclick: () => go("scenes") }, h("span", null, "从头开始"))
      )
    );
  }

  // 换了模块清单就重来；否则接着上次的进度
  if (!S.build || S.build.sig !== sigOf(hub)) set({ build: freshBuild(hub) });

  const b = S.build;
  const sc = sceneById(hub.scene);
  const anim = hub.anim || "lego";
  const total = b.order.length;

  /* ── 主板 ── */
  const board = h("div.pcbgrid");
  const boardCount = h("i", null, `0/${total} 已插上`);
  function paintBoard() {
    board.replaceChildren(
      ...b.order.map((mid, i) => {
        const m = hubMod(mid);
        const nm = m ? m.nm : mid;
        const hue = m ? packOf(m.pk).hue : 210;
        if (i < b.i) {
          const el = h(
            "div.mchip",
            { title: nm },
            h("span.nm", null, nm),
            h("span.dot")
          );
          el.style.setProperty("--h", hue);
          // 刚插上的那一块才播动效，其它的静止
          if (i === b.i - 1 && !b.done) el.classList.add("just");
          return el;
        }
        const slot = h("div.slot", { title: nm }, h("span.nm", null, nm));
        slot.style.setProperty("--h", hue);
        return slot;
      })
    );
    boardCount.textContent = `${b.i}/${total} 已插上`;
  }

  /* ── 进度环 ── */
  const C = 2 * Math.PI * 54;
  const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  arc.setAttribute("cx", "66");
  arc.setAttribute("cy", "66");
  arc.setAttribute("r", "54");
  arc.setAttribute("fill", "none");
  arc.setAttribute("class", "ringarc");
  arc.setAttribute("stroke-dasharray", String(C));
  arc.setAttribute("stroke-dashoffset", String(C));
  const pctText = h("b", null, "0%");
  const ringSub = h("span", null, "插模块");

  function paintRing() {
    arc.setAttribute("stroke-dashoffset", String(C * (1 - b.pct / 100)));
    pctText.textContent = b.pct + "%";
    ringSub.textContent = b.done ? "完成" : b.paused ? "已暂停" : "插模块";
  }

  /* ── 四个阶段 ── */
  const STAGES = ["开板", "插模块", "通电", "自检"];
  const stageEls = STAGES.map((nm) => h("div.s", null, h("i"), nm));
  function paintStages() {
    // 完成时四个阶段全部落定（k=4 时不会有任何一个被标成「进行中」）
    const k = b.done ? STAGES.length : b.pct < 10 ? 0 : b.pct < 92 ? 1 : b.pct < 98 ? 2 : 3;
    stageEls.forEach((el, i) => {
      el.className = "s" + (i === k ? " on" : i < k ? " done" : "");
    });
  }

  /* ── 日志：只追加，不倒车 ── */
  const logBox = h("div.log");
  let logged = 0;
  function paintLog(scroll = true) {
    for (; logged < b.logs.length; logged++) {
      const l = b.logs[logged];
      logBox.appendChild(h(`div.${l.c || "dim"}`, null, h("span.t", null, l.t), "  " + l.s));
    }
    if (scroll) logBox.scrollTop = logBox.scrollHeight;
  }

  const statusLine = h("div.buildline");
  function paintStatus() {
    statusLine.textContent = b.done
      ? "全部就绪"
      : b.paused
      ? "已暂停，点继续恢复"
      : `正在插第 ${Math.min(b.i + 1, total)} / ${total} 个模块`;
  }

  // 注意：不要在 h() 里给 onclick，又在 paintButtons 里赋 .onclick——
  // h() 用的是 addEventListener，两处都挂等于点一下触发两次（开关互相抵消）。
  const pauseBtn = h("button.btn");
  function paintButtons() {
    if (b.done) {
      pauseBtn.replaceChildren(h("span", null, "查看结果"), icon("arrow-right", { size: 14 }));
      pauseBtn.className = "btn btn--primary";
      pauseBtn.onclick = () => go("done");
    } else {
      pauseBtn.replaceChildren(h("span", null, b.paused ? "继续" : "暂停"));
      pauseBtn.className = "btn";
      pauseBtn.onclick = () => togglePause();
    }
    stopBtn.classList.toggle("hidden", b.done);
    skipBtn.classList.toggle("hidden", b.done);
  }

  const stopBtn = h(
    "button.btn.btn--danger",
    { onclick: () => confirmStop() },
    h("span", null, "中止")
  );
  const skipBtn = h(
    "button.btn.btn--ghost",
    { onclick: () => fastForward() },
    icon("bolt", { size: 13 }),
    h("span", null, "快进到底")
  );

  function paint() {
    titleEl.textContent = b.done ? "组装完成" : b.paused ? "已暂停" : "正在组装";
    paintBoard();
    paintRing();
    paintStages();
    paintLog();
    paintStatus();
    paintButtons();
  }

  /* ── 推进 ── */
  let timer = 0;
  function alive() {
    return document.body.contains(board);
  }

  function tick() {
    clearTimeout(timer);
    if (!b || b.done || b.paused || b.busy) return;
    if (!alive()) return; // 已经切走了

    b.busy = true;

    if (b.i < total) {
      const mid = b.order[b.i];
      const m = hubMod(mid);
      const pl = planOf(hub, mid);
      const what = "插上 " + (m ? m.nm : mid) + (pl ? " · " + pl.n : "");
      b.logs.push({ t: elapsed(b.t0), s: "→ " + what, c: "now" });
      paintLog();

      timer = setTimeout(() => {
        b.logs[b.logs.length - 1] = { t: elapsed(b.t0), s: "✓ " + what, c: "ok" };
        b.i++;
        b.pct = Math.round(8 + (b.i / Math.max(1, total)) * 82);
        b.busy = false;
        paint();
        set({}, { save: true });
        timer = setTimeout(tick, 140);
      }, 380);
      return;
    }

    if (b.pct < 92) {
      b.logs.push({ t: elapsed(b.t0), c: "dim", s: "→ 接线检查：按基板核对每格的进出" });
      b.pct = 94;
      b.busy = false;
      paint();
      timer = setTimeout(tick, 560);
      return;
    }
    if (b.pct < 99) {
      b.logs.push({ t: elapsed(b.t0), c: "dim", s: "→ 自检：类型检查 / 依赖锁版本" });
      b.pct = 99;
      b.busy = false;
      paint();
      timer = setTimeout(tick, 560);
      return;
    }

    b.done = true;
    b.pct = 100;
    b.busy = false;
    b.logs.push({ t: elapsed(b.t0), s: "✓ 组装完成，用时 " + elapsed(b.t0), c: "ok" });
    paint();
    set({}, { save: true });
    toast("组装完成", 1600);
  }

  function togglePause() {
    if (b.done) return go("done");
    b.paused = !b.paused;
    paint();
    if (!b.paused) {
      b.busy = false;
      timer = setTimeout(tick, 200);
    } else {
      clearTimeout(timer);
    }
  }

  /** 快进：一次把剩下的日志铺完。模拟出来的东西，不必逼人看满 20 秒。 */
  function fastForward() {
    clearTimeout(timer);
    while (b.i < total) {
      const mid = b.order[b.i];
      const m = hubMod(mid);
      const pl = planOf(hub, mid);
      b.logs.push({
        t: elapsed(b.t0),
        c: "ok",
        s: `✓ 插上 ${m ? m.nm : mid}${pl ? " · " + pl.n : ""}`,
      });
      b.i++;
    }
    if (b.pct < 92) b.logs.push({ t: elapsed(b.t0), c: "dim", s: "→ 接线检查：按基板核对每格的进出" });
    if (b.pct < 99) b.logs.push({ t: elapsed(b.t0), c: "dim", s: "→ 自检：类型检查 / 依赖锁版本" });
    b.done = true;
    b.pct = 100;
    b.busy = false;
    b.paused = false;
    b.logs.push({ t: elapsed(b.t0), s: "✓ 组装完成，用时 " + elapsed(b.t0), c: "ok" });
    logged = 0;
    logBox.replaceChildren();
    paint();
    set({}, { save: true });
    toast("已快进到完成", 1500);
  }

  function confirmStop() {
    const m = modal({
      title: "中止组装？",
      body: h(
        "p.prose.t-13",
        null,
        "已装好的模块会保留，下次进来可以接着装。这是模拟，实际不会留下任何文件。"
      ),
      footer: [
        h("button.btn.btn--ghost", { onclick: () => m.close() }, h("span", null, "继续装")),
        h(
          "button.btn.btn--danger",
          {
            onclick: () => {
              m.close();
              set({ build: null });
              toast("已中止", 1400);
              go("home");
            },
          },
          h("span", null, "确认中止")
        ),
      ],
    });
  }

  /* ── 页面 ── */
  const titleEl = h("h1", null, "正在组装");
  const page = h(
    "div.wrap",
    null,
    h(
      "div.buildhd",
      null,
      h(
        "div",
        null,
        titleEl,
        h(
          "p.lead",
          null,
          `${sc.nm} · ${formDef(hub.form).nm} · ${styName(hub.sty)}：${total} 个模块按施工顺序一个一个插上去。`
        )
      ),
      // 进度在主板上已经写了「N/M 已插上」，这里不再重复一遍
      h("div.row.gap-2", null, badge("模拟", "clay"))
    ),

    h(
      "div.pcb",
      { "data-anim": anim },
      h(
        "div.pcb-hd",
        null,
        icon("chip", { size: 15 }),
        h("b", null, `${sc.nm} · 主板`),
        boardCount
      ),
      board,
      h(
        "div.pcb-ft",
        null,
        `${(ANIMS.find((a) => a.id === anim) || ANIMS[0]).nm} · ${formDef(hub.form).nm} · ${styName(hub.sty)}`
      )
    ),

    h(
      "div.buildmid",
      null,
      h(
        "div.ring",
        null,
        (() => {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("width", "132");
          svg.setAttribute("height", "132");
          svg.setAttribute("viewBox", "0 0 132 132");
          const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          track.setAttribute("cx", "66");
          track.setAttribute("cy", "66");
          track.setAttribute("r", "54");
          track.setAttribute("fill", "none");
          track.setAttribute("class", "ringtrack");
          svg.append(track, arc);
          return svg;
        })(),
        h("div.c", null, pctText, ringSub)
      ),
      h("div.grow", null, statusLine, h("div.stage", null, stageEls))
    ),

    logBox,

    h(
      "div.buildbar",
      null,
      h(
        "button.btn.btn--ghost",
        {
          onclick: () => {
            if (b.pct > 0 && !b.done) b.paused = true;
            go("confirm");
          },
        },
        icon("arrow-left", { size: 14 }),
        h("span", null, "上一步：回确认清单")
      ),
      h("span.push", null, null),
      skipBtn,
      stopBtn,
      pauseBtn
    )
  );

  paint();
  if (!b.done && !b.paused && !b.busy) timer = setTimeout(tick, 420);

  // 离开页面时把定时器收掉，别在别的页面上继续推进
  const stopOnLeave = () => {
    if (!alive()) {
      clearTimeout(timer);
      document.removeEventListener("route:change", stopOnLeave);
    }
  };
  document.addEventListener("route:change", stopOnLeave);

  return page;
}
