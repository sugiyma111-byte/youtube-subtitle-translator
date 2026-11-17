# Caption Translator for YouTube — 新UI案

対象リポジトリ: `sugiyma111-byte/youtube-subtitle-translator`（コミット `f508d26` を閲覧のみ。変更・コミット・Issue/PR作成はしていません）
作成日: 2026-11-17

読んだもの: README.md、docs/（USER_GUIDE・ARCHITECTURE・PRIVACY・VALIDATION）、docs/images/settings.png、src/entrypoints/popup・options、src/ui/overlay.ts・shared.css、src/youtube/controller.ts、src/core/settings.ts・types.ts・providers.ts、src/background/settings-store.ts・translator.ts、src/entrypoints/background.ts、wxt.config.ts、tests/e2e。

モックアップ（同じフォルダーのHTML、1画面1ファイル。ブラウザーで直接開けます）:

| ファイル | 内容 | 確認できること |
|---|---|---|
| mockup-1-popup.html | ポップアップ（幅360px・実寸） | 6つの状態、下部ボタンでの日英切り替え |
| mockup-2-video-overlay.html | 動画上の表示 | 7つの状態、操作バーの表示/非表示、字幕の上下、全画面相当、小さいプレーヤー |
| mockup-3-settings.html | 設定ページ | 右上の表示言語切り替え、サービス切り替え、キー未登録/登録済み、削除の確認、未保存バー |

URLに `?lang=en` などを付けても状態を指定できます（例: `mockup-1-popup.html?lang=en&state=error`）。

---

## 1. デザインの方向性・配色・フォント

**方向性**: 主役は字幕そのもの。詩的なキャッチコピーをやめ、「いまの状態」と「次に押すもの」だけが一目でわかる、静かな道具にします。動画の上と状態表示は濃紺の「字幕プレート」、設定などの面は明るい紙色に分け、オン状態だけを昔ながらの字幕の黄色で示します。

YouTubeの赤・ロゴ・再生ボタンの形・Robotoは使いません。動画上のボタンもYouTubeの操作バーには入れず、独自の形（スイッチ付きのピル）にします。

### 配色

| 役割 | 色 | 使いどころ | コントラスト比 |
|---|---|---|---|
| インク | `#17212B` | 本文、主ボタンの地 | 白地に 16.3:1 |
| スレート | `#4B5967` | 補足文 | 白地に 7.2:1、紙色に 6.3:1 |
| 紙 | `#EEF1F4` | ページ背景 | — |
| 面 | `#FFFFFF` | カード、入力欄 | — |
| 字幕イエロー | `#FFD84A` | オン状態・進捗だけ | プレート上 13.6:1 |
| プレート | `#0D1218`（動画上は88%不透明） | 動画上のボタン・状態表示・字幕の地 | 白文字 18.8:1 |
| 注意 | `#9A3B00` / 地 `#FFF1E6` | 「暗号化なし」の警告 | 6.3:1（本文 14.1:1） |
| 削除 | `#B42318` | 削除ボタン | 白地に 6.6:1 |
| 成功 | `#0B6B45` / 地 `#E4F4EC` | 接続確認OK、登録済み | 5.8:1 |
| 入力欄の枠 | `#6B7785` | 入力欄・選択肢の枠 | 白地に 4.6:1（枠の基準3:1を満たす） |
| フォーカス | `#1D5FD3`（動画上は白の二重線） | キーボード操作時の枠 | 5.8:1 |

黄色は「オン」の意味だけに使い、警告は橙茶＋三角アイコンで区別します（色だけに頼らない）。現状の補足文 `#64766e` はページ背景 `#f4f5ef` に対して約 4.4:1 で、11〜12pxの小さな文字には不足しています。新案の文字は最小13pxです。

### フォント

拡張機能は外部フォントを読み込まない前提（プライバシーと配布サイズのため）で、OSのフォントを指定します。

```css
font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system,
             "BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
```

