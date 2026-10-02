/*
 * store.js — data/*.json を読み込み、ID で引ける形にまとめる。
 * GitHub Pages では fetch で読む。file:// で直接開いたときなど fetch が使えない場合は
 * data/data.bundle.js（tools/make_bundle.mjs が作る写し）に切り替える。
 */
(function (root) {
  "use strict";

  const FILES = ["site", "entities", "facts", "relations", "spots", "media", "dialogue", "language", "actions", "quiz", "sources"];

  function index(list) {
    const m = {};
    (list || []).forEach((x) => { m[x.id] = x; });
    return m;
  }

  function build(raw) {
    const d = {
      site: raw.site,
      entities: raw.entities.entities,
      facts: raw.facts.facts,
      relations: raw.relations.relations,
      spots: raw.spots.spots,
      map: raw.spots.map,
      media: raw.media.media,
      topics: raw.dialogue.topics,
      starters: raw.dialogue.starters || [],
      intents: raw.dialogue.intents || {},
      synonyms: raw.dialogue.synonyms || {},
      language: raw.language,
      actions: raw.actions.actions,
      quiz: raw.quiz.questions,
      sources: raw.sources.sources,
      review: raw.review || null,
    };
    d.entityMap = index(d.entities);
    d.factMap = index(d.facts);
    d.spotMap = index(d.spots);
    d.mediaMap = index(d.media);
    d.topicMap = index(d.topics);
    d.actionMap = index(d.actions);
    d.sourceMap = index(d.sources);
    d.factsBySubject = {};
    d.facts.forEach((f) => { (d.factsBySubject[f.subject] = d.factsBySubject[f.subject] || []).push(f); });
    return d;
  }

  function loadBundleScript(base) {
    return new Promise((resolve, reject) => {
      if (root.__HERITAGE_DATA__) return resolve(root.__HERITAGE_DATA__);
      const s = document.createElement("script");
      s.src = base + "data/data.bundle.js";
      s.onload = () => (root.__HERITAGE_DATA__ ? resolve(root.__HERITAGE_DATA__) : reject(new Error("bundle empty")));
      s.onerror = () => reject(new Error("bundle not found"));
      document.head.appendChild(s);
    });
  }

  /** base: index.html から見たサイトの根（"./" や "../../"）。相対パスだけを使う。 */
  async function load(base) {
    base = base || "./";
    let raw = {};
    let via = "fetch";
    try {
      if (location.protocol === "file:") throw new Error("file protocol");
      const res = await Promise.all(FILES.map((n) => fetch(base + "data/" + n + ".json", { cache: "no-cache" })));
      const bad = res.find((r) => !r.ok);
      if (bad) throw new Error("HTTP " + bad.status + " " + bad.url);
      const json = await Promise.all(res.map((r) => r.json()));
      FILES.forEach((n, i) => { raw[n] = json[i]; });
      try {
        const rv = await fetch(base + "review.json", { cache: "no-cache" });
        if (rv.ok) raw.review = await rv.json();
      } catch (e) { /* review.json は無くても動く */ }
    } catch (e) {
      via = "bundle";
      raw = await loadBundleScript(base);
    }
    const d = build(raw);
    d.loadedVia = via;
    return d;
  }

  const api = { load, build, FILES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Heritage = root.Heritage || {};
  root.Heritage.Store = api;
})(typeof window !== "undefined" ? window : globalThis);
