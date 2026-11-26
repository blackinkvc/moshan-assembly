// lib/pack.js —— 打出去的那一份：清单、README、安装说明、zip 里的文件表。
//
// 全部是纯函数：给一个 hub，出一组文件。这样「试用页预览的那份」和
// 「打包页写进 zip 的那份」共用同一个来源，不会出现「预览里有的、包里没有」。

import { hubMod, platOf, memSim, mbTxt, PLATS } from "./hub.js";
import { protoDoc, protoData } from "./proto.js";
import { mdFor } from "./exportMd.js";
import { zipStore, sizeTxt } from "./zip.js";

const TIER = {
  must: ["必装", "去掉就立不起来"],
  rec: ["推荐", "大部分人第一版就该有"],
  opt: ["可选", "用得上再加"],
};
const recOf = (provs) => provs.find((p) => p.lv === "rec") || provs[0];

export function installNotes(form, plats) {
  const P = {};
  P.mac = [
    {ty:"拦在哪", body: form === "app"
      ? "dmg 第一次打开会提示「无法验证开发者」；如果没公证，还会直接说「已损坏，移到废纸篓」。<b>不是文件坏了</b>，是下载来的文件带了 quarantine 隔离属性。"
      : "下载来的二进制/脚本第一次运行会提示「无法验证开发者」。"},
    {ty:"怎么过", body: form === "app"
      ? "右键 → 打开（只对这一次有效）；或 系统设置 → 隐私与安全性 → 仍要打开；或终端 <code>xattr -dr com.apple.quarantine /Applications/X.app</code>。"
      : "终端 <code>chmod +x ./x</code> 后右键打开；或 <code>xattr -dr com.apple.quarantine ./x</code>。"},
    {ty:"想彻底没有这一步", body:"两条路：① 买 Apple Developer（99 美元/年）做 Developer ID 签名 + <code>notarytool</code> 公证；② <b>发源码</b>——<code>git clone &amp;&amp; npm i &amp;&amp; npm run dev</code>，产物是用户本机编的，没有 quarantine、不经过别人的签名，所以系统不拦。源码路线零成本且最安全（用户看得见每一行），代价是他要装 Node / Rust 工具链。"},
  ];
  P.win = [
    {ty:"拦在哪", body:"exe 没有代码签名证书时，SmartScreen 会弹「Windows 已保护你的电脑」，默认只有「不运行」一个按钮。"},
    {ty:"怎么过", body:"点「更多信息」→「仍要运行」；或用 zip 绿色版（解压即用，能少一层）；企业内可用组策略白名单。"},
    {ty:"想彻底没有这一步", body:"买 OV/EV 代码签名证书（约 2000 元/年）签名；EV 证书能立刻建立信誉，OV 要累积下载量。次选是发源码，或发 <code>.zip</code> 免安装版（不写注册表、不需要管理员权限）。"},
  ];
  P.linux = [
    {ty:"拦在哪", body: form === "app" ? "AppImage 默认没有执行权限；deb 会缺 <code>libwebkit2gtk</code> 之类的运行时依赖。" : "下载的二进制没有执行权限。"},
    {ty:"怎么过", body:"<code>chmod +x ./App.AppImage</code> 后双击；缺库就用 <code>apt install ./x.deb</code> 让包管理器补依赖；或直接 <code>./x</code> 看它报缺哪个 so。"},
    {ty:"想彻底没有这一步", body:"打成 AppImage（自带运行时，最省心）或 flatpak；也可以直接给源码，一条 <code>make</code> 或 <code>npm run build</code>。"},
  ];
  P.android = [
    {ty:"拦在哪", body:"apk 不能在应用商店之外直接装，系统会拦「未知来源」；商店上架还要签名与审核（个人开发者常被要求先做小规模测试）。"},
    {ty:"怎么过", body:"设置 → 应用 → 特殊权限 → 安装未知应用 → 允许你的浏览器/文件管理器；装完关掉这个权限。"},
    {ty:"想彻底没有这一步", body:"上 Google Play / 国内应用商店（要签名 + 审核 + 隐私政策）；或者做成 <b>PWA</b>——用浏览器打开后「添加到主屏幕」，不经过任何安装包。"},
  ];
  P.web = [
    {ty:"怎么装", body:"没有安装这一步：给一个网址就能用。想常驻就「添加到桌面/主屏幕」（PWA）。"},
    {ty:"注意", body:"必须走 HTTPS 才能用摄像头、定位、剪贴板这些能力；本地双击 <code>index.html</code> 时 <code>file://</code> 下这些 API 多半被禁。"},
    {ty:"发出去", body:"静态托管（对象存储 + CDN、GitHub Pages、Vercel）都行；单文件 HTML 可以直接发微信，对方存下来双击就能开。"},
  ];
  P.cli = [
    {ty:"怎么装", body:"<code>chmod +x ./tool</code> 后放进 <code>/usr/local/bin</code>；或者 <code>npm i -g</code> / <code>brew install</code> / <code>scoop install</code>。"},
    {ty:"拦在哪", body:"macOS 会拦未签名的二进制（同上面的 quarantine）；Windows 会拦未签名的 exe。"},
    {ty:"想彻底没有这一步", body:"发源码让用户自己 <code>go build</code> / <code>cargo build --release</code>；或者只发一个 <code>.sh</code>/<code>.py</code> 脚本，天然没有签名问题。"},
  ];
  /* 一行版：确认页只放这一句，不截断原文（截断会把「已损坏，移到废纸篓」这种关键话切掉半截） */
  const SHORT = {
    mac: form === "app" ? "dmg 未签名会被 Gatekeeper 拦一次，右键「打开」就过" : "未签名的二进制会被拦一次，先 chmod +x",
    win: "exe 未签名会弹 SmartScreen，点「更多信息 → 仍要运行」",
    linux: "AppImage 要先 chmod +x；deb 缺库用 apt 补",
    android: "apk 要允许「安装未知应用」，装完关掉",
    web: "没有安装这一步，给个网址就能用",
    cli: "macOS 与 Windows 都会拦未签名的可执行文件"
  };
  const out = [];
  (plats.length ? plats : ["mac"]).forEach(pid => {
    const list = P[pid] || P.web;
    out.push({pl: (PLATS.find(p => p.id === pid) || {}).nm || pid, items:list, short: SHORT[pid] || SHORT.web});
  });
  return out;
}

