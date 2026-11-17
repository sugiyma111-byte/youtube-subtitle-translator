import './style.css';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, normalizeBaseUrl, validateSettings } from '../../core/settings';
import type { ProviderId, PublicSettings, Result } from '../../core/types';
import { applyI18n, errorMessage, MessageError, languageName, t, translateMessage, type Language, type LocalizedMessage } from '../../i18n';
import { bindUiLanguage } from '../../ui/language';

type Notice = LocalizedMessage & { error?: boolean; retryAfterMs?: number };
type Deletion = { kind: 'cache' } | { kind: 'key'; provider: ProviderId };
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const form = element<HTMLFormElement>('settings-form');
const dialog = element<HTMLDialogElement>('confirm-delete');
const radioFields = ['provider', 'style', 'displayMode', 'position'] as const;
const languages = ['en', 'ja', 'ko', 'zh-CN', 'zh-TW', 'fr', 'de', 'es', 'custom'];
const choice = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value;
const provider = () => choice('provider') as ProviderId;
const setChoice = (name: string, value: string) => {
  form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach(control => { control.checked = control.value === value; });
};
let current: PublicSettings = { settings: DEFAULT_SETTINGS, hasApiKey: false, hasApiKeys: { sarashina: false, 'openai-compatible': false }, uiLanguage: 'auto' };
let language: Language = 'en';
let loaded = false;
let busy = false;
let baseline = '';
let footerNotice: Notice | undefined;
let connectionNotice: Notice | undefined;
let deletionNotice: Notice | undefined;
let pendingDeletion: Deletion | undefined;
let deleteOpener: HTMLElement | undefined;
let keyRevision = 0;