- 欧文を先に、和文を後に並べ、英語UIでも日本語UIでも同じ指定で済ませます。和文はWindows標準のUDフォント（BIZ UDPゴシック）を優先します。
- サイズは 13 / 14 / 15 / 19 / 26px の5段。字幕の訳文は太字700、原文は訳文の0.62倍。
- 数字が動く箇所（進捗、px、秒）は `font-variant-numeric: tabular-nums`。

### アイコン

濃紺の角丸四角に、白い線（原文）と短い黄色の線（訳文）の2本。「2行の字幕」を表します。再生ボタンや吹き出しの形は使いません。

---

## 2. 画面ごとの案

### 2-1. ポップアップ

**レイアウト（上から）**

1. ヘッダー: アイコン、製品名（「Caption Translator」＋小さく「for YouTube」）、右端に設定ボタン（44×44px）。
2. 状態プレート（濃紺）: 状態の印＋見出し、説明1〜2行、翻訳中は進捗バーと「42 / 118 区間を翻訳済み」。
3. 主ボタン（高さ48px・幅いっぱい）: 状態に応じて文言が変わる。エラー時は2つ目のボタンが出る。
4. 現在の設定: 「翻訳サービス: Sarashina」「言語: 英語 → 日本語」と「変更」（設定ページへ）。
5. フッター: 送信範囲の注意書き1行と、表示言語の切り替えボタン（地球アイコン＋切り替え先の言語名）。

**状態と主ボタン**

| 状態 | 見出し（日 / 英） | 主ボタン（日 / 英） |
|---|---|---|
| 開始前 | この動画を翻訳できます / Ready to translate this video | 翻訳を開始 / Start translating |
| 翻訳中 | 翻訳中 / Translating | 翻訳を停止 / Stop translating |
| 送信待ち | 少し待っています / Waiting briefly | 翻訳を停止 / Stop translating |
| エラー | 字幕を取得できませんでした / Couldn't load captions | 字幕を再取得 / Reload captions（＋翻訳を停止） |
| APIキー未登録 | APIキーが未登録です / No API key yet | APIキーを登録 / Add API key（設定のキー欄へ） |
| 動画ページ以外 | YouTubeの動画ページで使えます / Open a YouTube video to use this | 翻訳を開始（押せない状態） |

**その他の文言**

| 場所 | 日本語 | English |
|---|---|---|
| 設定ボタン | 設定を開く | Open settings |
| 設定の要約 | 翻訳サービス / 言語 / 変更 | Service / Languages / Change |
| 進捗 | 42 / 118 区間を翻訳済み | 42 of 118 segments translated |
| 注意書き | 翻訳を開始した動画の字幕だけを、翻訳サービスに送信します。 | Captions are sent to the translation service only for videos where you start translating. |
| 言語ボタン | English（日本語表示のとき） | 日本語（英語表示のとき） |

**操作の流れ（初回）**: アイコンを押す →「APIキーが未登録です」→［APIキーを登録］→ 設定ページのAPIキー欄が開く → 登録後、動画ページで開き直すと「この動画を翻訳できます」→［翻訳を開始］→ プレートが「翻訳中」になり進捗が出る。

**表示言語の切り替え**: フッターのボタンを1回押すと、その場で全文言が切り替わります（保存ボタンなし）。ボタンには常に「切り替え先」の言語名をその言語で書くので、いまの表示が読めない人でも見つけられます。

### 2-2. 動画上の表示

**レイアウト**

- **操作ボタン**: プレーヤー右端、上の帯（全画面時のタイトルやカードの「i」が出る領域）のすぐ下。`right: 12px; top: 上の帯 + 8px`（上の帯は通常56px・全画面72pxを目安）。YouTubeの操作バーには何も入れません。
  - ［アイコン｜翻訳｜オン/オフ｜スイッチ］のピル（高さ44px、`role="switch"`）と、丸い設定ボタン（44×44px）の2つだけ。
  - 幅520px未満のプレーヤーでは「翻訳」の文字を省き、オン/オフとスイッチだけにします。
