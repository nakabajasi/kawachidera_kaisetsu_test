/*
 * ar-common.js — カメラ画面の共通処理。
 * カメラは、利用者がボタンを押したときにだけ許可を求める。映像は端末の中だけで扱い、送信しない。
 */
(function (root) {
  "use strict";
  let stream = null;

  async function startCamera(video, facing) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("このブラウザではカメラを使えません。https で開いているか、ブラウザが対応しているか確認してください。");
    }
    stopCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing || "environment" } }, audio: false });
    } catch (e) {
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw new Error("カメラの使用が許可されませんでした。ブラウザの設定でこのページのカメラを許可してから、もう一度押してください。");
      if (e && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) throw new Error("使えるカメラが見つかりませんでした。");
      throw new Error("カメラを起動できませんでした（" + (e && e.name ? e.name : "不明なエラー") + "）。");
    }
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    await video.play();
    return stream;
  }

  function stopCamera() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  /** サイトの根から JSON を読む。file:// などで読めないときは null */
  async function loadJSON(path) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });

  root.HeritageAR = { startCamera, stopCamera, loadJSON };
})(window);
