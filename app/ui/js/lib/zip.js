// lib/zip.js —— store 模式（不压缩）的 zip 生成。
//
// 为什么不用库：一个 zip 最少只需要「本地头 + 中央目录 + EOCD」三段结构，
// 不压缩时数据原样贴进去即可。为了一个下载按钮引一个 zip 库（几十 KB + 还得打包）
// 不值当。代价是包大一点：文本本来就小，store 与 deflate 差几百字节。

const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: string | Uint8Array }] → Uint8Array */
export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let off = 0;
  const dt = new Date();
  const dtime = ((dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1)) & 0xffff;
  const ddate = (((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate()) & 0xffff;

  files.forEach((f) => {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 文件名
    lh.setUint16(8, 0, true);
    lh.setUint16(10, dtime, true);
    lh.setUint16(12, ddate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dtime, true);
    ch.setUint16(14, ddate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);

    off += 30 + name.length + data.length;
  });

  const csize = central.reduce((n, u) => n + u.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, csize, true);
  eocd.setUint32(16, off, true);
  eocd.setUint16(20, 0, true);

  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((n, u) => n + u.length, 0));
  let p = 0;
  for (const u of all) {
    out.set(u, p);
    p += u.length;
  }
  return out;
}

/** 「12.3 KB」/「1.4 MB」 */
export function sizeTxt(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(1) + " KB";
}