- **状態表示**: ピルの真下に右寄せで出るプレート（最大幅380px）。準備中・送信待ちは文だけ、エラー・キー未登録は橙の左線＋ボタン付き。翻訳が順調なときは何も出しません。
- **字幕**: 中央寄せ・左右8%の余白。訳文（太字）の下に原文（0.62倍）。字幕の地は82%不透明の濃紺、角丸。
  - 下側表示: YouTubeの操作バーが出ている間だけ、その高さ分だけ上に逃げる。隠れたら下端近くに戻る。
  - 上側表示: 操作ボタンの行より下（上の帯 + 68px）から始める。

**邪魔にならないための動き**

| 場面 | 操作ボタン | 状態表示 | 字幕 |
|---|---|---|---|
| マウスを動かした（操作バー表示中） | 出る | 必要なら出る | 操作バーの上 |
| 操作バーが自動で隠れた・翻訳は順調 | 一緒に消える | なし | 下端近く |
| 操作バーが隠れた・準備中/待ち/エラー | 消える | 残る（伝えることがある間だけ） | 待ちの間は「翻訳中…」 |
| キーボードでフォーカス中 | 消えない | — | — |
| 広告中・動画終了後 | 現状どおり字幕を隠す | — | 隠す |

全画面でも同じ規則で、位置の数値だけ大きくします。操作バーの表示/非表示は、プレーヤーの `ytp-autohide` クラスを見て判定する案です（YouTube内部の名前なので変わる可能性あり。取れないときはマウス移動から3秒で隠す独自タイマーに切り替え）。

**文言**

| 場所 | 日本語 | English |
|---|---|---|
| スイッチ | 翻訳　オン / オフ | Translate　On / Off |
| スイッチの読み上げ名 | この動画の字幕を翻訳する | Translate captions for this video |
| 設定ボタン | 設定を開く | Open settings |
| 準備中 | 字幕を準備しています… | Preparing captions… |
| 送信待ち | 送信間隔を調整しています。自動で続行します。 | Spacing out requests to stay within the limit. This resumes automatically. |
| エラー | 字幕を取得できませんでした。YouTubeの「文字起こしを表示」で原文の言語を確認してください。 | Couldn't load captions. Open “Show transcript” on YouTube and check the source language. |
| エラー（小さいプレーヤー） | 字幕を取得できませんでした。 | Couldn't load captions. |
| キー未登録 | APIキーが未登録です。設定で登録してから、もう一度オンにしてください。 | No API key yet. Add one in Settings, then turn this on again. |
| ボタン | 字幕を再取得 / 設定を開く | Reload captions / Open settings |
| 訳文待ち | 翻訳中… | Translating… |

**操作の流れ**: 動画にマウスを乗せる → 右上に「翻訳 オフ」→ 押す →「翻訳 オン」（黄色）＋「字幕を準備しています…」→ 訳文が出たら状態表示は消える → マウスを止めるとボタンも消え、字幕だけが残る → 止めるときはマウスを動かして同じスイッチを押す（YouTube本来の字幕に戻る）。

**任意の提案（挙動が変わるので別判断）**: 文字サイズを「プレーヤーの高さ540pxのときの大きさ」とみなし、高さに比例して拡大縮小する（最小14px）。いまは固定pxのため、全画面では相対的に小さく、小さいプレーヤーでは大きくなります。モックアップはこの比例方式です。

### 2-3. 設定ページ

**レイアウト**

- **上部ヘッダー（スクロールしても固定）**: 左にアイコン・製品名・「設定・v0.1.0」。右に **表示言語の切り替え**（地球アイコン＋「表示言語 / Language」＋［自動｜日本語｜English］）。
- **左の列（設定本体）**: 4つのブロックを上から順に。
  1. 翻訳サービスとAPIキー
  2. 翻訳する言語と文体
  3. 字幕の見え方
  4. この端末に保存したデータ