function rawSettings() {
  return {
    provider: provider(),
    sourceLang: select('sourceLang').value === 'custom' ? input('sourceCode').value.trim() : select('sourceLang').value,
    targetLang: select('targetLang').value === 'custom' ? input('targetCode').value.trim() : select('targetLang').value,
    style: choice('style'), displayMode: choice('displayMode'), position: choice('position'),
    fontSize: Number(input('fontSize').value), lookaheadSeconds: Number(input('lookaheadSeconds').value),
    customBaseUrl: input('customBaseUrl').value.trim(), customModel: input('customModel').value.trim(), customRpm: Number(input('customRpm').value),
  };
}
function fingerprint() { return JSON.stringify({ settings: rawSettings(), apiKey: input('apiKey').value }); }
function isDirty() { return loaded && fingerprint() !== baseline; }
function keyName(service: ProviderId) { return t(language, service === 'sarashina' ? 'options.keySarashina' : 'options.keyCompatible'); }
function formatNotice(notice: Notice) {
  const params = notice.params?.provider ? { ...notice.params, provider: keyName(notice.params.provider as ProviderId) } : notice.params;
  return translateMessage(language, { ...notice, params })
    + (notice.retryAfterMs ? ` ${t(language, 'options.retryAfter', { seconds: Math.ceil(notice.retryAfterMs / 1000) })}` : '');
}
function renderNotice(id: string, notice?: Notice) {
  const target = element(id);
  target.hidden = !notice;
  target.textContent = notice ? formatNotice(notice) : '';
  target.dataset.error = String(Boolean(notice?.error));
}
function renderLanguages(source = select('sourceLang').value || 'en', target = select('targetLang').value || 'ja') {
  const choices = provider() === 'sarashina' ? languages.slice(0, 2) : languages;
  for (const [id, value] of [['sourceLang', source], ['targetLang', target]] as const) {
    const control = select(id);
    control.replaceChildren(...choices.map(code => new Option(code === 'custom' ? t(language, 'language.custom') : languageName(language, code), code)));
    control.value = choices.includes(value) ? value : provider() === 'sarashina' ? (id === 'sourceLang' ? 'en' : 'ja') : 'custom';
  }
}
function badge(id: string, hasKey: boolean) {
  element(id).textContent = t(language, hasKey ? 'options.keySaved' : 'options.keyMissing');
  element(id).dataset.saved = String(hasKey);
}
function render() {
  const service = provider();
  const hasKey = current.hasApiKeys[service];
  element('custom-fields').hidden = service === 'sarashina';
  element('get-key').hidden = service !== 'sarashina';
  element('language-note').textContent = t(language, service === 'sarashina' ? 'options.sarashinaLanguages' : 'options.customLanguages');
  element('key-title').textContent = keyName(service);
  badge('key-status', hasKey);
  input('apiKey').placeholder = t(language, hasKey ? 'options.keyUnchanged' : 'options.keyPlaceholder');
  button('show-key').textContent = t(language, input('apiKey').type === 'password' ? 'options.showKey' : 'options.hideKey');
  button('show-key').setAttribute('aria-pressed', String(input('apiKey').type === 'text'));
  button('remove-key').disabled = busy || !loaded || !hasKey;
  element('help-key').dataset.done = String(hasKey);
  for (const id of ['sarashina', 'openai-compatible'] as const) {
    badge(`key-status-${id}`, current.hasApiKeys[id]);
    const control = form.querySelector<HTMLButtonElement>(`[data-delete-provider="${id}"]`)!;
    control.disabled = busy || !loaded || !current.hasApiKeys[id];
    control.setAttribute('aria-label', t(language, 'options.deleteKeyLabel', { provider: keyName(id) }));
  }
  element('custom-language-fields').hidden = select('sourceLang').value !== 'custom' && select('targetLang').value !== 'custom';
  input('sourceCode').disabled = select('sourceLang').value !== 'custom';
  input('targetCode').disabled = select('targetLang').value !== 'custom';
  element('font-output').textContent = t(language, 'options.pixels', { value: input('fontSize').value });
  element('lookahead-output').textContent = t(language, 'options.seconds', { value: input('lookaheadSeconds').value });
  const previewSize = Math.max(13, Number(input('fontSize').value) * .65);
  element('preview-translation').style.fontSize = `${previewSize}px`;
  element('preview-original').style.fontSize = `${Math.max(13, previewSize * .62)}px`;
  element('preview-original').hidden = choice('displayMode') === 'translation';
  element('preview-caption').dataset.position = choice('position');
  form.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(control => {
    const range = input(control.dataset.step!);
    control.disabled = busy || !loaded || (control.dataset.direction === '-1' ? Number(range.value) <= Number(range.min) : Number(range.value) >= Number(range.max));
  });
  element<HTMLFieldSetElement>('settings-fields').disabled = busy || !loaded;
  button('clear-cache').disabled = busy || !loaded;
  const dirty = isDirty();
  element('save-bar').dataset.dirty = String(dirty);
  element('dirty-status').textContent = t(language, dirty ? 'options.dirty' : 'options.clean');
  button('save').disabled = busy || !dirty;
  renderNotice('message', footerNotice);
  renderNotice('connection-result', connectionNotice);
  if (pendingDeletion) {
    element('delete-title').textContent = pendingDeletion.kind === 'cache' ? t(language, 'options.confirmCacheTitle')
      : t(language, 'options.confirmKeyTitle', { provider: keyName(pendingDeletion.provider) });
    element('delete-description').textContent = t(language, pendingDeletion.kind === 'cache' ? 'options.confirmCacheBody' : 'options.confirmKeyBody');
  }
  renderNotice('delete-error', deletionNotice);
  button('cancel-delete').disabled = busy;
  button('confirm-delete-button').disabled = busy;
}
function fill(value: PublicSettings) {
  current = value;
  for (const name of radioFields) setChoice(name, value.settings[name]);
  for (const name of ['customBaseUrl', 'customModel', 'customRpm', 'fontSize', 'lookaheadSeconds'] as const) input(name).value = String(value.settings[name]);
  input('sourceCode').value = value.settings.sourceLang;
  input('targetCode').value = value.settings.targetLang;
  renderLanguages(value.settings.sourceLang, value.settings.targetLang);
  input('apiKey').value = '';
  input('apiKey').type = 'password';
  baseline = fingerprint();
  loaded = true;
  render();
}
function touch() {
  footerNotice = undefined;
  connectionNotice = undefined;
  render();
}
async function loadSettings() {
  button('reload-settings').disabled = true;
  try {
    const result = await browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }) as Result<PublicSettings>;
    if (!result.ok) throw new MessageError(result.messageKey, result.params);
    fill(result.value);
    footerNotice = undefined;
    button('reload-settings').hidden = true;
  } catch (error) {
    footerNotice = { ...errorMessage(error, 'error.loadSettings'), error: true };
    button('reload-settings').hidden = false;
  } finally {
    document.body.removeAttribute('data-settings-pending');
    button('reload-settings').disabled = false;
    render();
  }
}
async function save(testConnection = false) {
  if (busy || !loaded || (!testConnection && !isDirty())) return;
  busy = true;
  let saved = false;
  footerNotice = { messageKey: 'options.saving' };
  connectionNotice = undefined;
  render();
  try {
    const settings = validateSettings(rawSettings());
    // Keep this permission request in the original user-gesture call chain.
    if (settings.provider === 'openai-compatible') {
      const origin = `${new URL(normalizeBaseUrl(settings.customBaseUrl)).origin}/*`;
      if (!await browser.permissions.request({ origins: [origin] })) throw new MessageError('error.permissionRequired');
    }
    const result = await browser.runtime.sendMessage({ type: 'kotonoha:save-settings', settings, apiKey: input('apiKey').value }) as Result<PublicSettings>;
    if (!result.ok) throw new MessageError(result.messageKey, result.params);
    fill(result.value);
    saved = true;
    footerNotice = { messageKey: 'options.saved' };
    if (testConnection) {
      connectionNotice = { messageKey: 'options.testing' };
      render();
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:test-connection' }) as Result<string>;
      if (!result.ok) throw new MessageError(result.messageKey, result.params, result.retryAfterMs);
      connectionNotice = { messageKey: 'options.connected', params: { translation: result.value } };
    }
  } catch (error) {
    const notice = { ...errorMessage(error, 'error.saveSettings'), error: true };
    if (testConnection) connectionNotice = notice;
    if (!saved) footerNotice = notice;
  } finally { busy = false; render(); }
}
function confirmDeletion(deletion: Deletion, opener: HTMLElement) {
  if (busy || !loaded) return;
  pendingDeletion = deletion;
  deleteOpener = opener;
  deletionNotice = undefined;
  render();
  dialog.showModal();
  button('cancel-delete').focus();
}
async function deleteSavedData() {
  if (busy || !pendingDeletion) return;
  const deletion = pendingDeletion;
  busy = true;
  deletionNotice = undefined;
  render();
  try {
    if (deletion.kind === 'cache') {
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:clear-cache' }) as Result<null>;
      if (!result.ok) throw new MessageError(result.messageKey, result.params);
      footerNotice = { messageKey: 'options.cacheCleared' };
    } else {
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:delete-api-key', provider: deletion.provider }) as Result<PublicSettings>;
      if (!result.ok) throw new MessageError(result.messageKey, result.params);
      // Update saved-key badges only. A deletion never saves or discards form input.
      current.hasApiKeys = result.value.hasApiKeys;
      current.hasApiKey = current.hasApiKeys[current.settings.provider];
      footerNotice = { messageKey: 'options.keyRemoved', params: { provider: deletion.provider } };
      if (deletion.provider === provider()) connectionNotice = undefined;
    }
    dialog.close();
  } catch (error) {
    deletionNotice = { ...errorMessage(error, 'error.delete'), error: true };
    footerNotice = deletionNotice;
  } finally { busy = false; render(); }
}

