import type { ProviderCapabilities, Settings } from './types';

export const PROVIDERS: Record<Settings['provider'], ProviderCapabilities> = {
  sarashina: { id: 'sarashina', name: 'Sarashina', languagePairs: [['en', 'ja'], ['ja', 'en']], maxCharacters: 5000, requestsPerMinute: 30 },
  'openai-compatible': { id: 'openai-compatible', name: 'OpenAI互換API', languagePairs: 'custom', maxCharacters: 5000, requestsPerMinute: 30 },
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'sarashina', sourceLang: 'en', targetLang: 'ja', style: 'auto',
  displayMode: 'bilingual', fontSize: 26, position: 'bottom', lookaheadSeconds: 30,
  customBaseUrl: '', customModel: '', customRpm: 30,
};

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('接続先には、認証情報やクエリを含まないHTTPSのURLを指定してください。');
  }
  return url.href.replace(/\/+$/, '');
}

export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('設定の形式が正しくありません。');
  const value = { ...DEFAULT_SETTINGS, ...input } as Settings;
  if (!(value.provider in PROVIDERS) || !['sarashina', 'openai-compatible'].includes(value.provider)) throw new Error('翻訳サービスを選択してください。');
  for (const language of [value.sourceLang, value.targetLang]) {
    if (typeof language !== 'string' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) throw new Error('言語コードを確認してください（例: en、ja、zh-CN）。');
  }
  if (value.sourceLang.toLowerCase() === value.targetLang.toLowerCase()) throw new Error('原文と翻訳先には異なる言語を指定してください。');
  if (value.provider === 'sarashina' && ![['en', 'ja'], ['ja', 'en']].some(([a, b]) => a === value.sourceLang && b === value.targetLang)) throw new Error('Sarashinaは英語と日本語の相互翻訳に対応しています。');
  if (!['auto', 'plain', 'polite'].includes(value.style) || !['translation', 'bilingual'].includes(value.displayMode) || !['top', 'bottom'].includes(value.position)) throw new Error('表示設定を確認してください。');
  if (!Number.isFinite(value.fontSize) || value.fontSize < 16 || value.fontSize > 48) throw new Error('文字サイズは16〜48を指定してください。');
  if (!Number.isFinite(value.lookaheadSeconds) || value.lookaheadSeconds < 10 || value.lookaheadSeconds > 90) throw new Error('先読みは10〜90秒を指定してください。');
  if (!Number.isInteger(value.customRpm) || value.customRpm < 1 || value.customRpm > 120) throw new Error('毎分の送信上限は1〜120を指定してください。');
  if (typeof value.customBaseUrl !== 'string' || typeof value.customModel !== 'string' || value.customModel.length > 200) throw new Error('接続先とモデル名を確認してください。');
  const customBaseUrl = value.customBaseUrl ? normalizeBaseUrl(value.customBaseUrl) : '';
  if (value.provider === 'openai-compatible' && (!customBaseUrl || !value.customModel.trim())) throw new Error('接続先URLとモデル名を入力してください。');
  // Return an explicit shape so unknown fields (including credentials) never enter public settings.
  return {
    provider: value.provider, sourceLang: value.sourceLang, targetLang: value.targetLang,
    style: value.style, displayMode: value.displayMode, fontSize: value.fontSize,
    position: value.position, lookaheadSeconds: value.lookaheadSeconds,
    customBaseUrl, customModel: value.customModel.trim(), customRpm: value.customRpm,
  };
}