- **右の列（追従）**: 表示イメージ（字幕の見え方がすぐ反映）と「使い始めるまで」の3手順、送信範囲の注意、ガイドへのリンク。幅900px未満では本体の下に回り、消えません。
- **下部の保存バー（固定）**: 「保存していない変更があります。」/「すべて保存済みです。」と［変更を保存］。保存・削除の結果もここに出ます（`aria-live`）。

**各ブロックの中身（既存の設定項目との対応）**

| ブロック | 項目 | 形 | 既存の項目 |
|---|---|---|---|
| 1 | 使うサービス | 説明つきの2択カード | provider |
| 1 | 接続先のベースURL / モデル名 / 1分あたりの送信上限 | 互換APIを選んだときだけ表示 | customBaseUrl / customModel / customRpm |
| 1 | APIキー | 入力欄＋［表示/隠す］、状態バッジ、警告、［保存して接続を確認］［このキーを削除］ | apiKey、接続確認、キー削除 |
| 2 | 原文の言語 → 翻訳先の言語 | 2つの選択欄＋入れ替えボタン | sourceLang / targetLang |
| 2 | 言語コード | 「その他」を選んだときだけ表示 | 言語コード指定 |
| 2 | 日本語の文体 | 3択の切り替えボタン | style |
| 3 | 表示する字幕 / 表示位置 | 2択の切り替えボタン | displayMode / position |
| 3 | 文字サイズ（16〜48px）/ 先読みする長さ（10〜90秒） | スライダー＋［−］［+］（各44px） | fontSize / lookaheadSeconds |
| 4 | 保存した訳文を削除 | 確認ダイアログ付き | キャッシュ削除 |
| 4 | サービスごとのAPIキーの状態と削除 | 確認ダイアログ付き | キー削除（両サービス分を一覧に） |

**APIキーが暗号化されないことの伝え方**（APIキー欄のすぐ下、保存ボタンの手前。折りたたまず常に表示）

| | 日本語 | English |
|---|---|---|
| 見出し | APIキーは暗号化せずに保存されます | Your API key is stored without encryption |
| 1 | キーはこのChromeプロファイルの中に、そのままの文字列で保存されます。入力欄の「●●●」は画面上で隠しているだけで、暗号化ではありません。 | The key is saved as plain text inside this Chrome profile. The dots in the field only hide it on screen; they are not encryption. |
| 2 | このPCの保存ファイルやバックアップを読める人は、キーを読み取って使える可能性があります。共有のPCには登録しないでください。 | Anyone who can read this computer's files or backups may be able to read and use the key. Don't save a key on a shared computer. |
| 3 | キーを送る先は、選んだ翻訳サービスだけです。Chromeの同期やGitHubには送りません。 | The key is sent only to the translation service you selected. It is never sent to Chrome sync or GitHub. |
| リンク | 保存と削除のくわしい説明を読む（docs/PRIVACY.md） | Read more about how keys are stored and deleted |

加えて、登録後のバッジを「登録済み（暗号化なし）/ Saved (not encrypted)」とし、状態を見るたびに思い出せるようにします。データのブロックには「ここで削除しても、発行元のキーは無効になりません」を置きます。

**主な文言**

