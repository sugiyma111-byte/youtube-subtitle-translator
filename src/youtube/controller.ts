import { browser } from 'wxt/browser';
import { activeCue, groupCues, upcomingCues } from '../core/captions';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { Cue, PlayerStatus, PublicSettings, Result, Settings } from '../core/types';
import { SubtitleOverlay } from '../ui/overlay';
import { youtubeCaptionSource } from './source';

export class VideoController {
  private settings: Settings = DEFAULT_SETTINGS;
  private cues: Cue[] = [];
  private translations = new Map<string, string>();
  private sourceAbort?: AbortController;
  private generation = 0;
  private inFlight = false;
  private retryAt = 0;
  private networkFailures = 0;
  private overlay: SubtitleOverlay;
  private timer: number;
  private nativeStyle = document.createElement('style');
  readonly video: HTMLVideoElement;
  status: PlayerStatus = { enabled: false, phase: 'idle', message: '翻訳を開始すると、この動画の字幕を送信します。', total: 0, translated: 0 };

  constructor(readonly videoId: string, readonly player: HTMLElement) {
    this.video = player.querySelector('video')!;
    this.overlay = new SubtitleOverlay(player, () => this.status.enabled ? this.stop() : void this.start(), () => void this.start(), () => void browser.runtime.sendMessage({ type: 'kotonoha:open-options' }));
    this.nativeStyle.textContent = '#movie_player[data-kotonoha-active] .ytp-caption-window-container { visibility:hidden !important; }';
    document.head.append(this.nativeStyle);
    this.video.addEventListener('seeking', this.onSeeking);
    this.video.addEventListener('timeupdate', this.tick);
    this.timer = window.setInterval(this.tick, 350);
    this.overlay.setStatus(this.status);
  }

  private onSeeking = () => { this.overlay.hide(); this.tick(); };

  private update(update: Partial<PlayerStatus>) {
    this.status = { ...this.status, ...update, total: this.cues.length, translated: this.translations.size };
    this.overlay.setStatus(this.status);
  }

  async start() {
    this.stop();
    const generation = this.generation;
    this.update({ enabled: true, phase: 'loading', message: '字幕を準備しています…' });
    try {
      const response = await browser.runtime.sendMessage({ type: 'kotonoha:get-settings' }) as Result<PublicSettings>;
      if (generation !== this.generation) return;
      if (!response.ok) throw new Error(response.message);
      this.settings = response.value.settings;
      this.overlay.configure(this.settings);
      if (!response.value.hasApiKey) throw new Error('「設定」でAPIキーを登録してから、翻訳を開始してください。');
      this.sourceAbort = new AbortController();
      const source = await youtubeCaptionSource.load(this.videoId, this.settings.sourceLang, this.sourceAbort.signal);
      if (generation !== this.generation) return;
      this.cues = groupCues(source.cues, 220, 9);
      if (!this.cues.length) throw new Error('時刻付きの字幕が見つかりませんでした。');
      this.player.dataset.kotonohaActive = 'true';
      this.update({ phase: 'ready', message: '字幕を先読みしています。' });
      this.tick();
    } catch (error) {
      if (generation !== this.generation) return;
      delete this.player.dataset.kotonohaActive;
      this.update({ phase: 'error', message: error instanceof Error ? error.message : '字幕を準備できませんでした。' });
    }
  }

  stop() {
    this.generation++;
    this.sourceAbort?.abort();
    this.cues = []; this.translations.clear();
    this.inFlight = false; this.retryAt = 0; this.networkFailures = 0;
    delete this.player.dataset.kotonohaActive;
    this.overlay.hide();
    this.update({ enabled: false, phase: 'idle', message: '' });
  }

  private tick = () => {
    if (!this.status.enabled || !this.cues.length || this.status.phase === 'error') return;
    if (this.player.classList.contains('ad-showing') || this.video.ended) { this.overlay.hide(); return; }
    const cue = activeCue(this.cues, this.video.currentTime);
    if (cue) this.overlay.show(cue.text, this.translations.get(cue.id) ?? '', this.settings);
    else this.overlay.hide();
    if (!this.inFlight && Date.now() >= this.retryAt) void this.pump();
  };

  private async pump() {
    const cue = upcomingCues(this.cues, this.video.currentTime, this.settings.lookaheadSeconds).find(item => !this.translations.has(item.id));
    if (!cue) { this.update({ phase: 'ready', message: '再生位置の字幕を翻訳済みです。' }); return; }
    this.inFlight = true;
    const generation = this.generation;
    try {
      const result = await browser.runtime.sendMessage({ type: 'kotonoha:translate', text: cue.text, settingsSignature: JSON.stringify(this.settings) }) as Result<string>;
      if (generation !== this.generation) return;
      if (result.ok) {
        this.translations.set(cue.id, result.value);
        this.networkFailures = 0;
        this.update({ phase: 'ready', message: '字幕を先読みしています。' });
      } else if (result.retryAfterMs && (result.code === 'RATE_LIMIT' || result.code === 'NETWORK')) {
        if (result.code === 'NETWORK') this.networkFailures++;
        if (this.networkFailures >= 3) { this.fail('接続に失敗しました。通信状態を確認して「再取得」を押してください。'); return; }
        this.retryAt = Date.now() + result.retryAfterMs;
        const current = activeCue(this.cues, this.video.currentTime);
        this.update({ phase: current && !this.translations.has(current.id) ? 'waiting' : 'ready', message: result.code === 'RATE_LIMIT' ? '翻訳を準備しています。送信間隔を調整して自動で続行します。' : result.message });
      } else this.fail(result.message);
    } catch {
      if (generation === this.generation) this.fail('拡張機能との接続が切れました。動画ページを再読み込みしてください。');
    } finally {
      if (generation === this.generation) this.inFlight = false;
    }
  }

  private fail(message: string) {
    delete this.player.dataset.kotonohaActive;
    this.overlay.hide();
    this.update({ phase: 'error', message });
  }

  destroy() {
    this.stop(); clearInterval(this.timer);
    this.video.removeEventListener('seeking', this.onSeeking);
    this.video.removeEventListener('timeupdate', this.tick);
    this.overlay.remove(); this.nativeStyle.remove();
  }
}
