import type { ProviderCapabilities, Settings } from './types';
import { MessageError } from '../i18n';

export const PROVIDERS: Record<Settings['provider'], ProviderCapabilities> = {
  sarashina: { id: 'sarashina', nameKey: 'provider.sarashina', languagePairs: [['en', 'ja'], ['ja', 'en']], maxCharacters: 5000, requestsPerMinute: 30 },
  'openai-compatible': { id: 'openai-compatible', nameKey: 'provider.compatible', languagePairs: 'custom', maxCharacters: 5000, requestsPerMinute: 30 },
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'sarashina', sourceLang: 'en', targetLang: 'ja', style: 'auto',
  displayMode: 'bilingual', fontSize: 26, position: 'bottom', lookaheadSeconds: 30,
  customBaseUrl: '', customModel: '', customRpm: 30,
};

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new MessageError('error.invalidUrl'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new MessageError('error.invalidUrl');
  }
  return url.href.replace(/\/+$/, '');
}

export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new MessageError('error.invalidSettings');
  const value = { ...DEFAULT_SETTINGS, ...input } as Settings;
  if (!(value.provider in PROVIDERS) || !['sarashina', 'openai-compatible'].includes(value.provider)) throw new MessageError('error.provider');
  for (const language of [value.sourceLang, value.targetLang]) {
    if (typeof language !== 'string' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) throw new MessageError('error.languageCode');
  }
  if (value.sourceLang.toLowerCase() === value.targetLang.toLowerCase()) throw new MessageError('error.sameLanguages');
  if (value.provider === 'sarashina' && ![['en', 'ja'], ['ja', 'en']].some(([a, b]) => a === value.sourceLang && b === value.targetLang)) throw new MessageError('options.sarashinaLanguages');
  if (!['auto', 'plain', 'polite'].includes(value.style) || !['translation', 'bilingual'].includes(value.displayMode) || !['top', 'bottom'].includes(value.position)) throw new MessageError('error.displaySettings');
  if (!Number.isFinite(value.fontSize) || value.fontSize < 16 || value.fontSize > 48) throw new MessageError('error.fontSize');
  if (!Number.isFinite(value.lookaheadSeconds) || value.lookaheadSeconds < 10 || value.lookaheadSeconds > 90) throw new MessageError('error.lookahead');
  if (!Number.isInteger(value.customRpm) || value.customRpm < 1 || value.customRpm > 120) throw new MessageError('error.rpm');
  if (typeof value.customBaseUrl !== 'string' || typeof value.customModel !== 'string' || value.customModel.length > 200) throw new MessageError('error.endpointModel');
  const customBaseUrl = value.customBaseUrl ? normalizeBaseUrl(value.customBaseUrl) : '';
  if (value.provider === 'openai-compatible' && (!customBaseUrl || !value.customModel.trim())) throw new MessageError('error.missingEndpointModel');
  // Return an explicit shape so unknown fields (including credentials) never enter public settings.
  return {
    provider: value.provider, sourceLang: value.sourceLang, targetLang: value.targetLang,
    style: value.style, displayMode: value.displayMode, fontSize: value.fontSize,
    position: value.position, lookaheadSeconds: value.lookaheadSeconds,
    customBaseUrl, customModel: value.customModel.trim(), customRpm: value.customRpm,
  };
}
