import { describe, expect, it } from 'vitest';
import { EMPTY_RATE, reserveRequest } from '../../src/core/rate-limit';
import { isOptionsPage, isYouTubePage } from '../../src/core/security';

describe('shared request scheduling', () => {
  it('prevents bursts from multiple tabs', () => {
    const first = reserveRequest(EMPTY_RATE, 100000, 30);
    expect(first.waitMs).toBe(0);
    const second = reserveRequest(first.state, 100000, 30);
    expect(second.waitMs).toBe(2100);
    expect(second.state.timestamps).toHaveLength(1);
  });
  it('preserves a server cooldown and resumes after expiry', () => {
    const state = { timestamps: [100000], blockedUntil: 160000 };
    expect(reserveRequest(state, 102000, 30).waitMs).toBe(58000);
    expect(reserveRequest(state, 160001, 30).waitMs).toBe(0);
  });
  it('never exceeds a provider limit within any rolling minute', () => {
    let state = EMPTY_RATE;
    const times: number[] = [];
    for (let time = 100000; time < 280000; time += 100) {
      const result = reserveRequest(state, time, 30);
      state = result.state;
      if (!result.waitMs) times.push(time);
    }
    for (const now of times) expect(times.filter(time => time > now - 60000 && time <= now).length).toBeLessThanOrEqual(30);
  });
});

describe('trusted message senders', () => {
  it('requires the exact YouTube origin', () => {
    expect(isYouTubePage('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTubePage('https://www.youtube.com.attacker.test/')).toBe(false);
    expect(isYouTubePage('https://attacker.test/?www.youtube.com')).toBe(false);
  });
  it('only permits the extension options page to modify credentials', () => {
    expect(isOptionsPage('chrome-extension://abc/options.html', 'chrome-extension://abc/')).toBe(true);
    expect(isOptionsPage('chrome-extension://abc/popup.html', 'chrome-extension://abc/')).toBe(false);
    expect(isOptionsPage('chrome-extension://other/options.html', 'chrome-extension://abc/')).toBe(false);
  });
});