| 場所 | 日本語 | English |
|---|---|---|
| ページ見出し | 設定 | Settings |
| ブロック1 | 翻訳サービスとAPIキー | Translation service and API key |
| Sarashinaの説明 | 英語 ⇄ 日本語の翻訳専用。接続先とモデル名の入力は不要です。 | Built for English ⇄ Japanese. No endpoint or model name needed. |
| 互換APIの説明 | 韓国語・中国語・フランス語など、その他の言語に。ベースURLとモデル名が必要です。 | For other languages such as Korean, Chinese or French. Needs a base URL and a model name. |
| 補足 | サービスは自動では切り替わりません。「OpenAI互換」は通信形式の名前で、OpenAI社以外のサービスも使えます。 | Services never switch automatically. “OpenAI-compatible” is the name of the API format, so providers other than OpenAI work too. |
| ベースURLの補足 | 末尾の /chat/completions は付けません。URLを変更すると、保存済みの互換APIキーは削除されます。 | Leave off the trailing /chat/completions. Changing this URL deletes the key saved for this service. |
| キーの状態 | 未登録 / 登録済み（暗号化なし） | Not set / Saved (not encrypted) |
| キー欄 | APIキーを貼り付け / 変更するときだけ入力 | Paste your API key / Enter only to replace the saved key |
| ボタン | 保存して接続を確認 / このキーを削除 | Save and test connection / Delete this key |
| 接続OK | 接続できました。テスト翻訳：… | Connected. Test translation: … |
| ブロック2 | 翻訳する言語と文体 | Translation languages and style |
| 言語欄 | 原文の言語（動画の字幕）/ 翻訳先の言語 | Source language (video captions) / Target language |
| 文体 | おまかせ / 常体（だ・である）/ 敬体（です・ます） | Auto / Plain (da / de aru) / Polite (desu / masu) |
| ブロック3 | 字幕の見え方 | Caption appearance |
| 表示 | 訳文＋原文 / 訳文のみ | Translation + original / Translation only |
| 位置 | 動画の下側 / 動画の上側 | Bottom of video / Top of video |
| スライダー | 文字サイズ / 先読みする長さ | Text size / Look-ahead |
| ブロック4 | この端末に保存したデータ | Data stored on this device |
| 削除 | 保存した訳文を削除 | Delete saved translations |
| 確認 | 保存した訳文を削除しますか？ / キャンセル / 削除する | Delete saved translations? / Cancel / Delete |
| 保存バー | 保存していない変更があります。/ 変更を保存 | You have unsaved changes. / Save changes |
| 表示言語 | 自動 / 日本語 / English | Auto / 日本語 / English |

全文はモックアップ内の `M.ja` / `M.en`（そのまま文言ファイルの下書きに使えます）。

**操作の流れ（初回のAPIキー登録 → 翻訳開始）**

1. 設定ページを開く。右の「使い始めるまで」の1番が未完了、キーのバッジは「未登録」。
2. サービスを選ぶ（初期値はSarashina）。互換APIならベースURL・モデル名・送信上限を入力。
3. APIキーを貼り付ける。すぐ下の警告で「暗号化されない」ことを読む。
4. ［保存して接続を確認］。互換APIのときはここでChromeが接続先へのアクセス許可を求める。
5. 「接続できました。テスト翻訳：…」が同じブロック内に出る。バッジが「登録済み（暗号化なし）」、手順1にチェックが付く。
6. YouTubeで字幕のある動画を開き、動画右上の「翻訳」をオンにする。

**表示言語の切り替えの流れ**

- 場所: 設定ページのヘッダー右（常に見える）。ポップアップのフッターにも簡易ボタン。
- ラベルは「表示言語 / Language」と常に2言語で書き、選択肢の「日本語」「English」は翻訳しません。
- 押した瞬間に画面全体が切り替わります。保存ボタンは不要で、未保存バーも反応しません（翻訳設定とは別に保存）。
- 開いているポップアップ・YouTubeタブの動画上の表示にもすぐ反映します。翻訳中の動画は止めません。
- 「自動」（初期値）はChromeの表示言語が日本語なら日本語、それ以外は英語。
- 「翻訳する言語」（字幕の言語）とは別物なので、ブロック名を「翻訳する言語と文体」とし、UI側は必ず「表示言語」と呼び分けます。

---

## 3. いまのUIの問題点と改善

