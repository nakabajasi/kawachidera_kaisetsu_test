#!/usr/bin/env node
/*
 * HTML から読み込む js / css に付ける版の番号（?v=）を、まとめて書き換える。
 *   node tools/set_version.mjs 5
 * ファイルを直して公開し直すときに番号を上げると、利用者の端末に古い js / css が残っていても、
 * 新しい HTML は新しいファイルを読みに行く（新旧のファイルが混ざって動くのを防ぐ）。
 * js/columns3d.js の VERSION も同じ番号にする。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v = process.argv[2];
if (!/^[0-9]+$/.test(v || "")) { console.log("使い方: node tools/set_version.mjs <番号（整数）>"); process.exit(1); }

for (const f of ["index.html", "ar/columns3d/index.html", "ar/camera/index.html"]) {
  const p = path.join(ROOT, f);
  const s = fs.readFileSync(p, "utf8")
    .replace(/(<script src="[^"?]+\.js)(\?v=[^"]*)?(")/g, `$1?v=${v}$3`)
    .replace(/(<link rel="stylesheet" href="[^"?]+\.css)(\?v=[^"]*)?(")/g, `$1?v=${v}$3`)
    .replace(/const NEED = \d+;/, `const NEED = ${v};`);
  fs.writeFileSync(p, s);
  console.log(f);
}
const e = path.join(ROOT, "js/columns3d.js");
fs.writeFileSync(e, fs.readFileSync(e, "utf8").replace(/const VERSION = \d+;/, `const VERSION = ${v};`));
console.log("js/columns3d.js\n版の番号を " + v + " にしました");
