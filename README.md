# 河内寺廃寺跡 史跡解説Web

発掘調査報告書に書かれている内容だけをもとにした、スマートフォン向けの史跡解説です。HTML・CSS・JavaScript・JSON だけで動き、サーバーの処理、データベース、外部のAI、アカウント登録は使いません。

もとにした資料：東大阪市 2022『第１期史跡整備事業に伴う国指定史跡河内寺廃寺跡発掘調査報告書』

## 1. GitHub Pages に置く

1. GitHub で新しいリポジトリを作る（公開リポジトリ）。
2. この `heritage_site` フォルダの**中身**を、リポジトリの直下にアップロードする（`index.html` が直下に来るように）。
3. リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main`、フォルダを `/ (root)` にして保存する。
4. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開ける。

- リンクと読み込みはすべて相対パスなので、リポジトリ名が何でも動く。
- `.nojekyll` は GitHub 側の変換処理を止めるための空ファイル。消さない。
- `docs/` フォルダで公開したいときは、中身を `docs/` に入れて Pages のフォルダを `/docs` にする。
- `index.html` をダブルクリックで開いても動く（そのときは `data/data.bundle.js` を読む）。カメラは https でないと動かない。

## 2. 入っているファイル

```
heritage_site/
├─ index.html            画面の骨組み
├─ css/style.css         見た目
├─ js/
│   ├─ store.js          JSON の読み込み
│   ├─ nlg.js            文章生成（facts の値を言い回しに差し込む）
│   ├─ search.js         質問の判定
│   ├─ dialogue.js       対話の流れ
│   ├─ map.js            現地マップ（模式図）
│   ├─ media.js          画像・図面の一覧
│   ├─ quiz.js           クイズ
│   └─ app.js            画面の切り替えと各ページ
├─ data/                 下の表の JSON と data.bundle.js（JSON の写し）
├─ images/               このアプリで作図した図
├─ models/ audio/        いまは空
├─ ar/
│   ├─ overlay/          図をカメラに重ねる画面
│   ├─ camera/           記念フレームで撮影する画面
│   └─ ar.css, ar-common.js
├─ review.json           人の確認が必要な事項
├─ 00_project_config.json 対象史跡の設定（テンプレートのもの）
├─ tools/                検査用（公開には不要。消してもアプリは動く）
└─ README.md
```

## 3. JSON の役割

| ファイル | 役割 |
|---|---|
| `site.json` | 史跡の名前、機能のオン・オフ、概要・年表・遺物ページに並べる fact の ID |
| `entities.json` | 対象（史跡、建物、遺構、遺物、人・集団、場所、時期、調査）。名前と別名 |
| `facts.json` | 報告書から取り出した記述。**史実はここだけに置く** |
| `relations.json` | 対象どうしの関係。根拠の fact（`fact_id`）か出典頁を持つ |
| `spots.json` | 現地マップの地点と、模式図の中の位置 |
| `media.json` | 画像・図面・3D の一覧。報告書の図は題名と頁だけ（ファイルは入れていない） |
| `dialogue.json` | 対話の項目。どの fact を、どの組み立て方で答えるか。質問のキーワード |
| `language.json` | 言い回し。**史実は書かない** |
| `actions.json` | 解説から呼び出す機能（マップ、ページ、カメラ、AR、クイズ、外部リンク） |
| `quiz.json` | クイズ |
| `sources.json` | 報告書の書誌と章構成、報告書が引いている文献 |

### facts.json の1件

```json
{
  "id": "fact_kondo_roof",
  "subject": "structure_kondo",
  "predicate": "roof_type",
  "object": "入母屋造",
  "scope_text": "創建時の",
  "statement": "創建時の金堂の屋根の形は入母屋造であると考えられている。",
  "status": "interpretation",
  "certainty": "probable",
  "modality": "judged",
  "source_expression": "と考えられる",
  "quote": "よって屋根の形状は、入母屋造と考えられる",
  "attribution": { "type": "report", "label": "本報告書" },
  "superseded": false,
  "supersedes": [],
  "importance": 1,
  "source_refs": [{ "source_id": "source_report_2022", "page": 23, "pdf_page": 37, "locator": null }]
}
```

- `status`：`fact`（調査の記録）、`estimate`（復元・算出の値）、`interpretation`（解釈）、`hypothesis`（仮説・伝承）、`unknown`（不明）。
- `certainty`：`confirmed`、`probable`、`possible`、`uncertain`。
- `modality`：報告書の書き方の型。語尾はこれで決まる。

| modality | 報告書の書き方の例 | 画面での語尾の例 | certainty |
|---|---|---|---|
| `assert` | 〜である、〜した | 〜です | confirmed |
| `confirmed` | 〜を確認した、〜がわかった | 〜ことが確認されています | confirmed |
| `concluded` | 〜と結論づけられる | 〜と結論づけられています | probable |
| `judged` | 〜と考えられる、〜とみられる | 〜と考えられています | probable |
| `estimated` | 〜と推定される、〜が想定できる | 〜と推定されています | probable |
| `likely` | 〜可能性が高い | 〜可能性が高いとされています | probable |
| `possible` | 〜可能性がある | 〜可能性があります | possible |
| `proposed` | 〜という仮説を提示したい | 〜という仮説が示されています | possible |
| `tentative` | 〜か。、〜とも考えられる | 〜とも考えられていますが、はっきりとは分かっていません | uncertain |
| `cannot_conclude` | 〜とまでは断定できない | 〜とまでは断定できないとされています | uncertain |
| `reported` | 〜との報告がある、旧説、伝承 | 〜とされています／〜と伝えられています | uncertain |
| `unknown` `undetermined` | 不明、判断はむずかしい | 〜は分かっていません | uncertain |

- `superseded: true` は、その後に見直された以前の見方。語尾は「〜と考えられていました」になり、質問への回答では見直しの経過を説明する項目でだけ使う。
- `attribution`：誰の見方か。`section_author`（報告書の中の寄稿）、`cited`（報告書が紹介する他の文献）、`tradition`（伝承）のときは、文の頭に「報告書の第5章第4節（新尺雅弘）では、」のように付く。
- `page` は印刷された頁、`pdf_page` は PDF の通し頁。頁番号のない箇所は `page` が `null`。
- `statement` は `tools/make_statements.mjs` が作る。手で書かない。

## 4. 文章の作り方

```
質問 → search.js が項目を選ぶ → dialogue.json の fact_ids → facts.json の値
     → language.json の言い回しに差し込む（nlg.js）→ 回答
