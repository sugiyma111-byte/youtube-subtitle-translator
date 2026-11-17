import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { PlayerResponse } from '../../src/youtube/bridge';
declare const chrome: typeof import('wxt/browser').browser;

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let profileDirectory: string;
const fixtureVideo = 'aaaaaaaaaaa';
const root = path.resolve('.output/chrome-mv3');
const transcript = { events: [
  { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'Hello and welcome.' }] },
  { tStartMs: 4000, dDurationMs: 4000, segs: [{ utf8: 'This is the next sentence.' }] },
  { tStartMs: 60000, dDurationMs: 4000, segs: [{ utf8: 'We have skipped ahead.' }] },
] };
const fixture = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>字幕のテスト動画</title></head><body style="margin:0;background:#f5f5f2;font-family:system-ui"><main style="width:960px;margin:40px auto"><div id="movie_player" style="position:relative;width:960px;height:540px;background:linear-gradient(135deg,#284b3a,#819b78)"><video src="https://www.youtube.com/test-fixture.webm" preload="auto" style="width:100%;height:100%;opacity:.25"></video><div class="ytp-caption-window-container">native captions</div></div><h1>字幕表示の動作確認</h1><button id="fullscreen">全画面</button></main><script>
document.querySelector('#fullscreen').addEventListener('click',()=>document.querySelector('#movie_player').requestFullscreen());
document.querySelector('#movie_player').getPlayerResponse=()=>({videoDetails:{videoId:new URL(location.href).searchParams.get('v')},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v='+new URL(location.href).searchParams.get('v')+'&lang=en',languageCode:'en'}]}}});
</script></body></html>`;

test.beforeAll(async () => {
  // A fresh, short path avoids stale service workers and Windows IndexedDB path limits.
  await fs.mkdir('.local', { recursive: true });
  profileDirectory = await fs.mkdtemp(path.resolve('.local/e2e-'));
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(async () => { await chrome.storage.local.clear(); await chrome.storage.session.clear(); });
  // Mock the external service only. Extension messaging, permissions and storage run in Chrome.
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    (globalThis as unknown as { apiCalls: string[] }).apiCalls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://api.sarashina.ai/')) {
        const text = JSON.parse(String(init?.body)).text as string;
        (globalThis as unknown as { apiCalls: string[] }).apiCalls.push(text);
        const translations: Record<string, string> = { 'Hello and welcome.': 'こんにちは。ようこそ。', 'This is the next sentence.': '次の文です。', 'We have skipped ahead.': '先の場面に移動しました。', 'The subtitles are ready.': '字幕の準備ができました。' };
        return new Response(JSON.stringify({ translated_text: translations[text] ?? 'テスト訳文' }), { headers: { 'Content-Type': 'application/json' } });
      }
      return original(input, init);
    }) as typeof fetch;
  });
  await context.route('https://www.youtube.com/watch**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await context.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(transcript) }));
  const videoBytes = await fs.readFile('tests/fixtures/blank.webm');
  await context.route('https://www.youtube.com/test-fixture.webm', route => {
    const range = route.request().headers()['range'];
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range)!;
      const start = Number(match[1]); const end = match[2] ? Number(match[2]) : videoBytes.length - 1;
      return route.fulfill({ status: 206, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${videoBytes.length}` }, body: videoBytes.subarray(start, end + 1) });
    }
    return route.fulfill({ contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: videoBytes });
  });
});

test.afterAll(async () => {
  await context?.close();
  if (profileDirectory && path.dirname(path.resolve(profileDirectory)) === path.resolve('.local') && path.basename(profileDirectory).startsWith('e2e-')) {
    await fs.rm(profileDirectory, { recursive: true, force: true });
  }
});

test('saves credentials, translates, seeks, caches, stops on navigation and isolates the page', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'ja' }));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const [options] = await Promise.all([
    context.waitForEvent('page'),
    popup.getByRole('button', { name: '設定を開く' }).click(),
  ]);
  await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  await popup.close();
  await options.getByRole('textbox', { name: 'APIキー', exact: true }).fill('test-only-not-a-real-api-key');
  await options.getByRole('button', { name: '変更を保存', exact: true }).click();
  await expect(options.locator('#message')).toContainText('設定を保存しました');
  await expect(options.locator('#apiKey')).toHaveValue('');
  await options.getByRole('button', { name: '保存した訳文を削除' }).click();
  await options.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await expect(options.locator('#message')).toContainText('保存した訳文を削除しました');
  await fs.mkdir('artifacts', { recursive: true });
  await options.screenshot({ path: 'artifacts/settings.png', fullPage: true });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  await page.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; if (video.readyState < 1) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, {once:true})); video.currentTime = 1; });
  const overlay = page.locator('#kotonoha-subtitles');
  await overlay.getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: false, exact: true }).click();
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。', { timeout: 12000 });
  await expect(overlay.locator('.original')).toHaveText('Hello and welcome.');
  await expect(page.locator('#movie_player')).toHaveAttribute('data-kotonoha-active', 'true');
  expect(await page.evaluate(() => document.documentElement.outerHTML.includes('test-only-not-a-real-api-key'))).toBe(false);
  await page.screenshot({ path: 'artifacts/subtitles.png' });
  await page.getByRole('button', { name: '全画面', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await expect(overlay.locator('.translated')).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());

  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 61; });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBe(61);
  await expect(overlay.locator('.translated')).toHaveText('先の場面に移動しました。', { timeout: 15000 });
  const before = await worker.evaluate(() => (globalThis as unknown as { apiCalls: string[] }).apiCalls.filter(t => t === 'Hello and welcome.').length);
  await overlay.getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: true, exact: true }).click();
  await expect(page.locator('#movie_player')).not.toHaveAttribute('data-kotonoha-active');
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 1; });
  await overlay.getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: false, exact: true }).click();
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  const after = await worker.evaluate(() => (globalThis as unknown as { apiCalls: string[] }).apiCalls.filter(t => t === 'Hello and welcome.').length);
  expect(after).toBe(before);

  await page.evaluate(() => { history.pushState({}, '', '/watch?v=bbbbbbbbbbb'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await expect(overlay.getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: false, exact: true })).toBeVisible();
  await expect(overlay.locator('.captions')).toBeHidden();
  expect(errors).toEqual([]);

  await options.getByRole('button', { name: 'このキーを削除', exact: true }).click();
  await options.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await expect(options.locator('#message')).toContainText('APIキーを削除しました');
  await overlay.getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: false, exact: true }).click();
  await expect(overlay.locator('.status')).toContainText('APIキーが未登録');
  await page.close(); await options.close();
});

