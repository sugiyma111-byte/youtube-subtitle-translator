# Codex への引き継ぎ手順

## 1. 準備（済み）

提案書・モックアップ・この手順書は `docs/design/ui-redesign/` に、共通ルールはリポジトリ直下の `AGENTS.md` に置いてあります。
Codex は作業前に `AGENTS.md` を読むので、各段階の指示文で同じルールを繰り返す必要はありません。

## 2. 段階ごとに依頼する（1段階 = 1 PR）

一度に全部を頼むと差分が大きくなり、確認しづらくなります。提案書（ui-proposal.md）4章の「進め方の目安」の順で、次の5回に分けます。各段階が終わったらPRを確認し、マージしてから次を頼んでください。

### 段階1：文言の外出しと表示言語の切り替え（見た目は変えない）

```
docs/design/ui-redesign/ui-proposal.md の「4. 実装時に変更が必要そうなファイルと、日英切り替えの方針」に沿って、
UIの文言を辞書に移し、表示言語（自動・日本語・English）を保存・切り替えできるようにしてください。

- src/i18n/ja.ts・en.ts・index.ts を新設。en は Record<MessageKey, string> にして、キーの欠けを型エラーにする。
- popup・options・overlay・controller・background・providers・settings・translator の日本語直書きを t() に置き換える。
- エラーと状態は日本語の文ではなく、messageKey と params で返す形にする。
- 表示言語は chrome.storage.local の uiLanguage キーに保存し、変更をYouTubeタブへメッセージで通知する。
- 言語名は Intl.DisplayNames(表示言語) で出す。
- 拡張名を「Caption Translator for YouTube」に変更し、manifest の説明文は public/_locales（ja / en、default_locale: en）で出す。
- 見た目（CSS・レイアウト）はこの段階では変えない。切り替えボタンは仮の場所でよい。
- 単体テストに「全キーが両言語にある」「差し込み名 {…} が一致する」を追加。
- pnpm check を通す。
```

### 段階2：設定ページの組み替え

```
docs/design/ui-redesign/mockup-3-settings.html と ui-proposal.md の「2-3. 設定ページ」に合わせて、
src/entrypoints/options/ と src/ui/shared.css を作り直してください。

- ヘッダー右の表示言語切り替え（自動・日本語・English）。押すとすぐ反映し、未保存扱いにしない。
- APIキー欄の直下に「暗号化せずに保存されます」の警告を常時表示。登録済みバッジは「登録済み（暗号化なし）」。
- 「この端末に保存したデータ」ブロックに、訳文キャッシュと両サービスのキーの削除をまとめ、確認ダイアログを付ける。
- 下部固定の保存バー（未保存の表示、保存・削除の結果）。接続確認の結果はキー欄の下に出す。
- 2〜3択はプルダウンでなく切り替えボタン。スライダーに［−］［+］。原文と翻訳先の入れ替えボタン。
- 幅760px以下でも全項目が使えること。
- 既存の設定項目・保存処理・権限要求（互換APIの接続先許可）・ベースURL変更時のキー削除はすべて残す。
- e2e テストを新しいボタン名に合わせて更新し、pnpm check と pnpm test:e2e を通す。
```

### 段階3：ポップアップ

```
docs/design/ui-redesign/mockup-1-popup.html と ui-proposal.md の「2-1. ポップアップ」に合わせて、
src/entrypoints/popup/ を作り直してください。

- 状態プレート（開始前・翻訳中・送信待ち・エラー・APIキー未登録・動画ページ以外）と、状態に応じた主ボタン。
- APIキー未登録は hasApiKey から判定し、［APIキーを登録］で設定ページを開く。
- 現在のサービスと言語の要約、［変更］。
- フッターの表示言語ボタン（切り替え先の言語名を表示）。
- 幅360pxで日英とも収まること。pnpm check を通す。
```

### 段階4：動画上の表示

```
docs/design/ui-redesign/mockup-2-video-overlay.html と ui-proposal.md の「2-2. 動画上の表示」に合わせて、
src/ui/overlay.ts と src/youtube/controller.ts を変更してください。

- 「翻訳 OFF/ON」ボタンを、role="switch" の「翻訳 オン/オフ」スイッチ（高さ44px）と丸い設定ボタン（44px）に置き換える。
- 位置は右端・上の帯のすぐ下。YouTubeの操作バーの中には何も入れない。
- プレーヤーの操作バーが自動で隠れたら一緒に隠す（#movie_player の ytp-autohide を監視。取れない場合はマウス停止3秒で隠す）。
  ただし準備中・送信待ち・エラーの表示中と、キーボードでフォーカス中は隠さない。
- 字幕の下側表示は、操作バーが出ている間だけ上に逃げる。上側表示は操作ボタンの行より下から。
- 幅520px未満のプレーヤーでは「翻訳」の文字とエラーの長文を省く。
- 文字サイズの比例拡大縮小（提案書の「任意の提案」）はこの段階では実装しない。
- e2e テストを更新し、pnpm check と pnpm test:e2e を通す。
```

### 段階5：名前・アイコン・ドキュメント

```
拡張名「Caption Translator for YouTube」に合わせて、README.md と docs/*.md の旧名「ことのは字幕」と操作説明
（「翻訳 OFF を押す」など）を新しいUIに合わせて更新してください。
docs/design/ui-redesign/ui-proposal.md の「アイコン」の案で public/icon.svg を作り直し、scripts/generate-icons.mjs でPNGを再生成してください。
docs/images/settings.png は新しい設定画面のスクリーンショットに差し替えてください。
配布ZIPの名前（USER_GUIDE では kotonoha-subtitles-…）が実際の出力名と一致しているかも確認し、ずれていれば説明を直してください。
```

## 3. 確認のときに見るところ

- 段階1: 表示言語を切り替えても、翻訳中の動画が止まらないこと。
- 段階2: キー削除・訳文削除に確認が出ること。警告が常に見えること。狭い幅で項目が消えないこと。
- 段階4: 実際のYouTubeで、通常・シアター・全画面のそれぞれで、YouTubeのボタンやタイトルと重ならないこと（モックアップの高さは目安なので、ここだけは実物で確認が必要です）。