/* ────────── 打包：三个文本 + 一坨字节 ────────── */

/** manifest / README / 安装说明 */
export function packTexts(hub) {
  const data = protoData(hub);
  const memo = memSim(hub);
  const mods = hub.mods.map((id) => hubMod(id)).filter(Boolean);
  const planOf = (mid) => {
    const m = hubMod(mid);
    return m ? m.provs.find((p) => p.id === (hub.plans || {})[mid]) || recOf(m.provs) : null;
  };

  const manifest = {
    生成时间: data.at,
    场景: data.scene || "—",
    形态: data.formNm,
    规格: data.style,
    平台: data.platNm,
    最小包: !!hub.min,
    模块数: mods.length,
    能力格数: data.cells.length,
    连线数: data.lines,
    内存估算: {
      合计MB: memo.total, 预算MB: memo.budget, 外壳MB: memo.shellMB,
      模块MB: memo.packMB, 模型MB: memo.modelMB, 装得下: memo.ok,
      模型: memo.model
        ? { 名称: memo.model.nm, 量化: memo.model.q, 权重GB: memo.model.gb, 预估字每秒: memo.model.tps }
        : null,
    },
    包装: data.packs.map((p) => ({ id: p.id, 名称: p.nm, 等级: (TIER[p.tier] || [p.tier])[0], 模块数: p.n })),
    未装模块: data.shop.map((p) => ({ 包: p.nm, 模块: p.mods.map((m) => m.nm) })),
    胶水: data.glue.map((g) => ({ 项: g.nm, 做法: g.pick, 类型: g.k })),
    底座: data.base.map((g) => ({ 项: g.nm, 做法: g.pick, 类型: g.k })),
    模块: mods.map((m) => {
      const p = planOf(m.id);
      return {
        名称: m.nm, 编号: m.id,
        等级: (TIER[m.tier] || [m.tier])[0],
        能力格: m.cells,
        方案: p ? p.n : null, 方案类型: p ? p.k : null, 理由: p ? p.note : null,
      };
    }),
    施工顺序: data.order.map((o, i) => `${i + 1}. ${o.nm}（${o.id}）`),
  };

  const readme = `# ${data.name}

装配于 ${data.at} · ${mods.length} 个模块 · ${data.cells.length} 格 · ${data.lines} 条连线
形态 **${data.formNm}** · 平台 ${data.platNm.join(" / ") || "—"} · 预计占用 ${mbTxt(memo.total)}${hub.min ? " · 最小包" : ""}

## 怎么用

${
  hub.form === "cli"
    ? "双击 `index.html` 会打开一个能敲命令的终端：`todo`、`note`、`search 关键词`、`status`、`help`。\n数据存在你浏览器的 localStorage 里，不上传任何地方。"
    : "双击 `index.html`，会打开一个**能点的模拟中台**：左侧是模块导航，待办能加能勾、速记能保存、\n搜索能跨三处找、AI 对话框能真的给你加待办。数据存在你浏览器的 localStorage 里，不上传任何地方。"
}

这是原型：界面与交互是真的，后端是假的。要变成真程序，按 \`模块清单.md\` 的施工顺序逐格落地。

## 装了什么

${mods
  .map((m) => {
    const p = planOf(m.id);
    return `- **${m.nm}**（${m.cells.join(" / ")}）→ ${p ? p.n : "未选"}${p && p.note ? "　" + p.note : ""}`;
  })
  .join("\n")}
${
  data.shop.length
    ? `
## 还没装的（最小包）

这些模块没有打进包里，用「扩展系统」按需下载：

${data.shop
        .map((p) => `- **${p.nm}**：${p.mods.map((m) => m.nm).join("、")}`)
        .join("\n")}
`
    : ""
}
## 胶水与底座

模块之间怎么接、整台东西跑在哪：

${data.glue.map((g) => `- **胶水 · ${g.nm}** → ${g.pick}（${g.k}）`).join("\n")}
${data.base.map((g) => `- **底座 · ${g.nm}** → ${g.pick}（${g.k}）`).join("\n")}

## 内存

| 项 | 占用 |
|---|---|
| 运行时外壳 | ${mbTxt(memo.shellMB)} |
| 模块与数据 | ${mbTxt(memo.packMB)}（${memo.packs.length} 个包） |
| 本地模型 | ${memo.modelMB ? mbTxt(memo.modelMB) + "（" + memo.model.nm + " " + memo.model.q + "）" : "未启用"} |
| **合计** | **${mbTxt(memo.total)}** |
| 系统与后台预留 | ${mbTxt(memo.floor)} |
| 机器内存 | ${mbTxt(memo.budget)} |

${
  memo.ok
    ? `可用 ${mbTxt(memo.avail)}，还剩 ${mbTxt(memo.avail - memo.total)}。`
    : `超了 ${mbTxt(memo.total - memo.avail)}——把模型降一档，或者去掉几个可选包。`
}

## 施工顺序

${data.order.map((o, i) => `${i + 1}. ${o.nm}　\`${o.id}\``).join("\n")}

