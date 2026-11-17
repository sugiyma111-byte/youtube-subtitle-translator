import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, validateSettings } from '../core/settings';
import type { ProviderId, PublicSettings, Settings, UiLanguage } from '../core/types';
import { isUiLanguage, MessageError } from '../i18n';

export async function lockStorage(): Promise<void> {
  await Promise.all([
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
}

export async function readSettings(): Promise<Settings> {
  const { settings } = await browser.storage.local.get('settings');
  try { return validateSettings(settings ?? DEFAULT_SETTINGS); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export async function readApiKey(provider: ProviderId): Promise<string> {
  const data = await browser.storage.local.get(`key:${provider}`);
  return typeof data[`key:${provider}`] === 'string' ? data[`key:${provider}`] as string : '';
}

export async function publicSettings(): Promise<PublicSettings> {
  const settings = await readSettings();
  const [sarashina, compatible, uiLanguage] = await Promise.all([
    readApiKey('sarashina'), readApiKey('openai-compatible'), readUiLanguage(),
  ]);
  const hasApiKeys = { sarashina: Boolean(sarashina), 'openai-compatible': Boolean(compatible) };
  return { settings, hasApiKey: hasApiKeys[settings.provider], hasApiKeys, uiLanguage };
}

// Deleting a saved key must not validate or save an unrelated settings draft.
export async function deleteApiKey(provider: unknown): Promise<ProviderId> {
  if (provider !== 'sarashina' && provider !== 'openai-compatible') throw new MessageError('error.provider');
  await browser.storage.local.remove(`key:${provider}`);
  return provider;
}

export async function readUiLanguage(): Promise<UiLanguage> {
  const { uiLanguage } = await browser.storage.local.get('uiLanguage');
  return isUiLanguage(uiLanguage) ? uiLanguage : 'auto';
}

export async function saveUiLanguage(value: unknown): Promise<UiLanguage> {
  if (!isUiLanguage(value)) throw new MessageError('error.uiLanguage');
  await browser.storage.local.set({ uiLanguage: value });
  return value;
}

export async function saveSettings(input: unknown, apiKey?: unknown, removeApiKey?: unknown): Promise<void> {
  const settings = validateSettings(input);
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 4096 || /[\r\n]/.test(apiKey))) throw new MessageError('error.invalidKey');
  // Changing an endpoint must not silently send the old host's credential to a new host.
  const previous = await readSettings();
  if (previous.customBaseUrl !== settings.customBaseUrl) await browser.storage.local.remove('key:openai-compatible');
  await browser.storage.local.set({ settings });
  if (removeApiKey === true) await browser.storage.local.remove(`key:${settings.provider}`);
  else if (typeof apiKey === 'string' && apiKey.trim()) await browser.storage.local.set({ [`key:${settings.provider}`]: apiKey.trim() });
}