| # | いまの問題 | 根拠 | 改善 |
|---|---|---|---|
| 1 | APIキーが暗号化されないことが設定画面で伝わらない。あるのは小さな「キーはこのブラウザーに保存します。」だけ | options/index.html | キー欄の直下に常時表示の警告、バッジにも「暗号化なし」 |
| 2 | 動画上のボタンが小さい（12px文字・高さ約33px）うえ、常に表示されたまま | overlay.ts `.toolbar` | 44pxのピルと丸ボタン。操作バーと一緒に自動で隠れる |
| 3 | ボタン位置が右上の端（top:14px）で、全画面時のタイトルやカードの表示と重なりうる | overlay.ts | 上の帯を避けて、そのすぐ下に配置 |
| 4 | 「翻訳 OFF」を押すと開始する。状態の表示なのか操作なのかが紛らわしい | overlay.ts、USER_GUIDE「『翻訳 OFF』を押します」 | 「翻訳」＋オン/オフのスイッチ（`role="switch"`） |
| 5 | 字幕の位置が固定値（bottom:64px / top:100px）で、操作バーの有無やプレーヤーの大きさに追従しない | overlay.ts `configure` | 操作バーが出ている間だけ上に逃げる。上側表示はボタン行の下から |
| 6 | ポップアップの上部を大きなキャッチコピー（27px・2行）が占め、状態は13pxの灰色の文 | popup/index.html `h1` | 状態プレートを主役に。コピーは削除 |
| 7 | ポップアップでAPIキー未登録がわからない（`hasApiKey` は取得しているが未使用） | popup/main.ts | 「APIキーが未登録です」＋［APIキーを登録］ |
| 8 | 「保存した訳文を削除」がヘルプ欄の中にあり、幅760px以下では非表示になって使えない | options/style.css の media query | 「この端末に保存したデータ」ブロックに移し、どの幅でも表示 |
| 9 | 削除が確認なしで即実行。キー削除は12pxの文字リンク | options/main.ts | 赤枠の44pxボタン＋確認ダイアログ |
| 10 | 保存・接続確認・削除の結果がすべてページ最下部の1か所に出る（操作した場所から遠い） | `#message` | 接続確認はキー欄の下、保存と削除は固定の保存バー |
| 11 | 未保存かどうかがわからない | — | 保存バーに未保存の表示（黄色の印＋文） |
| 12 | 2〜3択の項目もすべてプルダウン。サービスの違いが選択肢の文言でしか伝わらない | options/index.html | 切り替えボタンと説明つきカード |
| 13 | 「01 / 02 / 03」の番号が手順のように見えるが、実際は並列の設定 | `.step` | 番号をやめ、番号は本当の手順（使い始めるまで）だけに使う |
| 14 | 補足文が11〜13pxで、ページ背景上のコントラストも約 4.4:1 | shared.css `.muted`、`.eyebrow` | 最小13px、補足文は 6.3:1 以上 |
| 15 | スライダーのつまみだけが操作対象で小さい | `input[type=range]` | 高さ44pxの操作域＋［−］［+］ボタン |
| 16 | 文言がHTML・TS・エラーメッセージに日本語で直書き。旧名「ことのは字幕」も各所に残る | 全体 | 文言ファイルに集約（4章） |
| 17 | 日→英の切り替えは2つのプルダウンを両方変える必要がある | options | 入れ替えボタン1つ |

**残した機能の確認（READMEの「機能」）**

| 機能 | 新UIでの場所 |
|---|---|
| 英語字幕・自動字幕の翻訳、Sarashinaでの日→英 | 設定2（入れ替えボタン）、動画上のスイッチ、ポップアップ |
| 訳文のみ／併記、文字サイズ、表示位置、文体 | 設定2・3 |
| 先読み、早送り・巻き戻し・一時停止・全画面への追従 | 設定3（先読み）、動画上の表示規則 |
| ローカルキャッシュ、複数タブ共通の送信制限、429対応 | 設定4（削除）、「送信間隔を調整しています」表示 |
| OpenAI互換APIの接続先・モデル・言語コード・送信上限 | 設定1・2 |
| 接続確認、キー削除、字幕の再取得、設定を開く | 設定1・4、動画上とポップアップのエラー表示 |
| 開始した動画だけで動作 | ポップアップの注意書き、設定右列 |

