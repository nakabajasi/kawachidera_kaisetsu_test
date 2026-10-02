/*
 * nlg.js — facts.json の値を language.json の言い回しに差し込んで文を作る。
 * 確からしさ（modality / certainty）に対応する語尾だけを使い、言い換えで確からしさを変えない。
 * ブラウザと Node の両方で動く（tools/ のテストから読み込むため）。
 */
(function (root) {
  "use strict";

  // 語尾を付けずに polite をそのまま使う型
  var DIRECT = { assert: true, unknown: true, undetermined: true };

  function create(data) {
    var lang = data.language;
    var entities = data.entityMap;
    var lastPick = {}; // 直前に使った候補の番号（同じ言い回しが続かないようにする）
    var rng = data.rng || Math.random;

    function pick(key, list, fixed) {
      if (!list || !list.length) return { text: "", index: -1 };
      if (fixed || list.length === 1) return { text: list[0], index: 0 };
      var i, guard = 0;
      do { i = Math.floor(rng() * list.length); guard++; } while (i === lastPick[key] && guard < 12);
      lastPick[key] = i;
      return { text: list[i], index: i };
    }

    function fill(tpl, vars) {
      return tpl.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? "" : vars[k]; });
    }

    function subjectText(fact) {
      var e = entities[fact.subject];
      var name = fact.subject_text || (e ? e.name : fact.subject);
      return (fact.scope_text || "") + name;
    }

    function templatesFor(fact) {
      if (lang.sentences[fact.predicate]) return { list: lang.sentences[fact.predicate], family: fact.predicate };
      if (lang.labels[fact.predicate]) return { list: lang.families.measure, family: "measure" };
      return { list: lang.sentences.is_a, family: "is_a" };
    }

    function endingKey(fact) {
      if (fact.superseded) return "reported_old";
      if (fact.modality === "reported") {
        return fact.attribution && fact.attribution.type === "tradition" ? "reported_tradition" : "reported";
      }
      return fact.modality;
    }

    function rewritePolite(text, style, fixed) {
      var rules = (lang.polite_rewrites && lang.polite_rewrites[style]) || [];
      for (var i = 0; i < rules.length; i++) {
        var m = rules[i].match;
        if (text.slice(-m.length) === m) {
          var p = pick("rw:" + style + ":" + m, rules[i].to, fixed);
          return text.slice(0, text.length - m.length) + p.text;
        }
      }
      return text;
    }

    /**
     * 1つの fact から1文を作る。
     * opts: { style, fixed(常に先頭の言い回し), first(回答の最初の文か), noPrefix }
     */
    function sentence(fact, opts) {
      opts = opts || {};
      var style = opts.style || lang.default_style || "normal";
      var written = style === "written";
      var fixed = !!opts.fixed || written;
      var t = templatesFor(fact);
      var p = pick("tpl:" + t.family, t.list, fixed);
      var tpl = p.text;
      var vars = { s: subjectText(fact), o: fact.object == null ? "" : fact.object, label: lang.labels[fact.predicate] || "" };
      var key = endingKey(fact);
      var text, endingId;

      if (DIRECT[key]) {
        if (written) text = fill(tpl.plain, vars) + "。";
        else text = rewritePolite(fill(tpl.polite, vars), style, fixed);
        endingId = "polite";
      } else {
        var table = lang.modality_endings[style] || lang.modality_endings.normal;
        var list = table[key];
        if (!list) { // modality が無い・未知のときは certainty の代表語尾に落とす
          list = lang.certainty_phrases[fact.certainty] || lang.certainty_phrases.uncertain;
          key = "certainty:" + fact.certainty;
        }
        var e = pick("end:" + style + ":" + key, list, fixed);
        text = fill(tpl.plain, vars) + e.text;
        endingId = key + "#" + e.index;
      }

      var prefix = "";
      var at = fact.attribution || { type: "report" };
      if (!opts.noPrefix && at.type !== "report" && lang.attribution_prefix[at.type]) {
        var ap = pick("attr:" + at.type, lang.attribution_prefix[at.type], fixed);
        prefix = fill(ap.text, { label: at.label });
      } else if (opts.first && !fixed && at.type === "report" && !fact.scope_text) {
        var st = lang.styles[style];
        if (st && st.lead_in) prefix = pick("lead:" + style, st.lead_in, false).text;
      }

      return {
        text: prefix + text,
        fact_id: fact.id,
        template_id: t.family + "#" + p.index + "/" + endingId,
        modality: fact.modality,
        certainty: fact.certainty,
      };
    }

    /**
     * 複数の fact から回答文を組み立てる。
     * spec: { topic, response_type, facts:[fact], connectors:{fact_id: 種別} }
     */
    function compose(spec, opts) {
      opts = opts || {};
      var style = opts.style || lang.default_style || "normal";
      var st = lang.styles[style] || lang.styles.normal;
      var frame = st[spec.response_type] || st.definition || {};
      var parts = [];
      var out = [];

      var intro = pick("intro:" + style + ":" + spec.response_type, frame.intro || [""], opts.fixed);
      if (intro.text) out.push(fill(intro.text, { topic: spec.topic || "" }));

      (spec.facts || []).forEach(function (fact, i) {
        var s = sentence(fact, { style: style, fixed: opts.fixed, first: i === 0 && !intro.text });
        var conn = "";
        if (i > 0) {
          var kind = (spec.connectors && spec.connectors[fact.id]) || "addition";
          if (kind !== "none" && lang.connectors[kind]) conn = pick("conn:" + kind, lang.connectors[kind], opts.fixed).text;
        }
        s.text = conn + s.text;
        parts.push(s);
        out.push(s.text);
      });

      var outro = pick("outro:" + style + ":" + spec.response_type, frame.outro || [""], opts.fixed);
      if (outro.text && parts.length) out.push(fill(outro.text, { topic: spec.topic || "" }));

      return {
        text: out.join(""),
        lines: out,
        parts: parts,
        frame_id: spec.response_type + "@" + style + "/intro#" + intro.index + "/outro#" + outro.index,
      };
    }

    function fallbackText(kind, style) {
      var list = (lang.fallback && lang.fallback[kind]) || [""];
      return pick("fb:" + kind, list, false).text;
    }

    return { sentence: sentence, compose: compose, fallbackText: fallbackText, DIRECT: DIRECT };
  }

  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Heritage = root.Heritage || {};
  root.Heritage.NLG = api;
})(typeof window !== "undefined" ? window : globalThis);
