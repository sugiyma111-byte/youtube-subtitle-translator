import { browser } from 'wxt/browser';
import type { Result, UiLanguage } from '../core/types';
import { errorMessage, isUiLanguage, languageName, MessageError, resolveLanguage, t, type Language, type LocalizedMessage } from '../i18n';

// Trusted extension pages only; content scripts receive preferences via messages.
export async function bindUiLanguage(control: HTMLElement, render: (language: Language) => void, onError: (message: LocalizedMessage) => void): Promise<void> {
  let preference: UiLanguage = 'auto';
  let revision = 0;
  const select = control instanceof HTMLSelectElement ? control : undefined;
  const buttons = [...control.querySelectorAll<HTMLButtonElement>('[data-ui-language]')];
  const disable = (value: boolean) => {
    if (select) select.disabled = value;
    buttons.forEach(button => { button.disabled = value; });
  };
  const apply = (value: unknown) => {
    preference = isUiLanguage(value) ? value : 'auto';
    const language = resolveLanguage(preference, browser.i18n.getUILanguage());
    const labels = { auto: t(language, 'language.auto'), ja: languageName('ja', 'ja'), en: languageName('en', 'en') };
    if (select) {
      select.replaceChildren(...Object.entries(labels).map(([value, label]) => new Option(label, value)));
      select.value = preference;
    }
    for (const button of buttons) {
      const value = button.dataset.uiLanguage;
      if (!isUiLanguage(value)) continue;
      button.textContent = labels[value];
      button.setAttribute('aria-pressed', String(value === preference));
    }
    render(language);
    document.body.removeAttribute('data-i18n-pending');
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.uiLanguage) {
      revision++;
      apply(changes.uiLanguage.newValue);
    }
  });
  const save = async (value: string) => {
    disable(true);
    const startingRevision = revision;
    try {
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:save-ui-language', uiLanguage: value }) as Result<UiLanguage>;
      if (!result.ok) throw new MessageError(result.messageKey, result.params);
      if (revision === startingRevision) apply(result.value);
    } catch (error) {
      if (select) select.value = preference;
      onError(errorMessage(error, 'error.saveUiLanguage'));
    } finally { disable(false); }
  };
  select?.addEventListener('change', () => void save(select.value));
  buttons.forEach(button => button.addEventListener('click', () => void save(button.dataset.uiLanguage!)));
  disable(true);
  const initialRevision = revision;
  try {
    const { uiLanguage } = await browser.storage.local.get('uiLanguage');
    if (revision === initialRevision) apply(uiLanguage);
  } catch {
    apply(preference);
    onError({ messageKey: 'error.loadSettings' });
  } finally { disable(false); }
}