test('requests English transcript data even on a Japanese YouTube page', async () => {
  await worker.evaluate(async () => { await chrome.storage.local.set({ 'key:sarashina': 'test-only-not-a-real-api-key', uiLanguage: 'ja' }); await chrome.storage.session.clear(); });
  const page = await context.newPage();
  const descriptor = { updateEngagementPanelContentCommand: { contentSourcePanelIdentifier: { tag: 'PAmodern_transcript_view' }, globalConfiguration: { params: Buffer.from(`prefix-${fixtureVideo}-suffix`).toString('base64') } } };
  const payload = { contents: [{ macroMarkersPanelItemViewModel: {
    item: { timelineItemViewModel: { contentItems: [{ transcriptSegmentViewModel: { simpleText: 'Hello and welcome.' } }] } },
    onTap: { innertubeCommand: { watchEndpoint: { videoId: fixtureVideo, startTimeSeconds: 0 } } },
  } }], sync: [{ videoTimeMs: '0', endTimeMs: '4000' }] };
  await page.route('https://www.youtube.com/watch**', route => route.fulfill({ contentType: 'text/html', body: fixture.replace('</script>', `window.ytInitialData=${JSON.stringify(descriptor)};window.ytcfg={get:()=>({client:{hl:'ja',clientName:'WEB',clientVersion:'test'}})};</script>`) }));
  await page.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({ body: '' }));
  let requestedLanguage: string | undefined;
  await page.route('https://www.youtube.com/youtubei/v1/get_panel**', route => {
    requestedLanguage = route.request().postDataJSON().context.client.hl;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  await page.locator('#kotonoha-subtitles').getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: false, exact: true }).click();
  await expect(page.locator('#kotonoha-subtitles').locator('.translated')).toHaveText('こんにちは。ようこそ。');
  await expect(page.locator('#kotonoha-subtitles').locator('.original')).toHaveText('Hello and welcome.');
  expect(requestedLanguage).toBe('en');
  await page.close();
});

test('persists UI language, synchronizes open pages and keeps translation and unsaved input intact', async () => {
  await worker.evaluate(async () => { await chrome.storage.local.set({ uiLanguage: 'auto' }); await chrome.storage.session.clear(); });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const automaticLanguage = await options.evaluate(() => chrome.i18n.getUILanguage().toLowerCase().startsWith('ja') ? 'ja' : 'en');
  await expect(options.locator('[data-ui-language=auto]')).toHaveAttribute('aria-pressed', 'true');
  await expect(options.locator('html')).toHaveAttribute('lang', automaticLanguage);
  await options.locator('[data-ui-language=ja]').click();
  await expect(options.locator('html')).toHaveAttribute('lang', 'ja');
  const settingsBefore = await worker.evaluate(async () => JSON.stringify((await chrome.storage.local.get('settings')).settings));

  const page = await context.newPage();
  let captionRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/timedtext')) captionRequests++; });
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  const overlay = page.locator('#kotonoha-subtitles');
  await overlay.getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: false, exact: true }).click();
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  const readState = () => options.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
    return chrome.tabs.sendMessage(tab!.id!, { type: 'kotonoha:player-status' });
  });
  await expect.poll(async () => (await readState()).translated).toBe(2);
  const before = await readState();
  const requestsBefore = captionRequests;
  const apiCallsBefore = await worker.evaluate(() => (globalThis as unknown as { apiCalls: string[] }).apiCalls.length);

  // These unsaved values must survive re-labeling, including a custom language.
  await options.locator('input[name=provider][value=openai-compatible]').check();
  await options.locator('#customBaseUrl').fill('https://example.com/v1');
  await options.locator('#customModel').fill('unsaved-model');
  await options.locator('#sourceLang').selectOption('custom');
  await options.locator('#sourceCode').fill('it');
  await options.locator('#apiKey').fill('unsaved-test-only');
  await options.locator('#fontSize').fill('32');
  await options.locator('[data-ui-language=en]').click();
  await expect(options.locator('html')).toHaveAttribute('lang', 'en');
  await expect(options).toHaveTitle('Caption Translator for YouTube Settings');
  await expect(options.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
  await expect(options.locator('#targetLang option:checked')).toHaveText('Japanese');
  await expect(options.locator('#customModel')).toHaveValue('unsaved-model');
  await expect(options.locator('#sourceLang')).toHaveValue('custom');
  await expect(options.locator('#sourceCode')).toHaveValue('it');
  await expect(options.locator('#apiKey')).toHaveValue('unsaved-test-only');
  await expect(options.locator('#fontSize')).toHaveValue('32');
  await expect(overlay.getByRole('switch', { name: 'Translate captions for this video', checked: true, exact: true })).toBeVisible();
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  const popup = await context.newPage();
  // Keep the YouTube page active so the popup can read its real player status.
  await page.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#uiLanguage')).toHaveText('日本語');
  await expect(popup.locator('#language-pair')).toHaveText('English → Japanese');
  await expect(popup.locator('#progress')).toHaveText('2 of 3 segments translated');
  await popup.locator('#uiLanguage').click();
  await expect(options.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(options.locator('[data-ui-language=ja]')).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay.getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: true, exact: true })).toBeVisible();
  await expect(popup.locator('#language-pair')).toHaveText('英語 → 日本語');
  await expect(popup.locator('#progress')).toHaveText('2 / 3 区間を翻訳済み');
  await options.locator('[data-ui-language=auto]').click();
  await expect(options.locator('[data-ui-language=auto]')).toHaveAttribute('aria-pressed', 'true');
  await expect(options.locator('html')).toHaveAttribute('lang', automaticLanguage);
  await expect(overlay).toHaveAttribute('lang', automaticLanguage);

  expect((await readState()).enabled).toBe(true);
  expect((await readState()).translated).toBe(before.translated);
  expect(captionRequests).toBe(requestsBefore);
  expect(await worker.evaluate(() => (globalThis as unknown as { apiCalls: string[] }).apiCalls.length)).toBe(apiCallsBefore);
  expect(await worker.evaluate(async () => JSON.stringify((await chrome.storage.local.get('settings')).settings))).toBe(settingsBefore);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('uiLanguage')).uiLanguage)).toBe('auto');

  await popup.reload();
  await expect(popup.locator('#uiLanguage')).toHaveText(automaticLanguage === 'ja' ? 'English' : '日本語');
  await expect(popup.locator('html')).toHaveAttribute('lang', automaticLanguage);
  await popup.close(); await options.close(); await page.close();
});

