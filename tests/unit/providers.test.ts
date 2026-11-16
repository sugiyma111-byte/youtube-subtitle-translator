import { describe, expect, it, vi } from 'vitest';
import { createProvider, retryDelay, translationKey } from '../../src/core/providers';
import { DEFAULT_SETTINGS, normalizeBaseUrl, validateSettings } from '../../src/core/settings';

describe('translation provider boundary', () => {
  it('sends the dedicated Sarashina schema and extracts only translated text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ translated_text: 'こんにちは。', extra: true })));
    const result = await createProvider(DEFAULT_SETTINGS, fetcher).translate({ text: 'Hello.', sourceLang: 'en', targetLang: 'ja', style: 'plain' }, 'test-key');
    expect(result).toEqual({ ok: true, value: 'こんにちは。' });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.sarashina.ai/v1/translate');
    expect(JSON.parse(request!.body as string)).toEqual({ text: 'Hello.', source_lang: 'en', target_lang: 'ja', style: 'plain' });
    expect(request).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });
  it('rejects unsupported languages before sending data', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await createProvider(DEFAULT_SETTINGS, fetcher).translate({ text: 'Hallo', sourceLang: 'de', targetLang: 'ja', style: 'auto' }, 'test-key');
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('counts Unicode codepoints for the API character limit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"translated_text":"翻訳"}'));
    const input = { text: '😀'.repeat(5000), sourceLang: 'en', targetLang: 'ja', style: 'auto' as const };
    expect((await createProvider(DEFAULT_SETTINGS, fetcher).translate(input, 'test-key')).ok).toBe(true);
    expect(await createProvider(DEFAULT_SETTINGS, fetcher).translate({ ...input, text: input.text + 'x' }, 'test-key')).toMatchObject({ ok: false, code: 'CONFIG' });
  });
  it('respects server retry timing and never exposes its response body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-debug-data', { status: 429, headers: { 'Retry-After': '17' } }));
    const result = await createProvider(DEFAULT_SETTINGS, fetcher).translate({ text: 'Hi', sourceLang: 'en', targetLang: 'ja', style: 'auto' }, 'secret-key');
    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMIT', retryAfterMs: 17000 });
    expect(JSON.stringify(result)).not.toMatch(/secret-key|private-debug-data/);
  });
  it('handles invalid success responses without treating them as translations', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"message":"wrong schema"}'));
    expect(await createProvider(DEFAULT_SETTINGS, fetcher).translate({ text: 'Hi', sourceLang: 'en', targetLang: 'ja', style: 'auto' }, 'key')).toMatchObject({ ok: false, code: 'RESPONSE' });
  });
  it('adapts compatible chat APIs without coupling subtitles to the response format', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"choices":[{"message":{"content":"Bonjour"}}]}'));
    const settings = { ...DEFAULT_SETTINGS, provider: 'openai-compatible' as const, targetLang: 'fr', customBaseUrl: 'https://example.com/v1/', customModel: 'translation-model' };
    expect(await createProvider(settings, fetcher).translate({ text: 'Hello', sourceLang: 'en', targetLang: 'fr', style: 'auto' }, 'key')).toEqual({ ok: true, value: 'Bonjour' });
    expect(fetcher.mock.calls[0]![0]).toBe('https://example.com/v1/chat/completions');
  });
  it('separates cached translations by language, model, endpoint and style', async () => {
    const values = await Promise.all([
      translationKey(DEFAULT_SETTINGS, 'Hello'),
      translationKey({ ...DEFAULT_SETTINGS, style: 'plain' }, 'Hello'),
      translationKey({ ...DEFAULT_SETTINGS, sourceLang: 'ja', targetLang: 'en' }, 'Hello'),
      translationKey({ ...DEFAULT_SETTINGS, provider: 'openai-compatible', customBaseUrl: 'https://example.com', customModel: 'a' }, 'Hello'),
      translationKey({ ...DEFAULT_SETTINGS, provider: 'openai-compatible', customBaseUrl: 'https://example.com', customModel: 'b' }, 'Hello'),
    ]);
    expect(new Set(values).size).toBe(values.length);
  });
  it('validates connection settings and strips unexpected secret fields', () => {
    expect(() => normalizeBaseUrl('https://key:secret@example.com')).toThrow();
    expect(() => normalizeBaseUrl('http://example.com')).toThrow();
    expect(() => normalizeBaseUrl('https://example.com?api_key=secret')).toThrow();
    expect(validateSettings({ ...DEFAULT_SETTINGS, apiKey: 'secret' })).not.toHaveProperty('apiKey');
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, targetLang: 'fr' })).toThrow();
  });
  it('interprets Retry-After dates as well as seconds', () => {
    expect(retryDelay('Wed, 01 Jan 2025 00:00:10 GMT', Date.parse('2025-01-01T00:00:00Z'))).toBe(10000);
    expect(retryDelay('nonsense')).toBe(60000);
  });
});
