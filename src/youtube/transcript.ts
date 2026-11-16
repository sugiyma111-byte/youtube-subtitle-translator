import { cleanText, normalizeCues, parseTimestamp } from '../core/captions';
import type { Cue } from '../core/types';

export function readTranscript(document: Document, duration = Number.POSITIVE_INFINITY): Cue[] {
  const rows = [...document.querySelectorAll('ytd-transcript-segment-renderer, yt-transcript-segment-view-model, transcript-segment-view-model')];
  const candidates = rows.flatMap((row, index) => {
    const timeElement = row.querySelector('.segment-timestamp, .ytTranscriptSegmentViewModelTimestamp, [class*="timestamp" i]');
    const textElement = row.querySelector('.segment-text, .ytTranscriptSegmentViewModelText, [class*="segmentText"], yt-formatted-string, span[role="text"]');
    const start = parseTimestamp(timeElement?.textContent ?? '');
    const text = cleanText(textElement?.textContent ?? '');
    if (start === null || !text) return [];
    return [{ id: `transcript-${index}`, start, end: start + 5, text }];
  });
  for (let i = 0; i < candidates.length; i++) {
    const cue = candidates[i]!;
    cue.end = Math.min(candidates[i + 1]?.start ?? cue.start + 5, duration);
  }
  return normalizeCues(candidates);
}

export function transcriptLanguageMatches(document: Document, language: string): boolean | undefined {
  const footer = document.querySelector('ytd-transcript-footer-renderer, [class*="transcriptLanguage"], [data-transcript-language]');
  // Unknown is not a match: never silently translate a localized transcript as English.
  if (!footer) return undefined;
  const declared = footer.getAttribute('data-transcript-language');
  if (declared) return declared.toLowerCase().split('-')[0] === language.toLowerCase().split('-')[0];
  const label = cleanText(footer.textContent ?? '').toLowerCase();
  const names = ['en', 'ja', document.documentElement.lang || 'en'].flatMap(locale => {
    try { return [new Intl.DisplayNames([locale], { type: 'language' }).of(language)?.toLowerCase() ?? '']; }
    catch { return []; }
  }).filter(Boolean);
  return names.some(name => label.startsWith(name));
}

export function openTranscript(document: Document): boolean {
  const buttons = [...document.querySelectorAll<HTMLElement>('ytd-video-description-transcript-section-renderer button')];
  const button = buttons.find(element => element.getClientRects().length > 0);
  if (button) { button.click(); return true; }
  const expand = [...document.querySelectorAll<HTMLElement>('ytd-watch-metadata #expand, ytd-text-inline-expander #expand')].find(element => element.getClientRects().length > 0);
  expand?.click();
  return false;
}