void bindUiLanguage(element('uiLanguage'), value => {
  language = value;
  applyI18n(document, language);
  renderLanguages();
  render();
}, notice => { footerNotice = { ...notice, error: true }; render(); });
element('version').textContent = browser.runtime.getManifest().version;
form.addEventListener('submit', event => { event.preventDefault(); void save(); });
form.addEventListener('input', event => {
  if (event.target instanceof HTMLInputElement && event.target.name === 'provider') {
    input('apiKey').value = '';
    input('apiKey').type = 'password';
    renderLanguages();
  }
  touch();
});
button('test').addEventListener('click', () => void save(true));
button('reload-settings').addEventListener('click', () => void loadSettings());
button('show-key').addEventListener('click', () => { input('apiKey').type = input('apiKey').type === 'password' ? 'text' : 'password'; render(); });
button('swap-languages').addEventListener('click', () => {
  const source = select('sourceLang').value;
  const target = select('targetLang').value;
  const sourceCode = input('sourceCode').value;
  input('sourceCode').value = input('targetCode').value;
  input('targetCode').value = sourceCode;
  renderLanguages(target, source);
  touch();
});
form.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(control => control.addEventListener('click', () => {
  const range = input(control.dataset.step!);
  if (control.dataset.direction === '1') range.stepUp(); else range.stepDown();
  touch();
}));
button('clear-cache').addEventListener('click', event => confirmDeletion({ kind: 'cache' }, event.currentTarget as HTMLElement));
button('remove-key').addEventListener('click', event => confirmDeletion({ kind: 'key', provider: provider() }, event.currentTarget as HTMLElement));
form.querySelectorAll<HTMLButtonElement>('[data-delete-provider]').forEach(control => control.addEventListener('click', () => confirmDeletion({ kind: 'key', provider: control.dataset.deleteProvider as ProviderId }, control)));
button('cancel-delete').addEventListener('click', () => dialog.close());
button('confirm-delete-button').addEventListener('click', () => void deleteSavedData());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
dialog.addEventListener('close', () => {
  pendingDeletion = undefined;
  if (deleteOpener && !deleteOpener.matches(':disabled')) deleteOpener.focus();
  else element('data-heading').focus();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !['key:sarashina', 'key:openai-compatible'].some(key => key in changes)) return;
  const revision = ++keyRevision;
  void browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }).then((result: Result<PublicSettings>) => {
    if (result.ok && revision === keyRevision) {
      current.hasApiKeys = result.value.hasApiKeys;
      current.hasApiKey = current.hasApiKeys[current.settings.provider];
      render();
    }
  }).catch(() => {});
});
const resize = new ResizeObserver(entries => {
  for (const entry of entries) {
    const property = entry.target.id === 'save-bar' ? '--savebar-height' : '--header-height';
    document.documentElement.style.setProperty(property, `${entry.target.getBoundingClientRect().height}px`);
  }
});
resize.observe(element('save-bar'));
resize.observe(document.querySelector('.settings-header')!);
void loadSettings();
