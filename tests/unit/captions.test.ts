import { describe, expect, it } from 'vitest';
import { activeCue, groupCues, normalizeCues, parseJson3, parseTimedTextXml, parseTimestamp, upcomingCues } from '../../src/core/captions';

describe('caption inputs and playback', () => {
  it('parses timestamped JSON3 and ignores window events', () => {
    expect(parseJson3({ events: [{ tStartMs: 0 }, { tStartMs: 1200, dDurationMs: 2200, segs: [{ utf8: 'Hello ' }, { utf8: 'world.' }] }] })).toEqual([{ id: 'cue-0', start: 1.2, end: 3.4, text: 'Hello world.' }]);
  });
  it('decodes XML without turning subtitle markup into HTML', () => {
    expect(parseTimedTextXml('<transcript><text start="1" dur="2">A &amp; B &lt;img&gt;</text></transcript>')[0]?.text).toBe('A & B <img>');
    expect(parseTimedTextXml('<timedtext><body><p t="1000" d="2000"><s>Hello</s> world</p></body></timedtext>')[0]).toMatchObject({ start: 1, end: 3, text: 'Hello world' });
  });
  it('drops invalid and empty cues', () => {
    expect(normalizeCues([{ id: 'a', start: -1, end: 3, text: 'negative' }, { id: 'b', start: 0, end: 0, text: 'empty duration' }, { id: 'c', start: 0, end: 3, text: '  ' }])).toEqual([]);
  });
  it('removes rolling-caption repetition but preserves later repeated speech', () => {
    expect(normalizeCues([
      { id: 'a', start: 0, end: 3, text: 'Welcome to this talk' },
      { id: 'b', start: 2, end: 5, text: 'this talk about space.' },
      { id: 'c', start: 7, end: 9, text: 'about space.' },
    ]).map(c => c.text)).toEqual(['Welcome to this talk', 'about space.', 'about space.']);
  });
  it('joins broken sentences while preserving the full time interval', () => {
    const cues = groupCues([{ id: 'a', start: 0, end: 2, text: 'This is' }, { id: 'b', start: 2, end: 4, text: 'one sentence.' }, { id: 'c', start: 4, end: 7, text: 'Next sentence.' }]);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 0, end: 4, text: 'This is one sentence.' });
    expect(activeCue(cues, 3)?.text).toBe('This is one sentence.');
    expect(activeCue(cues, 4)?.text).toBe('Next sentence.');
    expect(activeCue(cues, 7)).toBeUndefined();
    expect(activeCue(cues, -1)).toBeUndefined();
  });
  it('prioritizes a new playback position and does not stretch text across silence', () => {
    const cues = groupCues([{ id: 'a', start: 0, end: 2, text: 'First' }, { id: 'b', start: 20, end: 24, text: 'Later' }]);
    expect(cues).toHaveLength(2);
    expect(activeCue(cues, 8)).toBeUndefined();
    expect(upcomingCues(cues, 22, 30).map(c => c.text)).toEqual(['Later']);
  });
  it('recognizes hours and rejects impossible seconds', () => {
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('2:07')).toBe(127);
    expect(parseTimestamp('2:90')).toBeNull();
    expect(parseTimestamp('hello')).toBeNull();
  });
});