```

- `language.json` の `sentences` は述語ごとの文の型。`plain`（語尾を後ろに付ける形）と `polite`（断定の事実に使う形）を組で持つ。
- 断定以外の fact は、必ず `plain` に `modality_endings` の語尾を付けて作る。言い回しを選び直しても、語尾は同じ `modality` の中からしか選ばれないので、確からしさは変わらない。
- 話し方は `normal`（ふつう）、`friendly`（やさしく）、`guide`（ガイド風）。同じ言い回しは続けて選ばれない。
- 高さや幅のように「〜の○○は△△です」で言える述語は、`labels` に名前を足すだけでよい。

## 5. データを足す・直す

### 記述（fact）を足す
1. `data/facts.json` に1件足す。`subject` は `entities.json` の ID。`quote` に報告書の該当箇所を短く写す。
2. 新しい述語を使うときは、`data/language.json` の `sentences`（または `labels`）に言い回しを足す。数字や固有の名前は書かない。
3. `node tools/make_statements.mjs`（statement を作る）
4. `node tools/check.mjs`（検査）。報告書の PDF が手元にあれば `node tools/check.mjs --pdf 報告書.pdf` で、`quote` が該当頁にあるかも確かめられる（`pdftotext` が必要）。
5. `node tools/make_bundle.mjs`（`data.bundle.js` を作り直す）

### 対話の項目を足す
`data/dialogue.json` の `topics` に足す。

```json
{
  "id": "dialogue_xxx", "topic": "画面に出す項目名", "intent": "what",
  "keywords": ["質問に含まれそうな語"],
  "entity_ids": ["関係する対象の ID"],
  "sample_questions": ["質問の例。1つ目は関連質問のボタンにも使う"],
  "fact_ids": ["答えに使う fact。この順に文になる"],
  "connectors": { "fact_id": "contrast" },
  "detail_fact_ids": ["「もっと詳しく」で出す fact"],
  "response_type": "summary",
  "related_topics": ["dialogue_yyy"],
  "suggestions": [{ "text": "次に出す質問", "topic_id": "dialogue_yyy" }],
  "action_ids": ["action_open_map"]
}
```

- `response_type`：`summary`、`definition`、`period`、`location`、`size`、`artifact`、`interpretation`、`multi_view`（複数の見方）、`history`（見直しの経過）、`uncertainty`、`comparison`、`navigation`。
- `connectors`：文のつなぎ方。`addition`（既定）、`contrast`、`transition`、`none`。
- 足したら `tools/test_questions.json` に質問の例を足し、`node tools/check.mjs` で選ばれ方を確かめる。
- 言い換え（`synonyms`）と、対象＋意図で答えるときの意図（`intents`）も `dialogue.json` にある。

### クイズを足す
`data/quiz.json` に足す。`choice_fact_ids` は各選択肢のもとになった fact（なければ `null`）。正解の選択肢には必ず fact を付ける。`source_refs` は解説の fact の頁を写す。

### 画像を足す（転載の許諾が得られたもの）
1. ファイルを `images/` に置く。
2. `data/media.json` の該当項目の `file` を `"images/xxx.jpg"`、`availability` を `"included"`、`credit` と `rights` を許諾の内容に書き換える。
3. `review.json` の `copyright_review` から該当分を外す。

### 3Dモデルを足す
いまは表示の仕組みを入れていない（モデルがなく、外部の表示ライブラリを読み込まない方針のため）。足すときは、
1. `.glb` を `models/` に置き、`media.json` の該当項目を上と同じように書き換える。
2. 表示には `<model-viewer>` などのライブラリが要る。ファイルを `js/vendor/` に置いて `index.html` から読み込み、`js/app.js` の `routes["/experience"]` の 3D資料の箇所で `<model-viewer src="./models/xxx.glb" camera-controls>` を出す。

### AR・カメラの画面を足す
- 既存の AR 用 HTML がある場合は、フォルダごと `ar/` の下に置き、`data/actions.json` に `{ "type": "ar", "url": "ar/フォルダ名/index.html", ... }` を足すだけで呼び出せる。中身は書き換えなくてよい。
- 重ねる図を足すときは、図を `images/` に置いて `media.json` に `media_<名前>` で登録し、action の `url` を `ar/overlay/index.html?overlay=<名前>` にする。
- カメラは、画面の「カメラを使う」を押したときにだけ許可を求める。映像と写真は端末の中だけで扱い、送信しない。

### 現地マップ
- いまは緯度・経度がないので、`spots.json` の `schematic`（模式図の中の位置。北が上、単位はおおよそ m）から描いている。
- 緯度・経度が確定したら `location.latitude` `location.longitude` に入れる。地図タイルで表示する場合は `js/map.js` に表示方法を足す（外部の地図サービスを使うなら、その読み込みが外部通信になる）。
- 許諾を得た配置図を使う場合は、`media.json` に登録して `spots.json` の `map.image_map.media_id` に入れ、`js/map.js` で画像の上に地点を置く処理を足す。

## 6. 別の史跡を作る

1. このフォルダを複製する。
2. `data/` の `site.json`、`entities.json`、`facts.json`、`relations.json`、`spots.json`、`media.json`、`dialogue.json`、`actions.json`、`quiz.json`、`sources.json` と `review.json` を、新しい史跡の内容に置き換える。
3. `language.json` はそのまま使える。足りない述語の言い回しだけ足す（古墳なら墳丘長、周濠など）。
4. `index.html` の `<title>` と `<meta name="description">` を書き換える。
5. `node tools/make_statements.mjs && node tools/check.mjs && node tools/make_bundle.mjs`

`js/` と `css/` は史跡に依存しない。

## 7. 確認用の表示（debug）

URL に `?debug=true` を付ける（例：`index.html?debug=true#/chat`）。

