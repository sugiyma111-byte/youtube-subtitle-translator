export const BRIDGE_CHANNEL = 'kotonoha-captions-v1';
export interface CaptionTrack { baseUrl: string; languageCode: string; kind?: string }
export interface PlayerResponse {
  videoDetails?: { videoId?: string; isLive?: boolean };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}
export interface YouTubePlayer extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse;
  getOption?: (module: string, option: string) => { languageCode?: string } | undefined;
}
export interface BridgeResult {
  videoId: string;
  body?: string;
  format?: 'timedtext' | 'panel';
  language?: string;
  availableLanguages?: string[];
  selectedLanguage?: string;
  error?: string;
}

export function allowedCaptionUrl(value: string, videoId: string, language: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' || url.pathname !== '/api/timedtext' || url.username || url.password) return;
    if (url.searchParams.get('v') !== videoId || url.searchParams.has('tlang')) return;
    const lang = url.searchParams.get('lang');
    if (!lang || lang.toLowerCase().split('-')[0] !== language.toLowerCase().split('-')[0]) return;
    return url;
  } catch { return; }
}

export async function loadPlayerCaptions(videoId: string, language: string): Promise<BridgeResult> {
  const player = document.querySelector<YouTubePlayer>('#movie_player');
  const initial = (window as unknown as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  const current = player?.getPlayerResponse?.();
  const response = current?.videoDetails?.videoId === videoId ? current : initial?.videoDetails?.videoId === videoId ? initial : undefined;
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const metadata: BridgeResult = {
    videoId,
    availableLanguages: [...new Set(tracks.map(t => t.languageCode))],
    selectedLanguage: player?.getOption?.('captions', 'track')?.languageCode,
  };
  if (!response) return { ...metadata, error: 'not-ready' };
  if (response.videoDetails?.isLive) return { ...metadata, error: 'live' };
  const matching = tracks.filter(t => t.languageCode === language || t.languageCode.split('-')[0] === language.split('-')[0]);
  matching.sort((a, b) => Number(a.kind === 'asr') - Number(b.kind === 'asr'));
  if (!matching.length) return { ...metadata, error: 'no-language' };
  const urls = matching.slice(0, 2).flatMap(track => {
    const url = allowedCaptionUrl(track.baseUrl, videoId, track.languageCode);
    if (!url) return [];
    url.searchParams.set('fmt', 'json3');
    return [{ url, language: track.languageCode }];
  });
  // Reuse only URLs the current player already loaded. No token generation or bypass.
  for (const entry of performance.getEntriesByType('resource').slice(-200)) {
    const url = allowedCaptionUrl(entry.name, videoId, language);
    if (url) urls.unshift({ url, language: url.searchParams.get('lang')! });
  }
  for (const candidate of urls.slice(0, 2)) {
    try {
      const result = await fetch(candidate.url, { credentials: 'include', signal: AbortSignal.timeout(5500) });
      if (!result.ok) continue;
      const body = await result.text();
      if (body.trim() && body.length <= 5_000_000) return { ...metadata, body, format: 'timedtext', language: candidate.language };
    } catch { /* Try the independent transcript source when the player URL is unavailable. */ }
  }
  // The current YouTube UI uses get_panel for transcripts. Reuse the public page's
  // descriptor and client context, changing only the requested UI language. This
  // prevents Japanese YouTube pages from supplying Japanese text as English input.
  const globals = window as unknown as { ytInitialData?: unknown; ytcfg?: { get(key: string): unknown } };
  const pageData = (document.querySelector('ytd-watch-flexy') as (HTMLElement & { data?: unknown }) | null)?.data;
  const params = findPanelParams(pageData, videoId) ?? findPanelParams(globals.ytInitialData, videoId);
  const context = globals.ytcfg?.get('INNERTUBE_CONTEXT') as { client?: Record<string, unknown> } | undefined;
  if (params && context?.client) {
    try {
      const result = await fetch('https://www.youtube.com/youtubei/v1/get_panel?prettyPrint=false', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { ...context, client: { ...context.client, hl: language } }, panelId: 'PAmodern_transcript_view', params }),
        signal: AbortSignal.timeout(6500),
      });
      const body = await result.text();
      if (result.ok && body.length <= 5_000_000 && body.includes('transcriptSegmentViewModel')) return { ...metadata, body, format: 'panel', language };
    } catch { /* Fall back to an explicitly identified on-page transcript. */ }
  }
  return { ...metadata, error: 'unavailable' };
}
import { findPanelParams } from './panel';