## 三个提醒

1. **先跑通一条链**：数据仓 → 待办 → 界面。这三格通了，后面的都是加法。
2. **方案是候选不是承诺**：标「自研」的格子要算 token 与返工成本，标「慎选」的多半有运维代价。
3. **别一次装全**：这块东西是从「必装」起，用两周再决定要不要加可选模块。
`;

  const install = `# 安装说明

形态 **${data.formNm}** · 平台 ${data.platNm.join(" / ") || "—"}

先说一句：**被拦住的从来不是「你的程序不好」，是「系统不认识它」。**
要么买证书让系统认识你，要么发源码让用户自己编——后者零成本，而且用户能看到每一行。

${(installNotes(hub.form, platOf(hub)) || [])
  .map(
    (n) => `## ${n.pl}

${n.items.map((it) => `**${it.ty}**　${it.body.replace(/<[^>]+>/g, "")}`).join("\n\n")}
`
  )
  .join("\n")}
## 一张对照表

| 平台 | 产物 | 默认会被拦 | 最快过法 | 彻底解决 |
|---|---|---|---|---|
| macOS | dmg / app | Gatekeeper：「无法验证开发者」或「已损坏」 | 右键 → 打开，或 \`xattr -dr com.apple.quarantine\` | Apple Developer 签名 + 公证（99 美元/年），或发源码 |
| Windows | exe / msi | SmartScreen：「Windows 已保护你的电脑」 | 更多信息 → 仍要运行 | 代码签名证书（约 2000 元/年），或发 zip 绿色版 |
| Linux | AppImage / deb | 没有执行权限 / 缺依赖 | \`chmod +x\`、\`apt install ./x.deb\` | AppImage 自带运行时，或发源码 |
| 安卓 | apk | 未知来源被禁 | 设置里允许该来源安装 | 上架应用商店，或做成 PWA 加到主屏 |
| 网页 | 网址 | 没有安装这一步 | — | 走 HTTPS；本地打开时摄像头/定位多半被禁 |
| CLI | 单文件二进制 | 未签名二进制被拦 | \`chmod +x\`，右键打开 | 发源码让用户自己 \`build\`，或发脚本 |
`;

  return { manifest, readme, install };
}

