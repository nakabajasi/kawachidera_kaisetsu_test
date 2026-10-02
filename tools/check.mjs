#!/usr/bin/env node
/*
 * データと対話の検査。公開には不要（node があるときだけ使う）。
 *   node tools/check.mjs            … JSON の構文、ID の参照、言い回し、質問判定を確かめる
 *   node tools/check.mjs --pdf 報告書.pdf … さらに facts の原文抜粋（quote）が報告書の該当頁にあるか確かめる（pdftotext が必要）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Store = require(path.join(ROOT, "js/store.js"));
const NLG = require(path.join(ROOT, "js/nlg.js"));
const Search = require(path.join(ROOT, "js/search.js"));
const Dialogue = require(path.join(ROOT, "js/dialogue.js"));

let fail = 0, pass = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("NG  " + msg); } };
const section = (t) => console.log("\n== " + t);

// ───────── 1. JSON の構文 ─────────
section("JSON の構文");
const raw = {};
for (const n of Store.FILES) {
  try { raw[n] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", n + ".json"), "utf8")); pass++; }
  catch (e) { fail++; console.log("NG  data/" + n + ".json: " + e.message); }
}
try { raw.review = JSON.parse(fs.readFileSync(path.join(ROOT, "review.json"), "utf8")); pass++; }
catch (e) { fail++; console.log("NG  review.json: " + e.message); }
if (fail) { console.log("\nJSON が読めないため中止"); process.exit(1); }
const data = Store.build(raw);

// ───────── 2. ID の参照 ─────────
section("ID の参照");
const STATUS = ["fact", "interpretation", "hypothesis", "estimate", "unknown"];
const CERT = ["confirmed", "probable", "possible", "uncertain"];
const seen = new Set();
for (const f of data.facts) {
  ok(!seen.has(f.id), "fact の ID が重複: " + f.id); seen.add(f.id);
  ok(!!data.entityMap[f.subject], `fact ${f.id}: subject ${f.subject} が entities にない`);
  ok(!f.object_id || !!data.entityMap[f.object_id], `fact ${f.id}: object_id が entities にない`);
  ok(STATUS.includes(f.status), `fact ${f.id}: status ${f.status}`);
  ok(CERT.includes(f.certainty), `fact ${f.id}: certainty ${f.certainty}`);
  ok(f.source_refs.length > 0 && f.source_refs.every((r) => data.sourceMap[r.source_id] && r.pdf_page > 0), `fact ${f.id}: 出典頁がない`);
  ok(!!(data.language.sentences[f.predicate] || data.language.labels[f.predicate]), `fact ${f.id}: 述語 ${f.predicate} の言い回しが language.json にない`);
  (f.supersedes || []).forEach((id) => ok(!!data.factMap[id], `fact ${f.id}: supersedes ${id} がない`));
}
const needFact = (id, where) => ok(!!data.factMap[id], `${where}: fact ${id} がない`);
const needEnt = (id, where) => ok(!!data.entityMap[id], `${where}: entity ${id} がない`);
for (const t of data.topics) {
  t.fact_ids.concat(t.detail_fact_ids).forEach((id) => needFact(id, t.id));
  t.entity_ids.forEach((id) => needEnt(id, t.id));
  t.related_topics.forEach((id) => ok(!!data.topicMap[id], `${t.id}: related_topics ${id} がない`));
  t.suggestions.forEach((s) => ok(!!data.topicMap[s.topic_id], `${t.id}: suggestion ${s.topic_id} がない`));
  t.action_ids.forEach((id) => ok(!!data.actionMap[id], `${t.id}: action ${id} がない`));
  ok(!!data.language.styles.normal[t.response_type], `${t.id}: response_type ${t.response_type} が language.json にない`);
}
for (const s of data.spots) {
  s.entity_ids.forEach((id) => needEnt(id, s.id));
  s.description_fact_ids.forEach((id) => needFact(id, s.id));
  s.media_ids.forEach((id) => ok(!!data.mediaMap[id], `${s.id}: media ${id} がない`));
  s.action_ids.forEach((id) => ok(!!data.actionMap[id], `${s.id}: action ${id} がない`));
  ok(s.location.latitude === null || typeof s.location.latitude === "number", `${s.id}: latitude`);
}
for (const r of data.relations) { needEnt(r.subject, r.id); needEnt(r.object, r.id); ok(r.source_refs.length > 0, `${r.id}: 出典がない`); if (r.fact_id) needFact(r.fact_id, r.id); }
for (const m of data.media) m.related_entity_ids.forEach((id) => needEnt(id, m.id));
for (const q of data.quiz) {
  q.explanation_fact_ids.forEach((id) => needFact(id, q.id));
  ok(q.correct_index >= 0 && q.correct_index < q.choices.length, `${q.id}: correct_index`);
  ok(new Set(q.choices).size === q.choices.length, `${q.id}: 選択肢が重複`);
  ok(q.source_refs.length > 0, `${q.id}: 出典がない`);
}
for (const a of data.actions) {
  if (a.type !== "external" && !a.url.startsWith("#")) {
    const file = a.url.split("?")[0];
    ok(fs.existsSync(path.join(ROOT, file)), `${a.id}: ${file} がない`);
  }
  ok(!a.url.startsWith("/"), `${a.id}: URL が / で始まっている（GitHub Pages のサブフォルダで動かない）`);
}
for (const sec of [...data.site.pages.overview, ...data.site.pages.timeline, ...data.site.pages.artifacts]) sec.fact_ids.forEach((id) => needFact(id, "site.pages"));

// ───────── 3. 言い回しに史実が混ざっていないか ─────────
section("language.json に史実が混ざっていないか");
const strings = [];
(function walk(o, p) {
  if (typeof o === "string") strings.push([p, o]);
  else if (Array.isArray(o)) o.forEach((x, i) => walk(x, p + "[" + i + "]"));
  else if (o && typeof o === "object") Object.keys(o).forEach((k) => { if (!k.startsWith("_")) walk(o[k], p + "." + k); });
})(data.language, "language");
const properNames = data.entities.filter((e) => ["site", "structure", "feature", "artifact", "person", "place", "event", "excavation"].includes(e.entity_type))
  .map((e) => e.name).filter((n) => n.length >= 3);
for (const [p, s] of strings) {
  ok(!/[0-9０-９]/.test(s), `${p}: 数字が入っている「${s}」`);
  const hit = properNames.find((n) => s.includes(n));
  ok(!hit, `${p}: 固有の名称「${hit}」が入っている`);
}

// ───────── 4. 確からしさの語尾が保たれるか ─────────
section("確からしさの語尾");
const nlg = NLG.create({ language: data.language, entityMap: data.entityMap });
const HEDGES = ["と考えられて", "とみられて", "と推定されて", "と想定されて", "可能性が", "可能性も", "という仮説", "とする仮説", "とは言い切れない", "断定できない", "とされてい", "と報告されて", "と伝えられて", "と結論づけられて", "ことが確認されて", "ことが分かって", "ことが調査で分かって"];
let sentences = 0;
for (const style of ["normal", "friendly", "guide", "written"]) {
  const table = data.language.modality_endings[style];
  for (const f of data.facts) {
    for (let i = 0; i < 6; i++) { // 言い回しの候補をひととおり出す
      const s = nlg.sentence(f, { style, first: i % 2 === 0 });
      sentences++;
      let key = f.superseded ? "reported_old" : f.modality === "reported" ? (f.attribution.type === "tradition" ? "reported_tradition" : "reported") : f.modality;
      if (NLG.create({ language: data.language, entityMap: data.entityMap }).DIRECT[key]) {
        // 断定・不明の文に、推量の語尾が付いていないこと
        const e = data.entityMap[f.subject];
        const body = [f.object || "", f.subject_text || "", f.scope_text || "", e ? e.name : "", f.attribution.label || ""].join("");
        const tail = s.text.slice(-22);
        const hedge = HEDGES.find((h) => tail.includes(h) && !body.includes(h));
        const allowed = f.predicate === "undetermined" || f.predicate === "roof_option";
        ok(!hedge || allowed, `${style} ${f.id}: 断定の文に推量の語尾「${hedge}」: ${s.text}`);
      } else {
        const hit = table[key].some((e) => s.text.endsWith(e));
        ok(hit, `${style} ${f.id} [${key}]: 語尾が違う: ${s.text}`);
      }
      ok(!s.text.includes("{") && !s.text.includes("undefined") && !s.text.includes("null"), `${style} ${f.id}: 差し込み漏れ: ${s.text}`);
    }
  }
}
console.log(`   ${sentences} 文を生成して確認`);
// statement が facts.json に書かれた内容と一致しているか（nlg.js を変えたら作り直す）
for (const f of data.facts) ok(f.statement === nlg.sentence(f, { style: "written" }).text, `${f.id}: statement が言い回しと合っていない（tools/make_statements.mjs を実行）`);

// ───────── 5. 質問判定 ─────────
section("質問判定");
const tq = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/test_questions.json"), "utf8"));
const mk = () => {
  const n = NLG.create({ language: data.language, entityMap: data.entityMap });
  return Dialogue.create(data, n, Search.create(data));
};
let hitCount = 0;
for (const c of tq.questions) {
  const d = mk();
  const r = d.ask(c.q);
  const got = r.kind === "topic" ? r.topic_id : "kind:" + r.kind;
  const good = c.expect.split("|").includes(got);
  if (good) hitCount++;
  ok(good, `「${c.q}」→ ${got}（期待 ${c.expect}） ${JSON.stringify(r.debug && r.debug.candidates)}`);
  ok(r.text && r.text.length > 0, `「${c.q}」: 回答が空`);
  if (r.kind !== "not_found" && r.kind !== "greeting") ok(r.sources.length > 0 && r.fact_ids.length > 0, `「${c.q}」: 出典がない`);
}
console.log(`   ${hitCount}/${tq.questions.length} 件が期待どおり`);
for (const c of tq.follow_ups) {
  const d = mk();
  d.askTopic(c.after);
  const r = d.ask(c.q);
  ok(r.kind === c.expect_kind, `続きの質問「${c.q}」（${c.after} の後）→ ${r.kind}（期待 ${c.expect_kind}）`);
}

// ───────── 6. 同じ質問でも言い回しが変わるか ─────────
section("言い回しの変化");
{
  const d = mk();
  let varied = 0;
  for (const t of data.topics.filter((x) => x.fact_ids.length)) {
    const texts = new Set();
    for (let i = 0; i < 8; i++) texts.add(d.askTopic(t.id).text);
    if (texts.size >= 2) varied++;
    else console.log("   変化なし: " + t.id);
  }
  ok(varied >= data.topics.length * 0.9, `言い回しが変わる項目が少ない (${varied}/${data.topics.length})`);
  console.log(`   ${varied}/${data.topics.length} 項目で、8回のうちに2通り以上の文になった`);
  // 同じ言い回しが続かないこと（候補が2つ以上ある語尾）
  const f = data.facts.find((x) => x.modality === "judged");
  let same = 0, prev = null;
  for (let i = 0; i < 30; i++) { const s = nlg.sentence(f, { style: "normal" }); if (prev && s.template_id === prev) same++; prev = s.template_id; }
  ok(same === 0, `同じ言い回しが続けて選ばれた (${same}回)`);
}

// ───────── 7. 原文抜粋の照合（任意） ─────────
const pi = process.argv.indexOf("--pdf");
if (pi > 0) {
  section("原文抜粋（quote）の照合");
  const pdf = process.argv[pi + 1];
  const norm = (s) => s.normalize("NFKC").replace(/\s+/g, "");
  const cache = {};
  const pageText = (n) => {
    if (!(n in cache)) {
      cache[n] = ["-layout", "-raw"].map((mode) => {
        try { return norm(execFileSync("pdftotext", [mode, "-f", String(n), "-l", String(n), pdf, "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
        catch (e) { return ""; }
      });
    }
    return cache[n];
  };
  let q = 0;
  for (const f of data.facts) {
    const want = norm(f.quote);
    const found = f.source_refs.some((r) => [0, 1].some((m) => (pageText(r.pdf_page - 1)[m] + pageText(r.pdf_page)[m] + pageText(r.pdf_page + 1)[m]).includes(want)));
    ok(found, `${f.id}: 抜粋が PDF ${f.source_refs.map((r) => r.pdf_page).join(",")} 頁に見つからない`);
    q++;
  }
  console.log(`   ${q} 件を照合`);
}

console.log(`\n結果: ${pass} 件 OK、${fail} 件 NG`);
process.exit(fail ? 1 : 0);
