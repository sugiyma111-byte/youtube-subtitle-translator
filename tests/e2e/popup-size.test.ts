import { chromium, expect, test, type CDPSession } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

declare const chrome: typeof import('wxt/browser').browser;

// Action popups are browser-owned targets, not Pages exposed by Playwright.
function popupCommands(browser: CDPSession, sessionId: string) {
  let nextId = 0;
  return <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        browser.off('Target.receivedMessageFromTarget', receive);
        reject(new Error(`Popup command timed out: ${method}`));
      }, 5000);
      function receive(event: { sessionId: string; message: string }) {
        if (event.sessionId !== sessionId) return;
        const response = JSON.parse(event.message) as { id: number; result: T; error?: { message: string } };
        if (response.id !== id) return;
        clearTimeout(timeout);
        browser.off('Target.receivedMessageFromTarget', receive);
        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      }
      browser.on('Target.receivedMessageFromTarget', receive);
      void browser.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => {
        clearTimeout(timeout);
        browser.off('Target.receivedMessageFromTarget', receive);
        reject(error);
      });
    });
  };
}

function popupLayout() {
  const provider = document.querySelector('#provider-name');
  const range = document.createRange();
  if (provider) range.selectNodeContents(provider);
  return {
    ready: !document.body.hasAttribute('data-i18n-pending') && !!provider?.textContent,
    language: document.documentElement.lang,
    viewportWidth: innerWidth,
    bodyWidth: document.body.getBoundingClientRect().width,
    contentWidth: document.documentElement.scrollWidth,
    providerLines: range.getClientRects().length,
  };
}

for (const language of ['ja', 'en']) {
  test(`opens the real Chrome action popup at a readable width (${language})`, async () => {
    await fs.mkdir('.local', { recursive: true });
    const profile = await fs.mkdtemp(path.resolve('.local/popup-size-'));
    const extension = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: null,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const extensionId = new URL(worker.url()).host;
      await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Popup sizing fixture</h1>' }));
      await context.pages()[0]!.goto('https://www.youtube.com/');
      const browser = await context.browser()!.newBrowserCDPSession();
      const popupUrl = `chrome-extension://${extensionId}/popup.html`;
      await fs.mkdir('artifacts', { recursive: true });

      await worker.evaluate(uiLanguage => chrome.storage.local.set({ uiLanguage }), language);
      await worker.evaluate(() => chrome.action.openPopup());
      await expect.poll(async () => (await browser.send('Target.getTargets')).targetInfos.some(target => target.url === popupUrl)).toBe(true);
      const target = (await browser.send('Target.getTargets')).targetInfos.find(target => target.url === popupUrl)!;
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
      const command = popupCommands(browser, sessionId);
      const layout = async () => {
        const result = await command<{ result: { value: ReturnType<typeof popupLayout> } }>('Runtime.evaluate', {
          expression: `(${popupLayout.toString()})()`, returnByValue: true,
        });
        return result.result.value;
      };
      await expect.poll(layout, { message: `${language}: native popup must size itself without a preset viewport` }).toMatchObject({
        ready: true, language, viewportWidth: 360, bodyWidth: 360, providerLines: 1,
      });
      const measured = await layout();
      expect(measured.contentWidth).toBeLessThanOrEqual(measured.viewportWidth);
      const screenshot = await command<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(`artifacts/popup-native-${language}.png`, Buffer.from(screenshot.data, 'base64'));
    } finally {
      await context.close();
      if (path.dirname(profile) === path.resolve('.local') && path.basename(profile).startsWith('popup-size-')) {
        await fs.rm(profile, { recursive: true, force: true });
      }
    }
  });
}