test('re-localizes an existing validation error and rejects invalid preferences', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('[data-ui-language=ja]').click();
  await options.locator('#targetLang').selectOption('en');
  await options.getByRole('button', { name: '変更を保存', exact: true }).click();
  await expect(options.locator('#message')).toHaveText('原文と翻訳先には異なる言語を指定してください。');
  await options.locator('[data-ui-language=en]').click();
  await expect(options.locator('#message')).toHaveText('Choose different source and target languages.');
  await expect(options.locator('#targetLang')).toHaveValue('en');
  const invalid = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'kotonoha:save-ui-language', uiLanguage: 'fr' }));
  expect(invalid).toMatchObject({ ok: false, messageKey: 'error.uiLanguage' });
  expect(invalid).not.toHaveProperty('message');
  await options.close();
});

test('waits for the saved UI language before revealing extension pages', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'ja' }));
  for (const entry of ['options', 'popup']) {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const state = globalThis as unknown as { languageReadStarted: boolean; releaseLanguage: () => void };
      const original = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = (async (keys: string) => {
        if (keys === 'uiLanguage') {
          await new Promise<void>(resolve => { state.releaseLanguage = resolve; state.languageReadStarted = true; });
        }
        return original(keys);
      }) as unknown as typeof chrome.storage.local.get;
    });
    await page.goto(`chrome-extension://${extensionId}/${entry}.html`);
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { languageReadStarted: boolean }).languageReadStarted)).toBe(true);
    await expect(page.locator('body')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-i18n-pending', '');
    await page.evaluate(() => (globalThis as unknown as { releaseLanguage: () => void }).releaseLanguage());
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.close();
  }
});

test('tracks settings edits separately from UI language and shows connection results by the key', async () => {
  await worker.evaluate(async settings => {
    await chrome.storage.session.clear();
    await chrome.storage.local.remove(['key:sarashina', 'key:openai-compatible']);
    await chrome.storage.local.set({ settings, uiLanguage: 'ja' });
  }, DEFAULT_SETTINGS);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const save = options.getByRole('button', { name: '変更を保存', exact: true });
  await expect(save).toBeDisabled();
  await expect(options.locator('.key-warning')).toBeVisible();
  await expect(options.locator('#key-status')).toHaveText('未登録');
  await options.locator('[data-ui-language=en]').click();
  await expect(options.locator('#dirty-status')).toHaveText('All changes saved.');
  await expect(options.locator('#save')).toBeDisabled();
  await options.locator('[data-ui-language=ja]').click();
  await expect(options.locator('#save-bar')).toHaveAttribute('data-dirty', 'false');

  await options.getByRole('button', { name: '文字を大きく', exact: true }).click();
  await expect(options.locator('#fontSize')).toHaveValue('27');
  await expect(save).toBeEnabled();
  await options.getByRole('button', { name: '文字を小さく', exact: true }).click();
  await expect(save).toBeDisabled();
  await options.getByRole('button', { name: '文字を大きく', exact: true }).click();
  await options.locator('[data-step=lookaheadSeconds][data-direction="1"]').click();
  await options.getByRole('radio', { name: '敬体（です・ます）', exact: true }).check();
  await options.getByRole('radio', { name: '訳文のみ', exact: true }).check();
  await options.getByRole('radio', { name: '動画の上側', exact: true }).check();
  await expect(options.locator('#preview-original')).toBeHidden();
  await expect(options.locator('#preview-caption')).toHaveAttribute('data-position', 'top');
  await options.getByRole('button', { name: '原文と翻訳先を入れ替える' }).click();
  await expect(options.locator('#sourceLang')).toHaveValue('ja');
  await expect(options.locator('#targetLang')).toHaveValue('en');
  await options.locator('#apiKey').fill('test-only-not-a-real-api-key');
  await options.getByRole('button', { name: '表示', exact: true }).click();
  await expect(options.locator('#apiKey')).toHaveAttribute('type', 'text');
  await options.getByRole('button', { name: '隠す', exact: true }).click();
  await expect(options.locator('#apiKey')).toHaveAttribute('type', 'password');
  await options.getByRole('button', { name: '保存して接続を確認', exact: true }).click();
  await expect(options.locator('#connection-result')).toContainText('接続できました。');
  await expect(options.locator('#apikey #connection-result')).toBeVisible();
  await expect(options.locator('#message')).toContainText('設定を保存しました。');
  await expect(options.locator('#message')).not.toContainText('接続できました。');
  await expect(options.locator('#save-bar')).toHaveAttribute('data-dirty', 'false');
  await expect(options.locator('#key-status')).toHaveText('登録済み（暗号化なし）');
  await expect(options.locator('#help-key')).toHaveAttribute('data-done', 'true');
  await expect(options.locator('.key-warning')).toBeVisible();
  const stored = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  expect(stored).toMatchObject({ sourceLang: 'ja', targetLang: 'en', fontSize: 27, lookaheadSeconds: 35, style: 'polite', displayMode: 'translation', position: 'top' });
  await options.reload();
  await expect(options.locator('#fontSize')).toHaveValue('27');
  await expect(options.locator('input[name=style][value=polite]')).toBeChecked();
  await expect(options.locator('#save')).toBeDisabled();
  await options.close();
});

