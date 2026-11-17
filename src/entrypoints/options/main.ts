import './style.css';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, normalizeBaseUrl, validateSettings } from '../../core/settings';
import type { PublicSettings, Result, Settings } from '../../core/types';
import { applyI18n, errorMessage, languageName, MessageError, t, translateMessage, type Language, type LocalizedMessage, type MessageKey } from '../../i18n';
import { bindUiLanguage } from '../../ui/language';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const message = element<HTMLParagraphElement>('message');
let current: PublicSettings = { settings: DEFAULT_SETTINGS, hasApiKey: false, uiLanguage: 'auto' };
let language: Language = 'en';
let busy = false;
let keyStatusKey: MessageKey = 'options.keyMissing';
let messageState: (LocalizedMessage & { error: boolean; retryAfterMs?: number }) | undefined;
const languages = ['en', 'ja', 'ko', 'zh-CN', 'zh-TW', 'fr', 'de', 'es', 'custom'];

function renderMessage() {
  if (!messageState) return;
  message.textContent = translateMessage(language, messageState)
    + (messageState.retryAfterMs ? ` ${t(language, 'options.retryAfter', { seconds: Math.ceil(messageState.retryAfterMs / 1000) })}` : '');
  message.dataset.error = String(messageState.error);
}
function showMessage(value: LocalizedMessage & { retryAfterMs?: number }, error = false) {
  messageState = { ...value, error };
  renderMessage();
}
function renderKeyStatus() {
  element('key-status').textContent = t(language, keyStatusKey);
  const hasKey = select('provider').value === current.settings.provider && current.hasApiKey;
  input('apiKey').placeholder = t(language, hasKey ? 'options.keyUnchanged' : 'options.keyPlaceholder');
}
function renderLanguages(source = select('sourceLang').value || 'en', target = select('targetLang').value || 'ja') {
  const sarashina = select('provider').value === 'sarashina';
  const choices = sarashina ? languages.slice(0, 2) : languages;
  for (const [id, value] of [['sourceLang', source], ['targetLang', target]] as const) {
    const control = select(id);
    control.replaceChildren(...choices.map(code => new Option(code === 'custom' ? t(language, 'language.custom') : languageName(language, code), code)));
    control.value = choices.includes(value) ? value : sarashina ? (id === 'sourceLang' ? 'en' : 'ja') : 'custom';
  }
  element('custom-fields').hidden = sarashina;
  element('language-note').textContent = t(language, sarashina ? 'options.sarashinaLanguages' : 'options.customLanguages');
  updatePreview();
}

function updatePreview() {
  element('custom-language-fields').hidden = select('sourceLang').value !== 'custom' && select('targetLang').value !== 'custom';
  input('sourceCode').disabled = select('sourceLang').value !== 'custom';
  input('targetCode').disabled = select('targetLang').value !== 'custom';
  element('font-output').textContent = t(language, 'options.pixels', { value: input('fontSize').value });
  element('lookahead-output').textContent = t(language, 'options.seconds', { value: input('lookaheadSeconds').value });
  element('preview-translation').style.fontSize = `${Number(input('fontSize').value) * .68}px`;
  element('preview-original').hidden = select('displayMode').value === 'translation';
  element('preview-caption').style.bottom = select('position').value === 'bottom' ? '30px' : 'auto';
  element('preview-caption').style.top = select('position').value === 'top' ? '24px' : 'auto';
}

function fill(value: PublicSettings) {
  current = value;
  const settings = value.settings;
  for (const [key, value] of Object.entries(settings)) {
    const control = document.getElementById(key) as HTMLInputElement | HTMLSelectElement | null;
    if (control && !['sourceLang', 'targetLang'].includes(key)) control.value = String(value);
  }
  input('sourceCode').value = settings.sourceLang;
  input('targetCode').value = settings.targetLang;
  renderLanguages(settings.sourceLang, settings.targetLang);
  input('apiKey').value = '';
  keyStatusKey = value.hasApiKey ? 'options.keySavedHint' : 'options.keyMissing';
  renderKeyStatus();
  updatePreview();
}

function values(): Settings {
  return validateSettings({
    provider: select('provider').value,
    sourceLang: select('sourceLang').value === 'custom' ? input('sourceCode').value.trim() : select('sourceLang').value,
    targetLang: select('targetLang').value === 'custom' ? input('targetCode').value.trim() : select('targetLang').value,
    style: select('style').value, displayMode: select('displayMode').value, position: select('position').value,
    fontSize: Number(input('fontSize').value), lookaheadSeconds: Number(input('lookaheadSeconds').value),
    customBaseUrl: input('customBaseUrl').value.trim(), customModel: input('customModel').value.trim(), customRpm: Number(input('customRpm').value),
  });
}

async function save(test = false) {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
  try {
    const settings = values();
    if (settings.provider === 'openai-compatible') {
      const origin = `${new URL(normalizeBaseUrl(settings.customBaseUrl)).origin}/*`;
      if (!await browser.permissions.request({ origins: [origin] })) throw new MessageError('error.permissionRequired');
    }
    const result = await browser.runtime.sendMessage({ type: 'kotonoha:save-settings', settings, apiKey: input('apiKey').value }) as Result<PublicSettings>;
    if (!result.ok) throw new MessageError(result.messageKey, result.params);
    fill(result.value);
    showMessage({ messageKey: 'options.saved' });
    if (test) {
      showMessage({ messageKey: 'options.testing' });
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:test-connection' }) as Result<string>;
      if (!result.ok) throw new MessageError(result.messageKey, result.params, result.retryAfterMs);
      showMessage({ messageKey: 'options.connected', params: { translation: result.value } });
    }
  } catch (error) { showMessage(errorMessage(error, 'error.saveSettings'), true); }
  finally { busy = false; document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; }); }
}

bindUiLanguage(select('uiLanguage'), value => {
  language = value;
  applyI18n(document, language);
  // Re-label the current form without refilling it or discarding unsaved input.
  renderLanguages();
  renderKeyStatus();
  renderMessage();
}, error => showMessage(error, true));
element('settings-form').addEventListener('submit', event => { event.preventDefault(); void save(); });
element('test').addEventListener('click', () => void save(true));
select('provider').addEventListener('change', () => {
  renderLanguages(); input('apiKey').value = '';
  keyStatusKey = select('provider').value === current.settings.provider && current.hasApiKey ? 'options.keySaved' : 'options.keyAfterSave';
  renderKeyStatus();
});
element('settings-form').addEventListener('input', updatePreview);
element('remove-key').addEventListener('click', async () => {
  try {
    const result = await browser.runtime.sendMessage({ type: 'kotonoha:save-settings', settings: values(), removeApiKey: true }) as Result<PublicSettings>;
    if (!result.ok) throw new MessageError(result.messageKey, result.params);
    fill(result.value); showMessage({ messageKey: 'options.keyRemoved' });
  } catch (error) { showMessage(errorMessage(error, 'error.delete'), true); }
});
element('clear-cache').addEventListener('click', async () => {
  try {
    const result = await browser.runtime.sendMessage({ type: 'kotonoha:clear-cache' }) as Result<null>;
    showMessage(result.ok ? { messageKey: 'options.cacheCleared' } : result, !result.ok);
  } catch (error) { showMessage(errorMessage(error, 'error.delete'), true); }
});
browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }).then((result: Result<PublicSettings>) => {
  if (result.ok) fill(result.value); else showMessage(result, true);
}).catch(() => showMessage({ messageKey: 'error.loadSettings' }, true));
