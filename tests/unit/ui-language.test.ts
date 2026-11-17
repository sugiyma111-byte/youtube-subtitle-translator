import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { MessageError } from '../../src/i18n';
import type { Result } from '../../src/core/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), sendMessage: vi.fn(), load: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: {
  storage: { local: { get: mocks.get, set: mocks.set } },
  runtime: { sendMessage: mocks.sendMessage }, i18n: { getUILanguage: () => 'en-US' },
} }));
vi.mock('../../src/youtube/source', () => ({ youtubeCaptionSource: { load: mocks.load } }));

import { publicSettings, readUiLanguage, saveUiLanguage } from '../../src/background/settings-store';
import { VideoController } from '../../src/youtube/controller';

describe('UI language storage', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('defaults legacy and invalid preferences to auto', async () => {
    mocks.get.mockResolvedValueOnce({}).mockResolvedValueOnce({ uiLanguage: 'fr' });
    expect(await readUiLanguage()).toBe('auto');
    expect(await readUiLanguage()).toBe('auto');
  });

  it('saves only the separate preference key and rejects invalid values', async () => {
    for (const uiLanguage of ['auto', 'ja', 'en'] as const) {
      expect(await saveUiLanguage(uiLanguage)).toBe(uiLanguage);
      expect(mocks.set).toHaveBeenLastCalledWith({ uiLanguage });
    }
    await expect(saveUiLanguage('fr')).rejects.toThrow(MessageError);
    expect(mocks.set).toHaveBeenCalledTimes(3);
  });

  it('includes the preference without changing the translation signature or exposing credentials', async () => {
    mocks.get.mockImplementation(async (key: string) => key === 'settings' ? { settings: DEFAULT_SETTINGS }
      : key === 'uiLanguage' ? { uiLanguage: 'en' } : { 'key:sarashina': 'test-only' });
    const result = await publicSettings();
    expect(result).toEqual({ settings: DEFAULT_SETTINGS, hasApiKey: true, uiLanguage: 'en' });
    expect(JSON.stringify(result.settings)).toBe(JSON.stringify(DEFAULT_SETTINGS));
    expect(JSON.stringify(result)).not.toContain('test-only');
  });
});

describe('language changes during caption translation', () => {
  let controller: VideoController;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    document.documentElement.lang = 'fr';
    document.body.innerHTML = '<div id="movie_player"><video></video></div>';
    mocks.sendMessage.mockResolvedValue({ ok: true, value: { settings: DEFAULT_SETTINGS, hasApiKey: true, uiLanguage: 'ja' } });
    mocks.load.mockResolvedValue({ cues: [{ id: '1', start: 0, end: 4, text: 'Hello.' }], language: 'en', kind: 'player' });
    controller = new VideoController('aaaaaaaaaaa', document.querySelector('#movie_player')!, 'ja');
  });
  afterEach(() => { controller.destroy(); vi.useRealTimers(); });

  it('keeps an in-flight translation and its captions when switching languages', async () => {
    let finish!: (result: Result<string>) => void;
    mocks.sendMessage.mockImplementation(async ({ type }: { type: string }) => type === 'kotonoha:get-settings'
      ? { ok: true, value: { settings: DEFAULT_SETTINGS, hasApiKey: true, uiLanguage: 'ja' } }
      : new Promise<Result<string>>(resolve => { finish = resolve; }));
    await controller.start();
    const root = document.querySelector('#kotonoha-subtitles')!.shadowRoot!;
    expect(root.querySelector('.translated')?.textContent).toBe('翻訳中…');
    const before = { ...controller.status };
    controller.setUiLanguage('en');
    expect(controller.status).toEqual(before);
    expect(root.querySelector('.translated')?.textContent).toBe('Translating…');
    expect(document.querySelector('#movie_player')?.getAttribute('data-kotonoha-active')).toBe('true');
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    finish({ ok: true, value: '<b>こんにちは</b>' });
    await vi.advanceTimersByTimeAsync(350);
    expect(controller.status.translated).toBe(1);
    expect(root.querySelector('.translated')?.textContent).toBe('<b>こんにちは</b>');
    expect(root.querySelector('.translated b')).toBeNull();
    controller.setUiLanguage('ja');
    expect(root.querySelector('.translated')?.textContent).toBe('<b>こんにちは</b>');
    expect(document.documentElement.lang).toBe('fr');
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('re-renders an existing parameterized error without trying acquisition again', async () => {
    mocks.load.mockRejectedValue(new MessageError('error.noLanguage', { language: 'en' }));
    await controller.start();
    const root = document.querySelector('#kotonoha-subtitles')!.shadowRoot!;
    expect(controller.status).toMatchObject({ phase: 'error', messageKey: 'error.noLanguage', params: { language: 'en' } });
    expect(controller.status).not.toHaveProperty('message');
    expect(root.querySelector('.status')?.textContent).toContain('英語');
    controller.setUiLanguage('en');
    expect(root.querySelector('.status')?.textContent).toContain('No English captions');
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('preserves the retry deadline when switching during rate limiting', async () => {
    mocks.sendMessage.mockImplementation(async ({ type }: { type: string }) => type === 'kotonoha:get-settings'
      ? { ok: true, value: { settings: DEFAULT_SETTINGS, hasApiKey: true, uiLanguage: 'ja' } }
      : { ok: false, code: 'RATE_LIMIT', messageKey: 'error.rateLimit', retryAfterMs: 10000 });
    await controller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.status.phase).toBe('waiting');
    controller.setUiLanguage('en');
    await vi.advanceTimersByTimeAsync(9000);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#kotonoha-subtitles')!.shadowRoot!.querySelector('.status')?.textContent).toContain('Requests are spaced out');
  });
});
