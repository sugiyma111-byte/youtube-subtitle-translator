import './style.css';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, normalizeBaseUrl, validateSettings } from '../../core/settings';
import type { PublicSettings, Result, Settings } from '../../core/types';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const message = element<HTMLParagraphElement>('message');
let current: PublicSettings = { settings: DEFAULT_SETTINGS, hasApiKey: false };
let busy = false;
const languages = [['en', '英語'], ['ja', '日本語'], ['ko', '韓国語'], ['zh-CN', '中国語（簡体字）'], ['zh-TW', '中国語（繁体字）'], ['fr', 'フランス語'], ['de', 'ドイツ語'], ['es', 'スペイン語'], ['custom', 'その他（言語コードを指定）']];

function showMessage(text: string, error = false) { message.textContent = text; message.dataset.error = String(error); }
function renderLanguages(source = select('sourceLang').value || 'en', target = select('targetLang').value || 'ja') {
  const sarashina = select('provider').value === 'sarashina';
  const choices = sarashina ? languages.slice(0, 2) : languages;
  for (const [id, value] of [['sourceLang', source], ['targetLang', target]]) {
    const control = select(id!);
    control.replaceChildren(...choices.map(([code, name]) => new Option(name, code)));
    control.value = choices.some(([code]) => code === value) ? value! : sarashina ? (id === 'sourceLang' ? 'en' : 'ja') : 'custom';
  }
  element('custom-fields').hidden = sarashina;
  element('language-note').textContent = sarashina ? 'Sarashinaは英語と日本語の相互翻訳に対応しています。' : '対応言語は、接続するサービスとモデルによって異なります。';
  updatePreview();
}

function updatePreview() {
  element('custom-language-fields').hidden = select('sourceLang').value !== 'custom' && select('targetLang').value !== 'custom';
  input('sourceCode').disabled = select('sourceLang').value !== 'custom';
  input('targetCode').disabled = select('targetLang').value !== 'custom';
  element('font-output').textContent = `${input('fontSize').value} px`;
  element('lookahead-output').textContent = `${input('lookaheadSeconds').value} 秒`;
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
  element('key-status').textContent = value.hasApiKey ? '登録済み（変更するときだけ入力）' : '未登録';
  input('apiKey').placeholder = value.hasApiKey ? '変更しない場合は空欄のまま' : 'APIキーを入力';
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
      if (!await browser.permissions.request({ origins: [origin] })) throw new Error('この接続先へのアクセス許可が必要です。');
    }
    const result = await browser.runtime.sendMessage({ type: 'kotonoha:save-settings', settings, apiKey: input('apiKey').value }) as Result<PublicSettings>;
    if (!result.ok) throw new Error(result.message);
    fill(result.value);
    showMessage('設定を保存しました。YouTubeの動画で翻訳を開始できます。');
    if (test) {
      showMessage('短い例文を送信して、接続を確認しています…');
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:test-connection' }) as Result<string>;
      if (!result.ok) throw new Error(result.message + (result.retryAfterMs ? ` 約${Math.ceil(result.retryAfterMs / 1000)}秒後に再度お試しください。` : ''));
      showMessage(`接続できました。\nテスト翻訳: ${result.value}`);
    }
  } catch (error) { showMessage(error instanceof Error ? error.message : '設定を保存できませんでした。', true); }
  finally { busy = false; document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; }); }
}

element('settings-form').addEventListener('submit', event => { event.preventDefault(); void save(); });
element('test').addEventListener('click', () => void save(true));
select('provider').addEventListener('change', () => {
  renderLanguages(); input('apiKey').value = '';
  element('key-status').textContent = select('provider').value === current.settings.provider && current.hasApiKey ? '登録済み' : '保存後に登録状態を確認できます';
});
element('settings-form').addEventListener('input', updatePreview);
element('remove-key').addEventListener('click', async () => {
  try {
    const result = await browser.runtime.sendMessage({ type: 'kotonoha:save-settings', settings: values(), removeApiKey: true }) as Result<PublicSettings>;
    if (!result.ok) throw new Error(result.message);
    fill(result.value); showMessage('選択したサービスのAPIキーを削除しました。');
  } catch (error) { showMessage(error instanceof Error ? error.message : '削除できませんでした。', true); }
});
element('clear-cache').addEventListener('click', async () => {
  const result = await browser.runtime.sendMessage({ type: 'kotonoha:clear-cache' }) as Result<null>;
  showMessage(result.ok ? '保存した訳文を削除しました。次回の翻訳で再取得します。' : result.message, !result.ok);
});
browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }).then((result: Result<PublicSettings>) => {
  if (result.ok) fill(result.value); else showMessage(result.message, true);
}).catch(() => showMessage('設定を読み込めませんでした。このページを開き直してください。', true));
