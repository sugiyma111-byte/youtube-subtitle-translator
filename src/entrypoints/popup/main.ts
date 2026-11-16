import './style.css';
import { browser } from 'wxt/browser';
import { PROVIDERS } from '../../core/settings';
import type { PlayerStatus, PublicSettings, Result } from '../../core/types';

const toggle = document.getElementById('toggle') as HTMLButtonElement;
const retry = document.getElementById('retry') as HTMLButtonElement;
const status = document.getElementById('status')!;
let tabId: number | undefined;

async function refresh() {
  if (tabId === undefined) return;
  try {
    const state = await browser.tabs.sendMessage(tabId, { type: 'kotonoha:player-status' }) as PlayerStatus | null;
    if (!state) { status.textContent = 'YouTubeの通常の動画ページで利用できます。'; return; }
    toggle.disabled = false;
    toggle.textContent = state.enabled ? '翻訳を停止' : '翻訳を開始';
    status.textContent = state.enabled ? state.message || '字幕を翻訳しています。' : '字幕を先読みして、動画上に表示します。';
    retry.hidden = state.phase !== 'error';
    document.getElementById('progress')!.textContent = state.total ? `${state.translated} / ${state.total} 区間を翻訳済み` : '';
  } catch { status.textContent = 'YouTubeの動画ページを開くか、ページを再読み込みしてください。'; toggle.disabled = true; }
}

document.getElementById('options')!.addEventListener('click', () => void browser.runtime.openOptionsPage());
toggle.addEventListener('click', async () => { if (tabId !== undefined) { await browser.tabs.sendMessage(tabId, { type: 'kotonoha:toggle' }); await refresh(); } });
retry.addEventListener('click', async () => { if (tabId !== undefined) { await browser.tabs.sendMessage(tabId, { type: 'kotonoha:retry' }); await refresh(); } });

async function initialize() {
  const response = await browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }) as Result<PublicSettings>;
  if (response.ok) {
    const settings = response.value.settings;
    document.getElementById('provider-name')!.textContent = PROVIDERS[settings.provider].name;
    const names = new Intl.DisplayNames(['ja'], { type: 'language' });
    document.getElementById('language-pair')!.textContent = `${names.of(settings.sourceLang)} → ${names.of(settings.targetLang)}`;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  await refresh();
  window.setInterval(() => void refresh(), 1000);
}
initialize().catch(() => { status.textContent = '拡張機能を開き直してください。'; });
