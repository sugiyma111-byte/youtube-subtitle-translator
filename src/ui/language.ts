import { browser } from 'wxt/browser';
import type { Result, UiLanguage } from '../core/types';
import { errorMessage, isUiLanguage, languageName, MessageError, resolveLanguage, t, type Language, type LocalizedMessage } from '../i18n';

// Used only by trusted extension pages. YouTube receives preferences via messages.
export function bindUiLanguage(control: HTMLSelectElement, render: (language: Language) => void, onError: (message: LocalizedMessage) => void): void {
  let preference: UiLanguage = 'auto';
  let revision = 0;
  const apply = (value: unknown) => {
    preference = isUiLanguage(value) ? value : 'auto';
    const language = resolveLanguage(preference, browser.i18n.getUILanguage());
    control.replaceChildren(
      new Option(t(language, 'language.auto'), 'auto'),
      new Option(languageName('ja', 'ja'), 'ja'),
      new Option(languageName('en', 'en'), 'en'),
    );
    control.value = preference;
    render(language);
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.uiLanguage) {
      revision++;
      apply(changes.uiLanguage.newValue);
    }
  });
  control.addEventListener('change', async () => {
    control.disabled = true;
    try {
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:save-ui-language', uiLanguage: control.value }) as Result<UiLanguage>;
      if (!result.ok) throw new MessageError(result.messageKey, result.params);
    } catch (error) {
      control.value = preference;
      onError(errorMessage(error, 'error.saveUiLanguage'));
    } finally { control.disabled = false; }
  });
  apply(preference);
  const initialRevision = revision;
  void browser.storage.local.get('uiLanguage').then(({ uiLanguage }) => {
    if (revision === initialRevision) apply(uiLanguage);
  }).catch(() => onError({ messageKey: 'error.loadSettings' }));
}
