import { browser } from 'wxt/browser';
import { createProvider, failure, translationKey } from '../core/providers';
import { EMPTY_RATE, reserveRequest, type RateState } from '../core/rate-limit';
import { PROVIDERS } from '../core/settings';
import type { Result, Settings } from '../core/types';
import { readCache, writeCache } from './cache';
import { readApiKey } from './settings-store';

let reservation = Promise.resolve();
const pending = new Map<string, Promise<Result<string>>>();

async function reserve(key: string, rpm: number): Promise<number> {
  let waitMs = 0;
  const next = reservation.then(async () => {
    const data = await browser.storage.session.get(key);
    const result = reserveRequest((data[key] as RateState | undefined) ?? EMPTY_RATE, Date.now(), rpm);
    waitMs = result.waitMs;
    await browser.storage.session.set({ [key]: result.state });
  });
  reservation = next.catch(() => {});
  await next;
  return waitMs;
}

async function block(key: string, milliseconds: number): Promise<void> {
  const next = reservation.then(async () => {
    const data = await browser.storage.session.get(key);
    const state = (data[key] as RateState | undefined) ?? EMPTY_RATE;
    await browser.storage.session.set({ [key]: { ...state, blockedUntil: Math.max(state.blockedUntil, Date.now() + milliseconds) } });
  });
  reservation = next.catch(() => {});
  await next;
}

export async function translate(settings: Settings, text: string, bypassCache = false): Promise<Result<string>> {
  if (typeof text !== 'string' || !text.trim() || [...text].length > PROVIDERS[settings.provider].maxCharacters) return failure('CONFIG', '翻訳する文章の長さを確認してください。');
  const key = await translationKey(settings, text);
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async (): Promise<Result<string>> => {
    const apiKey = await readApiKey(settings.provider);
    if (!apiKey) return failure('AUTH', '設定画面でAPIキーを登録してください。');
    if (!bypassCache) {
      const cached = await readCache(key).catch(() => undefined);
      if (cached) return { ok: true, value: cached };
    }
    if (settings.provider === 'openai-compatible') {
      const origin = `${new URL(settings.customBaseUrl).origin}/*`;
      if (!await browser.permissions.contains({ origins: [origin] })) return failure('CONFIG', '設定画面で接続先へのアクセスを許可してください。');
    }
    const rateKey = `rate:${settings.provider}:${settings.provider === 'sarashina' ? 'translate' : settings.customBaseUrl + ':' + settings.customModel}`;
    const waitMs = await reserve(rateKey, settings.provider === 'sarashina' ? PROVIDERS.sarashina.requestsPerMinute : settings.customRpm);
    if (waitMs > 0) return failure('RATE_LIMIT', '送信間隔を調整しています。', waitMs);
    const result = await createProvider(settings).translate({ text, sourceLang: settings.sourceLang, targetLang: settings.targetLang, style: settings.style }, apiKey);
    if (result.ok) await writeCache(key, result.value).catch(() => {});
    else if (result.retryAfterMs) await block(rateKey, result.retryAfterMs);
    return result;
  })();
  pending.set(key, task);
  try { return await task; }
  finally { pending.delete(key); }
}
