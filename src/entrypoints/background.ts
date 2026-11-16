import { browser } from 'wxt/browser';
import { clearCache } from '../background/cache';
import { lockStorage, publicSettings, readSettings, saveSettings } from '../background/settings-store';
import { translate } from '../background/translator';
import { failure } from '../core/providers';
import { isOptionsPage, isYouTubePage } from '../core/security';

export default defineBackground(() => {
  const ready = lockStorage();
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || !message.type.startsWith('kotonoha:')) return;
    const handle = async () => {
      await ready;
      if (sender.id !== browser.runtime.id) return failure('FORBIDDEN', 'この操作は許可されていません。');
      const options = isOptionsPage(sender.url, browser.runtime.getURL('/'));
      const popup = sender.url === browser.runtime.getURL('/popup.html');
      const youtube = sender.frameId === 0 && isYouTubePage(sender.url);
      if (!options && !popup && !youtube) return failure('FORBIDDEN', 'このページからは利用できません。');
      switch (message.type) {
        case 'kotonoha:get-settings': return { ok: true, value: await publicSettings() };
        case 'kotonoha:open-options': await browser.runtime.openOptionsPage(); return { ok: true, value: null };
        case 'kotonoha:save-settings': {
          if (!options) return failure('FORBIDDEN', '設定画面から変更してください。');
          await saveSettings(message.settings, message.apiKey, message.removeApiKey);
          const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
          await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab => browser.tabs.sendMessage(tab.id!, { type: 'kotonoha:settings-changed' })));
          return { ok: true, value: await publicSettings() };
        }
        case 'kotonoha:translate': {
          if (!youtube || typeof message.text !== 'string') return failure('FORBIDDEN', '字幕の翻訳リクエストを確認してください。');
          const settings = await readSettings();
          if (message.settingsSignature !== JSON.stringify(settings)) return failure('CONFIG', '設定が変更されました。翻訳を再開してください。');
          return translate(settings, message.text);
        }
        case 'kotonoha:test-connection': {
          if (!options) return failure('FORBIDDEN', '設定画面から接続を確認してください。');
          const settings = await readSettings();
          const sample = settings.sourceLang === 'ja' ? '字幕の翻訳を開始します。' : 'The subtitles are ready.';
          return translate(settings, sample, true);
        }
        case 'kotonoha:clear-cache': {
          if (!options) return failure('FORBIDDEN', '設定画面から削除してください。');
          await clearCache(); return { ok: true, value: null };
        }
        default: return failure('CONFIG', '不明な操作です。');
      }
    };
    handle().then(sendResponse).catch(error => sendResponse(failure('CONFIG', message.type === 'kotonoha:save-settings' && error instanceof Error ? error.message : '処理に失敗しました。ページを再読み込みしてお試しください。')));
    return true;
  });
});
