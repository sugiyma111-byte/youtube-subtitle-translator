import './style.css';
import { browser } from 'wxt/browser';
import { PROVIDERS } from '../../core/settings';
import { isYouTubePage } from '../../core/security';
import type { PlayerStatus, PublicSettings, Result } from '../../core/types';
import { applyI18n, errorMessage, languageName, MessageError, t, translateMessage, type Language, type LocalizedMessage, type MessageKey } from '../../i18n';
import { bindUiLanguage } from '../../ui/language';

type Action = 'start' | 'stop' | 'retry' | 'add-key' | 'none';
type Player = { kind: 'video' | 'other' | 'unavailable'; state: PlayerStatus | null };
interface View {
  kind: string;
  title: MessageKey;
  detail: LocalizedMessage;
  signal: 'off' | 'on' | 'wait' | 'alert';
  action: Action;
}
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const primary = element<HTMLButtonElement>('primary');
const secondary = element<HTMLButtonElement>('secondary');
const text = (id: string, value: string) => {
  const target = element(id);
  // Polling should not repeatedly announce unchanged live-region text.
  if (target.textContent !== value) target.textContent = value;
};
let tabId: number | undefined;
let language: Language = 'en';
let settings: PublicSettings | undefined;
let player: Player = { kind: 'other', state: null };
let loadError: LocalizedMessage | undefined;
let notice: LocalizedMessage | undefined;
let noticeTimer: number | undefined;
let refreshRevision = 0;
let busy = false;

function currentView(): View {
  if (loadError) return { kind: 'unavailable', title: 'popup.unavailableTitle', detail: loadError, signal: 'alert', action: 'none' };
  if (!settings) return { kind: 'checking', title: 'popup.checking', detail: { messageKey: 'popup.checkingDetail' }, signal: 'off', action: 'none' };
  // Registration is useful even when the active tab is not a video yet.
  if (!settings.hasApiKey) return { kind: 'no-key', title: 'popup.noKeyTitle', detail: { messageKey: 'popup.noKeyDetail' }, signal: 'alert', action: 'add-key' };
  if (player.kind === 'unavailable') return { kind: 'unavailable', title: 'popup.unavailableTitle', detail: { messageKey: 'popup.reloadVideo' }, signal: 'alert', action: 'none' };
  if (!player.state) return { kind: 'not-video', title: 'popup.notVideoTitle', detail: { messageKey: 'popup.notVideoDetail' }, signal: 'off', action: 'none' };
  const state = player.state;
  if (!state.enabled) return { kind: 'idle', title: 'popup.idleTitle', detail: { messageKey: 'popup.idleDetail' }, signal: 'off', action: 'start' };
  if (state.phase === 'error') {
    const captionErrors: MessageKey[] = ['error.noTimedCaptions', 'error.prepareCaptions', 'error.live', 'error.noLanguage', 'error.captions'];
    const title = !state.messageKey || captionErrors.includes(state.messageKey) ? 'popup.errorTitle' : 'popup.translationErrorTitle';
    return { kind: 'error', title, detail: { messageKey: state.messageKey ?? 'popup.errorDetail', params: state.params }, signal: 'alert', action: 'retry' };
  }
  if (state.phase === 'waiting' || state.messageKey === 'status.waiting') return {
    kind: 'waiting', title: 'popup.waitingTitle', signal: 'wait', action: 'stop',
    detail: state.messageKey && state.messageKey !== 'status.waiting' ? { messageKey: state.messageKey, params: state.params } : { messageKey: 'popup.waitingDetail' },
  };
  return {
    kind: 'active', title: 'popup.activeTitle', signal: 'on', action: 'stop',
    detail: state.messageKey && state.messageKey !== 'status.prefetching' ? { messageKey: state.messageKey, params: state.params } : { messageKey: 'popup.activeDetail' },
  };
}

