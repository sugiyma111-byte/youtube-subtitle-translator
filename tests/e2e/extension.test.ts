import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
declare const chrome: typeof import('wxt/browser').browser;

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
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
  await fs.mkdir('.local/e2e-profile', { recursive: true });
  context = await chromium.launchPersistentContext(path.resolve('.local/e2e-profile'), {
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

test.afterAll(async () => { await context?.close(); });

test('saves credentials, translates, seeks, caches, stops on navigation and isolates the page', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('APIキー', { exact: false }).fill('test-only-not-a-real-api-key');
  await options.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(options.locator('#message')).toContainText('設定を保存しました');
  await expect(options.locator('#apiKey')).toHaveValue('');
  await options.getByRole('button', { name: '保存した訳文を削除' }).click();
  await expect(options.locator('#message')).toContainText('保存した訳文を削除しました');
  await fs.mkdir('artifacts', { recursive: true });
  await options.screenshot({ path: 'artifacts/settings.png', fullPage: true });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://www.youtube.com/watch?v=${fixtureVideo}`);
  await page.locator('video').evaluate(async element => { const video = element as HTMLVideoElement; if (video.readyState < 1) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, {once:true})); video.currentTime = 1; });
  const overlay = page.locator('#kotonoha-subtitles');
  await overlay.getByRole('button', { name: '翻訳 OFF', exact: true }).click();
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
  await overlay.getByRole('button', { name: '翻訳 ON', exact: true }).click();
  await expect(page.locator('#movie_player')).not.toHaveAttribute('data-kotonoha-active');
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).currentTime = 1; });
  await overlay.getByRole('button', { name: '翻訳 OFF', exact: true }).click();
  await expect(overlay.locator('.translated')).toHaveText('こんにちは。ようこそ。');
  const after = await worker.evaluate(() => (globalThis as unknown as { apiCalls: string[] }).apiCalls.filter(t => t === 'Hello and welcome.').length);
  expect(after).toBe(before);

  await page.evaluate(() => { history.pushState({}, '', '/watch?v=bbbbbbbbbbb'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await expect(overlay.getByRole('button', { name: '翻訳 OFF', exact: true })).toBeVisible();
  await expect(overlay.locator('.captions')).toBeHidden();
  expect(errors).toEqual([]);

  await options.getByRole('button', { name: '登録したキーを削除' }).click();
  await expect(options.locator('#message')).toContainText('APIキーを削除しました');
  await overlay.getByRole('button', { name: '翻訳 OFF', exact: true }).click();
  await expect(overlay.locator('.status')).toContainText('APIキーを登録');
  await page.close(); await options.close();
});

test('requests English transcript data even on a Japanese YouTube page', async () => {
  await worker.evaluate(async () => { await chrome.storage.local.set({ 'key:sarashina': 'test-only-not-a-real-api-key' }); await chrome.storage.session.clear(); });
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
  await page.locator('#kotonoha-subtitles').getByRole('button', { name: '翻訳 OFF', exact: true }).click();
  await expect(page.locator('#kotonoha-subtitles').locator('.translated')).toHaveText('こんにちは。ようこそ。');
  await expect(page.locator('#kotonoha-subtitles').locator('.original')).toHaveText('Hello and welcome.');
  expect(requestedLanguage).toBe('en');
  await page.close();
});