- 対話の回答の下に、topic、使った fact_id、言い回しの番号（template）、source_id、page、質問判定の点数が出る。
- 概要・遺構・遺物の各文の下に、fact_id、言い回し、status、modality が出る。
- 文末の頁番号を押すと、報告書のもとの記述（quote）と区分を確認できる。これは通常の表示でも使える。

## 8. 検査（tools/）

Node.js があるときだけ使う。公開には要らない。

| コマンド | 内容 |
|---|---|
| `node tools/check.mjs` | JSON の構文、ID の参照、language.json に数字や固有の名前が入っていないか、語尾が modality と合っているか（全 fact × 4つの話し方）、質問80件の選ばれ方、言い回しの変化 |
| `node tools/check.mjs --pdf 報告書.pdf` | 上に加えて、quote が報告書の該当頁にあるか |
| `node tools/browser_test.mjs` | Chromium での動作確認（playwright が必要）。サブフォルダの下で配信し、各ページ、対話、マップ、クイズ、debug、画面幅5種、カメラ画面、file:// を確かめる |
| `node tools/make_statements.mjs` | facts.json の statement を作り直す |
| `node tools/make_bundle.mjs` | data/data.bundle.js を作り直す |

## 9. 将来、生成AIを足すとき

差し替える場所は `js/dialogue.js` の1か所。

