export interface RateState { timestamps: number[]; blockedUntil: number }
export const EMPTY_RATE: RateState = { timestamps: [], blockedUntil: 0 };

export function reserveRequest(state: RateState, now: number, requestsPerMinute: number): { state: RateState; waitMs: number } {
  const limit = Math.max(1, Math.floor(requestsPerMinute));
  const timestamps = state.timestamps.filter(time => time > now - 60000 && time <= now);
  const last = timestamps.at(-1);
  const spacing = Math.ceil(60000 / limit) + 100;
  const availableAt = Math.max(state.blockedUntil, last === undefined ? 0 : last + spacing, timestamps.length >= limit ? timestamps[0]! + 60001 : 0);
  if (availableAt > now) return { state: { timestamps, blockedUntil: state.blockedUntil }, waitMs: availableAt - now };
  return { state: { timestamps: [...timestamps, now], blockedUntil: 0 }, waitMs: 0 };
}
