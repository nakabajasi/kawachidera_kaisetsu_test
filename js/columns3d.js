/*
 * columns3d.js — 柱を円柱の立体として並べ、好きな位置から見た絵を canvas に描く。
 * 外部のライブラリは使わない。media.json の model（kind: "column_grid"）を読んで形を作る。
 *
 * 立体にするのは柱だけ。基壇の範囲と建物の範囲は、柱の根元の高さ（高さ0）に置いた平らな面として描く。
 * 座標は ｍ。x = 東が正、y = 上が正、z = 南が正。原点は建物の中心で、高さ0は柱の根元の面。
 *
 * 使い方
 *   const scene = Heritage.Columns3D.buildScene(model);
 *   const view  = Heritage.Columns3D.defaultView(model);
 *   Heritage.Columns3D.render(canvas, scene, view, { tone: "tan", planes: true });
 */
(function (root) {
  "use strict";

  const RAD = Math.PI / 180;
  const SIDES = 20;            // 円柱の側面を何枚の面で表すか
  const NEAR = 0.25;           // これより手前（目のすぐ前）は描かない
  const TARGET_Y = 1.5;        // 回すときの中心の高さ（ｍ）
  const LIMIT = { el: [-15, 89], dist: [4, 80], fov: [30, 100], roll: [-30, 30] };

  // ───────── 形を作る ─────────

  /** model から、柱の一覧と平面の一覧を作る */
  function buildScene(model) {
    const g = model.grid;
    const nx = g.cols.length, nz = g.rows.length;
    const width = (nx - 1) * g.bay_x, depth = (nz - 1) * g.bay_z;
    const omit = new Set(model.omit || []);
    const inner = model.inner || null;
    const range = inner ? {
      c0: g.cols.indexOf(inner.cols[0]), c1: g.cols.indexOf(inner.cols[1]),
      r0: g.rows.indexOf(inner.rows[0]), r1: g.rows.indexOf(inner.rows[1]),
    } : null;
    const columns = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const name = g.cols[i] + g.rows[j];
        if (omit.has(name)) continue;
        const isInner = !!range && i >= range.c0 && i <= range.c1 && j >= range.r0 && j <= range.r1;
        columns.push({ name, x: -width / 2 + i * g.bay_x, z: -depth / 2 + j * g.bay_z, inner: isInner });
      }
    }
    const planes = (model.planes || []).map((p) => ({
      id: p.id, label: p.label, w: p.w, d: p.d, x: p.offset_x || 0, z: p.offset_z || 0, y: 0, dashed: !!p.dashed,
    }));
    return {
      columns, planes, width, depth,
      radius: model.column.diameter / 2,
      innerRatio: inner ? inner.height_ratio : 1,
      north: model.north_mark !== false,
    };
  }

  /** 最初の見え方 */
  function defaultView(model) {
    const v = model.view || {};
    return {
      az: v.az != null ? v.az : 25,          // 見る方角。0 = 南から、90 = 東から、180 = 北から、270 = 西から
      el: v.el != null ? v.el : 10,          // 見下ろす角度（度）。0 = 真横から
      dist: v.dist != null ? v.dist : 24,    // 建物の中心までの距離（ｍ）
      pan: 0, tilt: 0,                       // カメラの向きのずらし（度）。絵が画面の中で左右・上下に動く
      roll: 0,                               // 画面の傾き（度）
      fov: v.fov != null ? v.fov : 60,       // 写る範囲の広さ（画面の長い辺の方向の角度）
      height: model.column.height,           // 外側の柱の高さ（ｍ）
    };
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /** 値を使える範囲におさめる */
  function normalize(view, model) {
    view.az = ((view.az % 360) + 360) % 360;
    view.el = clamp(view.el, LIMIT.el[0], LIMIT.el[1]);
    view.dist = clamp(view.dist, LIMIT.dist[0], LIMIT.dist[1]);
    view.fov = clamp(view.fov, LIMIT.fov[0], LIMIT.fov[1]);
    view.roll = clamp(view.roll, LIMIT.roll[0], LIMIT.roll[1]);
    view.pan = clamp(view.pan, -80, 80);
    view.tilt = clamp(view.tilt, -80, 80);
    if (model) view.height = clamp(view.height, model.column.height_min, model.column.height_max);
    return view;
  }

  // ───────── 見る位置と向き ─────────

  function camera(view, w, h) {
    const az = view.az * RAD, el = view.el * RAD;
    const eye = {
      x: view.dist * Math.sin(az) * Math.cos(el),
      y: TARGET_Y + view.dist * Math.sin(el),
      z: view.dist * Math.cos(az) * Math.cos(el),
    };
    // 中心を向いた向きに、ずらし（pan / tilt）を足す
    const yaw = Math.atan2(-eye.x, eye.z) + view.pan * RAD;
    const pitch = clamp(Math.asin(clamp((TARGET_Y - eye.y) / view.dist, -1, 1)) + view.tilt * RAD, -89.5 * RAD, 89.5 * RAD);
    const f = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const r = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };                  // 右（水平）
    const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x }; // 上 = 右 × 前
    const focal = (Math.max(w, h) / 2) / Math.tan((view.fov * RAD) / 2);
    return { eye, f, r, u, focal, w, h };
  }

  /** 世界の点 → カメラから見た点（x 右、y 上、z 奥行き） */
  function toCam(cam, x, y, z) {
    const dx = x - cam.eye.x, dy = y - cam.eye.y, dz = z - cam.eye.z;
    return [dx * cam.r.x + dy * cam.r.y + dz * cam.r.z, dx * cam.u.x + dy * cam.u.y + dz * cam.u.z, dx * cam.f.x + dy * cam.f.y + dz * cam.f.z];
  }
  function toScreen(cam, p) { return [cam.w / 2 + (cam.focal * p[0]) / p[2], cam.h / 2 - (cam.focal * p[1]) / p[2]]; }

  /** 目より手前にはみ出す多角形を切りそろえる */
  function clipNear(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return out;
  }

  function path(ctx, cam, world) {
    const pts = clipNear(world.map((p) => toCam(cam, p[0], p[1], p[2])));
    if (pts.length < 3) return false;
    ctx.beginPath();
    pts.forEach((p, i) => { const s = toScreen(cam, p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
    ctx.closePath();
    return true;
  }

  /** 世界の点が画面のどこに来るか（目より手前なら null）。位置の確認や検査に使う */
  function project(view, w, h, x, y, z) {
    const cam = camera(view, w, h);
    const p = toCam(cam, x, y, z);
    if (p[2] < NEAR) return null;
    const s = toScreen(cam, p);
    return { x: s[0], y: s[1], depth: p[2] };
  }

  // ───────── 描く ─────────

  const TONES = {
    tan: { name: "丹", rgb: [206, 92, 62] },
    white: { name: "白", rgb: [244, 244, 238] },
    green: { name: "緑", rgb: [88, 190, 166] },
  };
  const PLANE_STYLE = {
    kidan: { fill: "rgba(116,196,176,0.22)", stroke: "rgba(140,226,204,0.95)" },
    building: { fill: "rgba(255,255,255,0.20)", stroke: "rgba(255,255,255,0.95)" },
  };
  // 光は南南東の上から当たるものとして、側面の明るさを変える（立体に見せるためだけのもの）
  const LIGHT = { x: 0.447, z: 0.894 };

  function shade(rgb, k) { return "rgb(" + rgb.map((c) => Math.round(clamp(c * k, 0, 255))).join(",") + ")"; }

  function drawPlane(ctx, cam, p, scale) {
    const st = PLANE_STYLE[p.id] || PLANE_STYLE.building;
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
    if (!path(ctx, cam, [[x0, p.y, z0], [x1, p.y, z0], [x1, p.y, z1], [x0, p.y, z1]])) return;
    ctx.fillStyle = st.fill; ctx.fill();
    ctx.lineWidth = 2 * scale; ctx.strokeStyle = st.stroke;
    ctx.setLineDash(p.dashed ? [7 * scale, 5 * scale] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** 北の向きを示す、平らな三角の印（基壇の範囲の北のふちに置く） */
  function drawNorth(ctx, cam, scene, scale) {
    const base = scene.planes[0];
    if (!base) return;
    const zEdge = base.z - base.d / 2;
    const tip = [base.x, 0, zEdge - 1.3], a = [base.x - 0.55, 0, zEdge - 0.2], b = [base.x + 0.55, 0, zEdge - 0.2];
    if (path(ctx, cam, [tip, b, a])) { ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill(); }
    const p = toCam(cam, base.x, 0, zEdge - 2.0);
    if (p[2] < NEAR) return;
    const s = toScreen(cam, p);
    ctx.font = "600 " + Math.round(14 * scale) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 3 * scale; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText("北", s[0], s[1]);
    ctx.fillStyle = "#fff"; ctx.fillText("北", s[0], s[1]);
  }

  function drawColumn(ctx, cam, col, radius, height, rgb, scale) {
    const ex = cam.eye.x - col.x, ez = cam.eye.z - col.z;
    ctx.lineJoin = "round";
    // 側面（目のほうを向いた面だけ）
    for (let k = 0; k < SIDES; k++) {
      const a0 = (k / SIDES) * 2 * Math.PI, a1 = ((k + 1) / SIDES) * 2 * Math.PI, am = (a0 + a1) / 2;
      const nx = Math.cos(am), nz = Math.sin(am);
      if (nx * (ex - radius * nx) + nz * (ez - radius * nz) <= 0) continue;
      const x0 = col.x + radius * Math.cos(a0), z0 = col.z + radius * Math.sin(a0);
      const x1 = col.x + radius * Math.cos(a1), z1 = col.z + radius * Math.sin(a1);
      if (!path(ctx, cam, [[x0, 0, z0], [x1, 0, z1], [x1, height, z1], [x0, height, z0]])) continue;
      const c = shade(rgb, 0.5 + 0.5 * Math.max(0, nx * LIGHT.x + nz * LIGHT.z));
      ctx.fillStyle = c; ctx.fill();
      ctx.lineWidth = 0.8 * scale; ctx.strokeStyle = c; ctx.stroke();
    }
    // 上の面（見下ろしているとき）と下の面（見上げているとき）
    const cap = (y, k) => {
      const ring = [];
      for (let i = 0; i < SIDES; i++) { const a = (i / SIDES) * 2 * Math.PI; ring.push([col.x + radius * Math.cos(a), y, col.z + radius * Math.sin(a)]); }
      if (!path(ctx, cam, ring)) return;
      ctx.fillStyle = shade(rgb, k); ctx.fill();
      ctx.lineWidth = 1 * scale; ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.stroke();
    };
    if (cam.eye.y > height) cap(height, 1.08);
    if (cam.eye.y < 0) cap(0, 0.45);
  }

  /**
   * canvas に描く。
   * opts: { tone: "tan" | "white" | "green", planes: true/false, background: 色（省くと透明） }
   */
  function render(canvas, scene, view, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const scale = opts.scale || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, w, h); }
    if (view.roll) { ctx.translate(w / 2, h / 2); ctx.rotate(view.roll * RAD); ctx.translate(-w / 2, -h / 2); }
    const cam = camera(view, w, h);

    if (opts.planes !== false) {
      scene.planes.forEach((p) => drawPlane(ctx, cam, p, scale));
      if (scene.north) drawNorth(ctx, cam, scene, scale);
    }
    const rgb = (TONES[opts.tone] || TONES.tan).rgb;
    // 遠い柱から順に描く（手前の柱が奥の柱を隠す）
    const order = scene.columns.slice().sort((a, b) =>
      Math.hypot(b.x - cam.eye.x, b.z - cam.eye.z) - Math.hypot(a.x - cam.eye.x, a.z - cam.eye.z));
    order.forEach((c) => drawColumn(ctx, cam, c, scene.radius, c.inner ? view.height * scene.innerRatio : view.height, rgb, scale));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return cam;
  }

  /** 見る方角を言葉にする（0 = 南、時計の逆回りに 東・北・西） */
  function directionName(az) {
    const names = ["南", "南南東", "南東", "東南東", "東", "東北東", "北東", "北北東", "北", "北北西", "北西", "西北西", "西", "西南西", "南西", "南南西"];
    return names[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
  }
  /** 目の高さ（柱の根元の面からの高さ、ｍ） */
  function eyeHeight(view) { return TARGET_Y + view.dist * Math.sin(view.el * RAD); }

  const api = { buildScene, defaultView, normalize, render, project, directionName, eyeHeight, TONES, LIMIT, TARGET_Y };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Heritage = root.Heritage || {};
  root.Heritage.Columns3D = api;
})(typeof window !== "undefined" ? window : globalThis);
