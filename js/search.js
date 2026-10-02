/*
 * search.js — 質問文から、答えるべき項目（topic）や対象（entity）・事実（fact）を選ぶ。
 * 生成AIは使わず、キーワード・別名・言い換え・部分一致・2文字の重なり・直前の話題で点数をつける。
 */
(function (root) {
  "use strict";

  const PUNCT = /[\s　?？!！。、，,.．・「」『』（）()\[\]【】〜~ー\-—:：;；"'’”…]/g;

  function normalize(text) {
    return String(text || "").normalize("NFKC").toLowerCase().replace(PUNCT, "");
  }

  function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  function dice(a, b) {
    if (!a.size || !b.size) return 0;
    let n = 0;
    a.forEach((x) => { if (b.has(x)) n++; });
    return (2 * n) / (a.size + b.size);
  }

  // 質問の決まり文句。似ているかどうかの計算からは外す（「〜を教えて」どうしが似てしまうのを防ぐ）
  const STOCK = ["教えてください", "教えて", "について", "でしょうか", "ですか", "ますか", "だったの", "なの", "本当"];
  function core(s) {
    let out = s;
    STOCK.forEach((w) => { out = out.split(w).join(""); });
    return out.length >= 2 ? out : s;
  }

  function containment(q, t) {
    if (!q.size) return 0;
    let n = 0;
    q.forEach((x) => { if (t.has(x)) n++; });
    return n / q.size;
  }

  function create(data) {
    // ---- 前処理：正規化した索引を作る ----
    const synonyms = Object.keys(data.synonyms || {}).map((canon) => ({
      canon: normalize(canon),
      variants: data.synonyms[canon].map(normalize),
    }));

    const topicIndex = data.topics.map((t) => ({
      topic: t,
      title: normalize(t.topic),
      keywords: t.keywords.map(normalize).filter(Boolean),
      samples: t.sample_questions.map((q) => ({ norm: normalize(q), grams: bigrams(core(normalize(q))) })),
      names: [].concat.apply([], t.entity_ids.map((id) => namesOf(data.entityMap[id]))),
    }));

    const entityIndex = data.entities
      .map((e) => ({ entity: e, names: namesOf(e) }))
      .filter((x) => x.names.length);

    const factIndex = data.facts.map((f) => {
      const e = data.entityMap[f.subject];
      const text = normalize((f.statement || "") + (e ? e.name + (e.aliases || []).join("") : "") + (f.quote || ""));
      return { fact: f, grams: bigrams(text) };
    });

    const intentIndex = Object.keys(data.intents || {}).map((k) => ({
      id: k,
      keywords: data.intents[k].keywords.map(normalize),
      predicates: data.intents[k].predicates,
    }));

    function namesOf(e) {
      if (!e) return [];
      return [e.name].concat(e.aliases || []).map(normalize).filter((n) => n.length >= 2 || /[一-龠]/.test(n));
    }

    function expand(qn) {
      let out = qn;
      synonyms.forEach((s) => {
        if (s.variants.some((v) => v && qn.indexOf(v) >= 0) && out.indexOf(s.canon) < 0) out += s.canon;
      });
      return out;
    }

    function scoreTopics(qn, ctx) {
      const grams = bigrams(core(qn));
      return topicIndex.map((ti) => {
        let score = 0;
        let anchored = false; // キーワード・名前・項目名のどれかが質問に入っているか
        const why = [];
        ti.keywords.forEach((k) => {
          if (qn.indexOf(k) >= 0) { const s = 2 + Math.min(k.length, 6) * 0.5; score += s; anchored = true; why.push("kw:" + k); }
        });
        const hitName = ti.names.filter((n) => qn.indexOf(n) >= 0).sort((a, b) => b.length - a.length)[0];
        if (hitName) { score += 1.5 + Math.min(hitName.length, 4) * 0.25; anchored = true; why.push("name:" + hitName); }
        if (ti.title && qn.indexOf(ti.title) >= 0) { score += 3; anchored = true; why.push("title"); }
        let best = 0;
        ti.samples.forEach((s) => {
          if (s.norm === qn) best = Math.max(best, 2);
          else best = Math.max(best, dice(grams, s.grams));
        });
        if (best > 0.3) { score += best * 8; why.push("sample:" + best.toFixed(2)); }
        if (ctx && ctx.prevTopic && ctx.prevTopic.related_topics.indexOf(ti.topic.id) >= 0 && score > 0) { score += 0.8; why.push("related"); }
        return { topic: ti.topic, score, why, anchored, sample: Math.min(best, 1) };
      }).sort((a, b) => b.score - a.score);
    }

    function findEntities(qn) {
      const hits = [];
      entityIndex.forEach((x) => {
        const n = x.names.filter((nm) => qn.indexOf(nm) >= 0).sort((a, b) => b.length - a.length)[0];
        if (n) hits.push({ entity: x.entity, len: n.length });
      });
      // 長い名前を優先し、短い名前がその一部なら外す（「金堂基壇」があれば「金堂」は外さず両方残す）
      hits.sort((a, b) => b.len - a.len);
      return hits.map((h) => h.entity);
    }

    function findIntent(qn) {
      for (let i = 0; i < intentIndex.length; i++) {
        if (intentIndex[i].keywords.some((k) => qn.indexOf(k) >= 0)) return intentIndex[i];
      }
      return null;
    }

    function factsFor(entities, intent, limit) {
      const ids = new Set(entities.map((e) => e.id));
      let list = data.facts.filter((f) => !f.superseded && (ids.has(f.subject) || (f.object_id && ids.has(f.object_id))));
      if (intent) {
        const narrowed = list.filter((f) => intent.predicates.indexOf(f.predicate) >= 0);
        if (narrowed.length) list = narrowed; // 意図に合う fact がなければ、その対象の主な fact を返す
      }
      list.sort((a, b) => (a.importance - b.importance) || (ids.has(a.subject) ? -1 : 1));
      return list.slice(0, limit || 3);
    }

    function fullText(qn, limit) {
      if (qn.length < 3) return [];
      const grams = bigrams(qn);
      return factIndex
        .filter((x) => !x.fact.superseded)
        .map((x) => ({ fact: x.fact, score: containment(grams, x.grams) }))
        .filter((x) => x.score >= 0.5)
        .sort((a, b) => (b.score - a.score) || (a.fact.importance - b.fact.importance))
        .slice(0, limit || 2);
    }

    /**
     * 質問を解釈する。
     * 戻り値: { kind: "topic"|"entity"|"search"|"none", topic?, entities?, intent?, facts?, debug }
     */
    function resolve(text, ctx) {
      const qn = expand(normalize(text));
      const ranked = scoreTopics(qn, ctx);
      const top = ranked[0];
      const debug = {
        query: qn,
        candidates: ranked.slice(0, 3).map((r) => ({ id: r.topic.id, score: Math.round(r.score * 100) / 100, why: r.why })),
      };
      const intent = findIntent(qn);
      const ents = findEntities(qn);

      // 項目として確かに合っている：点数が高く、かつキーワード等が入っているか質問例とほぼ同じ
      if (top && top.score >= 4 && (top.anchored || top.sample >= 0.75)) return { kind: "topic", topic: top.topic, intent, debug };

      // 対象の名前がなく、意図だけ分かるとき（「大きさは？」など）は直前の話題の対象を使う
      let targets = ents;
      let followUp = false;
      if (!targets.length && intent && ctx && ctx.prevTopic && ctx.prevTopic.entity_ids.length) {
        targets = ctx.prevTopic.entity_ids.slice(0, 3).map((id) => data.entityMap[id]).filter(Boolean);
        followUp = true;
      }
      if (targets.length) {
        const facts = factsFor(targets, intent, 3);
        if (facts.length) {
          debug.entities = targets.map((e) => e.id);
          debug.intent = intent ? intent.id : null;
          debug.follow_up = followUp;
          return { kind: "entity", entities: targets, intent, facts, debug };
        }
      }
      const anchoredTop = ranked.find((r) => r.anchored && r.score >= 2.5);
      if (anchoredTop) return { kind: "topic", topic: anchoredTop.topic, intent, debug };
      const similar = ranked.slice().sort((a, b) => b.sample - a.sample)[0];
      if (similar && similar.sample >= 0.5) return { kind: "topic", topic: similar.topic, intent, debug };

      const hits = fullText(qn, 2);
      if (hits.length) {
        debug.fulltext = hits.map((h) => ({ id: h.fact.id, score: Math.round(h.score * 100) / 100 }));
        return { kind: "search", facts: hits.map((h) => h.fact), debug };
      }
      return { kind: "none", debug };
    }

    /** 画面内検索用：語句に合う fact を返す */
    function searchFacts(text, limit) {
      return fullText(expand(normalize(text)), limit || 10).map((h) => h.fact);
    }

    return { resolve, searchFacts, normalize, scoreTopics };
  }

  const api = { create, normalize, bigrams, dice };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Heritage = root.Heritage || {};
  root.Heritage.Search = api;
})(typeof window !== "undefined" ? window : globalThis);
