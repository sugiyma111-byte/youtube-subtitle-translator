# ことのは字幕

YouTubeの既存字幕を先読みして翻訳し、動画上に重ねて表示するChrome拡張機能です。
初期の翻訳先はSarashina。字幕取得・翻訳管理・API接続・表示を分離し、他の言語やAPIを追加できる構成にします。

## 開発段階

1. TypeScript / WXT / Manifest V3 の土台
2. 時刻付き字幕の整理、翻訳API接続、キャッシュと利用量制御
3. YouTube上の表示、設定画面、結合テスト、導入用ZIP

## 開発

Node.js 24、pnpm 11を使用します。

```sh
pnpm install
pnpm build
```

ビルドした `.output/chrome-mv3` をChromeの拡張機能管理画面から読み込みます。
APIキーや個人の閲覧データをリポジトリに追加しないでください。

## 方針

- 既存の字幕がある通常動画から対応。音声認識、吹き替え、ライブ配信は初期対象外。
- APIキーはユーザーが拡張の設定画面で登録。コードや同期ストレージに含めない。
- YouTubeの字幕取得は非公開の画面構造に依存するため、取得方法を交換可能にする。
- 翻訳APIの対応言語、入力上限、認証、レスポンス形式を接続部分に閉じ込める。

仕様参照: [Sarashina Translate](https://docs.sarashina.ai/api-reference/translate)、[レート制限](https://docs.sarashina.ai/rate-limits)、[WXT](https://wxt.dev/)。
