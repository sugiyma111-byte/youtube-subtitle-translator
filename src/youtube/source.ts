import { parseJson3, parseTimedTextXml } from '../core/captions';
import type { Cue } from '../core/types';
import { MessageError } from '../i18n';
import { BRIDGE_CHANNEL, type BridgeResult } from './bridge';
import { openTranscript, readTranscript, transcriptLanguageMatches } from './transcript';
import { parseTranscriptPanel } from './panel';

export interface CaptionSourceResult { cues: Cue[]; kind: 'player' | 'transcript'; language: string }
export interface CaptionSource { load(videoId: string, language: string, signal: AbortSignal): Promise<CaptionSourceResult> }

function bridgeRequest(videoId: string, language: string, signal: AbortSignal): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', onMessage); signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== BRIDGE_CHANNEL || event.data?.type !== 'response' || event.data?.requestId !== requestId || event.data?.result?.videoId !== videoId) return;
      cleanup(); resolve(event.data.result as BridgeResult);
    };
    const timeout = window.setTimeout(() => { cleanup(); resolve({ videoId, error: 'timeout' }); }, 24000);
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('message', onMessage);
    window.postMessage({ channel: BRIDGE_CHANNEL, type: 'request', requestId, videoId, language }, location.origin);
  });
}

export const youtubeCaptionSource: CaptionSource = {
  async load(videoId, language, signal) {
    const result = await bridgeRequest(videoId, language, signal);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (typeof result.body === 'string' && result.body.length <= 5_000_000) {
      let cues: Cue[] = [];
      try { cues = result.format === 'panel' ? parseTranscriptPanel(JSON.parse(result.body), videoId) : parseJson3(JSON.parse(result.body)); } catch { cues = parseTimedTextXml(result.body); }
      if (cues.length) return { cues, kind: 'player', language: result.language ?? language };
    }
    if (result.error === 'live') throw new MessageError('error.live');
    if (result.error === 'no-language') throw new MessageError('error.noLanguage', { language });
    openTranscript(document);
    let didOpen = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (!didOpen) didOpen = openTranscript(document);
      const video = document.querySelector<HTMLVideoElement>('#movie_player video');
      const cues = readTranscript(document, video?.duration || Number.POSITIVE_INFINITY);
      const matches = transcriptLanguageMatches(document, language);
      if (cues.length && matches === true) return { cues, kind: 'transcript', language };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new MessageError('error.captions', { language });
  },
};
