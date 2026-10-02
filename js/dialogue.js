/*
 * dialogue.js — 質問 → 項目の選択（search.js）→ 使う fact の決定（dialogue.json）→ 文章生成（nlg.js）。
 * 回答文は保存しておらず、毎回 facts.json の値から作る。
 *
 * 将来、生成AIに切り替える場合は answer() の中の nlg.compose を差し替える（README 参照）。
 * そのとき渡す材料は retrieve() が返す facts（出典つき）で足りる。
 */
(function (root) {
  "use strict";

  const GREETINGS = ["こんにちは", "こんばんは", "おはよう", "はじめまして", "hello", "hi", "やあ"];
  const MORE = ["もっと詳しく", "詳しく", "もっと教えて", "くわしく", "続き", "ほかには"];
  const RESPONSE_BY_INTENT = { when: "period", size: "size", count: "size", where: "location", who: "interpretation", unknown: "uncertainty", what: "definition" };

  function create(data, nlg, search) {
    const state = { style: data.language.default_style || "normal", prevTopic: null, history: [] };

    function refsOf(facts) {
      const seen = new Set();
      const out = [];
      facts.forEach((f) => (f.source_refs || []).forEach((r) => {
        const k = r.source_id + "|" + r.page + "|" + r.pdf_page;
        if (!seen.has(k)) { seen.add(k); out.push(r); }
      }));
      out.sort((a, b) => a.pdf_page - b.pdf_page);
      return out;
    }

    function actionsOf(ids) {
      return (ids || []).map((id) => data.actionMap[id]).filter(Boolean);
    }

    function result(kind, spec, facts, extra) {
      const composed = nlg.compose({ topic: spec.topic, response_type: spec.response_type, facts, connectors: spec.connectors }, { style: state.style });
      return Object.assign({
        kind,
        topic_id: spec.id || null,
        topic: spec.topic || null,
        response_type: spec.response_type,
        style: state.style,
        text: composed.text,
        lines: composed.lines,
        parts: composed.parts,
        frame_id: composed.frame_id,
        fact_ids: facts.map((f) => f.id),
        sources: refsOf(facts),
        suggestions: [],
        actions: [],
        has_more: false,
      }, extra || {});
    }

    /** 検索だけを行う（生成AIに渡す材料を取り出す入口）。 */
    function retrieve(text) {
      const r = search.resolve(text, { prevTopic: state.prevTopic });
      if (r.kind === "topic") return { kind: r.kind, topic: r.topic, facts: r.topic.fact_ids.map((id) => data.factMap[id]), debug: r.debug };
      return { kind: r.kind, facts: r.facts || [], entities: r.entities || [], debug: r.debug };
    }

    function answerTopic(topic, debug) {
      const facts = topic.fact_ids.map((id) => data.factMap[id]).filter(Boolean);
      const res = result("topic", topic, facts, {
        suggestions: topic.suggestions.slice(),
        actions: actionsOf(topic.action_ids),
        has_more: topic.detail_fact_ids.length > 0,
        debug,
      });
      state.prevTopic = topic;
      return res;
    }

    function answerDetail(topic) {
      const facts = topic.detail_fact_ids.map((id) => data.factMap[id]).filter(Boolean);
      // 旧説（superseded）は「以前は…」として読めるよう、そのまま語尾で区別する
      return result("detail", { id: topic.id, topic: topic.topic, response_type: "definition", connectors: {} }, facts, {
        suggestions: topic.suggestions.slice(),
        actions: actionsOf(topic.action_ids),
      });
    }

    function fallback(debug) {
      const text = nlg.fallbackText("not_found") + nlg.fallbackText("ask_again");
      return {
        kind: "not_found", topic_id: null, topic: null, response_type: null, style: state.style,
        text, lines: [text], parts: [], fact_ids: [], sources: [], frame_id: "fallback",
        suggestions: data.starters.slice(0, 4), actions: [], has_more: false, debug,
      };
    }

    function ask(text) {
      const qn = search.normalize(text);
      let res;
      if (!qn) return fallback({ query: "" });

      if (MORE.some((m) => qn === search.normalize(m)) && state.prevTopic && state.prevTopic.detail_fact_ids.length) {
        res = answerDetail(state.prevTopic);
        res.debug = { query: qn, more_of: state.prevTopic.id };
      } else if (GREETINGS.some((g) => qn.indexOf(g) === 0) && qn.length <= 8) {
        const t = (data.language.fallback.greeting || [""])[0].replace("{site}", data.site.name);
        res = { kind: "greeting", topic_id: null, topic: null, response_type: "navigation", style: state.style,
          text: t, lines: [t], parts: [], fact_ids: [], sources: [], frame_id: "greeting",
          suggestions: data.starters.slice(0, 4), actions: [], has_more: false, debug: { query: qn } };
      } else {
        const r = search.resolve(text, { prevTopic: state.prevTopic });
        if (r.kind === "topic") {
          res = answerTopic(r.topic, r.debug);
        } else if (r.kind === "entity") {
          const name = r.entities[0].name;
          const rt = (r.intent && RESPONSE_BY_INTENT[r.intent.id]) || "definition";
          res = result("entity", { topic: name, response_type: rt, connectors: {} }, r.facts, { debug: r.debug });
          // 関連する項目を次の質問として出す
          const ids = new Set(r.entities.map((e) => e.id));
          res.suggestions = data.topics.filter((t) => t.entity_ids.some((id) => ids.has(id))).slice(0, 3)
            .map((t) => ({ text: t.sample_questions[0], topic_id: t.id }));
          if (!res.suggestions.length) res.suggestions = data.starters.slice(0, 3);
        } else if (r.kind === "search") {
          res = result("search", { topic: null, response_type: "definition", connectors: {} }, r.facts, { debug: r.debug });
          const lead = nlg.fallbackText("search_hit");
          res.text = lead + res.text;
          res.lines.unshift(lead);
          res.suggestions = data.starters.slice(0, 3);
        } else {
          res = fallback(r.debug);
        }
      }
      state.history.push({ q: text, kind: res.kind, topic_id: res.topic_id });
      return res;
    }

    /** 関連質問のボタンから呼ぶ（文字の照合を通さず、項目を直接指定する）。 */
    function askTopic(topicId) {
      const topic = data.topicMap[topicId];
      if (!topic) return fallback({ query: topicId });
      const res = answerTopic(topic, { query: "(button)", candidates: [{ id: topicId, score: null, why: ["button"] }] });
      state.history.push({ q: "(button)", kind: res.kind, topic_id: topicId });
      return res;
    }

    function more() {
      if (!state.prevTopic) return fallback({ query: "(more)" });
      const res = answerDetail(state.prevTopic);
      res.debug = { query: "(more)", more_of: state.prevTopic.id };
      return res;
    }

    return {
      ask, askTopic, more, retrieve, state,
      setStyle(s) { if (data.language.styles[s]) state.style = s; },
      styles() { return Object.keys(data.language.styles).map((k) => ({ id: k, name: data.language.styles[k].name })); },
    };
  }

  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Heritage = root.Heritage || {};
  root.Heritage.Dialogue = api;
})(typeof window !== "undefined" ? window : globalThis);
