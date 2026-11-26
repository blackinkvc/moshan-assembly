#!/usr/bin/env python3
"""把 catalog.json 包成 ES module，前端不需要 import assertion 或打包器。

数据本身是从旧版运行时导出的（见 arch/README 里第 14 批的记录），
这里只做格式包装，不改内容。
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "ui" / "data" / "catalog.json"
OUT = ROOT / "ui" / "data" / "catalog.js"

data = json.loads(SRC.read_text(encoding="utf-8"))

lines = [
    "// 由 tools/gen-catalog.py 从 catalog.json 生成，勿手改。",
    "// 数据源：旧版装配台的运行时状态（SCENES / PACKS / HUB / W / D 等），逐字段序列化导出。",
    "",
]

for key in ("SCENES", "SCAT", "PACKS", "HUB", "GLUE", "BASE", "EXTRA_PK", "ANIMS", "STYLES", "FORMS"):
    if key in data:
        lines.append(f"export const {key} = {json.dumps(data[key], ensure_ascii=False)};")
        lines.append("")

for key in ("ART", "W", "D"):
    if key in data:
        lines.append(f"export const {key} = {json.dumps(data[key], ensure_ascii=False)};")
        lines.append("")

lines.append(
    "export default { SCENES, SCAT, PACKS, HUB, GLUE, BASE, EXTRA_PK, ANIMS, STYLES, FORMS, ART, W, D };"
)

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
kb = OUT.stat().st_size / 1024
print(f"wrote {OUT} ({kb:.0f} KB)")
