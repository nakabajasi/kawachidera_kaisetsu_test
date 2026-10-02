#!/usr/bin/env node
/*
 * data/*.json と review.json を1つにまとめた data/data.bundle.js を作る。
 * index.html をダブルクリックで開いたとき（file://）は fetch が使えないため、この写しを読む。
 * JSON を書き換えたら実行する:  node tools/make_bundle.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["site", "entities", "facts", "relations", "spots", "media", "dialogue", "language", "actions", "quiz", "sources"];
const out = {};
for (const n of FILES) out[n] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", n + ".json"), "utf8"));
out.review = JSON.parse(fs.readFileSync(path.join(ROOT, "review.json"), "utf8"));
const js = "/* 自動生成。編集しない（tools/make_bundle.mjs で作り直す） */\nwindow.__HERITAGE_DATA__ = " + JSON.stringify(out) + ";\n";
fs.writeFileSync(path.join(ROOT, "data", "data.bundle.js"), js);
console.log("data/data.bundle.js " + Math.round(js.length / 1024) + " KB");
