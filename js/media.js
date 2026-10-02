/*
 * media.js — 画像・図面・3D資料の一覧と、各ページに置く資料カード。
 * media.json の availability が "included" のものだけを表示し、それ以外は題名と頁だけを示す
 * （報告書の図や写真は、転載の可否を確認するまで複製しない）。
 */
(function (root) {
  "use strict";

  const TYPE = { image: "画像", photo: "写真", drawing: "図面", map: "地図・配置図", reconstruction: "復元図", video: "動画", audio: "音声", model3d: "3Dモデル", panorama: "パノラマ" };

  function refs(m, h) {
    return (m.source_refs || []).map((r) => h.esc(h.refLabel(r)) + (r.locator ? "（" + h.esc(r.locator) + "）" : "")).join("、");
  }

  function card(m, data, h) {
    if (!m) return "";
    const included = m.availability === "included";
    let body;
    if (included && m.file === "generated:map") body = `<div class="mediacard__figure" data-generated-map="1"></div>`;
    else if (included && m.model) body = `<div class="mediacard__figure mediacard__figure--3d"><canvas data-columns3d="${h.esc(m.id)}" width="720" height="440" role="img" aria-label="${h.esc(m.title)}"></canvas></div>`;
    else if (included && m.file) body = `<div class="mediacard__figure"><img src="./${h.esc(m.file)}" alt="${h.esc(m.title)}" loading="lazy"></div>`;
    else body = `<div class="mediacard__absent" role="img" aria-label="画像は掲載していません"><span>${h.esc(TYPE[m.type] || m.type)}</span><span>掲載していません</span></div>`;
    // 立体の図には、動かせる画面を開くボタンを付ける
    const act = included && m.action_id && data.actionMap ? data.actionMap[m.action_id] : null;
    const open = act ? `<div class="acts"><button type="button" class="act act--${h.esc(act.type)}" data-action="${h.esc(act.id)}">${h.esc(act.label)}</button></div>` : "";
    return `<figure class="mediacard${included ? "" : " mediacard--none"}" data-type="${h.esc(m.type)}">
      ${body}
      <figcaption>
        <h3>${h.esc(m.title)}</h3>
        <p>${h.esc(m.caption || "")}</p>
        <p class="mediacard__meta">${included ? h.esc(m.credit) : "報告書 " + refs(m, h) + " に掲載。転載の可否を確認中のため、ここには載せていません。"}</p>
        ${open}
      </figcaption>
    </figure>`;
  }

  function cards(list, data, h) {
    const items = (list || []).filter(Boolean);
    if (!items.length) return "";
    return `<div class="mediagrid">${items.map((m) => card(m, data, h)).join("")}</div>`;
  }

  /** カードの中の「作図した模式図」と「立体の図」を描く（innerHTML を入れたあとに呼ぶ） */
  function hydrate(scope, data) {
    const C = root.Heritage.Columns3D;
    Array.from(scope.querySelectorAll("canvas[data-columns3d]")).forEach((el) => {
      const m = data.mediaMap[el.dataset.columns3d];
      if (!C || !m || !m.model) return;
      const view = C.defaultView(m.model);
      view.dist *= 0.92; // カードでは少し大きめに見せる
      C.render(el, C.buildScene(m.model), view, { tone: "tan", scale: 1.6, background: "#1b2428" });
    });
    Array.from(scope.querySelectorAll("[data-generated-map]")).forEach((el) => {
      root.Heritage.Map.render(el, data, { onSelect: (id) => { location.hash = "/map?spot=" + id; } });
    });
  }

  function gallery(container, data, h) {
    const types = Array.from(new Set(data.media.map((m) => m.type)));
    let current = "all";
    const draw = () => {
      const list = data.media.filter((m) => current === "all" || m.type === current);
      const shown = list.filter((m) => m.availability === "included").length;
      container.innerHTML = `
        <div class="seg seg--wrap" role="group" aria-label="種類でしぼる">
          <button type="button" data-type="all" aria-pressed="${current === "all"}">すべて</button>
          ${types.map((t) => `<button type="button" data-type="${h.esc(t)}" aria-pressed="${current === t}">${h.esc(TYPE[t] || t)}</button>`).join("")}
        </div>
        <p class="hint">${list.length}件のうち、表示できるのは${shown}件です。報告書の図や写真は、題名と掲載頁だけを載せています。</p>
        ${cards(list.slice().sort((a, b) => (a.availability === "included" ? -1 : 1) - (b.availability === "included" ? -1 : 1)), data, h)}`;
      hydrate(container, data);
    };
    container.addEventListener("click", (e) => {
      const b = e.target.closest("[data-type]");
      if (!b || b.tagName !== "BUTTON") return;
      current = b.dataset.type;
      draw();
    });
    draw();
  }

  root.Heritage = root.Heritage || {};
  root.Heritage.Media = { card, cards, gallery, hydrate, TYPE };
})(window);
