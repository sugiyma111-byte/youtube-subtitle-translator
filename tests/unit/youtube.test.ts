import { describe, expect, it } from 'vitest';
import { allowedCaptionUrl } from '../../src/youtube/bridge';
import { readTranscript, transcriptLanguageMatches } from '../../src/youtube/transcript';
import { groupCues } from '../../src/core/captions';
import { findPanelParams, parseTranscriptPanel } from '../../src/youtube/panel';

describe('YouTube acquisition boundaries', () => {
  it('uses only a current-video descriptor supplied by YouTube', () => {
    const params = btoa('prefix-aaaaaaaaaaa-suffix');
    const data = { nested: { updateEngagementPanelContentCommand: { contentSourcePanelIdentifier: { tag: 'PAmodern_transcript_view' }, globalConfiguration: { params } } } };
    expect(findPanelParams(data, 'aaaaaaaaaaa')).toBe(params);
    expect(findPanelParams(data, 'bbbbbbbbbbb')).toBeUndefined();
  });
  it('reads transcript panel text with exact end times and rejects another video', () => {
    const data = { contents: [{ macroMarkersPanelItemViewModel: {
      onTap: { innertubeCommand: { watchEndpoint: { videoId: 'aaaaaaaaaaa', startTimeSeconds: 12 } } },
      item: { timelineItemViewModel: { contentItems: [{ transcriptSegmentViewModel: { simpleText: 'A synthetic example.' } }] } },
    } }], frameworkUpdates: { timedSyncDataList: [{ videoTimeMs: '12000', endTimeMs: '19399' }] } };
    expect(parseTranscriptPanel(data, 'aaaaaaaaaaa')[0]).toMatchObject({ start: 12, end: 19.399, text: 'A synthetic example.' });
    expect(parseTranscriptPanel(data, 'bbbbbbbbbbb')).toEqual([]);
  });
  it('only fetches original captions for the current video and requested language', () => {
    const base = 'https://www.youtube.com/api/timedtext?v=aaaaaaaaaaa&lang=en';
    expect(allowedCaptionUrl(base, 'aaaaaaaaaaa', 'en')).toBeInstanceOf(URL);
    expect(allowedCaptionUrl(base + '&tlang=ja', 'aaaaaaaaaaa', 'en')).toBeUndefined();
    expect(allowedCaptionUrl(base, 'bbbbbbbbbbb', 'en')).toBeUndefined();
    expect(allowedCaptionUrl(base, 'aaaaaaaaaaa', 'de')).toBeUndefined();
    expect(allowedCaptionUrl(base.replace('www.youtube.com', 'attacker.test'), 'aaaaaaaaaaa', 'en')).toBeUndefined();
  });
  it('reads the observed current transcript layout without including accessibility timestamps', () => {
    document.body.innerHTML = '<transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">0:12</div><div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">12 seconds</div><span role="text">An example sentence.</span></transcript-segment-view-model><transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">0:32</div><span role="text">A second sentence.</span></transcript-segment-view-model>';
    const cues = readTranscript(document, 40);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 12, end: 32, text: 'An example sentence.' });
    expect(transcriptLanguageMatches(document, 'en')).toBeUndefined();
  });
  it('refuses a known mismatched transcript language', () => {
    document.body.innerHTML = '<ytd-transcript-footer-renderer>日本語</ytd-transcript-footer-renderer>';
    expect(transcriptLanguageMatches(document, 'en')).toBe(false);
    expect(transcriptLanguageMatches(document, 'ja')).toBe(true);
  });
  it('splits long transcript paragraphs without losing text or time coverage', () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const cues = groupCues([{ id: 'paragraph', start: 12, end: 42, text }], 220);
    expect(cues.map(c => c.text).join(' ')).toBe(text);
    expect(cues[0]?.start).toBe(12);
    expect(cues.at(-1)?.end).toBe(42);
    expect(cues.every(c => c.text.length <= 220)).toBe(true);
  });
});
