import { browser } from 'wxt/browser';
import { clearCache } from '../background/cache';
import { lockStorage, publicSettings, readSettings, readUiLanguage, saveSettings, saveUiLanguage } from '../background/settings-store';
import { translate } from '../background/translator';
import { failure } from '../core/providers';
import { isOptionsPage, isYouTubePage } from '../core/security';
import { errorMessage, t } from '../i18n';

async function notifyYouTubeTabs(message: object): Promise<void> {
  const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
  await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab => browser.tabs.sendMessage(tab.id!, message)));
}

export default defineBackground(() => {
  const ready = lockStorage();
  // Storage is trusted-contexts only. Content scripts receive preferences via messages.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.uiLanguage) {
      void ready.then(readUiLanguage).then(uiLanguage => notifyYouTubeTabs({ type: 'kotonoha:ui-language-changed', uiLanguage })).catch(() => {});
    }
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || !message.type.startsWith('kotonoha:')) return;
    const handle = async () => {
      await ready;
      if (sender.id !== browser.runtime.id) return failure('FORBIDDEN', 'error.forbidden');
      const options = isOptionsPage(sender.url, browser.runtime.getURL('/'));
      const popup = sender.url === browser.runtime.getURL('/popup.html');
      const youtube = sender.frameId === 0 && isYouTubePage(sender.url);
      if (!options && !popup && !youtube) return failure('FORBIDDEN', 'error.pageForbidden');
      switch (message.type) {
        case 'kotonoha:get-settings': return { ok: true, value: await publicSettings() };
        case 'kotonoha:open-options': await browser.runtime.openOptionsPage(); return { ok: true, value: null };
        case 'kotonoha:save-ui-language': {
          if (!options && !popup) return failure('FORBIDDEN', 'error.languagePageOnly');
          return { ok: true, value: await saveUiLanguage(message.uiLanguage) };
        }
        case 'kotonoha:save-settings': {
          if (!options) return failure('FORBIDDEN', 'error.optionsOnly');
          await saveSettings(message.settings, message.apiKey, message.removeApiKey);
          await notifyYouTubeTabs({ type: 'kotonoha:settings-changed' });
          return { ok: true, value: await publicSettings() };
        }
        case 'kotonoha:translate': {
          if (!youtube || typeof message.text !== 'string') return failure('FORBIDDEN', 'error.translationRequest');
          const settings = await readSettings();
          if (message.settingsSignature !== JSON.stringify(settings)) return failure('CONFIG', 'error.settingsChanged');
          return translate(settings, message.text);
        }
        case 'kotonoha:test-connection': {
          if (!options) return failure('FORBIDDEN', 'error.testOptionsOnly');
          const settings = await readSettings();
          // This is translation input: choose by source language, never UI language.
          const sample = t(settings.sourceLang === 'ja' ? 'ja' : 'en', 'connection.sample');
          return translate(settings, sample, true);
        }
        case 'kotonoha:clear-cache': {
          if (!options) return failure('FORBIDDEN', 'error.deleteOptionsOnly');
          await clearCache(); return { ok: true, value: null };
        }
        default: return failure('CONFIG', 'error.unknownOperation');
      }
    };
    handle().then(sendResponse).catch(error => {
      const message = errorMessage(error, 'error.operation');
      sendResponse(failure('CONFIG', message.messageKey, undefined, message.params));
    });
    return true;
  });
});