test('confirms each data deletion and preserves unrelated keys and unsaved invalid settings', async () => {
  await worker.evaluate(settings => chrome.storage.local.set({ settings, uiLanguage: 'ja', 'key:sarashina': 'test-only-sarashina', 'key:openai-compatible': 'test-only-compatible' }), DEFAULT_SETTINGS);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator('#key-status-sarashina')).toHaveText('登録済み（暗号化なし）');
  await expect(options.locator('#key-status-openai-compatible')).toHaveText('登録済み（暗号化なし）');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  expect(await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'kotonoha:delete-api-key', provider: 'sarashina' }))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  await popup.close();
  await options.locator('input[name=provider][value=openai-compatible]').check();
  await options.locator('#customBaseUrl').fill('not-a-url');
  await options.locator('#customModel').fill('unsaved-model');
  await options.locator('#apiKey').fill('unsaved-test-only');
  await options.locator('#targetLang').selectOption('en');
  const cache = options.getByRole('button', { name: '保存した訳文を削除', exact: true });
  const dialog = options.getByRole('dialog');
  await cache.click();
  await expect(dialog).toHaveAccessibleName('保存した訳文を削除しますか？');
  await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(dialog).toBeHidden();
  await expect(cache).toBeFocused();
  await expect(options.locator('#message')).toBeHidden();
  await cache.click();
  await dialog.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(options.locator('#message')).toHaveText('保存した訳文を削除しました。');

  await options.locator('[data-delete-provider=sarashina]').click();
  await expect(dialog).toHaveAccessibleName('Sarashina のAPIキーを削除しますか？');
  await dialog.press('Escape');
  expect(await worker.evaluate(async () => Boolean((await chrome.storage.local.get('key:sarashina'))['key:sarashina']))).toBe(true);
  for (const provider of ['openai-compatible', 'sarashina']) {
    await options.locator(`[data-delete-provider="${provider}"]`).click();
    await dialog.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(options.locator(`#key-status-${provider}`)).toHaveText('未登録');
    await expect(options.locator(`[data-delete-provider="${provider}"]`)).toBeDisabled();
    if (provider === 'openai-compatible') {
      await expect(options.locator('#key-status-sarashina')).toHaveText('登録済み（暗号化なし）');
    }
  }
  await expect(options.locator('#apiKey')).toHaveValue('unsaved-test-only');
  await expect(options.locator('#customBaseUrl')).toHaveValue('not-a-url');
  await expect(options.locator('#customModel')).toHaveValue('unsaved-model');
  await expect(options.locator('#save-bar')).toHaveAttribute('data-dirty', 'true');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings)).toEqual(DEFAULT_SETTINGS);
  await options.close();
});

test('requests endpoint permission from the save gesture and clears old credentials only after approval', async () => {
  const settings = { ...DEFAULT_SETTINGS, provider: 'openai-compatible', customBaseUrl: 'https://old.example/v1', customModel: 'test-model' };
  await worker.evaluate(settings => chrome.storage.local.set({ settings, uiLanguage: 'en', 'key:sarashina': 'test-only-sarashina', 'key:openai-compatible': 'test-only-old-host' }), settings);
  const options = await context.newPage();
  // Chrome's native permission dialog is stubbed; the save path, messaging and key removal are real.
  await options.addInitScript(() => {
    const state = globalThis as unknown as { permissionAllowed: boolean; permissionRequests: unknown[] };
    state.permissionAllowed = false;
    state.permissionRequests = [];
    chrome.permissions.request = (async permissions => {
      state.permissionRequests.push({ permissions, userGesture: navigator.userActivation.isActive });
      return state.permissionAllowed;
    }) as typeof chrome.permissions.request;
  });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('#customBaseUrl').fill('https://new.example/v1');
  await options.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(options.locator('#message')).toHaveAttribute('data-error', 'true');
  await expect(options.locator('#save-bar')).toHaveAttribute('data-dirty', 'true');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings)).toEqual(settings);
  expect(await worker.evaluate(async () => Boolean((await chrome.storage.local.get('key:openai-compatible'))['key:openai-compatible']))).toBe(true);
  expect(await options.evaluate(() => (globalThis as unknown as { permissionRequests: unknown[] }).permissionRequests)).toEqual([{ permissions: { origins: ['https://new.example/*'] }, userGesture: true }]);

  await options.evaluate(() => { (globalThis as unknown as { permissionAllowed: boolean }).permissionAllowed = true; });
  await options.locator('#sourceLang').selectOption('custom');
  await options.locator('#sourceCode').fill('it');
  await options.locator('#targetLang').selectOption('de');
  await options.getByRole('button', { name: 'Swap source and target' }).click();
  await expect(options.locator('#sourceLang')).toHaveValue('de');
  await expect(options.locator('#targetLang')).toHaveValue('custom');
  await expect(options.locator('#targetCode')).toHaveValue('it');
  await options.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(options.locator('#save-bar')).toHaveAttribute('data-dirty', 'false');
  await expect(options.locator('#key-status')).toHaveText('Not set');
  await expect(options.locator('#key-status-sarashina')).toHaveText('Saved (not encrypted)');
  const stored = await worker.evaluate(() => chrome.storage.local.get(['settings', 'key:openai-compatible']));
  expect(stored).not.toHaveProperty('key:openai-compatible');
  expect(stored.settings).toMatchObject({ customBaseUrl: 'https://new.example/v1', sourceLang: 'de', targetLang: 'it', customModel: 'test-model', customRpm: 30 });
  await options.close();
});

