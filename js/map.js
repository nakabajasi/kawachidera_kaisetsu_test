/*
 * map.js — 現地マップ。
 * 緯度・経度が入った spot が無いので、spots.json の schematic（模式図の中の位置）から SVG を描く。
 * 緯度経度がそろったら、ここに地図タイル表示を足せるよう、描画は render() に分けてある。
 */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function node(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (text != null) n.textContent = text;
    return n;
  }

  function rectsOf(spot) {
    const s = spot.schematic;
    if (!s) return [];
    return s.shape === "polyrect" ? s.rects : [s];
  }

  function center(spot) {
    const rs = rectsOf(spot);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rs.forEach((r) => { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, x0, y0, x1, y1 };
  }

  /**
   * opts: { compact(ホームの見出し用), selected, onSelect(spotId) }
   */
  function render(container, data, opts) {
    opts = opts || {};
    const m = data.map;
    const vb = m.view_box;
    const svg = node("svg", {
      viewBox: vb.join(" "), class: "plan" + (opts.compact ? " plan--compact" : ""),
      role: "group", "aria-label": "伽藍配置の模式図。建物を選ぶと解説を表示します。",
    });

    // 枠と目盛（実測図の体裁）
    const frame = node("g", { class: "plan__frame" });
    frame.appendChild(node("rect", { x: vb[0] + 1.5, y: vb[1] + 1.5, width: vb[2] - 3, height: vb[3] - 3 }));
    for (let x = Math.ceil((vb[0] + 2) / 10) * 10; x < vb[0] + vb[2] - 2; x += 10) {
      frame.appendChild(node("line", { x1: x, y1: vb[1] + 1.5, x2: x, y2: vb[1] + 3 }));
      frame.appendChild(node("line", { x1: x, y1: vb[1] + vb[3] - 1.5, x2: x, y2: vb[1] + vb[3] - 3 }));
    }
    for (let y = Math.ceil((vb[1] + 2) / 10) * 10; y < vb[1] + vb[3] - 2; y += 10) {
      frame.appendChild(node("line", { x1: vb[0] + 1.5, y1: y, x2: vb[0] + 3, y2: y }));
      frame.appendChild(node("line", { x1: vb[0] + vb[2] - 1.5, y1: y, x2: vb[0] + vb[2] - 3, y2: y }));
    }
    svg.appendChild(frame);

    // 土石流が流れた帯
    if (m.dosekiryu && m.dosekiryu.band && !opts.compact) {
      const b = m.dosekiryu.band;
      const defs = node("defs");
      const pat = node("pattern", { id: "hatch", width: 2.2, height: 2.2, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" });
      pat.appendChild(node("line", { x1: 0, y1: 0, x2: 0, y2: 2.2, class: "plan__hatch" }));
      defs.appendChild(pat);
      svg.appendChild(defs);
      svg.appendChild(node("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "url(#hatch)", class: "plan__band" }));
      svg.appendChild(node("text", { x: b.x + b.w / 2, y: b.y + b.h / 2 + 1, class: "plan__note", "text-anchor": "middle" }, m.dosekiryu.label));
    }

    // 史跡指定範囲の南の境
    if (m.boundary) {
      const y = m.boundary.y;
      svg.appendChild(node("line", { x1: vb[0] + 4, y1: y, x2: vb[0] + vb[2] - 4, y2: y, class: "plan__boundary" }));
      if (!opts.compact) {
        const lx = m.boundary.label_x != null ? m.boundary.label_x : vb[0] + 5;
        svg.appendChild(node("text", { x: lx, y: y - 1.1, class: "plan__note" }, "↑ 史跡指定範囲"));
        svg.appendChild(node("text", { x: lx, y: y + 3.3, class: "plan__note" }, "↓ 範囲の外"));
      }
    }

    // 建物・遺構
    data.spots.forEach((spot) => {
      const g = node("g", {
        class: "plan__spot plan__spot--" + spot.state + (spot.in_designated_area ? "" : " plan__spot--outside") + (opts.selected === spot.id ? " is-selected" : ""),
        tabindex: 0, role: "button", "data-spot": spot.id, "aria-label": spot.name + "の解説を表示",
      });
      rectsOf(spot).forEach((r) => g.appendChild(node("rect", { x: r.x, y: r.y, width: r.w, height: r.h })));
      const L = spot.schematic.label;
      if (L === undefined) { // ラベル指定がなければ図形の中央に名前を置く
        const c = center(spot);
        g.appendChild(node("text", { x: c.x, y: c.y + 1.1, "text-anchor": "middle", class: "plan__label" }, spot.name));
      } else if (L) {
        g.appendChild(node("text", { x: L.x, y: L.y, "text-anchor": L.anchor || "middle", class: "plan__label" }, L.text || spot.name));
      }
      const pick = () => opts.onSelect && opts.onSelect(spot.id);
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      svg.appendChild(g);
    });

    // 方位と縮尺
    const nx = vb[0] + vb[2] - 9, ny = vb[1] + 12;
    const north = node("g", { class: "plan__north" });
    north.appendChild(node("line", { x1: nx, y1: ny + 5, x2: nx, y2: ny - 5 }));
    north.appendChild(node("path", { d: `M${nx} ${ny - 5} l-1.6 3.4 h3.2 z` }));
    north.appendChild(node("text", { x: nx, y: ny - 6.4, "text-anchor": "middle", class: "plan__note" }, "北"));
    svg.appendChild(north);
    if (!opts.compact) {
      const sx = vb[0] + 6, sy = vb[1] + vb[3] - 6, len = m.scale_bar_m || 20;
      const bar = node("g", { class: "plan__scale" });
      bar.appendChild(node("path", { d: `M${sx} ${sy - 1} v1 h${len} v-1 M${sx + len / 2} ${sy - 0.7} v0.7` }));
      bar.appendChild(node("text", { x: sx, y: sy - 2, class: "plan__note" }, "0"));
      bar.appendChild(node("text", { x: sx + len, y: sy - 2, class: "plan__note", "text-anchor": "middle" }, "約" + len + "ｍ"));
      svg.appendChild(bar);
    }

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  root.Heritage = root.Heritage || {};
  root.Heritage.Map = { render };
})(window);