function render() {
  const view = currentView();
  element('status').dataset.state = view.kind;
  element('signal').dataset.kind = view.signal;
  text('status-title', t(language, view.title));
  text('status-detail', translateMessage(language, view.detail));
  const labels: Record<Action, MessageKey> = { start: 'popup.start', stop: 'popup.stop', retry: 'popup.retry', 'add-key': 'popup.addKey', none: 'popup.start' };
  text('primary', t(language, labels[view.action]));
  primary.disabled = busy || view.action === 'none';
  primary.classList.toggle('primary', view.action !== 'stop');
  secondary.hidden = view.kind !== 'error';
  secondary.disabled = busy;
  const state = player.state;
  const total = state && Number.isFinite(state.total) ? Math.max(0, state.total) : 0;
  const done = state && Number.isFinite(state.translated) ? Math.max(0, Math.min(state.translated, total)) : 0;
  element('translation-progress').hidden = !['active', 'waiting'].includes(view.kind) || total === 0;
  text('progress', t(language, 'popup.progress', { done, total }));
  element('progress-bar').setAttribute('aria-valuemax', String(total));
  element('progress-bar').setAttribute('aria-valuenow', String(done));
  element('progress-bar').firstElementChild!.setAttribute('style', `width: ${total ? done / total * 100 : 0}%`);
  element('settings-summary').hidden = !settings;
  if (settings) {
    text('provider-name', t(language, PROVIDERS[settings.settings.provider].nameKey));
    text('language-pair', `${languageName(language, settings.settings.sourceLang)} → ${languageName(language, settings.settings.targetLang)}`);
  }
  element('notice').hidden = !notice;
  text('notice', notice ? translateMessage(language, notice) : '');
}

function showNotice(message: LocalizedMessage) {
  notice = message;
  window.clearTimeout(noticeTimer);
  // A language-save error never replaces the video state, and expires on its own.
  noticeTimer = window.setTimeout(() => { notice = undefined; render(); }, 5000);
  render();
}

async function readPlayer(): Promise<Player> {
  if (tabId === undefined) return { kind: 'other', state: null };
  let tab;
  try { tab = await browser.tabs.get(tabId); }
  catch { return { kind: 'other', state: null }; }
  if (!isYouTubePage(tab.url)) return { kind: 'other', state: null };
  const url = new URL(tab.url!);
  if (url.pathname !== '/watch' || !/^[\w-]{11}$/.test(url.searchParams.get('v') ?? '')) return { kind: 'other', state: null };
  try {
    const state = await browser.tabs.sendMessage(tabId, { type: 'kotonoha:player-status' }) as PlayerStatus | null;
    return { kind: state ? 'video' : 'unavailable', state };
  } catch { return { kind: 'unavailable', state: null }; }
}

async function refresh() {
  if (busy) return;
  const revision = ++refreshRevision;
  try {
    const [response, currentPlayer] = await Promise.all([
      browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }) as Promise<Result<PublicSettings>>, readPlayer(),
    ]);
    if (revision !== refreshRevision) return;
    if (!response.ok) throw new MessageError(response.messageKey, response.params);
    settings = response.value;
    player = currentPlayer;
    loadError = undefined;
  } catch (error) {
    if (revision !== refreshRevision) return;
    loadError = errorMessage(error, 'error.loadSettings');
  }
  render();
}

async function act(action: Action) {
  if (busy || action === 'none') return;
  busy = true;
  refreshRevision++;
  render();
  try {
    if (action === 'add-key') {
      await browser.tabs.create({ url: browser.runtime.getURL('/options.html#apikey') });
    } else if (tabId !== undefined) {
      // Honor the requested action if a video-side control changed state since the last poll.
      const current = await readPlayer();
      if (current.state && (action === 'retry' || current.state.enabled === (action === 'stop'))) {
        await browser.tabs.sendMessage(tabId, { type: action === 'retry' ? 'kotonoha:retry' : 'kotonoha:toggle' });
      }
    }
  } catch (error) { showNotice(errorMessage(error, 'error.operation')); }
  finally { busy = false; await refresh(); }
}

void bindUiLanguage(element('uiLanguage'), value => {
  language = value;
  notice = undefined;
  window.clearTimeout(noticeTimer);
  applyI18n(document, language);
  render();
}, showNotice);
for (const id of ['options', 'change-settings']) {
  element(id).addEventListener('click', () => { void browser.runtime.openOptionsPage().catch(error => showNotice(errorMessage(error, 'error.operation'))); });
}
primary.addEventListener('click', () => void act(currentView().action));
secondary.addEventListener('click', () => void act('stop'));

async function initialize() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  } catch { showNotice({ messageKey: 'popup.reopen' }); }
  await refresh();
  const timer = window.setInterval(() => void refresh(), 1000);
  window.addEventListener('pagehide', () => { window.clearInterval(timer); window.clearTimeout(noticeTimer); }, { once: true });
}
void initialize();
