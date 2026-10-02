/*
 * quiz.js — quiz.json の問題を1問ずつ出す。
 * 解説は explanation_fact_ids の fact から文を作り、出典の頁を添える。
 */
(function (root) {
  "use strict";

  function shuffle(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function mount(container, data, h) {
    const total = data.quiz.length;
    let order, pos, score, answered, choiceOrder;

    function begin() {
      order = shuffle(total); pos = 0; score = 0;
      show();
    }

    function show() {
      const q = data.quiz[order[pos]];
      answered = false;
      choiceOrder = shuffle(q.choices.length);
      container.innerHTML = `
        <p class="quiz__count">${pos + 1}問目（全${total}問）</p>
        <h2 class="quiz__q" id="quizQ" tabindex="-1">${h.esc(q.question)}</h2>
        <ul class="quiz__choices">${choiceOrder.map((ci) =>
          `<li><button type="button" data-choice="${ci}">${h.esc(q.choices[ci])}</button></li>`).join("")}</ul>
        <div class="quiz__result" id="quizResult" aria-live="polite"></div>
        ${h.DEBUG ? `<pre class="dbg">quiz_id: ${h.esc(q.id)}\ncorrect_index: ${q.correct_index}\nexplanation_fact_ids: ${h.esc(q.explanation_fact_ids.join(", "))}</pre>` : ""}`;
    }

    function answer(ci) {
      if (answered) return;
      answered = true;
      const q = data.quiz[order[pos]];
      const right = ci === q.correct_index;
      if (right) score++;
      Array.from(container.querySelectorAll("[data-choice]")).forEach((b) => {
        const i = Number(b.dataset.choice);
        b.disabled = true;
        if (i === q.correct_index) b.classList.add("is-correct");
        else if (i === ci) b.classList.add("is-wrong");
      });
      const last = pos === total - 1;
      container.querySelector("#quizResult").innerHTML = `
        <p class="quiz__judge ${right ? "is-right" : "is-miss"}">${right ? "正解です。" : "正解は「" + h.esc(q.choices[q.correct_index]) + "」です。"}</p>
        ${q.explanation_fact_ids.map((id) => h.factHTML(data.factMap[id])).join("")}
        <button type="button" class="act" data-next="1">${last ? "結果を見る" : "次の問題へ"}</button>`;
      container.querySelector("[data-next]").focus();
    }

    function finish() {
      container.innerHTML = `
        <h2 class="quiz__q">${total}問のうち${score}問に正解しました。</h2>
        <p>解説の文末にある頁番号から、報告書のもとの記述を確かめられます。</p>
        <div class="acts">
          <button type="button" class="act" data-restart="1">もう一度挑戦する</button>
          <button type="button" class="act" data-action="action_page_overview">史跡概要を読む</button>
        </div>`;
    }

    container.addEventListener("click", (e) => {
      const c = e.target.closest("[data-choice]");
      if (c) { answer(Number(c.dataset.choice)); return; }
      if (e.target.closest("[data-next]")) {
        if (pos === total - 1) finish(); else { pos++; show(); container.querySelector("#quizQ").focus(); }
        return;
      }
      if (e.target.closest("[data-restart]")) begin();
    });

    begin();
  }

  root.Heritage = root.Heritage || {};
  root.Heritage.Quiz = { mount };
})(window);
