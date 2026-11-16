import type { Cue } from './types';

export function cleanText(text: string): string {
  return text.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

export function parseTimestamp(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+(?:\.\d+)?$/.test(p))) return null;
  if (parts.slice(1).some(p => Number(p) >= 60)) return null;
  return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
}

export function normalizeCues(input: Cue[]): Cue[] {
  const sorted = input.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start && cleanText(c.text))
    .map(c => ({ ...c, text: cleanText(c.text) })).sort((a, b) => a.start - b.start);
  const output: Cue[] = [];
  for (const cue of sorted) {
    const previous = output.at(-1);
    if (previous && cue.start < previous.end && previous.text === cue.text) {
      previous.end = Math.max(previous.end, cue.end);
      continue;
    }
    // Automatic captions can repeat the end of the preceding on-screen line.
    if (previous && cue.start < previous.end) {
      const before = previous.text.split(' ');
      const next = cue.text.split(' ');
      for (let size = Math.min(before.length, next.length); size >= 2; size--) {
        if (before.slice(-size).join(' ') === next.slice(0, size).join(' ')) {
          cue.text = next.slice(size).join(' ');
          if (!cue.text) previous.end = Math.max(previous.end, cue.end);
          break;
        }
      }
    }
    if (cue.text) output.push({ ...cue, id: `cue-${output.length}` });
  }
  return output;
}

export function parseJson3(data: unknown): Cue[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { events?: unknown }).events)) return [];
  const events = (data as { events: Array<{ tStartMs?: unknown; dDurationMs?: unknown; segs?: Array<{ utf8?: unknown }> }> }).events;
  return normalizeCues(events.flatMap((event, index) => {
    if (typeof event.tStartMs !== 'number' || !Array.isArray(event.segs)) return [];
    const text = event.segs.map(s => typeof s.utf8 === 'string' ? s.utf8 : '').join('');
    const start = event.tStartMs / 1000;
    const nextStart = events[index + 1]?.tStartMs;
    const end = typeof event.dDurationMs === 'number' ? (event.tStartMs + event.dDurationMs) / 1000 : typeof nextStart === 'number' ? nextStart / 1000 : start + 4;
    return [{ id: String(index), start, end, text }];
  }));
}

export function parseTimedTextXml(xml: string): Cue[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return [];
  return normalizeCues([...document.querySelectorAll('text[start], p[t]')].map((element, index) => {
    const isMs = element.tagName === 'p';
    const start = Number(element.getAttribute(isMs ? 't' : 'start')) / (isMs ? 1000 : 1);
    const duration = Number(element.getAttribute(isMs ? 'd' : 'dur')) / (isMs ? 1000 : 1);
    return { id: String(index), start, end: start + (duration > 0 ? duration : 4), text: element.textContent ?? '' };
  }));
}

export function groupCues(input: Cue[], maxCharacters = 350, maxSeconds = 12): Cue[] {
  const groups: Cue[] = [];
  const sized = normalizeCues(input).flatMap(cue => {
    if (cue.text.length <= maxCharacters) return [cue];
    const pieces: string[] = [];
    let remaining = cue.text;
    while (remaining.length > maxCharacters) {
      const space = remaining.lastIndexOf(' ', maxCharacters);
      const boundary = space > maxCharacters / 2 ? space : maxCharacters;
      pieces.push(remaining.slice(0, boundary).trim());
      remaining = remaining.slice(boundary).trim();
    }
    if (remaining) pieces.push(remaining);
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    let consumed = 0;
    return pieces.map(text => {
      const start = cue.start + (cue.end - cue.start) * consumed / total;
      consumed += text.length;
      return { ...cue, start, end: cue.start + (cue.end - cue.start) * consumed / total, text };
    });
  });
  for (const cue of sized) {
    const previous = groups.at(-1);
    const endsSentence = previous && /[.!?。！？]["'”’)]?$/.test(previous.text);
    const canJoin = previous && cue.start - previous.end <= 1.2 && cue.end - previous.start <= maxSeconds && previous.text.length + cue.text.length + 1 <= maxCharacters && (!endsSentence || previous.end - previous.start < 2);
    if (canJoin) {
      previous.text += ` ${cue.text}`;
      previous.end = Math.max(previous.end, cue.end);
    } else groups.push({ ...cue, id: `segment-${groups.length}` });
  }
  // Avoid a translated paragraph overlapping the next one on screen.
  for (let i = 0; i < groups.length - 1; i++) groups[i]!.end = Math.min(groups[i]!.end, groups[i + 1]!.start);
  return groups.filter(c => c.end > c.start);
}

export function activeCue(cues: Cue[], time: number): Cue | undefined {
  let low = 0, high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (cues[mid]!.start <= time) low = mid + 1;
    else high = mid - 1;
  }
  const cue = cues[high];
  return cue && time < cue.end ? cue : undefined;
}

export function upcomingCues(cues: Cue[], time: number, lookahead: number): Cue[] {
  return cues.filter(cue => cue.end > time && cue.start <= time + lookahead);
}
