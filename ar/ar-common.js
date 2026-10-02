/*
 * ar-common.js — カメラ画面の共通処理（柱の立体の画面と、記念フレームの画面で使う）。
 * カメラは、利用者がボタンを押したときにだけ許可を求める。映像と写真は端末の中だけで扱い、
 * 利用者が「写真に保存」（共有）を押したとき以外は端末の外に出さない。
 *
 * 撮影のしかた
 *   1. 画面に見えている大きさ × 端末の画素の細かさ（最大2.5倍）の canvas を作る
 *   2. カメラの映像を、画面と同じ切り抜き方（枠いっぱい）で描く
 *   3. その上に、重ねるもの（柱、枠、文字）を描く
 *   4. JPEG にして全画面で見せる。「写真に保存」は端末の共有の画面を開く（iPhone では「画像を保存」で写真に入る）。
 *      共有が使えない端末では、画像の長押しで保存してもらう。
 */
(function (root) {
  "use strict";
  let stream = null;
  let videoEl = null;
  let facingNow = "environment";
  let wanted = false; // 利用者がカメラを始めたか（画面に戻ってきたときに映像を出し直すかどうか）

  async function startCamera(video, facing) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("このブラウザではカメラを使えません。https で開いているか、ブラウザが対応しているか確認してください。");
    }
    release();
    videoEl = video;
    facingNow = facing || "environment";
    try {
      // 写真にしたときに粗くならないよう、細かい映像を頼む（端末が出せる範囲で近いものになる）
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facingNow }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw new Error("カメラの使用が許可されませんでした。ブラウザの設定でこのページのカメラを許可してから、もう一度押してください。");
      if (e && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) throw new Error("使えるカメラが見つかりませんでした。");
      throw new Error("カメラを起動できませんでした（" + (e && e.name ? e.name : "不明なエラー") + "）。");
    }
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    await video.play();
    wanted = true;
    return stream;
  }

  function release() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (videoEl) videoEl.srcObject = null;
  }
  /** カメラを止める（利用者が止めたとき） */
  function stopCamera() { wanted = false; release(); }
  function isLive() { return !!stream && stream.getVideoTracks().some((t) => t.readyState === "live"); }

  async function resume() {
    if (!wanted || !videoEl) return;
    if (isLive()) { videoEl.play().catch(() => {}); return; }
    try { await startCamera(videoEl, facingNow); } catch (e) { /* 出し直せないときは、そのままにする */ }
  }
  // ページを離れるときは止める。共有の画面や別のアプリから戻ってきたときは、映像を出し直す
  window.addEventListener("pagehide", release);
  window.addEventListener("pageshow", (e) => { if (e.persisted) resume(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resume(); });

  /** サイトの根から JSON を読む。file:// などで読めないときは null */
  async function loadJSON(path) {
    if (location.protocol === "file:") return null; // 直接開いたときは fetch が使えない（loadBundle を使う）
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  /** fetch が使えないとき（file:// で開いたときなど）に、data/data.bundle.js から同じデータを読む */
  function loadBundle(path, name) {
    return new Promise((resolve) => {
      if (root.__HERITAGE_DATA__) { resolve(root.__HERITAGE_DATA__[name] || null); return; }
      const s = document.createElement("script");
      s.src = path;
      s.onload = () => resolve((root.__HERITAGE_DATA__ && root.__HERITAGE_DATA__[name]) || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }

  // ───────── 撮影 ─────────

  /** 写真の大きさ。画面に見えている大きさ × 画素の細かさ（最大2.5倍） */
  function captureSize(el) {
    const r = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    return { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)), scale: dpr };
  }

  /** カメラの映像を、画面と同じ切り抜き方（枠いっぱい・中央）で描く。映像がまだないときは false */
  function drawVideoCover(ctx, video, w, h) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (vw / vh > w / h) { sw = vh * (w / h); sx = (vw - sw) / 2; } else { sh = vw / (w / h); sy = (vh - sh) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    return true;
  }

  /** 撮った瞬間に画面を白く光らせる */
  function flash(el) {
    if (!el) return;
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
  }

  function toJpeg(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95));
  }

  /** ファイル名に使う日時（端末の時刻）。例 20261003_011500 */
  function stamp(d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /**
   * 撮影した写真を見せる画面。els = { root, image, hint, retake, save }
   * show({ blob, name, title, hint }) で開く。「写真に保存」は共有の画面を開く。
   */
  function captureView(els, onClose) {
    const state = { blob: null, url: null, name: "photo.jpg", title: "" };
    const LONG_PRESS = "画像を長押しして写真に保存してください";

    function close() {
      els.root.hidden = true;
      if (onClose) onClose();
    }
    function fallback() {
      // 共有が使えない端末。マウスで使う端末ではファイルとして保存し、指で使う端末では長押しを案内する
      const mouse = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (mouse) {
        const a = document.createElement("a");
        a.href = state.url; a.download = state.name;
        document.body.appendChild(a); a.click(); a.remove();
        els.hint.textContent = "ファイルに保存しました（画像の右クリックでも保存できます）";
      } else {
        els.hint.textContent = "この端末では、" + LONG_PRESS;
      }
    }
    els.retake.addEventListener("click", close);
    els.save.addEventListener("click", async () => {
      if (!state.blob) return;
      let file = null;
      try { file = new File([state.blob], state.name, { type: "image/jpeg" }); } catch (e) { fallback(); return; }
      try {
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({ files: [file], title: state.title });
        } else fallback();
      } catch (err) {
        if (err && err.name !== "AbortError") fallback(); // 利用者が取り消したときは、何もしない
      }
    });

    return {
      show(o) {
        state.blob = o.blob; state.name = o.name; state.title = o.title || "";
        if (state.url) URL.revokeObjectURL(state.url);
        state.url = URL.createObjectURL(o.blob);
        els.image.src = state.url;
        els.hint.textContent = o.hint || "";
        els.root.hidden = false;
        els.save.focus();
      },
      close,
      get isOpen() { return !els.root.hidden; },
      state,
    };
  }

  root.HeritageAR = { startCamera, stopCamera, isLive, loadJSON, loadBundle, captureSize, drawVideoCover, flash, toJpeg, stamp, captureView };
})(window);
