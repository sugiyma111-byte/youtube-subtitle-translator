# AGENTS.md

このリポジトリで作業するエージェント向けの共通ルールです。

## 開発環境

- Node.js 24 / pnpm 11。
- 変更の最後に `pnpm check`（型チェック・単体テスト・本番ビルド）を通す。
- 画面やボタン名を変えたときは `pnpm test:e2e` も通す（`pnpm exec playwright install chromium` が必要）。
- 自動テストは実際の翻訳APIを呼ばない。APIキーをコードやテストデータに含めない。

## UI刷新（Caption Translator for YouTube）

- 仕様は docs/design/ui-redesign/ui-proposal.md。見た目と文言は同じフォルダーの mockup-*.html を正とする。
- 作業の進め方と段階ごとの範囲は docs/design/ui-redesign/CODEX_HANDOFF.md を参照する。
- モックアップは見た目の参照であり、コードをそのまま貼らない。既存の WXT の構成（src/entrypoints、src/ui、src/core）に合わせて実装する。
- 字幕・外部から来た文字列は textContent で表示し、innerHTML を使わない。
- 表示言語（uiLanguage）は Settings 型に入れず、chrome.storage.local の別キーに保存する。Settings は翻訳リクエストの照合（settingsSignature）に使われているため。
- chrome.storage は TRUSTED_CONTEXTS に制限されている。YouTube 上のスクリプトへはメッセージで値を渡す。
- 外部フォント・外部CDNは読み込まない。
- 操作できる要素は 44px 以上。文字は最小 13px。
- e2e テスト（tests/e2e）のボタン名などは、文言の変更に合わせて更新する。
- 1回の依頼で行うのは、指示された段階だけ。次の段階の変更を先取りしない。
