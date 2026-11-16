import { browser } from 'wxt/browser';
import { VideoController } from '../youtube/controller';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'], runAt: 'document_idle',
  main(ctx) {
    let controller: VideoController | undefined;
    const mount = () => {
      const url = new URL(location.href);
      const videoId = url.pathname === '/watch' ? url.searchParams.get('v') : null;
      const player = document.querySelector<HTMLElement>('#movie_player');
      const video = player?.querySelector('video');
      if (controller && (controller.videoId !== videoId || controller.player !== player || controller.video !== video || !controller.player.isConnected)) { controller.destroy(); controller = undefined; }
      if (!controller && videoId && /^[\w-]{11}$/.test(videoId) && player && video) controller = new VideoController(videoId, player);
    };
    const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, _sender, sendResponse) => {
      if (message?.type === 'kotonoha:player-status') { sendResponse(controller?.status ?? null); return; }
      if (message?.type === 'kotonoha:toggle') {
        if (controller) { if (controller.status.enabled) controller.stop(); else void controller.start(); }
        sendResponse(controller?.status ?? null); return;
      }
      if (message?.type === 'kotonoha:retry') { if (controller) void controller.start(); sendResponse(controller?.status ?? null); return; }
      if (message?.type === 'kotonoha:settings-changed' && controller?.status.enabled) void controller.start();
    };
    browser.runtime.onMessage.addListener(listener);
    ctx.addEventListener(document, 'yt-navigate-start', () => { controller?.destroy(); controller = undefined; });
    ctx.addEventListener(document, 'yt-navigate-finish', mount);
    ctx.addEventListener(window, 'popstate', mount);
    ctx.setInterval(mount, 1000);
    ctx.onInvalidated(() => { controller?.destroy(); browser.runtime.onMessage.removeListener(listener); });
    mount();
  },
});