- `dialogue.retrieve(質問)` が、質問に合う項目と fact（出典頁つき）を返す。これを生成AIに渡す材料にする。
- いまは `result()` の中で `nlg.compose(...)` を呼んで文を作っている。ここを「fact の一覧を渡して文を作らせる」処理に替える。
- 渡すときは、各 fact の `statement`、`status`、`certainty`、`source_expression`、`attribution`、`source_refs` を付け、「渡した記述にないことは答えない」「確からしさの語尾を変えない」と指示する。
- APIキーは HTML や JavaScript に書かない。GitHub Pages だけでは鍵を隠せないので、鍵を持つ中継のサーバーを別に用意する。
- 生成AIを使わない経路（いまの方式）は、通信できないときの予備として残せる。

## 10. このテンプレート指示から変えた点

- **language.json の形**：指示の例は、同じ配列に「〜です」と「〜と考えられています」が並んでおり、選び方によって確からしさが変わる。文の型（plain / polite）と語尾（modality_endings）を分け、語尾は fact の modality で決まるようにした。
- **facts.json の項目**：`modality`、`source_expression`、`quote`、`attribution`、`superseded`、`pdf_page` などを足した。`statement` は言い回しから作る（手書きの文と生成文が食い違わないようにするため）。
- **suggestions**：文字列ではなく `{ text, topic_id }`。ボタンは文字の照合を通さず項目を直接開く。
- **relations.json**：facts と同じ内容を二重に持たないよう、根拠の fact を `fact_id` で指す。
- **review.json**：指示どおりフォルダ直下に置いた（テンプレートは data/ の中）。
- **画像**：報告書の図・写真は複製していない。題名と頁だけを `media.json` に記録し、`review.json` に挙げた。
- **地図**：緯度・経度が報告書にないため、模式図で表示している。

## 11. 通信と権限

- 外部への通信は、出典画面の「報告書の公開ページを開く」を押したときだけ（全国遺跡報告総覧）。
- 外部のスクリプト、書体、解析は読み込んでいない。
- カメラは AR・体験の画面でボタンを押したときだけ。位置情報は使っていない。
- 読み上げは端末の音声合成（Web Speech API）を使う。対応していない端末ではボタンが出ない。
