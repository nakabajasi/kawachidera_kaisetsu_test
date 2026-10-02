#!/usr/bin/env node
/*
 * facts.json の statement（確からしさを保った1文）を、language.json の言い回しから作り直す。
 * facts や language.json を書き換えたら実行する:  node tools/make_statements.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NLG = require(path.join(ROOT, "js/nlg.js"));
const read = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", n + ".json"), "utf8"));
const facts = read("facts"), language = read("language"), entities = read("entities");
const entityMap = Object.fromEntries(entities.entities.map((e) => [e.id, e]));
const nlg = NLG.create({ language, entityMap });
let changed = 0;
for (const f of facts.facts) {
  const s = nlg.sentence(f, { style: "written" }).text;
  if (s !== f.statement) { f.statement = s; changed++; }
}
fs.writeFileSync(path.join(ROOT, "data", "facts.json"), JSON.stringify(facts, null, 2) + "\n");
console.log(`statement を ${changed} 件更新（全 ${facts.facts.length} 件）`);
