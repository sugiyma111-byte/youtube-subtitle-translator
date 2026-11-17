import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { ja, type MessageKey } from '../../src/i18n/ja';
import { applyI18n, errorMessage, languageName, MessageError, resolveLanguage, t, translateMessage } from '../../src/i18n';
import { DEFAULT_SETTINGS, normalizeBaseUrl, validateSettings } from '../../src/core/settings';

describe('UI dictionaries', () => {
  it('contains every key in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
    for (const key of Object.keys(ja) as MessageKey[]) {
      expect(ja[key].trim(), key).not.toBe('');
      expect(en[key].trim(), key).not.toBe('');
    }
  });

  it('uses exactly the same interpolation names in both languages', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(ja) as MessageKey[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(ja[key]));
    }
  });

  it('resolves automatic language and honors an explicit preference', () => {
    for (const language of ['ja', 'ja-JP', 'JA-jp']) expect(resolveLanguage('auto', language)).toBe('ja');
    for (const language of ['en', 'en-US', 'fr', 'zh-CN', '']) expect(resolveLanguage('auto', language)).toBe('en');
    expect(resolveLanguage('ja', 'en-US')).toBe('ja');
    expect(resolveLanguage('en', 'ja-JP')).toBe('en');
  });

  it('interpolates numbers and treats external text as literal data', () => {
    expect(t('en', 'popup.progress', { done: 0, total: 12 })).toBe('0 of 12 segments translated');
    expect(t('ja', 'popup.progress', { done: 2, total: 12 })).toBe('2 / 12 区間を翻訳済み');
    const translation = '<img src=x onerror=alert(1)> $& {translation}';
    expect(t('en', 'options.connected', { translation })).toBe(`Connected.\nTest translation: ${translation}`);
  });

  it('localizes language names at render time, including error parameters', () => {
    const message = { messageKey: 'error.noLanguage', params: { language: 'en' } } as const;
    expect(translateMessage('ja', message)).toContain('英語');
    expect(translateMessage('en', message)).toContain('English');
    expect(languageName('ja', 'not_a_tag')).toBe('not_a_tag');
    expect(message.params.language).toBe('en');
  });

  it('updates text, placeholders, accessible labels, titles and document language', () => {
    document.body.innerHTML = '<button data-i18n="popup.start" data-i18n-title="overlay.toggleTitle" data-i18n-aria-label="popup.start"></button><input data-i18n-placeholder="options.keyPlaceholder" value="unsaved">';
    applyI18n(document, 'en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('button')?.textContent).toBe('Start translating');
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('Start translating');
    expect(document.querySelector('button')?.title).toBe(en['overlay.toggleTitle']);
    expect(document.querySelector('input')?.placeholder).toBe(en['options.keyPlaceholder']);
    applyI18n(document, 'ja');
    expect(document.documentElement.lang).toBe('ja');
    expect(document.querySelector('button')?.textContent).toBe('翻訳を開始');
    expect(document.querySelector('input')?.value).toBe('unsaved');
  });

  it('has valid dictionary references throughout both HTML entrypoints', () => {
    for (const page of ['popup', 'options']) {
      const html = readFileSync(`src/entrypoints/${page}/index.html`, 'utf8');
      const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map(match => match[1]!);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(Object.hasOwn(ja, key), `${page}: ${key}`).toBe(true);
    }
  });

  it('keeps validation errors structured without exposing unknown errors', () => {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, fontSize: 1 })).toThrow(MessageError);
    expect(() => normalizeBaseUrl('invalid')).toThrow('error.invalidUrl');
    expect(errorMessage(new Error('private error details'), 'error.operation')).toEqual({ messageKey: 'error.operation' });
    expect(errorMessage(new MessageError('error.requestRejected', { status: 400 }), 'error.operation')).toMatchObject({ messageKey: 'error.requestRejected', params: { status: 400 } });
    expect(validateSettings({ ...DEFAULT_SETTINGS, uiLanguage: 'en' })).not.toHaveProperty('uiLanguage');
  });
});
