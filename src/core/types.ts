export interface Cue {
  id: string;
  start: number;
  end: number;
  text: string;
}

export type ProviderId = 'sarashina' | 'openai-compatible';
export type TranslationStyle = 'auto' | 'plain' | 'polite';
export interface Settings {
  provider: ProviderId;
  sourceLang: string;
  targetLang: string;
  style: TranslationStyle;
  displayMode: 'translation' | 'bilingual';
  fontSize: number;
  position: 'bottom' | 'top';
  lookaheadSeconds: number;
  customBaseUrl: string;
  customModel: string;
  customRpm: number;
}

export interface ProviderCapabilities {
  id: ProviderId;
  name: string;
  languagePairs: ReadonlyArray<readonly [string, string]> | 'custom';
  maxCharacters: number;
  requestsPerMinute: number;
}

export interface TranslationInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  style: TranslationStyle;
}

export type ErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'CONFIG' | 'RESPONSE' | 'UNSUPPORTED' | 'FORBIDDEN';
export interface Failure { ok: false; code: ErrorCode; message: string; retryAfterMs?: number }
export type Result<T> = { ok: true; value: T } | Failure;
export interface PublicSettings { settings: Settings; hasApiKey: boolean }
export interface PlayerStatus {
  enabled: boolean;
  phase: 'idle' | 'loading' | 'ready' | 'waiting' | 'error';
  message: string;
  total: number;
  translated: number;
}
