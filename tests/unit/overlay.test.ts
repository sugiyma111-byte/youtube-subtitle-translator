import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubtitleOverlay } from '../../src/ui/overlay';
import type { PlayerStatus } from '../../src/core/types';

describe('overlay visibility and lifecycle', () => {
  let player: HTMLElement;
  let overlay: SubtitleOverlay;
  const disconnected = vi.fn();
  const idle: PlayerStatus = { enabled: false, phase: 'idle', messageKey: null, translated: 0, total: 0 };
  const dock = () => overlay.host.shadowRoot!.querySelector<HTMLElement>('.dock')!;
  beforeEach(() => {
    vi.useFakeTimers();
    disconnected.mockClear();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() { disconnected(); } });
    player = document.createElement('div');
    document.body.append(player);
    overlay = new SubtitleOverlay(player, vi.fn(), vi.fn(), vi.fn());
    overlay.setStatus(idle);
  });
  afterEach(() => { overlay.remove(); player.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('uses three seconds of pointer inactivity until the native auto-hide class is observed', async () => {
    await vi.advanceTimersByTimeAsync(2999);
    expect(dock().dataset.visible).toBe('true');
    await vi.advanceTimersByTimeAsync(1);
    expect(dock().dataset.visible).toBe('false');
    player.dispatchEvent(new Event('pointermove'));
    expect(dock().dataset.visible).toBe('true');
    player.classList.add('ytp-autohide');
    await Promise.resolve();
    expect(overlay.host.dataset.autohide).toBe('player');
    expect(dock().dataset.visible).toBe('false');
    player.classList.remove('ytp-autohide');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(dock().dataset.visible).toBe('true');
    expect(overlay.host.dataset.controls).toBe('shown');
  });

  it('keeps preparing, waiting and error states visible without pretending native controls are shown', async () => {
    player.classList.add('ytp-autohide');
    await Promise.resolve();
    for (const state of [
      { phase: 'loading', messageKey: 'status.loading' },
      { phase: 'waiting', messageKey: 'status.waiting' },
      { phase: 'error', messageKey: 'error.noTimedCaptions' },
      { phase: 'error', messageKey: 'error.startWithoutKey' },
    ] as const) {
      overlay.setStatus({ ...idle, ...state, enabled: true });
      expect(dock().dataset.visible).toBe('true');
      expect(overlay.host.dataset.controls).toBe('hidden');
      expect(overlay.host.shadowRoot!.querySelector<HTMLElement>('.status')!.hidden).toBe(false);
    }
    overlay.setStatus({ ...idle, enabled: true, phase: 'ready', messageKey: 'status.translated' });
    expect(dock().dataset.visible).toBe('false');
  });

  it('disconnects observers, listeners and timers when the video is replaced', async () => {
    overlay.remove();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    player.dispatchEvent(new Event('pointermove'));
    player.classList.add('ytp-autohide');
    await vi.advanceTimersByTimeAsync(5000);
    expect(overlay.host.isConnected).toBe(false);
    expect(overlay.host.dataset.autohide).toBe('fallback');
    expect(vi.getTimerCount()).toBe(0);
  });
});