test('keeps every settings section and its controls usable at narrow Japanese and English widths', async () => {
  await worker.evaluate(settings => chrome.storage.local.set({ settings, uiLanguage: 'ja' }), DEFAULT_SETTINGS);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await fs.mkdir('artifacts', { recursive: true });
  for (const language of ['ja', 'en']) {
    await options.locator(`[data-ui-language=${language}]`).click();
    for (const width of [1280, 760, 420, 320]) {
      await options.setViewportSize({ width, height: 900 });
      await options.locator('input[name=provider][value=openai-compatible]').check();
      await options.locator('#sourceLang').selectOption('custom');
      await options.locator('#sourceCode').fill('it');
      for (const selector of ['#custom-fields', '#custom-language-fields', '.key-warning', '#stored-data', '.preview-card', '.help-card', '#save-bar']) {
        await expect(options.locator(selector)).toBeVisible();
      }
      await options.locator('#clear-cache').click();
      await expect(options.getByRole('dialog')).toBeInViewport();
      await options.locator('#cancel-delete').click();
      await options.locator('[data-step=fontSize][data-direction="1"]').click();
      await options.locator('[data-step=fontSize][data-direction="-1"]').click();
      const bounds = await options.evaluate(() => {
        const issues: string[] = [];
        for (const control of document.querySelectorAll<HTMLElement>('button, a, select, input')) {
          if (!control.checkVisibility() || control.closest('dialog')) continue;
          const target = control instanceof HTMLInputElement && control.type === 'radio' ? control.closest('label')! : control;
          const rect = target.getBoundingClientRect();
          if (rect.width < 43.5 || rect.height < 43.5 || rect.left < -.5 || rect.right > innerWidth + .5) issues.push(control.id || control.getAttribute('name') || control.textContent || 'control');
        }
        return { issues, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      expect(bounds, `${language} at ${width}px`).toEqual({ issues: [], pageWidth: width, viewport: width });
      await options.evaluate(() => scrollTo(0, 0));
      await options.screenshot({ path: `artifacts/settings-${language}-${width}.png`, fullPage: true });
    }
  }
  await options.close();
});

async function capturePopup(popup: Page, state: string, title: [string, string], action: [string, string], suffix = '') {
  for (const [index, language] of ['ja', 'en'].entries()) {
    if (await popup.locator('html').getAttribute('lang') !== language) await popup.locator('#uiLanguage').click();
    await expect(popup.locator('#status')).toHaveAttribute('data-state', state);
    await expect(popup.locator('#status-title')).toHaveText(title[index]!);
    await expect(popup.locator('#primary')).toHaveText(action[index]!);
    if (state === 'not-video') await expect(popup.locator('#primary')).toBeDisabled();
    else await expect(popup.locator('#primary')).toBeEnabled();
    await expect(popup.locator('#uiLanguage')).toHaveText(language === 'ja' ? 'English' : '日本語');
    const layout = await popup.evaluate(() => {
      const issues: string[] = [];
      for (const node of document.querySelectorAll<HTMLElement>('body *')) {
        if (!node.checkVisibility()) continue;
        if ([...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) && parseFloat(getComputedStyle(node).fontSize) < 13) issues.push(`small text: ${node.id || node.tagName}`);
        if (node instanceof HTMLButtonElement) {
          const rect = node.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44 || rect.left < 0 || rect.right > document.documentElement.clientWidth) issues.push(`button bounds: ${node.id}`);
        }
      }
      return { issues, width: document.documentElement.scrollWidth, availableWidth: document.documentElement.clientWidth };
    });
    expect(layout.issues, `${language}: ${state}`).toEqual([]);
    expect(layout.width).toBeLessThanOrEqual(layout.availableWidth);
    await popup.mouse.move(359, 599);
    await popup.screenshot({ path: `artifacts/popup-${state}-${language}${suffix}.png`, fullPage: true, animations: 'disabled' });
  }
}

test('shows all six popup states at 360px and drives registration, start, stop and caption reload', async () => {
  await worker.evaluate(async settings => {
    await chrome.storage.local.remove(['key:sarashina', 'key:openai-compatible']);
    await chrome.storage.local.set({ settings, uiLanguage: 'ja' });
    await chrome.storage.session.clear();
  }, DEFAULT_SETTINGS);
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await page.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await fs.mkdir('artifacts', { recursive: true });
  await capturePopup(popup, 'no-key', ['APIキーが未登録です', 'No API key yet'], ['APIキーを登録', 'Add API key']);
  const [options] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Add API key', exact: true }).click()]);
  await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html#apikey`);
  await expect(options.locator('#apiKey')).toBeInViewport();
  await options.locator('#apiKey').fill('test-only-not-a-real-api-key');
  await options.locator('#save').click();
  await expect(options.locator('#key-status')).toHaveText('Saved (not encrypted)');
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'kotonoha:clear-cache' }));
  await options.close();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'idle');
  await capturePopup(popup, 'idle', ['この動画を翻訳できます', 'Ready to translate this video'], ['翻訳を開始', 'Start translating']);

  // Use the real limiter and controller; no API call is made while waiting.
  await worker.evaluate(() => chrome.storage.session.set({ 'rate:sarashina:translate': { timestamps: [], blockedUntil: Date.now() + 60000 } }));
  await popup.locator('#primary').click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'waiting');
  await capturePopup(popup, 'waiting', ['少し待っています', 'Waiting briefly'], ['翻訳を停止', 'Stop translating']);
  await expect(popup.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(popup.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '3');
  await popup.locator('#primary').click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'idle');
  await worker.evaluate(() => chrome.storage.session.clear());
  await popup.locator('#primary').click();
  await expect(page.locator('#kotonoha-subtitles .translated')).toHaveText('こんにちは。ようこそ。');
  await expect(popup.locator('#progress')).toHaveText('2 of 3 segments translated');
  await capturePopup(popup, 'active', ['翻訳中', 'Translating'], ['翻訳を停止', 'Stop translating']);
  await expect(popup.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^[12]$/);
  await popup.locator('#primary').click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#movie_player')).not.toHaveAttribute('data-kotonoha-active');

  // Make the fixture expose a different source language, then restore it before Reload captions.
  await page.evaluate(() => {
    const player = document.getElementById('movie_player') as HTMLElement & { getPlayerResponse: () => PlayerResponse };
    const original = player.getPlayerResponse;
    (globalThis as unknown as { restoreCaptions: () => void }).restoreCaptions = () => { player.getPlayerResponse = original; };
    player.getPlayerResponse = () => {
      const response = original();
      for (const track of response.captions!.playerCaptionsTracklistRenderer!.captionTracks!) track.languageCode = 'ko';
      return response;
    };
  });
  await popup.locator('#primary').click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'error');
  await capturePopup(popup, 'error', ['字幕を取得できませんでした', "Couldn't load captions"], ['字幕を再取得', 'Reload captions']);
  await expect(popup.locator('#status-detail')).toContainText('No English captions');
  await expect(popup.getByRole('button', { name: 'Stop translating', exact: true })).toBeVisible();
  await popup.locator('#secondary').click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'idle');
  await popup.locator('#primary').click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'error');
  await page.evaluate(() => (globalThis as unknown as { restoreCaptions: () => void }).restoreCaptions());
  await popup.getByRole('button', { name: 'Reload captions', exact: true }).click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'active');
  await expect(page.locator('#kotonoha-subtitles .translated')).toHaveText('こんにちは。ようこそ。');

  await page.route('https://www.youtube.com/', route => route.fulfill({ contentType: 'text/html', body: '<h1>Home fixture</h1>' }));
  await page.goto('https://www.youtube.com/');
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'not-video');
  await capturePopup(popup, 'not-video', ['YouTubeの動画ページで使えます', 'Open a YouTube video to use this'], ['翻訳を開始', 'Start translating']);
  await expect(popup.locator('#primary')).toBeDisabled();
  await expect(popup.locator('#secondary')).toBeHidden();

  // Summary labels are localized from the current saved settings, including long language names.
  await worker.evaluate(settings => chrome.storage.local.set({ settings: { ...settings, provider: 'openai-compatible', customBaseUrl: 'https://example.com/v1', customModel: 'test-model', sourceLang: 'zh-Hant-TW', targetLang: 'ko' }, 'key:openai-compatible': 'test-only-compatible' }), DEFAULT_SETTINGS);
  await expect(popup.locator('#provider-name')).toHaveText('OpenAI-compatible API');
  await expect(popup.locator('#language-pair')).toContainText('Korean');
  await capturePopup(popup, 'not-video', ['YouTubeの動画ページで使えます', 'Open a YouTube video to use this'], ['翻訳を開始', 'Start translating'], '-compatible');
  const [changedOptions] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Change', exact: true }).click()]);
  await expect(changedOptions).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  await changedOptions.close();
  await popup.close(); await page.close();
});

