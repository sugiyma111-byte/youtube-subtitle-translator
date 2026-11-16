import { normalizeCues } from '../core/captions';
import type { Cue } from '../core/types';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined; }
function visit(root: unknown, callback: (value: RecordValue) => void) {
  const stack: unknown[] = [root];
  const seen = new Set<object>();
  let count = 0;
  while (stack.length && count++ < 60000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (!Array.isArray(value)) callback(value as RecordValue);
    stack.push(...Object.values(value).reverse());
  }
}

export function findPanelParams(root: unknown, videoId: string): string | undefined {
  let result: string | undefined;
  visit(root, value => {
    const command = record(value.updateEngagementPanelContentCommand);
    if (record(command?.contentSourcePanelIdentifier)?.tag !== 'PAmodern_transcript_view') return;
    const params = record(command?.globalConfiguration)?.params;
    if (typeof params !== 'string' || params.length > 4096) return;
    try {
      const decoded = atob(decodeURIComponent(params).replace(/-/g, '+').replace(/_/g, '/'));
      // Use the site's own descriptor, and reject stale parameters after SPA navigation.
      if (decoded.includes(videoId)) result = params;
    } catch { /* Unsupported descriptor encoding. */ }
  });
  return result;
}

export function parseTranscriptPanel(data: unknown, videoId: string): Cue[] {
  const ends = new Map<number, number>();
  const cues: Cue[] = [];
  visit(data, value => {
    if (value.videoTimeMs !== undefined && value.endTimeMs !== undefined) {
      const start = Number(value.videoTimeMs) / 1000;
      const end = Number(value.endTimeMs) / 1000;
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) ends.set(start, end);
    }
    const item = record(value.macroMarkersPanelItemViewModel);
    if (!item) return;
    const endpoint = record(record(record(item.onTap)?.innertubeCommand)?.watchEndpoint);
    if (endpoint?.videoId !== videoId || typeof endpoint.startTimeSeconds !== 'number') return;
    const timeline = record(record(item.item)?.timelineItemViewModel);
    if (!Array.isArray(timeline?.contentItems)) return;
    const text = timeline.contentItems.map(content => record(record(content)?.transcriptSegmentViewModel)?.simpleText).filter(t => typeof t === 'string').join(' ');
    if (text) cues.push({ id: `panel-${cues.length}`, start: endpoint.startTimeSeconds, end: endpoint.startTimeSeconds + 5, text });
  });
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) cues[i]!.end = ends.get(cues[i]!.start) ?? cues[i + 1]?.start ?? cues[i]!.end;
  return normalizeCues(cues);
}