/** zip 里的那份文件表（顺序就是解压后看到的顺序） */
export function packFiles(hub) {
  const data = protoData(hub);
  /* 「有效的那份」：开了最小包之后，模块数、包数、内存都要按地基算，
     否则页面上一半数字是全量、一半是最小包，等于两套账。 */
  const effHub = { ...hub, mods: data.mods.map((m) => m.id) };
  const memo = memSim(effHub);
  const { manifest, readme, install } = packTexts(hub);
  const html = protoDoc(hub);

  const files = [
    { name: "index.html", data: html, why: hub.form === "cli" ? "双击打开是一个能敲命令的终端" : "刚才试的那个东西，双击即开，不依赖网络" },
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2), why: "模块、能力格、胶水、底座、内存估算、施工顺序" },
    { name: "README.md", data: readme, why: "怎么用、装了什么、施工顺序、三个提醒" },
    { name: "安装说明.md", data: install, why: `${installNotes(hub.form, platOf(hub)).length} 个平台：会被什么拦住、怎么过、怎么彻底绕开` },
    { name: "模块清单.md", data: mdFor(hub), why: "按能力格展开的施工表，含每格选的方案与类型" },
  ];
  if (data.shop.length) {
    files.push({
      name: "modules.json",
      data: JSON.stringify(
        {
          说明: "最小包没有装这些模块。真实版本由「扩展系统」按这个清单去下，下完热加载。",
          未装: data.shop.map((p) => ({
            包: p.nm,
            模块: p.mods.map((m) => ({ 名称: m.nm, 编号: m.id })),
          })),
        },
        null,
        2
      ),
      why: `还没装的 ${data.shop.reduce((n, p) => n + p.mods.length, 0)} 个模块清单，商店照它去下`,
    });
  }

  const bytes = zipStore(files.map((f) => ({ name: f.name, data: f.data })));
  return {
    files,
    bytes,
    sizeTxt: sizeTxt(bytes.length),
    html,
    manifest,
    readme,
    install,
    data, // min 之后的真实数据（模块数、格数、连线）
    memo, // 按 min 之后算的内存
  };
}

/** 最小包会留下哪几个模块：core 里的必装 + 扩展系统（下载入口不能砍）。
    和 protoData 里的 minSet 保持一致——两处对不上，页面上就会一个说 3 个、一个写 4 个。 */
export function minMods(hub) {
  const keep = hub.mods
    .map((id) => hubMod(id))
    .filter((m) => m && (((m.pks || []).includes("core") && m.tier === "must") || m.id === "plugin"));
  if (keep.some((m) => m.id === "plugin")) return keep;
  const plugin = hubMod("plugin");
  return plugin ? [...keep, plugin] : keep;
}
