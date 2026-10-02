#!/usr/bin/env node
/*
 * 実ブラウザ（Chromium）での動作確認。公開には不要。
 *   node tools/browser_test.mjs [--shots 保存先フォルダ]
 * playwright が必要（npm i -D playwright && npx playwright install chromium）。
 * GitHub Pages と同じく、サブフォルダの下で配信して確かめる。
 * 別の場所の playwright や Chromium を使うときは、環境変数 PLAYWRIGHT_MODULE と CHROMIUM_PATH で指定する。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
for (const p of ["playwright", process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
if (!chromium) { console.log("playwright が見つかりません"); process.exit(2); }

const si = process.argv.indexOf("--shots");
const SHOTS = si > 0 ? process.argv[si + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ── /repo-name/ の下で配信する静的サーバ ──
const BASE = "/heritage_site/";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8" };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split("?")[0]);
  if (!u.startsWith(BASE)) { res.writeHead(404); return res.end("not found"); }
  let f = path.join(ROOT, u.slice(BASE.length));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const URL0 = ORIGIN + BASE;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("NG  " + m); } };
const section = (t) => console.log("\n== " + t);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined, // 既定の Chromium を使わないときだけ指定する
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ja-JP", permissions: ["camera"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
  page.on("response", (r) => { if (r.status() >= 400) errors.push("HTTP " + r.status() + " " + r.url()); });
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(120); };

// ───────── 1. 読み込みと各ページ ─────────
section("読み込みと各ページ（390×844）");
{
  const { ctx, page, errors } = await newPage(390, 844);
  const jsonRequests = [];
  page.on("response", (r) => { if (r.url().endsWith(".json")) jsonRequests.push(r.url()); });
  await page.goto(URL0 + "index.html");
  await page.waitForSelector(".hero h1");
  ok((await page.getAttribute(".hero h1", "aria-label")).length > 0, "ホームの見出しが出ない");
  const tall = await page.evaluate(() => { const h = document.querySelector(".hero h1"); return h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).fontSize) / h.children.length; });
  ok(tall > 1.05, "縦書きの見出しの文字が重なっている（1文字あたりの高さ " + tall.toFixed(2) + "）");
  ok(jsonRequests.length >= 11 && jsonRequests.every((u) => u.startsWith(URL0)), "JSON がサブフォルダの下から読まれていない: " + jsonRequests.length);
  ok(await page.locator(".hero .plan rect").count() > 5, "ホームの模式図が描かれていない");
  ok(await noOverflow(page), "ホームが横にはみ出す");
  await shot(page, "390_home");

  const routes = [["/overview", "史跡概要"], ["/map", "現地マップ"], ["/features", "遺構"], ["/features/spot_kondo", "金堂跡"], ["/features/spot_chumon", "中門推定地"],
    ["/artifacts", "出土遺物"], ["/gallery", "画像・図面"], ["/chat", "対話型解説"], ["/quiz", "クイズ"], ["/experience", "AR・体験"], ["/sources", "出典"], ["/menu", "メニュー"]];
  for (const [h, title] of routes) {
    await go(page, h);
    const t = await page.textContent("#pageTitle");
    ok(t === title, `${h}: 見出し「${t}」（期待「${title}」）`);
    ok((await page.locator("#main").innerText()).length > 20, `${h}: 中身が空`);
    ok(await noOverflow(page), `${h}: 横にはみ出す`);
    await shot(page, "390_" + h.replace(/\W+/g, "_").replace(/^_/, ""));
  }
  // タブで移動できる
  for (const tab of ["map", "chat", "quiz", "menu", "home"]) {
    await page.click(`.tabs a[data-tab="${tab}"]`);
    await page.waitForTimeout(80);
    ok((await page.getAttribute(`.tabs a[data-tab="${tab}"]`, "aria-current")) === "page", `タブ ${tab} に移動できない`);
  }
  ok(errors.length === 0, "エラー: " + errors.join(" | "));
  await ctx.close();
}

// ───────── 2. 対話 ─────────
section("対話");
{
  const { ctx, page, errors } = await newPage(390, 844);
  await page.goto(URL0 + "index.html#/chat");
  await page.waitForSelector("#chatInput");
  const ask = async (q) => {
    const before = await page.locator(".msg--sys").count();
    await page.fill("#chatInput", q);
    await page.click("#chatForm button[type=submit]");
    await page.waitForFunction((n) => document.querySelectorAll(".msg--sys").length > n, before);
    return (await page.locator(".msg--sys .msg__text").last().innerText()).trim();
  };
  const a1 = await ask("いつ建てられたの？");
  ok(a1.includes("四半期"), "回答が生成されない: " + a1);
  ok((await page.textContent("#curTopic")) === "創建の時期", "いまの話題が出ない");
  const texts = new Set([a1]);
  for (let i = 0; i < 5; i++) texts.add(await ask("いつ建てられたの？"));
  ok(texts.size >= 2, "同じ質問で表現が変わらない");
  const roof = await ask("金堂の屋根の形は？");
  ok(/入母屋造であると(考えられて|みられて)/.test(roof), "「考えられる」が保たれていない: " + roof);
  const to = await ask("塔は見つかったの？");
  ok(/見つかっていません|未検出です/.test(to) && /推定されて|想定されて/.test(to), "塔の回答: " + to);
  // 関連質問
  const n1 = await page.locator(".msg--sys").count();
  await page.locator(".msg--sys").last().locator(".chip").first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".msg--sys").length > n, n1);
  ok(true, "");
  // もっと詳しく
  await ask("誰が建てたの？");
  const n2 = await page.locator(".msg--sys").count();
  await page.locator(".msg--sys").last().locator("[data-more]").click();
  await page.waitForFunction((n) => document.querySelectorAll(".msg--sys").length > n, n2);
  ok((await page.locator(".msg--sys .msg__text").last().innerText()).includes("藤沢一夫"), "「もっと詳しく」が動かない");
  // 根拠と出典
  await page.locator(".msg--sys").last().locator(".evidence summary").click();
  await page.locator(".msg--sys").last().locator(".ref").first().click();
  await page.waitForSelector("#sheet:not([hidden])");
  ok((await page.textContent("#sheetContent")).includes("報告書のもとの記述"), "出典の確認が開かない");
  await page.click(".sheet__close");
  ok(await page.locator("#sheet").isHidden(), "出典の確認が閉じない");
  ok(await page.locator(".dbg").count() === 0, "通常表示なのに確認用の表示が出ている");
  // 話し方
  await page.click('.seg [data-style="friendly"]');
  let friendly = false;
  for (let i = 0; i < 6 && !friendly; i++) friendly = /んです|ですよ|ますよ|ますね|ましょう/.test(await ask("どんな瓦が出たの？"));
  ok(friendly, "やさしい話し方に変わらない");
  // 見つからない質問
  const nf = await ask("今日の天気は？");
  ok(nf.includes("見つけられませんでした") || nf.includes("見つかりませんでした"), "見つからないときの応答: " + nf);
  ok(await noOverflow(page), "対話が横にはみ出す");
  await shot(page, "390_chat_talk");
  // 関連ページへのボタン
  await ask("金堂の基壇の大きさは？");
  await page.locator(".msg--sys").last().locator('[data-action="action_page_kondo"]').click();
  await page.waitForTimeout(150);
  ok(page.url().endsWith("#/features/spot_kondo"), "action ボタンで移動しない: " + page.url());
  await page.goBack();
  await page.waitForSelector("#chatLog .msg");
  ok(await page.locator(".msg--user").count() > 5, "戻ったときに会話が消えている");
  ok(errors.length === 0, "エラー: " + errors.join(" | "));
  await ctx.close();
}

// ───────── 3. マップ・クイズ・画像 ─────────
section("マップ・クイズ・画像");
{
  const { ctx, page, errors } = await newPage(390, 844);
  await page.goto(URL0 + "index.html#/map");
  await page.waitForSelector(".planwrap .plan");
  await page.locator('.plan__spot[data-spot="spot_kodo"] rect').first().click();
  await page.waitForSelector("#spotPanel h2");
  ok((await page.textContent("#spotPanel h2")) === "講堂跡", "マップで地点を選べない");
  ok(page.url().includes("spot=spot_kodo"), "選んだ地点が URL に入らない");
  await page.locator('[data-pick="spot_to"]').click();
  ok((await page.textContent("#spotPanel h2")) === "塔推定地", "一覧から地点を選べない");
  await shot(page, "390_map_selected");
  await page.goto(URL0 + "index.html#/map?spot=spot_north");
  await page.reload();
  await page.waitForSelector("#spotPanel h2");
  ok((await page.textContent("#spotPanel h2")).startsWith("寺域北方"), "URL の地点指定が効かない");

  await go(page, "/quiz");
  await page.waitForSelector(".quiz__choices button");
  let answered = 0;
  for (let i = 0; i < 12; i++) {
    await page.locator(".quiz__choices button").first().click();
    await page.waitForSelector("[data-next]");
    ok(await page.locator(".quiz__result .fs").count() > 0, "クイズの解説が出ない");
    ok(await page.locator(".quiz__choices .is-correct").count() === 1, "正解の表示がない");
    if (i === 0) await shot(page, "390_quiz_answered");
    answered++;
    await page.click("[data-next]");
    await page.waitForTimeout(50);
  }
  ok(/12問のうち\d+問に正解/.test(await page.locator("#quiz").innerText()), "クイズの結果が出ない");
  await page.click("[data-restart]");
  ok(await page.locator(".quiz__choices button").count() >= 3, "クイズをやり直せない");

  await go(page, "/gallery");
  ok(await page.locator(".mediacard").count() === 19, "画像一覧の件数が違う");
  ok(await page.locator(".mediacard__figure .plan").count() === 1 && await page.locator(".mediacard__figure img").count() === 1, "作図した図が表示されない");
  const imgOk = await page.evaluate(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
  ok(imgOk, "画像が読めていない");
  await page.click('.seg [data-type="model3d"]');
  ok(await page.locator(".mediacard").count() === 3, "種類でしぼれない");
  ok(await page.locator(".mediacard canvas[data-columns3d]").count() === 1 && await page.locator('.mediacard [data-action="action_ar_kondo"]').count() === 1, "画像一覧に柱の立体の図と、開くボタンが出ない");

  await go(page, "/sources");
  await page.fill("#factQuery", "礎石");
  await page.click("#factSearch button");
  ok(await page.locator("#factResults .fs").count() > 3, "記述を探せない");
  ok(errors.length === 0, "エラー: " + errors.join(" | "));
  await ctx.close();
}

// ───────── 4. 確認用の表示（?debug=true） ─────────
section("?debug=true");
{
  const { ctx, page, errors } = await newPage(390, 844);
  await page.goto(URL0 + "index.html?debug=true#/chat");
  await page.waitForSelector("#chatInput");
  await page.fill("#chatInput", "金堂の基壇の大きさは？");
  await page.click("#chatForm button[type=submit]");
  await page.waitForSelector(".msg--sys:nth-of-type(n+2) .dbg, .msg--sys .dbg");
  const dbg = await page.locator(".msg--sys").last().locator("pre.dbg").innerText();
  for (const key of ["topic: dialogue_kondo_kidan", "fact_id: fact_kondo_kidan_ew", "template: ", "source_id: source_report_2022", "page: 11"]) ok(dbg.includes(key), "確認用の表示に「" + key + "」がない\n" + dbg);
  await shot(page, "390_debug_chat");
  await go(page, "/overview");
  ok(await page.locator(".fs .dbg").count() > 5, "概要ページに fact_id が出ない");
  ok(page.url().includes("?debug=true"), "画面を移ると debug が外れる");
  ok(errors.length === 0, "エラー: " + errors.join(" | "));
  await ctx.close();
}

// ───────── 5. 幅の狭い端末・横長・広い画面 ─────────
section("ほかの画面幅");
for (const [w, h] of [[320, 568], [360, 740], [412, 915], [844, 390], [1280, 800]]) {
  const { ctx, page, errors } = await newPage(w, h);
  await page.goto(URL0 + "index.html");
  await page.waitForSelector(".hero h1");
  for (const hash of ["/home", "/overview", "/map?spot=spot_kondo", "/features/spot_kondo", "/artifacts", "/gallery", "/chat", "/quiz", "/sources"]) {
    await go(page, hash);
    ok(await noOverflow(page), `${w}×${h} ${hash}: 横にはみ出す`);
  }
  // 下のタブと入力欄が重ならない
  await go(page, "/chat");
  const boxes = await page.evaluate(() => { const f = document.querySelector(".chat__form").getBoundingClientRect(), t = document.querySelector(".tabs").getBoundingClientRect(); return { fb: f.bottom, tt: t.top, tb: t.bottom, ih: innerHeight }; });
  ok(boxes.fb <= boxes.tt + 1 && Math.abs(boxes.tb - boxes.ih) < 2, `${w}×${h}: 入力欄とタブの位置がおかしい ${JSON.stringify(boxes)}`);
  if (w === 320) { await go(page, "/home"); await shot(page, "320_home"); await go(page, "/map?spot=spot_kondo"); await shot(page, "320_map"); }
  if (w === 1280) { await go(page, "/home"); await shot(page, "1280_home"); }
  ok(errors.length === 0, `${w}×${h} エラー: ` + errors.join(" | "));
  await ctx.close();
}

// ───────── 6. AR・カメラ（偽のカメラ映像で確認） ─────────
section("AR・カメラ");
{
  const { ctx, page, errors } = await newPage(390, 844);
  await page.goto(URL0 + "index.html#/experience");
  await page.waitForSelector('[data-action="action_ar_kondo"]');
  await page.click('[data-action="action_ar_kondo"]');
  await page.waitForSelector("#nocam");
  ok(page.url().startsWith(URL0 + "ar/columns3d/"), "AR の画面に移らない: " + page.url());
  ok((await page.textContent("#title")).includes("金堂"), "立体の図の題名が出ない");
  ok(await page.locator("#video").evaluate((v) => !v.srcObject), "ボタンを押す前にカメラが動いている");
  await page.click("#start");
  await page.waitForSelector("#view:not([hidden])");
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById("video").videoWidth > 0), "カメラの映像が出ない");

  // 形：柱28本、身舎の柱10本だけ1.2倍、平面は高さ0
  const sc = await page.evaluate(() => { const s = window.__columns3d.scene; return {
    n: s.columns.length, inner: s.columns.filter((c) => c.inner).map((c) => c.name).join(""), ratio: s.innerRatio, r: s.radius,
    planes: s.planes.map((p) => [p.id, p.w, p.d, p.y].join("/")).join(" ") }; });
  ok(sc.n === 28, "柱の本数が28でない: " + sc.n);
  ok(sc.inner === "Ｂ②Ｃ②Ｄ②Ｅ②Ｂ③Ｅ③Ｂ④Ｃ④Ｄ④Ｅ④", "身舎の柱が違う: " + sc.inner);
  ok(sc.ratio === 1.2, "身舎の柱の高さの倍率が1.2でない: " + sc.ratio);
  ok(sc.planes === "kidan/13.9/12.3/0 building/9.75/7.8/0", "平面の大きさ・高さが違う: " + sc.planes);
  const inked = () => page.evaluate(() => { const c = document.getElementById("view"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  const drawn = await inked();
  ok(drawn > 5000, "立体が描かれていない: " + drawn);
  const state = () => page.evaluate(() => Object.assign({}, window.__columns3d.view));
  const v0 = await state();

  // なぞって回す／ずらす、ホイールとつまむ操作で距離
  const box = await page.locator("#view").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const drag = async (dx, dy) => { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx / 2, cy + dy / 2); await page.mouse.move(cx + dx, cy + dy); await page.mouse.up(); await page.waitForTimeout(60); };
  await drag(60, -30);
  const v1 = await state();
  ok(Math.abs(v1.az - ((v0.az - 24 + 360) % 360)) < 0.01 && Math.abs(v1.el - (v0.el - 9)) < 0.01, `なぞっても回らない: az ${v0.az}→${v1.az} el ${v0.el}→${v1.el}`);
  ok(v1.pan === 0 && v1.tilt === 0, "「回す」のときに位置がずれる");
  await page.click("#modeMove");
  await drag(40, 20);
  const v2 = await state();
  ok(v2.az === v1.az && v2.el === v1.el && v2.pan < 0 && v2.tilt > 0, `「ずらす」が効かない: pan ${v2.pan} tilt ${v2.tilt}`);
  await page.click("#modeRotate");
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -200); await page.waitForTimeout(60);
  const v3 = await state();
  ok(v3.dist < v2.dist, `ホイールで距離が変わらない: ${v2.dist}→${v3.dist}`);
  await page.evaluate(() => { // 2本の指を広げる
    const c = document.getElementById("view"); const r = c.getBoundingClientRect(); const y = r.top + r.height / 2;
    const ev = (type, id, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true }));
    ev("pointerdown", 91, r.left + 150); ev("pointerdown", 92, r.left + 240);
    ev("pointermove", 91, r.left + 105); ev("pointermove", 92, r.left + 285);
    ev("pointerup", 91, r.left + 105); ev("pointerup", 92, r.left + 285);
  });
  await page.waitForTimeout(60);
  const v4 = await state();
  ok(Math.abs(v4.dist - v3.dist / 2) < 0.02, `つまんでも距離が変わらない: ${v3.dist}→${v4.dist}`);

  // スライダー
  const slide = async (id, value) => { await page.locator("#" + id).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, String(value)); await page.waitForTimeout(60); };
  await slide("az", 90); await slide("el", 30); await slide("dist", 30); await slide("height", 4);
  const v5 = await state();
  ok(v5.az === 90 && v5.el === 30 && v5.dist === 30 && v5.height === 4, "スライダーが効かない: " + JSON.stringify(v5));
  ok((await page.textContent("#readout")).startsWith("東から"), "見る方角の表示が違う: " + (await page.textContent("#readout")));
  ok((await page.textContent("#heightOut")).includes("4.0"), "柱の高さの表示が違う");
  ok((await page.textContent("#heightNote")).includes("報告書に書かれていません"), "柱の高さが仮の値であることが示されていない");
  // 身舎の柱の頭が、外側の柱の頭より1.2倍高い位置に描かれる（真横から見て確かめる）
  const tops = await page.evaluate(() => { const C = Heritage.Columns3D, v = Object.assign({}, window.__columns3d.view, { az: 0, el: 0, pan: 0, tilt: 0, roll: 0 });
    const y = (h) => C.project(v, 400, 400, 0, h, 0).y; return (y(0) - y(4 * 1.2)) / (y(0) - y(4)); });
  ok(Math.abs(tops - 1.2) < 1e-9, "身舎の柱の高さの比が違う: " + tops);
  await page.evaluate(() => { document.getElementById("more").open = true; });
  await page.click("#planes");
  await page.waitForTimeout(80);
  ok((await inked()) < (await page.evaluate(() => { window.__columns3d.ui.planes = true; window.__columns3d.draw(); const c = document.getElementById("view"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })), "基壇と建物の範囲を隠せない");
  await page.evaluate(() => { document.getElementById("about").open = true; });
  const basis = await page.textContent("#basis");
  ok(basis.includes("基壇の範囲") && basis.includes("建物の範囲") && basis.includes("報告書に書かれていない"), "もとになっているものの説明が足りない");
  ok(await noOverflow(page), "立体の画面が横にはみ出す");
  await shot(page, "390_ar_columns3d");

  // 合わせた見え方は、開き直しても残る。「最初に戻す」で戻る
  await page.waitForTimeout(600);
  await page.reload();
  await page.click("#nocam");
  await page.waitForSelector("#view:not([hidden])");
  await page.waitForTimeout(150);
  const v6 = await state();
  ok(v6.az === 90 && v6.height === 4, "合わせた見え方が残らない: " + JSON.stringify(v6));
  ok(await page.locator("#video").evaluate((v) => !v.srcObject), "「カメラを使わずに」でカメラが動いている");
  ok((await inked()) > 5000, "カメラなしで立体が描かれない");
  await page.click("#reset");
  await page.waitForTimeout(80);
  const v7 = await state();
  ok(v7.az === v0.az && v7.el === v0.el && v7.dist === v0.dist && v7.height === v0.height && v7.pan === 0, "最初の見え方に戻らない: " + JSON.stringify(v7));
  await shot(page, "390_ar_columns3d_plain");
  await page.waitForTimeout(600);
  await page.click("#back");
  await page.waitForSelector(".hero h1, .h1");
  ok(page.url().endsWith("#/experience"), "AR から戻れない: " + page.url());
  ok(await page.evaluate(() => { const c = document.querySelector("canvas[data-columns3d]"); if (!c) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 2] < 120) n++; return n > 1000; }), "体験ページに立体の図が描かれていない");

  await page.click('[data-action="action_camera_frame"]');
  await page.waitForSelector("#start");
  ok(await page.locator("#video").evaluate((v) => !v.srcObject), "ボタンを押す前にカメラが動いている");
  await page.click("#start");
  await page.waitForSelector("#shoot", { state: "visible" });
  ok((await page.textContent("#frameTitle")) === "河内寺廃寺跡", "フレームに史跡名が出ない");
  await page.click("#shoot");
  await page.waitForSelector("#shot:not([hidden])");
  ok((await page.getAttribute("#save", "href")).startsWith("data:image/jpeg"), "撮影した写真が作られない");
  await shot(page, "390_ar_camera");
  ok(errors.length === 0, "エラー: " + errors.join(" | "));
  await ctx.close();
}

section("立体の画面の大きさ");
for (const [w, h] of [[320, 568], [844, 390], [1280, 800]]) {
  const { ctx, page, errors } = await newPage(w, h);
  await page.goto(URL0 + "ar/columns3d/index.html?model=kondo_columns_3d&debug=true");
  await page.click("#nocam");
  await page.waitForSelector("#view:not([hidden])");
  await page.waitForTimeout(150);
  const g = await page.evaluate(() => { const r = document.getElementById("view").getBoundingClientRect(), p = document.getElementById("panel").getBoundingClientRect();
    return { w: r.width, h: r.height, panelBottom: p.bottom, panelRight: p.right, vw: innerWidth, vh: innerHeight, debug: document.getElementById("debug").textContent, back: document.getElementById("back").getAttribute("href") }; });
  ok(g.w >= 280 && g.h >= 180, `${w}×${h} 立体を見る場所が小さすぎる: ${Math.round(g.w)}×${Math.round(g.h)}`);
  ok(g.panelBottom <= g.vh + 1 && g.panelRight <= g.vw + 1, `${w}×${h} 調整の欄が画面からはみ出す`);
  ok(await noOverflow(page), `${w}×${h} 横にはみ出す`);
  ok(g.debug.includes("media_kondo_columns_3d") && g.debug.includes("28本") && g.back.includes("debug=true"), `${w}×${h} デバッグ表示が出ない`);
  await page.click("#reset"); await page.waitForTimeout(80);
  await shot(page, `${w}_ar_columns3d`);
  ok(errors.length === 0, `${w}×${h} エラー: ` + errors.join(" | "));
  await ctx.close();
}

// ───────── 7. index.html を直接開く（file://） ─────────
section("file:// で直接開く");
{
  const { ctx, page, errors } = await newPage(390, 844);
  await page.goto(pathToFileURL(path.join(ROOT, "index.html")).href);
  await page.waitForSelector(".hero h1");
  await go(page, "/chat");
  await page.fill("#chatInput", "講堂の大きさは？");
  await page.click("#chatForm button[type=submit]");
  await page.waitForFunction(() => document.querySelectorAll(".msg--sys").length > 1);
  ok((await page.locator(".msg--sys .msg__text").last().innerText()).includes("22.8"), "file:// で対話が動かない");
  await page.goto(pathToFileURL(path.join(ROOT, "ar/columns3d/index.html")).href + "?model=kondo_columns_3d");
  await page.click("#nocam");
  await page.waitForSelector("#view:not([hidden])");
  ok(await page.evaluate(() => window.__columns3d.scene.columns.length === 28), "file:// で立体の画面が動かない");
  ok(errors.filter((e) => !e.includes("requestfailed")).length === 0, "エラー: " + errors.join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n結果: ${pass} 件 OK、${fail} 件 NG`);
process.exit(fail ? 1 : 0);
