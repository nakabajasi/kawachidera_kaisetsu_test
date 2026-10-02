/*
 * app.js — 画面の切り替えと各ページの表示。
 * 文章はページごとに持たず、facts.json の値を nlg.js で文にして表示する。
 * URL に ?debug=true を付けると、文ごとの fact_id・言い回し・出典を表示する。
 */
(function () {
  "use strict";
  const H = window.Heritage;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DEBUG = new URLSearchParams(location.search).get("debug") === "true";

  const CERT = {
    confirmed: { label: "確認されたこと・断定の記述", short: "確認" },
    probable: { label: "推定・解釈（〜と考えられる）", short: "推定" },
    possible: { label: "可能性（〜の可能性がある）", short: "可能性" },
    uncertain: { label: "はっきりしない・旧説・不明", short: "不確か" },
  };
  const STATUS = { fact: "調査の記録", estimate: "復元・算出の値", interpretation: "解釈", hypothesis: "仮説・伝承", unknown: "不明" };
  const STATE = { confirmed: "遺構を確認", estimated: "推定（未検出）" };
  const PAGES = [
    { path: "/overview", title: "史跡概要", note: "場所、寺のすがた、時期ごとの移り変わり" },
    { path: "/map", title: "現地マップ", note: "伽藍配置の模式図から地点を選ぶ" },
    { path: "/features", title: "遺構", note: "金堂・講堂・回廊・寺域北方" },
    { path: "/artifacts", title: "出土遺物", note: "瓦、土器、硯、石製品" },
    { path: "/gallery", title: "画像・図面", note: "報告書の図と写真の一覧" },
    { path: "/chat", title: "対話型解説", note: "質問すると報告書の内容から答える" },
    { path: "/quiz", title: "クイズ", note: "報告書の内容から12問" },
    { path: "/experience", title: "AR・体験", note: "カメラへの重ね表示、記念撮影、3D資料" },
    { path: "/sources", title: "出典", note: "報告書の情報、頁の見方、確認が必要な事項" },
  ];

  let data, nlg, search, dialogue;
  const main = $("#main");
  const chat = { messages: [], greeted: false };

  // ───────── 共通の部品 ─────────
  function refLabel(r) {
    return r.page != null ? "p." + r.page : "PDF " + r.pdf_page + "頁";
  }

  // 縦書きの見出し。writing-mode に頼らず1文字ずつ積む（端末の書体によって縦書きの字送りが崩れるのを避ける）
  function vertical(text) {
    return Array.from(String(text || "")).map((ch) =>
      `<span${/[ー（）()〜～\-－—]/.test(ch) ? ' class="vt__rot"' : ""} aria-hidden="true">${esc(ch)}</span>`).join("");
  }

  function certMark(c) {
    return `<span class="cert cert--${esc(c)}" role="img" aria-label="${esc(CERT[c] ? CERT[c].short : c)}"></span>`;
  }

  function sentenceOf(fact, opts) {
    return nlg.sentence(fact, Object.assign({ style: "normal", fixed: true }, opts || {}));
  }

  function factHTML(fact, opts) {
    if (!fact) return "";
    const s = sentenceOf(fact, opts);
    const refs = fact.source_refs.map(refLabel).join("・");
    return `<p class="fs">${certMark(fact.certainty)}<span class="fs__text">${esc(s.text)}</span>` +
      `<button type="button" class="ref" data-fact="${esc(fact.id)}" aria-label="出典 ${esc(refs)} を表示">${esc(refs)}</button>` +
      (DEBUG ? `<code class="dbg">${esc(fact.id)} / ${esc(s.template_id)} / ${esc(fact.status)}・${esc(fact.modality)}</code>` : "") + `</p>`;
  }

  function factsHTML(ids, opts) {
    return ids.map((id) => factHTML(data.factMap[id], opts)).join("");
  }

  function legendHTML() {
    return `<details class="legend"><summary>文頭の印と頁番号の見方</summary>
      <ul>${Object.keys(CERT).map((k) => `<li>${certMark(k)}${esc(CERT[k].label)}</li>`).join("")}</ul>
      <p>文末の「p.11」などは報告書の頁です。押すと、もとの記述と区分を確認できます。</p></details>`;
  }

  function actionButtons(actions) {
    if (!actions || !actions.length) return "";
    return `<div class="acts">${actions.map((a) =>
      `<button type="button" class="act act--${esc(a.type)}" data-action="${esc(a.id)}">${esc(a.label)}</button>`).join("")}</div>`;
  }

  function topicChips(items) {
    if (!items || !items.length) return "";
    return `<div class="chips">${items.map((s) =>
      `<button type="button" class="chip" data-ask-topic="${esc(s.topic_id)}">${esc(s.text)}</button>`).join("")}</div>`;
  }

  function runAction(id) {
    const a = data.actionMap[id];
    if (!a) return;
    if (a.type === "external") { window.open(a.url, "_blank", "noopener"); return; }
    if (a.url.charAt(0) === "#") { location.hash = a.url.slice(1); return; }
    location.href = a.url + (DEBUG ? (a.url.indexOf("?") >= 0 ? "&" : "?") + "debug=true" : ""); // AR・カメラは別ページ（相対パス）
  }

  // ───────── 下から出るパネル（出典の確認など） ─────────
  const sheet = $("#sheet");
  let sheetReturn = null;
  function openSheet(title, html) {
    sheetReturn = document.activeElement;
    $("#sheetTitle").textContent = title;
    $("#sheetContent").innerHTML = html;
    sheet.hidden = false;
    document.body.classList.add("has-sheet");
    $(".sheet__close").focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.classList.remove("has-sheet");
    if (sheetReturn && sheetReturn.focus) sheetReturn.focus();
  }
  sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  function openFactSheet(id) {
    const f = data.factMap[id];
    if (!f) return;
    const src = data.sourceMap[f.source_refs[0].source_id];
    const rows = [
      ["区分", STATUS[f.status] || f.status],
      ["確からしさ", (CERT[f.certainty] || {}).label || f.certainty],
      f.source_expression ? ["報告書の書き方", "「" + f.source_expression + "」"] : null,
      f.attribution && f.attribution.type !== "report" ? ["誰の見方か", f.attribution.label] : null,
      f.superseded ? ["扱い", "以前の見方（その後に見直されたもの）"] : null,
      ["頁", f.source_refs.map((r) => refLabel(r) + (r.locator ? "（" + r.locator + "）" : "") + (r.page != null ? " ／ PDF " + r.pdf_page + "頁" : "")).join("、")],
    ].filter(Boolean);
    openSheet("出典の確認", `
      <p class="sheet__statement">${certMark(f.certainty)}${esc(f.statement)}</p>
      <dl class="kv">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join("")}</dl>
      <h3>報告書のもとの記述</h3>
      <blockquote class="quote">${esc(f.quote)}</blockquote>
      ${f.note ? `<p class="caution">${esc(f.note)}</p>` : ""}
      <p class="sheet__src">${esc(src.organization)} ${esc(src.year)}『${esc(src.title)}』</p>
      ${DEBUG ? `<pre class="dbg">fact_id: ${esc(f.id)}\nsubject: ${esc(f.subject)}\npredicate: ${esc(f.predicate)}\nobject: ${esc(f.object)}\nstatus: ${esc(f.status)} / certainty: ${esc(f.certainty)} / modality: ${esc(f.modality)}\nsource_id: ${esc(f.source_refs[0].source_id)}</pre>` : ""}
    `);
  }

  // ───────── ページ ─────────
  const routes = {};

  routes["/home"] = function () {
    const site = data.site;
    const reading = data.factMap[site.reading_fact_id];
    main.innerHTML = `
      <section class="hero">
        <div class="hero__plan" id="heroPlan"></div>
        <div class="hero__title">
          <h1 class="vt" aria-label="${esc(site.name)}">${vertical(site.name)}</h1>
          <p class="hero__reading vt" aria-label="${esc(reading ? reading.object : "")}">${vertical(reading ? reading.object : "")}</p>
        </div>
      </section>
      <section class="lead">${factsHTML(site.summary_fact_ids)}</section>
      <section class="block">
        <h2>聞いてみる</h2>
        ${topicChips(data.starters)}
        <p><a class="textlink" href="#/chat">質問を自分で入力する</a></p>
      </section>
      <section class="block">
        <h2>見る・読む</h2>
        <ul class="menu">${PAGES.filter((p) => p.path !== "/chat").map((p) =>
          `<li><a href="#${p.path}"><span class="menu__title">${esc(p.title)}</span><span class="menu__note">${esc(p.note)}</span></a></li>`).join("")}</ul>
      </section>
      <p class="foot">この解説は、${esc(data.sources[0].organization)}『${esc(data.sources[0].title)}』（${esc(data.sources[0].year)}）に書かれている内容だけをもとにしています。<a class="textlink" href="#/sources">出典を見る</a></p>`;
    H.Map.render($("#heroPlan"), data, { compact: true, onSelect: (id) => { location.hash = "/map?spot=" + id; } });
    return data.site.category;
  };

  routes["/menu"] = function () {
    const dbgUrl = location.pathname + (DEBUG ? "" : "?debug=true") + "#/menu";
    main.innerHTML = `
      <h1 class="h1">メニュー</h1>
      <ul class="menu">${[{ path: "/home", title: "ホーム", note: "はじめの画面" }].concat(PAGES).map((p) =>
        `<li><a href="#${p.path}"><span class="menu__title">${esc(p.title)}</span><span class="menu__note">${esc(p.note)}</span></a></li>`).join("")}</ul>
      <section class="block">
        <h2>このアプリについて</h2>
        <p>収めているデータ：記述 ${data.facts.length} 件、対象 ${data.entities.length} 件、対話の項目 ${data.topics.length} 件、クイズ ${data.quiz.length} 問。</p>
        <p>通信は最初のデータ読み込みだけです。カメラは「AR・体験」でボタンを押したときにだけ使います。</p>
        <p><a class="textlink" href="${esc(dbgUrl)}">${DEBUG ? "確認用の表示を消す" : "確認用の表示（fact_id と出典）を出す"}</a></p>
      </section>`;
    return "メニュー";
  };

  routes["/overview"] = function (q) {
    const pg = data.site.pages;
    main.innerHTML = `
      <h1 class="h1">史跡概要</h1>
      ${legendHTML()}
      ${pg.overview.map((sec) => `<section class="block"><h2>${esc(sec.title)}</h2>
        ${sec.note_kind === "multi_view" ? `<p class="caution">見方が分かれています。報告書の書き方のまま並べます。</p>` : ""}
        ${factsHTML(sec.fact_ids)}</section>`).join("")}
      <section class="block" id="timeline">
        <h2>時期ごとの移り変わり</h2>
        <ol class="timeline">${pg.timeline.map((ph) => `<li><h3>${esc(data.entityMap[ph.period_id].name)}</h3>${factsHTML(ph.fact_ids)}</li>`).join("")}</ol>
      </section>
      ${actionButtons(["action_open_map", "action_sources"].map((id) => data.actionMap[id]))}`;
    if (q.sec === "timeline") requestAnimationFrame(() => $("#timeline").scrollIntoView());
    return "史跡概要";
  };

  function spotBadge(spot) {
    return `<span class="badge badge--${esc(spot.state)}">${esc(STATE[spot.state] || spot.state)}</span>` +
      (spot.in_designated_area === false ? `<span class="badge badge--outside">史跡指定範囲の外</span>` : "");
  }

  function spotPanel(spot, full) {
    const facts = full ? spot.description_fact_ids : spot.description_fact_ids.slice(0, 3);
    const empty = `<p class="fs fs--empty">この地点について、報告書に解説の記述はありません。図（${spot.source_refs.map((r) => esc(r.locator) + "・" + esc(refLabel(r))).join("、")}）に示されているだけです。</p>`;
    return `<div class="spot">
      <h2>${esc(spot.name)}</h2>
      <p class="badges">${spotBadge(spot)}</p>
      ${facts.length ? factsHTML(facts) : empty}
      ${!full && spot.description_fact_ids.length > 3 ? `<p><a class="textlink" href="#/features/${esc(spot.id)}">この地点の解説をすべて読む（${spot.description_fact_ids.length}件）</a></p>` : ""}
      ${topicChips(spot.topic_ids.map((id) => ({ topic_id: id, text: data.topicMap[id].sample_questions[0] })))}
      ${actionButtons(spot.action_ids.map((id) => data.actionMap[id]))}
    </div>`;
  }

  routes["/map"] = function (q) {
    let selected = q.spot && data.spotMap[q.spot] ? q.spot : null;
    main.innerHTML = `
      <h1 class="h1">現地マップ</h1>
      <div class="planwrap" id="plan"></div>
      <p class="caption">実線は遺構を確認した場所、破線は推定地です。赤い破線は史跡指定範囲の南の境（概略）です。</p>
      <p class="caption">${esc(data.map.note)}</p>
      <div id="spotPanel" aria-live="polite"></div>
      <section class="block">
        <h2>地点の一覧</h2>
        <ul class="spotlist">${data.spots.map((s) => `<li><button type="button" data-pick="${esc(s.id)}">${esc(s.name)}${spotBadge(s)}</button></li>`).join("")}</ul>
      </section>
      ${legendHTML()}`;
    const draw = () => {
      H.Map.render($("#plan"), data, { selected, onSelect: (id) => { selected = id; draw(); $("#spotPanel").scrollIntoView({ block: "nearest", behavior: "smooth" }); } });
      $("#spotPanel").innerHTML = selected ? spotPanel(data.spotMap[selected], false) : `<p class="hint">図の建物を押すと、その場所の解説を表示します。</p>`;
      $$("[data-pick]").forEach((b) => b.classList.toggle("is-current", b.dataset.pick === selected));
      history.replaceState(null, "", location.pathname + location.search + "#/map" + (selected ? "?spot=" + selected : ""));
    };
    $(".spotlist").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      selected = b.dataset.pick; draw();
      $("#plan").scrollIntoView({ block: "start", behavior: "smooth" });
    });
    draw();
    return "現地マップ";
  };

  routes["/features"] = function (q, rest) {
    if (rest && data.spotMap[rest]) {
      const spot = data.spotMap[rest];
      main.innerHTML = `
        <p class="crumb"><a class="textlink" href="#/features">遺構の一覧へ</a></p>
        <div class="feature">
          <div class="feature__plan" id="miniPlan"></div>
          ${spotPanel(spot, true)}
        </div>
        ${H.Media.cards(spot.media_ids.map((id) => data.mediaMap[id]), data, { refLabel, esc })}
        ${legendHTML()}`;
      H.Map.render($("#miniPlan"), data, { compact: true, selected: spot.id, onSelect: (id) => { location.hash = "/features/" + id; } });
      H.Media.hydrate(main, data);
      return spot.name;
    }
    main.innerHTML = `
      <h1 class="h1">遺構</h1>
      <p class="hint">報告書が扱う地点です。実線は遺構を確認した場所、破線は推定地です。</p>
      <ul class="cards">${data.spots.map((s) => {
        const first = data.factMap[s.description_fact_ids[0]];
        return `<li><a href="#/features/${esc(s.id)}"><h2>${esc(s.name)}</h2><p class="badges">${spotBadge(s)}</p>
          <p class="cards__lead">${first ? esc(sentenceOf(first).text) : "報告書に解説の記述はありません。"}</p></a></li>`;
      }).join("")}</ul>
      ${actionButtons([data.actionMap.action_open_map])}`;
    return "遺構";
  };

  routes["/artifacts"] = function () {
    main.innerHTML = `
      <h1 class="h1">出土遺物</h1>
      ${legendHTML()}
      ${data.site.pages.artifacts.map((sec) => `<section class="block"><h2>${esc(sec.title)}</h2>
        ${factsHTML(sec.fact_ids)}
        ${H.Media.cards((sec.media_ids || []).map((id) => data.mediaMap[id]), data, { refLabel, esc })}
        ${sec.topic_id ? topicChips([{ topic_id: sec.topic_id, text: data.topicMap[sec.topic_id].sample_questions[0] }]) : ""}
      </section>`).join("")}`;
    H.Media.hydrate(main, data);
    return "出土遺物";
  };

  routes["/gallery"] = function () {
    main.innerHTML = `<h1 class="h1">画像・図面</h1><div id="gallery"></div>`;
    H.Media.gallery($("#gallery"), data, { refLabel, esc });
    return "画像・図面";
  };

  routes["/experience"] = function (q) {
    const by = (t) => data.actions.filter((a) => a.type === t);
    const models = data.media.filter((m) => m.type === "model3d");
    main.innerHTML = `
      <h1 class="h1">AR・体験</h1>
      <section class="block">
        <h2>カメラに重ねて見る</h2>
        <p>金堂の柱配置の模式図を、カメラの映像に重ねて表示します。位置と大きさは画面上で手で合わせます。</p>
        ${actionButtons(by("ar"))}
      </section>
      <section class="block">
        <h2>記念フレームで撮影する</h2>
        <p>史跡名の入った枠をつけて写真を撮り、端末に保存できます。写真は端末の中だけで処理し、送信しません。</p>
        ${actionButtons(by("camera"))}
      </section>
      <p class="caution">カメラは、次の画面で「カメラを使う」を押したときにだけ許可を求めます。https で開いているときに動きます。</p>
      <section class="block" id="model3d">
        <h2>3D資料</h2>
        ${models.map((m) => `<div class="mediacard mediacard--none"><h3>${esc(m.title)}</h3><p>${esc(m.caption)}</p>
          <p class="mediacard__meta">${m.source_refs.map((r) => esc(refLabel(r)) + (r.locator ? "（" + esc(r.locator) + "）" : "")).join("、")}</p></div>`).join("")}
        <p class="hint">3Dモデルのファイルは、まだこのアプリに入っていません。入手できたら models/ に置いて登録します（README 参照）。</p>
      </section>
      ${actionButtons([data.actionMap.action_quiz, data.actionMap.action_open_map])}`;
    if (q.sec === "model3d") requestAnimationFrame(() => $("#model3d").scrollIntoView());
    return "AR・体験";
  };

  routes["/quiz"] = function () {
    main.innerHTML = `<h1 class="h1">クイズ</h1><div id="quiz"></div>`;
    H.Quiz.mount($("#quiz"), data, { factHTML, refLabel, esc, DEBUG });
    return "クイズ";
  };

  routes["/sources"] = function () {
    const src = data.sources[0];
    const cited = data.sources.filter((s) => s.role !== "primary");
    const rv = data.review;
    const cats = [["conflicts", "記述の食い違い"], ["uncertain_information", "確からしさが定まらない事項"], ["missing_information", "報告書にない情報"], ["copyright_review", "権利の確認"], ["human_review", "人による確認"]];
    main.innerHTML = `
      <h1 class="h1">出典</h1>
      <section class="block">
        <h2>もとにした報告書</h2>
        <p class="biblio">${esc(src.organization)} ${esc(src.year)}『${esc(src.title)}』</p>
        <dl class="kv"><dt>発行</dt><dd>${esc(src.published)}</dd><dt>作成・編集</dt><dd>${esc(src.author)}</dd><dt>頁の示し方</dt><dd>${esc(src.page_note || src.page_rule)}</dd></dl>
        ${actionButtons([data.actionMap.action_report_external])}
      </section>
      ${legendHTML()}
      <section class="block">
        <h2>記述を探す</h2>
        <form id="factSearch" class="searchform"><input type="search" id="factQuery" placeholder="例：礎石、平安時代、瓦" aria-label="探す語句"><button type="submit">探す</button></form>
        <div id="factResults"></div>
      </section>
      <section class="block">
        <h2>報告書の構成</h2>
        <table class="table"><thead><tr><th>章・節</th><th>頁</th><th>執筆</th></tr></thead><tbody>
        ${src.sections.map((s) => `<tr><td>${esc(s.title)}</td><td>${esc(s.pages || "PDF " + s.pdf_pages)}</td><td>${esc(s.author || "")}</td></tr>`).join("")}
        </tbody></table>
      </section>
      <section class="block">
        <h2>報告書が引いている文献</h2>
        <p class="hint">下の文献は報告書の中で紹介されているもので、このアプリでは原本を確認していません。</p>
        <ul class="plain">${cited.map((s) => `<li>${esc(s.author || s.organization || "")} ${esc(s.year)}『${esc(s.title)}』</li>`).join("")}</ul>
      </section>
      ${rv ? `<section class="block"><h2>人の確認が必要な事項</h2>
        <p class="hint">報告書の中で記述が食い違う箇所や、このアプリを作るときに確定できなかった点です。</p>
        ${cats.map(([k, label]) => `<details class="review"><summary>${esc(label)}（${(rv[k] || []).length}件）</summary><ul>${(rv[k] || []).map((it) =>
          `<li><b>${esc(it.item)}</b>　${esc(it.reason)}${it.source_refs && it.source_refs.length ? `<span class="review__ref">${it.source_refs.map(refLabel).map(esc).join("・")}</span>` : ""}</li>`).join("")}</ul></details>`).join("")}
      </section>` : ""}`;
    $("#factSearch").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#factQuery").value.trim();
      if (!q) return;
      const qn = search.normalize(q);
      const hits = data.facts.filter((f) => search.normalize(f.statement + (f.quote || "")).indexOf(qn) >= 0);
      const more = search.searchFacts(q, 10).filter((f) => hits.indexOf(f) < 0);
      const list = hits.concat(more).slice(0, 30);
      $("#factResults").innerHTML = list.length
        ? `<p class="hint">${list.length}件${hits.length + more.length > 30 ? "（先頭の30件）" : ""}</p>` + list.map((f) => factHTML(f)).join("")
        : `<p class="hint">「${esc(q)}」を含む記述は見つかりませんでした。別の語句で探してください。</p>`;
    });
    return "出典";
  };

  // ───────── 対話 ─────────
  function speak(text, btn) {
    if (!("speechSynthesis" in window)) return;
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); $$(".js-speak").forEach((b) => { b.textContent = "読み上げる"; }); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.onend = () => { btn.textContent = "読み上げる"; };
    btn.textContent = "読み上げを止める";
    speechSynthesis.speak(u);
  }

  function answerHTML(m, i) {
    const r = m.res;
    const facts = r.fact_ids.map((id) => data.factMap[id]);
    const canSpeak = "speechSynthesis" in window;
    const evidence = facts.length ? `<details class="evidence"><summary>根拠の記述と頁（${facts.length}件）</summary>
      ${r.parts.map((p) => {
        const f = data.factMap[p.fact_id];
        return `<p class="fs">${certMark(f.certainty)}<span class="fs__text">${esc(f.statement)}</span><button type="button" class="ref" data-fact="${esc(f.id)}">${esc(f.source_refs.map(refLabel).join("・"))}</button></p>`;
      }).join("")}</details>` : "";
    const dbg = DEBUG ? `<pre class="dbg">topic: ${esc(r.topic_id || "(なし)")} ／ kind: ${esc(r.kind)} ／ style: ${esc(r.style)}
frame: ${esc(r.frame_id)}
${r.parts.map((p) => {
      const f = data.factMap[p.fact_id];
      return `fact_id: ${esc(p.fact_id)}\n  template: ${esc(p.template_id)}\n  ${f.source_refs.map((x) => `source_id: ${esc(x.source_id)} / page: ${x.page == null ? "null" : x.page} / pdf_page: ${x.pdf_page}`).join("\n  ")}`;
    }).join("\n")}
match: ${esc(JSON.stringify(r.debug && (r.debug.candidates || r.debug)))}</pre>` : "";
    return `<div class="msg msg--sys" data-i="${i}">
      <p class="msg__text">${esc(r.text)}</p>
      <div class="msg__tools">
        ${r.has_more ? `<button type="button" class="tool" data-more="1">もっと詳しく</button>` : ""}
        ${canSpeak ? `<button type="button" class="tool js-speak" data-speak="${i}">読み上げる</button>` : ""}
      </div>
      ${evidence}
      ${topicChips(r.suggestions)}
      ${actionButtons(r.actions)}
      ${dbg}
    </div>`;
  }

  function renderChat() {
    const log = $("#chatLog");
    if (!log) return;
    log.innerHTML = chat.messages.map((m, i) => m.role === "user"
      ? `<div class="msg msg--user"><p class="msg__text">${esc(m.text)}</p></div>` : answerHTML(m, i)).join("");
    const t = dialogue.state.prevTopic;
    $("#curTopic").textContent = t ? t.topic : "まだありません";
    // 直前の質問が画面の上に来るように送る（長い回答でも読み始めが見える）
    const users = $$(".msg--user", log);
    const target = users.length ? users[users.length - 1] : log.lastElementChild;
    if (target) target.scrollIntoView({ block: "start" });
  }

  function pushAnswer(question, res) {
    if (question) chat.messages.push({ role: "user", text: question });
    chat.messages.push({ role: "sys", res });
    renderChat();
  }

  function greet() {
    if (chat.greeted) return;
    chat.greeted = true;
    chat.messages.push({ role: "sys", res: dialogue.ask("こんにちは") });
  }

  routes["/chat"] = function (q) {
    greet();
    main.innerHTML = `
      <section class="chat">
        <div class="chat__bar">
          <p class="chat__topic">いまの話題：<b id="curTopic"></b></p>
          <div class="seg" role="group" aria-label="話し方">
            ${dialogue.styles().map((s) => `<button type="button" data-style="${esc(s.id)}" aria-pressed="${s.id === dialogue.state.style}">${esc(s.name)}</button>`).join("")}
          </div>
        </div>
        <div class="chat__log" id="chatLog" aria-live="polite"></div>
        <form class="chat__form" id="chatForm" autocomplete="off">
          <input id="chatInput" type="text" enterkeyhint="send" placeholder="例：金堂の大きさは？" aria-label="質問を入力">
          <button type="submit">送信</button>
        </form>
      </section>`;
    $("#chatForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#chatInput");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      pushAnswer(text, dialogue.ask(text));
    });
    $(".seg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-style]");
      if (!b) return;
      dialogue.setStyle(b.dataset.style);
      $$(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    renderChat();
    if (q.topic && data.topicMap[q.topic]) askTopic(q.topic);
    return "対話型解説";
  };

  function askTopic(topicId) {
    const topic = data.topicMap[topicId];
    if (!topic) return;
    const label = topic.sample_questions[0] || topic.topic;
    if (currentPath() !== "/chat") {
      greet();
      chat.messages.push({ role: "user", text: label });
      chat.messages.push({ role: "sys", res: dialogue.askTopic(topicId) });
      location.hash = "/chat";
      return;
    }
    pushAnswer(label, dialogue.askTopic(topicId));
  }

  // ───────── 画面のどこでも効く操作 ─────────
  document.addEventListener("click", (e) => {
    const ref = e.target.closest(".ref[data-fact]");
    if (ref) { openFactSheet(ref.dataset.fact); return; }
    const act = e.target.closest("[data-action]");
    if (act) { closeSheet(); runAction(act.dataset.action); return; }
    const ask = e.target.closest("[data-ask-topic]");
    if (ask) {
      const text = ask.textContent;
      const id = ask.dataset.askTopic;
      if (currentPath() === "/chat") { pushAnswer(text, dialogue.askTopic(id)); }
      else { greet(); chat.messages.push({ role: "user", text }); chat.messages.push({ role: "sys", res: dialogue.askTopic(id) }); location.hash = "/chat"; }
      return;
    }
    const more = e.target.closest("[data-more]");
    if (more) { pushAnswer("もっと詳しく", dialogue.more()); return; }
    const sp = e.target.closest("[data-speak]");
    if (sp) { speak(chat.messages[Number(sp.dataset.speak)].res.text, sp); return; }
  });

  // ───────── 画面の切り替え ─────────
  function parseHash() {
    const h = location.hash.replace(/^#/, "") || "/home";
    const [p, qs] = h.split("?");
    const q = {};
    (qs || "").split("&").filter(Boolean).forEach((kv) => { const [k, v] = kv.split("="); q[decodeURIComponent(k)] = decodeURIComponent(v || ""); });
    const seg = p.split("/").filter(Boolean);
    return { path: "/" + (seg[0] || "home"), rest: seg[1] || null, query: q };
  }
  function currentPath() { return parseHash().path; }

  function route() {
    const r = parseHash();
    const fn = routes[r.path] || routes["/home"];
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    closeSheet();
    const title = fn(r.query, r.rest) || "";
    $("#pageTitle").textContent = r.path === "/home" ? "" : title;
    document.title = (r.path === "/home" ? "" : title + "｜") + data.site.name + " 史跡解説";
    document.body.dataset.page = r.path.slice(1);
    const tab = { "/home": "home", "/map": "map", "/chat": "chat", "/quiz": "quiz" }[r.path] || (r.path === "/menu" ? "menu" : null);
    $$(".tabs a").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (!(r.path === "/chat" || r.query.sec || r.query.spot)) window.scrollTo(0, 0);
  }
  async function start() {
    try {
      data = await H.Store.load("./");
    } catch (e) {
      main.innerHTML = `<p class="error">データを読み込めませんでした。data フォルダが index.html と同じ場所にあるか確認してください。<br><small>${esc(e.message)}</small></p>`;
      return;
    }
    nlg = H.NLG.create({ language: data.language, entityMap: data.entityMap });
    search = H.Search.create(data);
    dialogue = H.Dialogue.create(data, nlg, search);
    $("#siteName").textContent = data.site.short_name;
    if (DEBUG) document.body.classList.add("is-debug");
    // 確認用表示のまま画面を移れるよう、ページ内リンクはハッシュだけを変える（?debug=true は保たれる）
    window.addEventListener("hashchange", route);
    route();
  }

  start();
})();
