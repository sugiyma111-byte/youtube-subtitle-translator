import './style.css';
import { browser } from 'wxt/browser';
import { PROVIDERS } from '../../core/settings';
import type { PlayerStatus, PublicSettings, Result } from '../../core/types';
import { applyI18n, languageName, t, translateMessage, type Language, type LocalizedMessage } from '../../i18n';
import { bindUiLanguage } from '../../ui/language';

const toggle = document.getElementById('toggle') as HTMLButtonElement;
const retry = document.getElementById('retry') as HTMLButtonElement;
const status = document.getElementById('status')!;
let tabId: number | undefined;
let language: Language = 'en';
let settings: PublicSettings['settings'] | undefined;
let state: PlayerStatus | null = null;
let statusMessage: LocalizedMessage = { messageKey: 'popup.checking' };
let languageError: LocalizedMessage | undefined;

function render() {
  applyI18n(document, language);
  if (settings) {
    document.getElementById('provider-name')!.textContent = t(language, PROVIDERS[settings.provider].nameKey);
    document.getElementById('language-pair')!.textContent = `${languageName(language, settings.sourceLang)} → ${languageName(language, settings.targetLang)}`;
  }
  toggle.disabled = !state;
  toggle.textContent = t(language, state?.enabled ? 'popup.stop' : 'popup.start');
  status.textContent = translateMessage(language, languageError ?? statusMessage);
  retry.hidden = state?.phase !== 'error';
  document.getElementById('progress')!.textContent = state?.total ? t(language, 'popup.progress', { done: state.translated, total: state.total }) : '';
}

async function refresh() {
  if (tabId === undefined) { statusMessage = { messageKey: 'popup.videoOnly' }; render(); return; }
  try {
    state = await browser.tabs.sendMessage(tabId, { type: 'kotonoha:player-status' }) as PlayerStatus | null;
    statusMessage = !state ? { messageKey: 'popup.videoOnly' }
      : state.enabled ? { messageKey: state.messageKey ?? 'popup.translating', params: state.params }
      : { messageKey: 'popup.ready' };
  } catch { state = null; statusMessage = { messageKey: 'popup.reloadVideo' }; }
  render();
}

bindUiLanguage(document.getElementById('uiLanguage') as HTMLSelectElement, value => {
  language = value;
  languageError = undefined;
  render();
}, error => { languageError = error; render(); });
document.getElementById('options')!.addEventListener('click', () => void browser.runtime.openOptionsPage());
for (const [button, type] of [[toggle, 'kotonoha:toggle'], [retry, 'kotonoha:retry']] as const) {
  button.addEventListener('click', async () => {
    try { if (tabId !== undefined) await browser.tabs.sendMessage(tabId, { type }); }
    catch { state = null; }
    await refresh();
  });
}

async function initialize() {
  const response = await browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }) as Result<PublicSettings>;
  if (response.ok) settings = response.value.settings;
  else { statusMessage = response; render(); return; }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  await refresh();
  window.setInterval(() => void refresh(), 1000);
}
initialize().catch(() => { statusMessage = { messageKey: 'popup.reopen' }; render(); });