---

## 4. 実装時に変更が必要そうなファイルと、日英切り替えの方針

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `wxt.config.ts` | `name` を新名に。`description` を `__MSG_extDescription__`、`default_locale: 'en'` を追加 |
| `public/_locales/ja/messages.json`・`en/messages.json`（新規） | manifest用（拡張機能一覧・ストアに出る説明文）だけ |
| `src/i18n/ja.ts`・`en.ts`・`index.ts`（新規） | 文言の辞書、`t()`、言語の決定、DOMへの適用 |
| `src/core/types.ts` | `UiLanguage = 'auto' \| 'ja' \| 'en'`、`PublicSettings` に `uiLanguage` とサービス別のキー有無、`Failure`・`PlayerStatus` を文言キー方式に |
| `src/core/settings.ts` | エラー文をキーに。`PROVIDERS[].name`（「OpenAI互換API」）も辞書へ |
| `src/core/providers.ts`、`src/background/translator.ts` | `failure(code, 日本語文)` → `failure(code, キー)` |
| `src/background/settings-store.ts` | `uiLanguage` の読み書き（`settings` とは別キー）、両サービスのキー有無を返す |
| `src/entrypoints/background.ts` | 表示言語の取得・変更メッセージ、変更時の各タブへの通知 |
| `src/entrypoints/popup/`（3ファイル） | 新レイアウト、状態別の表示、言語ボタン |
| `src/entrypoints/options/`（3ファイル） | 新レイアウト、言語切り替え、警告、確認ダイアログ、保存バー |
| `src/ui/overlay.ts` | スイッチ化、自動で隠す、位置の規則、文言の差し替え |
| `src/ui/shared.css` | 色・文字サイズの変数に置き換え |
| `src/youtube/controller.ts`、`source.ts` | 状態・エラー文をキーに。操作バー表示状態の監視 |
| `src/entrypoints/youtube.content.ts` | 表示言語変更の通知を受けて再描画 |
| `public/icon.svg`、`icon-*.png`（`scripts/generate-icons.mjs` で再生成） | 新アイコンにする場合 |
| `tests/e2e/extension.test.ts`、`tests/unit/`（追加） | ボタン名の変更に追従、辞書の検査、言語切り替えの確認 |
| `README.md`、`docs/*.md`、`docs/images/settings.png` | 新名・新しい画面・新しい操作名（「翻訳 OFF を押す」→「翻訳をオンにする」）に更新 |
| `package.json` | 説明文。配布ZIP名は要確認: USER_GUIDE は `kotonoha-subtitles-0.1.0-chrome.zip` と案内しているが、`name` は `youtube-subtitle-translator` で、リポジトリ内にZIP名を変える設定は見当たらない |

内部の識別子（メッセージの `kotonoha:` 接頭辞、`#kotonoha-subtitles`、`data-kotonoha-active`）は利用者に見えないので、改名は任意です。変えるならテストと合わせて一括で。

### 日英切り替えの実装方針

