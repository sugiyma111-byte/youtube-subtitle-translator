import { BRIDGE_CHANNEL, loadPlayerCaptions } from '../youtube/bridge';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'], world: 'MAIN', runAt: 'document_start',
  main() {
    let busy = false;
    window.addEventListener('message', async event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== BRIDGE_CHANNEL || event.data?.type !== 'request') return;
      const { requestId, videoId, language } = event.data;
      if (busy || typeof requestId !== 'string' || requestId.length > 100 || typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId) || typeof language !== 'string' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) return;
      if (new URL(location.href).searchParams.get('v') !== videoId) return;
      busy = true;
      try {
        const result = await loadPlayerCaptions(videoId, language);
        window.postMessage({ channel: BRIDGE_CHANNEL, type: 'response', requestId, result }, location.origin);
      } catch {
        window.postMessage({ channel: BRIDGE_CHANNEL, type: 'response', requestId, result: { videoId, error: 'unavailable' } }, location.origin);
      } finally { busy = false; }
    });
  },
});