test('expires a failed popup language save without covering or freezing the video status', async () => {
  await worker.evaluate(async settings => {
    await chrome.storage.local.set({ settings, uiLanguage: 'ja', 'key:sarashina': 'test-only-not-a-real-api-key' });
    await chrome.storage.session.clear();
  }, DEFAULT_SETTINGS);
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.addInitScript(() => {
    const state = globalThis as unknown as { rejectLanguageSave: boolean };
    state.rejectLanguageSave = true;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (async (message: { type?: string }) => {
      if (state.rejectLanguageSave && message.type === 'kotonoha:save-ui-language') return { ok: false, code: 'CONFIG', messageKey: 'error.saveUiLanguage' };
      return original(message);
    }) as typeof chrome.runtime.sendMessage;
  });
  await page.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('button', { name: '翻訳を開始', exact: true }).click();
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'active');
  await popup.locator('#uiLanguage').click();
  await expect(popup.locator('#notice')).toContainText('表示言語を保存できませんでした。');
  await expect(popup.locator('#status-title')).toHaveText('翻訳中');
  await expect(popup.getByRole('progressbar')).toBeVisible();
  await expect(popup.locator('html')).toHaveAttribute('lang', 'ja');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('uiLanguage')).uiLanguage)).toBe('ja');
  await page.locator('#kotonoha-subtitles').getByRole('switch', { name: 'この動画の字幕を翻訳する', checked: true, exact: true }).click();
  await expect(popup.locator('#status-title')).toHaveText('この動画を翻訳できます');
  await expect(popup.locator('#notice')).toBeVisible();
  await expect(popup.locator('#notice')).toBeHidden({ timeout: 7000 });
  await popup.evaluate(() => { (globalThis as unknown as { rejectLanguageSave: boolean }).rejectLanguageSave = false; });
  await popup.locator('#uiLanguage').click();
  await expect(popup.locator('html')).toHaveAttribute('lang', 'en');
  await expect(popup.locator('#status-title')).toHaveText('Ready to translate this video');
  await page.bringToFront();
  await popup.reload();
  await expect(popup.locator('#uiLanguage')).toHaveText('日本語');
  await expect(popup.locator('html')).toHaveAttribute('lang', 'en');
  await popup.close(); await page.close();
});

async function resizePlayer(page: Page, width: number, height: number) {
  await page.locator('#movie_player').evaluate((player, size) => {
    player.style.width = `${size.width}px`; player.style.height = `${size.height}px`;
    player.parentElement!.style.width = `${size.width}px`;
  }, { width, height });
}

async function overlayBounds(page: Page) {
  return page.locator('#movie_player').evaluate(player => {
    const rect = player.getBoundingClientRect();
    const host = player.querySelector('#kotonoha-subtitles')!;
    const root = host.shadowRoot!;
    const toggle = root.querySelector('.translation-switch')!.getBoundingClientRect();
    const settings = root.querySelector('.settings-button')!.getBoundingClientRect();
    const captions = root.querySelector('.captions')!;
    const captionRect = captions.getBoundingClientRect();
    const visibleLines = [...root.querySelectorAll<HTMLElement>('.line')].filter(line => line.checkVisibility());
    return {
      top: toggle.top - rect.top, right: rect.right - settings.right,
      switchHeight: toggle.height, settingsSize: [settings.width, settings.height],
      bottomGap: rect.bottom - captionRect.bottom,
      topGap: captionRect.top - toggle.bottom,
      fontSize: getComputedStyle(captions).fontSize,
      inside: [captionRect, ...visibleLines.map(line => line.getBoundingClientRect())].every(box => box.left >= rect.left && box.right <= rect.right && box.top >= rect.top && box.bottom <= rect.bottom),
      separate: host.parentElement === player && !host.closest('.ytp-chrome-bottom'),
    };
  });
}

