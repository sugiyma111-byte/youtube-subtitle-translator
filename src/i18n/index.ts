import type { UiLanguage } from '../core/types';
import { en } from './en';
import { ja, type MessageKey } from './ja';

export type { MessageKey } from './ja';
export type Language = 'ja' | 'en';
export type MessageParams = Record<string, string | number>;
export interface LocalizedMessage { messageKey: MessageKey; params?: MessageParams }

// Errors stay language-independent until a UI renders them.
export class MessageError extends Error implements LocalizedMessage {
  constructor(readonly messageKey: MessageKey, readonly params?: MessageParams, readonly retryAfterMs?: number) {
    super(messageKey);
    this.name = 'MessageError';
  }
}

export function errorMessage(error: unknown, fallback: MessageKey): LocalizedMessage & { retryAfterMs?: number } {
  return error instanceof MessageError
    ? { messageKey: error.messageKey, params: error.params, retryAfterMs: error.retryAfterMs }
    : { messageKey: fallback };
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'auto' || value === 'ja' || value === 'en';
}

export function resolveLanguage(pref: UiLanguage, browserLang: string): Language {
  return pref === 'auto' ? (browserLang.toLowerCase().startsWith('ja') ? 'ja' : 'en') : pref;
}

export function t(lang: Language, key: MessageKey, params: MessageParams = {}): string {
  return (lang === 'ja' ? ja : en)[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

export function languageName(lang: Language, code: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? code; }
  catch { return code; }
}

export function translateMessage(lang: Language, message: LocalizedMessage): string {
  // Caption-source errors carry a language code, never a pre-localized name.
  const params = message.params?.language === undefined ? message.params
    : { ...message.params, language: languageName(lang, String(message.params.language)) };
  return t(lang, message.messageKey, params);
}

export function applyI18n(root: Document | HTMLElement | ShadowRoot, lang: Language): void {
  const attributes = { 'data-i18n': null, 'data-i18n-placeholder': 'placeholder', 'data-i18n-aria-label': 'aria-label', 'data-i18n-title': 'title' } as const;
  for (const [dataAttribute, target] of Object.entries(attributes)) {
    const elements = [...root.querySelectorAll<HTMLElement>(`[${dataAttribute}]`)];
    if (root instanceof HTMLElement && root.hasAttribute(dataAttribute)) elements.unshift(root);
    for (const element of elements) {
      const key = element.getAttribute(dataAttribute)!;
      if (!Object.hasOwn(ja, key)) continue;
      const text = t(lang, key as MessageKey);
      if (target) element.setAttribute(target, text);
      else element.textContent = text;
    }
  }
  if (root instanceof Document) root.documentElement.lang = lang;
  else if (root instanceof HTMLElement) root.lang = lang;
  else root.host.setAttribute('lang', lang);
}