**1. 画面の文言は自前の辞書で持つ。`chrome.i18n` は manifest 用だけにする。**
`chrome.i18n`（`_locales`）はブラウザーの表示言語で決まり、拡張内の設定で切り替えられません。そこで、拡張機能一覧に出る名前と説明だけ `_locales` に置き、画面の文言はTypeScriptの辞書にします。WXTでは `public/_locales/<言語>/messages.json` に置き、manifest に `default_locale` を指定します（[WXTのi18nガイド](https://wxt.dev/guide/essentials/i18n)）。

**2. 辞書は「日本語を正、英語は同じキーを強制」。**

```ts
// src/i18n/ja.ts
export const ja = {
  'overlay.toggle.label': '翻訳',
  'popup.progress': '{done} / {total} 区間を翻訳済み',
  'error.auth': 'APIキーまたはサービスの利用権限を確認してください。',
} as const;
export type MessageKey = keyof typeof ja;

// src/i18n/en.ts
export const en: Record<MessageKey, string> = { /* キーが欠けると型エラー */ };

// src/i18n/index.ts
export function t(lang: 'ja' | 'en', key: MessageKey, params?: Record<string, string | number>): string
export function resolveLanguage(pref: UiLanguage, browserLang: string): 'ja' | 'en'  // ja* → ja、他 → en
```

単体テストで「全キーが両言語にある」「`{done}` などの差し込み名が一致する」を検査します。

**3. HTMLは `data-i18n` 属性で差し替える。**
`<button data-i18n="options.save">` のように書き、`applyI18n(root, lang)` が `textContent`・`placeholder`・`aria-label`・`title` を入れます（`innerHTML` は使わない）。同時に `<html lang>` も更新。モックアップがこの方式で動いています。

**4. 表示言語は翻訳設定（`Settings`）に入れない。**
`Settings` は `JSON.stringify` して翻訳リクエストの照合（`settingsSignature`）に使われ、保存すると翻訳中の動画が取得し直しになります。表示言語を混ぜると、言語を切り替えただけで翻訳中の動画がやり直しになります。`chrome.storage.local` の別キー（例 `uiLanguage`）に保存し、保存メッセージも別にします。

**5. 動画上の表示にはメッセージで渡す。**
ストレージは `TRUSTED_CONTEXTS` に制限されていて、YouTube上のスクリプトからは読めません。`get-settings` の応答に `uiLanguage` を足し、変更時はバックグラウンドから各YouTubeタブへ通知します（いまの `settings-changed` と同じ経路）。ポップアップと設定ページは `storage.onChanged` で追従できます。

**6. エラーと状態は「文」ではなく「キー」で運ぶ。**
いまはバックグラウンドやコントローラーが日本語の文を作って返しています。`{ code, messageKey, params }` を返し、表示する側が `t()` で文にします。こうすると、表示中に言語を切り替えても状態表示が正しい言語になります。

**7. 言語名は `Intl.DisplayNames` に任せる。**
ポップアップは既に使っています（いまは `['ja']` 固定）。表示言語を渡せば「英語 → 日本語」/「English → Japanese」が自動で出ます。設定の言語リストも同じ方法にでき、辞書に持つのは「その他（言語コードを指定）」だけで済みます。

**8. 英語が長くなる箇所の受け方。**
ボタンは幅固定にせず折り返し可（`min-height: 44px`）、切り替えボタンは等幅に割って2行まで許容、動画上のピルは狭いときに文字を省略。モックアップでは日英とも幅360px（ポップアップ）・420px（設定ページ）・460px（小さいプレーヤー）で収まることを画面で確認しました。

### 進め方の目安

1. 文言の外出し（見た目は変えず、辞書と `t()` に置き換え）＋表示言語の保存と切り替え
2. 設定ページの組み替え（警告・保存バー・確認ダイアログ）
3. ポップアップ
4. 動画上の表示（自動で隠す・位置の規則）— 実際のYouTubeでの確認が必要
5. 名前・アイコン・README・ガイド・スクリーンショットの更新

---

## 確認できていないこと

- 実際のYouTubeページでは試していません。上の帯・操作バーの高さ（56 / 72 / 64 / 88px）は目安で、通常・シアター・全画面・小さいプレーヤーでの実測が必要です。
- `ytp-autohide` はYouTube内部のクラス名で、今後変わる可能性があります。
- モックアップの描画確認はLinux上のChrome（Notoフォント）で行いました。Windows（BIZ UDPゴシック、Yu Gothic UI）やmacOS（ヒラギノ）では字幅が少し変わります。
- 英語の文言は下書きです。公開前にネイティブの確認をおすすめします。