test('follows player controls, keeps keyboard access and positions fixed-size captions in every player mode', async () => {
  await worker.evaluate(async settings => {
    await chrome.storage.local.set({ settings, uiLanguage: 'ja', 'key:sarashina': 'test-only-not-a-real-api-key' });
    await chrome.storage.session.clear();
  }, DEFAULT_SETTINGS);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  // Reference native control bands, outside the extension's shadow tree.
  await page.addStyleTag({ content: '.ytp-chrome-bottom{position:absolute;bottom:0;width:100%;height:64px;background:#17212b88;pointer-events:none} :fullscreen .ytp-chrome-bottom{height:88px} .ytp-autohide .ytp-chrome-bottom{opacity:0}' });
  await page.locator('#movie_player').evaluate(player => {
    const bar = document.createElement('div'); bar.className = 'ytp-chrome-bottom'; player.append(bar);
  });
  const overlay = page.locator('#kotonoha-subtitles');
  const dock = overlay.locator('.dock');
  const toggle = overlay.getByRole('switch');
  await expect(overlay).toHaveAttribute('data-autohide', 'fallback');
  await page.mouse.move(300, 300);
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await expect(dock).toHaveAttribute('data-visible', 'false', { timeout: 5000 });
  await page.mouse.move(310, 300);
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await page.locator('#movie_player').evaluate(player => player.classList.add('ytp-autohide'));
  await expect(overlay).toHaveAttribute('data-autohide', 'player');
  await expect(dock).toHaveAttribute('data-visible', 'false');

  // Invisible controls remain reachable by Tab, and Space/Enter use native button activation.
  await page.locator('#fullscreen').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(overlay.locator('.settings-button')).toBeFocused();
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await page.keyboard.press('Shift+Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('#fullscreen')).toBeFocused();
  await expect(dock).toHaveAttribute('data-visible', 'false');

  await page.locator('#movie_player').evaluate(player => player.classList.remove('ytp-autohide'));
  await toggle.click();
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  await expect(overlay.locator('.status')).toBeHidden({ timeout: 12000 });
  const normal = await overlayBounds(page);
  expect(normal).toMatchObject({ top: 64, right: 12, switchHeight: 44, settingsSize: [44, 44], fontSize: '26px', inside: true, separate: true });
  expect(normal.bottomGap).toBeCloseTo(64 + 540 * .03, 1);
  await fs.mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/overlay-normal-ja.png' });
  await page.locator('#movie_player').evaluate(player => player.classList.add('ytp-autohide'));
  // A mouse click must not leave keyboard-focus protection stuck on.
  await expect(dock).toHaveAttribute('data-visible', 'false');
  expect((await overlayBounds(page)).bottomGap).toBeCloseTo(540 * .03, 1);

  await options.evaluate(settings => chrome.runtime.sendMessage({ type: 'kotonoha:save-settings', settings: { ...settings, position: 'top', fontSize: 32 }, apiKey: '' }), DEFAULT_SETTINGS);
  await expect(overlay.locator('.captions')).toHaveAttribute('data-position', 'top');
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  await page.locator('#movie_player').evaluate(player => player.classList.remove('ytp-autohide'));
  await resizePlayer(page, 1200, 675);
  await expect.poll(async () => (await overlayBounds(page)).fontSize).toBe('32px');
  expect((await overlayBounds(page)).topGap).toBeGreaterThanOrEqual(16);
  await resizePlayer(page, 520, 293);
  await expect(overlay).toHaveAttribute('data-compact', 'false');
  await expect(overlay.locator('.translation-label')).toBeVisible();
  await resizePlayer(page, 519, 292);
  await expect(overlay).toHaveAttribute('data-compact', 'true');
  await expect(overlay.locator('.translation-label')).toBeHidden();
  await resizePlayer(page, 460, 259);
  await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
  await expect(toggle).toHaveAccessibleName('Translate captions for this video');
  await expect.poll(() => overlayBounds(page)).toMatchObject({ fontSize: '32px', inside: true });
  // Full-width Japanese glyphs reproduce the extra wrapping seen on Linux.
  await overlay.evaluate(host => host.style.setProperty('--ui-font', 'monospace'));
  await expect.poll(() => overlayBounds(page)).toMatchObject({ fontSize: '32px', inside: true });
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  await expect(overlay.locator('.original')).toBeVisible();
  await page.screenshot({ path: 'artifacts/overlay-small-en.png' });
  await overlay.evaluate(host => host.style.removeProperty('--ui-font'));

  await resizePlayer(page, 1200, 675);
  await page.locator('#fullscreen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await expect.poll(async () => (await overlayBounds(page)).top).toBe(80);
  expect(await overlayBounds(page)).toMatchObject({ right: 12, switchHeight: 44, settingsSize: [44, 44], fontSize: '32px', inside: true });
  await page.screenshot({ path: 'artifacts/overlay-fullscreen-en.png' });
  await page.evaluate(() => document.exitFullscreen());
  expect(errors).toEqual([]);
  await page.close(); await options.close();
});

test('pins preparation, waiting and actionable errors, and shortens small-player error text', async () => {
  await worker.evaluate(async settings => {
    await chrome.storage.local.set({ settings, uiLanguage: 'ja' });
    await chrome.storage.local.remove('key:sarashina');
    await chrome.storage.session.clear();
  }, DEFAULT_SETTINGS);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'kotonoha:clear-cache' }));
  await options.close();
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  const overlay = page.locator('#kotonoha-subtitles');
  const toggle = overlay.getByRole('switch');
  const dock = overlay.locator('.dock');
  const status = overlay.locator('.status-text');
  await toggle.click();
  await expect(status).toContainText('APIキーが未登録');
  await page.locator('#movie_player').evaluate(player => player.classList.add('ytp-autohide'));
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await expect(overlay.locator('.actions').getByRole('button', { name: '設定を開く', exact: true })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '字幕を再取得', exact: true })).toBeHidden();
  const [openedOptions] = await Promise.all([
    context.waitForEvent('page'),
    overlay.locator('.actions').getByRole('button', { name: '設定を開く', exact: true }).click(),
  ]);
  await expect.poll(() => worker.evaluate(async url => (await chrome.tabs.query({ url })).length, `chrome-extension://${extensionId}/options.html`)).toBeGreaterThan(0);
  await page.bringToFront();
  await toggle.click();

  let releaseCaptions!: () => void;
  const captionGate = new Promise<void>(resolve => { releaseCaptions = resolve; });
  await page.route('https://www.youtube.com/api/timedtext**', async route => {
    await captionGate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(transcript) });
  });
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ 'key:sarashina': 'test-only-not-a-real-api-key' });
    await chrome.storage.session.set({ 'rate:sarashina:translate': { timestamps: [], blockedUntil: Date.now() + 60000 } });
  });
  await page.locator('#movie_player').evaluate(player => player.classList.remove('ytp-autohide'));
  await toggle.click();
  await expect(status).toHaveText('字幕を準備しています…');
  await page.locator('#movie_player').evaluate(player => player.classList.add('ytp-autohide'));
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await fs.mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/overlay-preparing-ja.png' });
  releaseCaptions();
  await expect(status).toContainText('送信');
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await expect(overlay).toHaveAttribute('data-controls', 'hidden');
  await expect(overlay.locator('.translated')).toHaveText('翻訳中…');
  expect((await overlayBounds(page)).bottomGap).toBeCloseTo(540 * .03, 1);
  await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
  await resizePlayer(page, 460, 259);
  await expect(status).toHaveText('Waiting to send. Resumes automatically.');
  await expect(overlay.locator('.translation-label')).toBeHidden();
  await expect(toggle).toHaveAccessibleName('Translate captions for this video');
  const plateBounds = await overlay.locator('.status').boundingBox();
  const captionBounds = await overlay.locator('.captions').boundingBox();
  expect(plateBounds!.y + plateBounds!.height).toBeLessThan(captionBounds!.y);
  await page.screenshot({ path: 'artifacts/overlay-waiting-small-en.png' });
  await toggle.click();
  await worker.evaluate(() => chrome.storage.session.clear());
  await page.evaluate(() => {
    const player = document.getElementById('movie_player') as HTMLElement & { getPlayerResponse: () => PlayerResponse };
    const original = player.getPlayerResponse;
    (globalThis as unknown as { restoreCaptions: () => void }).restoreCaptions = () => { player.getPlayerResponse = original; };
    player.getPlayerResponse = () => {
      const response = original();
      for (const track of response.captions!.playerCaptionsTracklistRenderer!.captionTracks!) track.languageCode = 'ko';
      return response;
    };
    player.classList.remove('ytp-autohide');
  });
  await toggle.click();
  await expect(status).toHaveText("Couldn't load captions.");
  await page.locator('#movie_player').evaluate(player => player.classList.add('ytp-autohide'));
  await expect(dock).toHaveAttribute('data-visible', 'true');
  await expect(overlay.locator('.actions .secondary')).toBeHidden();
  await expect(overlay.locator('.settings-button')).toBeVisible();
  await page.screenshot({ path: 'artifacts/overlay-error-small-en.png' });
  await resizePlayer(page, 960, 540);
  await expect(status).toContainText('No English captions');
  await expect(overlay.locator('.actions .secondary')).toBeVisible();
  await page.evaluate(() => (globalThis as unknown as { restoreCaptions: () => void }).restoreCaptions());
  await overlay.getByRole('button', { name: 'Reload captions', exact: true }).click();
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  await expect(dock).toHaveAttribute('data-visible', 'false', { timeout: 12000 });
  await page.close(); await openedOptions.close();
});

test('bounds wrapped captions at a fixed font size and restores all lines when the player grows', async () => {
  const translatedText = '字幕の表示領域を確認します。'.repeat(6);
  const originalText = 'This is a long source caption. '.repeat(5).trim();
  const settings = { ...DEFAULT_SETTINGS, fontSize: 32, position: 'top' as const };
  await worker.evaluate(async ({ settings, translatedText }) => {
    await chrome.storage.local.set({ settings, uiLanguage: 'en', 'key:sarashina': 'test-only-not-a-real-api-key' });
    await chrome.storage.session.clear();
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { restoreOverlayFetch: () => void }).restoreOverlayFetch = () => { globalThis.fetch = originalFetch; };
    globalThis.fetch = (input, init) => String(input).startsWith('https://api.sarashina.ai/')
      ? Promise.resolve(new Response(JSON.stringify({ translated_text: translatedText }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(input, init);
  }, { settings, translatedText });
  const options = await context.newPage();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(() => chrome.runtime.sendMessage({ type: 'kotonoha:clear-cache' }));
    await page.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: originalText }] }] }) }));
    await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
    await resizePlayer(page, 460, 259);
    const overlay = page.locator('#kotonoha-subtitles');
    await overlay.getByRole('switch').click();
    await overlay.evaluate(host => host.style.setProperty('--ui-font', 'monospace'));
    for (const position of ['top', 'bottom'] as const) {
      for (const displayMode of ['bilingual', 'translation'] as const) {
        await options.evaluate(settings => chrome.runtime.sendMessage({ type: 'kotonoha:save-settings', settings, apiKey: '' }), { ...settings, position, displayMode });
        await expect(overlay.locator('.translated')).toHaveText(translatedText);
        await expect(overlay.locator('.captions')).toHaveAttribute('data-position', position);
        await expect.poll(() => overlayBounds(page)).toMatchObject({ fontSize: '32px', inside: true });
        await expect(overlay.locator('.translated')).toBeVisible();
        await expect.poll(() => overlay.locator('.translated').evaluate(line => getComputedStyle(line).webkitLineClamp)).not.toBe('none');
        if (displayMode === 'bilingual') await expect(overlay.locator('.original')).toBeVisible();
        else await expect(overlay.locator('.original')).toBeHidden();
        await page.screenshot({ path: `artifacts/review-wrapped-${position}-${displayMode}.png`, animations: 'disabled' });
      }
    }
    await resizePlayer(page, 1200, 675);
    await expect.poll(() => overlay.locator('.translated').evaluate(line => getComputedStyle(line).webkitLineClamp)).toBe('none');
    await expect(overlay.locator('.translated')).toHaveText(translatedText);
    await expect.poll(() => overlayBounds(page)).toMatchObject({ fontSize: '32px', inside: true });
    expect(errors).toEqual([]);
  } finally {
    await worker.evaluate(() => (globalThis as unknown as { restoreOverlayFetch: () => void }).restoreOverlayFetch());
    await page.close(); await options.close();
  }
});

test('shows checking while the video controller mounts, times out and recovers without reopening the popup', async () => {
  await worker.evaluate(settings => chrome.storage.local.set({ settings, uiLanguage: 'en', 'key:sarashina': 'test-only-not-a-real-api-key' }), DEFAULT_SETTINGS);
  const page = await context.newPage();
  // The watch page is present before YouTube has mounted its player.
  await page.route('https://www.youtube.com/watch**', route => route.fulfill({ contentType: 'text/html', body: fixture.replaceAll('movie_player', 'pending_player') }));
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await page.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'checking');
  await expect(popup.locator('#primary')).toBeDisabled();
  await page.locator('#pending_player').evaluate(player => { player.id = 'movie_player'; });
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'idle');
  await page.locator('#movie_player').evaluate(player => { player.id = 'pending_player'; });
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'checking');
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'unavailable', { timeout: 8000 });
  await page.locator('#pending_player').evaluate(player => { player.id = 'movie_player'; });
  await expect(popup.locator('#status')).toHaveAttribute('data-state', 'idle');
  await popup.close(); await page.close();
});
